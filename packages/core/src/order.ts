import type { Hunk, HunkGroup } from "./types.js";

export type ReviewSortMode = "risk" | "reading" | "path";

export const REVIEW_SORT_MODES: ReviewSortMode[] = ["risk", "reading", "path"];

export function orderReview(
  hunks: Hunk[],
  groups: HunkGroup[],
  mode: ReviewSortMode = "risk"
): { hunks: Hunk[]; groups: HunkGroup[] } {
  const groupOrder = new Map(groups.map((group) => [group.id, group.order]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const orderedHunks = [...hunks].sort((a, b) => {
    const groupDelta = (groupOrder.get(a.groupId) ?? 999) - (groupOrder.get(b.groupId) ?? 999);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    return compareWithinGroup(a, b, mode, groupById);
  });
  const orderedIds = new Map(orderedHunks.map((hunk, index) => [hunk.id, index]));
  const orderedGroups = [...groups]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      ...group,
      hunkIds: [...group.hunkIds].sort((a, b) => (orderedIds.get(a) ?? 0) - (orderedIds.get(b) ?? 0))
    }));
  return { hunks: orderedHunks, groups: orderedGroups };
}

export function assignReadingRanks(hunks: Hunk[], groups: HunkGroup[]): Hunk[] {
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  const ranked = new Map<string, number>();
  for (const group of groups) {
    if (group.kind !== "attention") {
      continue;
    }
    const groupHunks = hunks.filter((hunk) => hunk.groupId === group.id);
    const ranks = readingRanksForGroup(groupHunks);
    for (const [id, rank] of ranks) {
      ranked.set(id, rank);
    }
  }
  return hunks.map((hunk) => {
    const group = byGroup.get(hunk.groupId);
    const rank = group?.kind === "attention" ? ranked.get(hunk.id) : undefined;
    return rank === undefined ? hunk : { ...hunk, readingRank: rank };
  });
}

function readingRanksForGroup(hunks: Hunk[]): Map<string, number> {
  const definingHunks = new Map<string, Hunk[]>();
  for (const hunk of hunks) {
    for (const name of hunk.defines ?? []) {
      definingHunks.set(name, [...(definingHunks.get(name) ?? []), hunk]);
    }
  }

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map(hunks.map((hunk) => [hunk.id, 0]));
  let edgeCount = 0;
  for (const hunk of hunks) {
    for (const name of hunk.references ?? []) {
      for (const definer of definingHunks.get(name) ?? []) {
        if (definer.id === hunk.id) {
          continue;
        }
        const targets = outgoing.get(definer.id) ?? new Set<string>();
        if (!targets.has(hunk.id)) {
          targets.add(hunk.id);
          outgoing.set(definer.id, targets);
          incoming.set(hunk.id, (incoming.get(hunk.id) ?? 0) + 1);
          edgeCount += 1;
        }
      }
    }
  }

  if (edgeCount === 0) {
    return new Map();
  }

  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const ready = hunks
    .filter((hunk) => incoming.get(hunk.id) === 0)
    .sort(compareRiskThenPath);
  const ordered: Hunk[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) {
      break;
    }
    ordered.push(current);
    for (const target of outgoing.get(current.id) ?? []) {
      const nextIncoming = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0) {
        const next = byId.get(target);
        if (next) {
          ready.push(next);
          ready.sort(compareRiskThenPath);
        }
      }
    }
  }

  if (ordered.length !== hunks.length) {
    return new Map();
  }

  return new Map(ordered.map((hunk, index) => [hunk.id, index]));
}

function compareWithinGroup(
  a: Hunk,
  b: Hunk,
  mode: ReviewSortMode,
  groups: Map<string, HunkGroup>
): number {
  if (mode === "path") {
    return comparePathThenRisk(a, b);
  }
  if (mode === "reading" && groups.get(a.groupId)?.kind === "attention") {
    const aRank = a.readingRank;
    const bRank = b.readingRank;
    if (aRank !== undefined && bRank !== undefined && aRank !== bRank) {
      return aRank - bRank;
    }
  }
  return compareRiskThenPath(a, b);
}

function compareRiskThenPath(a: Hunk, b: Hunk): number {
  if (b.risk !== a.risk) {
    return b.risk - a.risk;
  }
  return comparePathOnly(a, b);
}

function comparePathThenRisk(a: Hunk, b: Hunk): number {
  const pathDelta = comparePathOnly(a, b);
  return pathDelta !== 0 ? pathDelta : b.risk - a.risk;
}

function comparePathOnly(a: Hunk, b: Hunk): number {
  const fileDelta = a.file.localeCompare(b.file);
  if (fileDelta !== 0) {
    return fileDelta;
  }
  return (a.newStart ?? a.oldStart ?? 0) - (b.newStart ?? b.oldStart ?? 0);
}
