import type { HunkStatus, HunkWithState } from "../types.js";
import type { SessionHunk, SessionModel } from "./queue.js";

export function preserveNearestSelection(
  previous: SessionHunk[],
  selectedId: string | undefined,
  available: ReadonlySet<string>
): string | undefined {
  if (selectedId && available.has(selectedId)) {
    return selectedId;
  }
  const index = selectedId ? previous.findIndex((hunk) => hunk.id === selectedId) : -1;
  const after = previous.slice(index + 1).find((hunk) => available.has(hunk.id));
  if (after) {
    return after.id;
  }
  return [...previous.slice(0, Math.max(0, index))].reverse().find((hunk) => available.has(hunk.id))?.id;
}

export function nextUnreviewedAfter(hunks: SessionHunk[], currentId: string): string | undefined {
  const index = Math.max(0, hunks.findIndex((hunk) => hunk.id === currentId));
  const ordered = [...hunks.slice(index + 1), ...hunks.slice(0, index + 1)];
  return ordered.find((hunk) => hunk.status === "unreviewed")?.id ?? hunks[index]?.id;
}

export function nextAttentionUnreviewed(
  hunks: SessionHunk[],
  selectedId: string | undefined,
  delta: 1 | -1
): string | undefined {
  if (hunks.length === 0) {
    return undefined;
  }
  const currentIndex = Math.max(0, hunks.findIndex((hunk) => hunk.id === selectedId));
  const forward = [...hunks.slice(currentIndex + 1), ...hunks.slice(0, currentIndex + 1)];
  const backward = [...hunks.slice(0, currentIndex).reverse(), ...hunks.slice(currentIndex).reverse()];
  const ordered = delta > 0 ? forward : backward;
  return ordered.find(isUnreviewedAttentionHunk)?.id ?? selectedId;
}

export function relativeHunkId(allIds: string[], selectedId: string | undefined, delta: number): string | undefined {
  if (allIds.length === 0) {
    return undefined;
  }
  const index = Math.max(0, allIds.findIndex((id) => id === selectedId));
  const next = Math.min(allIds.length - 1, Math.max(0, index + delta));
  return allIds[next];
}

export function nextFileHunkId(hunks: SessionHunk[], selectedId: string | undefined, delta: number): string | undefined {
  const current = hunks.find((hunk) => hunk.id === selectedId);
  if (!current) {
    return relativeHunkId(
      hunks.map((hunk) => hunk.id),
      selectedId,
      delta
    );
  }
  const index = hunks.findIndex((hunk) => hunk.id === current.id);
  const scan = delta > 0 ? hunks.slice(index + 1) : hunks.slice(0, index).reverse();
  return scan.find((hunk) => hunk.file !== current.file)?.id ?? current.id;
}

export function applyHunkStatus(
  model: SessionModel,
  id: string,
  status: HunkStatus,
  note?: string,
  reviewedAt = new Date().toISOString()
): SessionModel {
  return {
    ...model,
    hunks: model.hunks.map((hunk) =>
      hunk.id === id ? { ...hunk, status, note: note ?? hunk.note, reviewedAt } : hunk
    )
  };
}

export function omitFresh(freshIds: Record<string, true>, id: string): Record<string, true> {
  if (!freshIds[id]) {
    return freshIds;
  }
  const remaining = { ...freshIds };
  delete remaining[id];
  return remaining;
}

export function mergeFreshIds(
  existing: Record<string, true>,
  addedIds: string[],
  available: ReadonlySet<string>
): Record<string, true> {
  return Object.fromEntries(
    [...Object.keys(existing), ...addedIds]
      .filter((id, index, ids) => available.has(id) && ids.indexOf(id) === index)
      .map((id) => [id, true] as const)
  );
}

export function hydrateFreshIds(
  hunks: Array<Pick<HunkWithState, "id" | "firstSeenAt">>,
  existing: Record<string, true>,
  sessionStartedAt: string,
  visitedIds: ReadonlySet<string>
): Record<string, true> {
  return Object.fromEntries(
    hunks
      .filter(
        (hunk) =>
          existing[hunk.id] ||
          (Boolean(hunk.firstSeenAt && hunk.firstSeenAt >= sessionStartedAt) && !visitedIds.has(hunk.id))
      )
      .map((hunk) => [hunk.id, true] as const)
  );
}

function isUnreviewedAttentionHunk(hunk: SessionHunk): boolean {
  return hunk.status === "unreviewed" && (hunk.band === "high" || hunk.band === "medium");
}
