import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  HunkStatus,
  ReviewModel,
  ReviewModelWithState,
  ReviewStateFile,
  StoredHunkState
} from "./types.js";
import { reviewStateFileSchema } from "./types.js";

export interface StateReadResult {
  state: ReviewStateFile;
  warning?: string;
}

export function siftDir(repoRoot: string): string {
  return path.join(repoRoot, ".sift");
}

export function statePath(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "state.json");
}

export function historyPath(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "history.jsonl");
}

export function emptyState(): ReviewStateFile {
  return { version: 1, updatedAt: new Date().toISOString(), hunks: {} };
}

export async function ensureSiftDir(repoRoot: string): Promise<void> {
  const dir = siftDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ".gitignore"), "*\n", "utf8");
}

export async function readReviewState(repoRoot: string): Promise<StateReadResult> {
  const file = statePath(repoRoot);
  try {
    const raw = await fs.readFile(file, "utf8");
    return { state: reviewStateFileSchema.parse(JSON.parse(raw)) };
  } catch (error) {
    if (isMissingFile(error)) {
      return { state: emptyState() };
    }
    await ensureSiftDir(repoRoot);
    const backup = `${file}.corrupt-${Date.now()}`;
    await fs.rename(file, backup).catch(() => undefined);
    return {
      state: emptyState(),
      warning: `Review state was corrupt and was backed up to ${path.basename(backup)}.`
    };
  }
}

export async function writeReviewState(repoRoot: string, state: ReviewStateFile): Promise<void> {
  await ensureSiftDir(repoRoot);
  const file = statePath(repoRoot);
  const temp = `${file}.tmp`;
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

export async function updateHunkStatus(
  repoRoot: string,
  hunkId: string,
  status: HunkStatus,
  note?: string,
  via: "single" | "group" = "single"
): Promise<StoredHunkState> {
  const { state } = await readReviewState(repoRoot);
  const next: StoredHunkState = status === "unreviewed" ? { status } : { status, note, reviewedAt: new Date().toISOString(), via };
  if (note && status === "unreviewed") {
    next.note = note;
  }
  state.hunks[hunkId] = next;
  state.updatedAt = new Date().toISOString();
  await writeReviewState(repoRoot, state);
  return next;
}

export async function approveGroup(repoRoot: string, model: ReviewModel, groupId: string): Promise<StoredHunkState[]> {
  const group = model.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    throw new Error(`Unknown group: ${groupId}`);
  }
  const hunks = model.hunks.filter((hunk) => group.hunkIds.includes(hunk.id));
  const blocked = hunks.filter((hunk) => hunk.reasons.some((reason) => reason.weight >= 15));
  if (blocked.length > 0) {
    throw new BulkApproveBlockedError(blocked.map((hunk) => hunk.id));
  }
  const { state } = await readReviewState(repoRoot);
  const now = new Date().toISOString();
  const results = hunks.map<StoredHunkState>((hunk) => {
    const stored: StoredHunkState = { status: "approved", reviewedAt: now, via: "group" };
    state.hunks[hunk.id] = stored;
    return stored;
  });
  state.updatedAt = now;
  await writeReviewState(repoRoot, state);
  return results;
}

export class BulkApproveBlockedError extends Error {
  constructor(readonly hunkIds: string[]) {
    super("Group contains hunks with hot risk signals.");
    this.name = "BulkApproveBlockedError";
  }
}

export function mergeReviewState(model: ReviewModel, state: ReviewStateFile): ReviewModelWithState {
  return {
    ...model,
    hunks: model.hunks.map((hunk) => ({
      ...hunk,
      ...(state.hunks[hunk.id] ?? { status: "unreviewed" as const })
    }))
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
