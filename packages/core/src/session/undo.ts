import type { HunkStatus } from "../types.js";
import { normalizeFlagReasons } from "../flag-reasons.js";

export { normalizeFlagReasons };

export const UNDO_STACK_DEPTH = 20;

export interface UndoChange {
  hunkId: string;
  prevStatus: HunkStatus;
  prevNote?: string;
  nextStatus?: HunkStatus;
  nextNote?: string;
  /** Snapshot-backed file revert; the hunk fields retain its decision context. */
  revertId?: string;
  revertPath?: string;
}

export type UndoEntry = UndoChange[];

export interface UndoResult {
  stack: UndoEntry[];
  restore: UndoChange[];
  entry?: UndoEntry;
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
  // A file revert intentionally removes its hunks from the refreshed model;
  // its snapshot id, unlike a normal decision, remains safely undoable.
  const restore = entry.filter((change) => Boolean(change.revertId) || existingIds.has(change.hunkId));
  if (restore.length === 0) {
    return { stack: remaining, restore: [], message: "Nothing to undo here" };
  }
  return { stack: remaining, restore, entry: restore, message: null };
}

/** Redo is the same stack operation; consumers apply nextStatus/nextNote from the returned entry. */
export const popRedo = popUndo;
