import type { Status } from "./types.js";

export const UNDO_STACK_DEPTH = 20;

export const DEFAULT_FLAG_REASONS = [
  "Needs tests",
  "Security concern",
  "Doesn't match intent",
  "Unnecessary change"
] as const;

export const MAX_FLAG_REASONS = 6;

export interface UndoChange {
  hunkId: string;
  prevStatus: Status;
  prevNote?: string;
}

export type UndoEntry = UndoChange[];

export interface UndoResult {
  stack: UndoEntry[];
  restore: UndoChange[];
  message: string | null;
}

/** Push a single- or multi-hunk undo entry, capping the stack at UNDO_STACK_DEPTH. */
export function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  if (entry.length === 0) {
    return stack;
  }
  const next = [...stack, entry];
  return next.length > UNDO_STACK_DEPTH ? next.slice(next.length - UNDO_STACK_DEPTH) : next;
}

/**
 * Pop the top entry. Changes whose hunk no longer exists (e.g. after a refresh)
 * are dropped; if none remain, the entry is discarded with a toast message.
 */
export function popUndo(stack: UndoEntry[], existingIds: ReadonlySet<string>): UndoResult {
  if (stack.length === 0) {
    return { stack, restore: [], message: "Nothing to undo" };
  }
  const entry = stack[stack.length - 1] ?? [];
  const remaining = stack.slice(0, -1);
  const restore = entry.filter((change) => existingIds.has(change.hunkId));
  if (restore.length === 0) {
    return { stack: remaining, restore: [], message: "Nothing to undo here" };
  }
  return { stack: remaining, restore, message: null };
}

/** Validate and normalize a user-configured flag-reason list (cap MAX_FLAG_REASONS). */
export function normalizeFlagReasons(reasons: readonly string[] | undefined): string[] {
  if (!reasons || reasons.length === 0) {
    return [...DEFAULT_FLAG_REASONS];
  }
  const cleaned = reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)
    .slice(0, MAX_FLAG_REASONS);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_FLAG_REASONS];
}
