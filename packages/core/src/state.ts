import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  HunkStatus,
  ReviewModel,
  ReviewModelWithState,
  ReviewStateFile,
  StoredHunkState
} from "./types.js";
import { reviewStateFileSchema } from "./types.js";
import { appendJournal, createJournalId, makeJournalEntry, type JournalEntry, type JournalKind } from "./journal.js";

export interface StateReadResult {
  state: ReviewStateFile;
  warning?: string;
}

export interface StatusUpdateOptions {
  file?: string;
  via?: "single" | "group" | "undo" | "redo" | "targeted-undo";
  kind?: JournalKind;
  compoundId?: string;
  journal?: boolean;
}

const stateLocks = new Map<string, Promise<void>>();

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
  await withStateLock(repoRoot, () => writeReviewStateAtomic(repoRoot, state));
}

async function writeReviewStateAtomic(repoRoot: string, state: ReviewStateFile): Promise<void> {
  await ensureSiftDir(repoRoot);
  const file = statePath(repoRoot);
  const temp = `${file}.${randomUUID()}.tmp`;
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
  options: StatusUpdateOptions = {}
): Promise<StoredHunkState> {
  return withStateLock(repoRoot, () => updateHunkStatusUnlocked(repoRoot, hunkId, status, note, options));
}

async function updateHunkStatusUnlocked(
  repoRoot: string,
  hunkId: string,
  status: HunkStatus,
  note: string | undefined,
  options: StatusUpdateOptions
): Promise<StoredHunkState> {
  const { state } = await readReviewState(repoRoot);
  const previous = state.hunks[hunkId] ?? { status: "unreviewed" as const };
  const via = options.via ?? "single";
  const next: StoredHunkState = status === "unreviewed" ? { status } : { status, note, reviewedAt: new Date().toISOString(), via };
  if (note && status === "unreviewed") {
    next.note = note;
  }
  state.hunks[hunkId] = next;
  state.updatedAt = new Date().toISOString();
  await writeReviewStateAtomic(repoRoot, state);
  if (options.journal !== false && (previous.status !== next.status || previous.note !== next.note)) {
    await appendJournal(
      repoRoot,
      makeJournalEntry({
        hunkId,
        file: options.file ?? "",
        via,
        note: next.note,
        kind: options.kind ?? "status",
        compoundId: options.compoundId,
        fromStatus: previous.status,
        fromNote: previous.note,
        toStatus: next.status,
        toNote: next.note
      })
    );
  }
  return next;
}

export async function approveGroup(repoRoot: string, model: ReviewModel, groupId: string): Promise<StoredHunkState[]> {
  return withStateLock(repoRoot, () => approveGroupUnlocked(repoRoot, model, groupId));
}

async function approveGroupUnlocked(repoRoot: string, model: ReviewModel, groupId: string): Promise<StoredHunkState[]> {
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
  const compoundId = createJournalId();
  const journalEntries: JournalEntry[] = [];
  const results = hunks.map<StoredHunkState>((hunk) => {
    const previous = state.hunks[hunk.id] ?? { status: "unreviewed" as const };
    const stored: StoredHunkState = { status: "approved", reviewedAt: now, via: "group" };
    state.hunks[hunk.id] = stored;
    if (previous.status !== stored.status || previous.note !== stored.note) {
      journalEntries.push(
        makeJournalEntry({
          hunkId: hunk.id,
          file: hunk.file,
          via: "group",
          kind: "group",
          compoundId,
          fromStatus: previous.status,
          fromNote: previous.note,
          toStatus: stored.status,
          toNote: stored.note
        })
      );
    }
    return stored;
  });
  state.updatedAt = now;
  await writeReviewStateAtomic(repoRoot, state);
  for (const entry of journalEntries) {
    await appendJournal(repoRoot, entry);
  }
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

async function withStateLock<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = statePath(repoRoot);
  const previous = stateLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  stateLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release?.();
    if (stateLocks.get(key) === tail) {
      stateLocks.delete(key);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
