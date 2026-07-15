import type { HunkWithState, ReviewModelWithState } from "../types.js";
import { REVIEW_SORT_MODES, type ReviewSortMode } from "../order.js";

// Re-export for session consumers that only import queue helpers.
export type { ReviewSortMode };

export type SessionHunk = HunkWithState;
export type SessionModel = ReviewModelWithState;

export function visibleHunks(
  model: SessionModel | undefined,
  filter: string,
  collapsed: Record<string, boolean>,
  sortMode: ReviewSortMode = "risk",
  freshIds: Record<string, true> = {},
  freshOnly = false,
  flaggedOnly = false
): SessionHunk[] {
  if (!model) {
    return [];
  }
  const groupById = new Map(model.groups.map((group) => [group.id, group]));
  const needle = filter.trim().toLowerCase();
  return sortReviewHunks(model.hunks, model, sortMode).filter((hunk) => {
    if (needle && !hunk.file.toLowerCase().includes(needle)) {
      return false;
    }
    if (freshOnly && !freshIds[hunk.id]) {
      return false;
    }
    if (flaggedOnly && hunk.status !== "flagged") {
      return false;
    }
    const group = groupById.get(hunk.groupId);
    return group ? !collapsed[group.id] : true;
  });
}

export function sortReviewHunks(
  hunks: SessionHunk[],
  model: SessionModel,
  sortMode: ReviewSortMode = "risk"
): SessionHunk[] {
  const groupOrder = new Map(model.groups.map((group) => [group.id, group.order]));
  const groupKind = new Map(model.groups.map((group) => [group.id, group.kind]));
  return [...hunks].sort((a, b) => {
    const groupDelta = (groupOrder.get(a.groupId) ?? 999) - (groupOrder.get(b.groupId) ?? 999);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    if (sortMode === "path") {
      return comparePathThenRisk(a, b);
    }
    if (sortMode === "reading" && groupKind.get(a.groupId) === "attention") {
      const aRank = a.readingRank;
      const bRank = b.readingRank;
      if (aRank !== undefined && bRank !== undefined && aRank !== bRank) {
        return aRank - bRank;
      }
    }
    return compareRiskThenPath(a, b);
  });
}

export function nextSortMode(current: ReviewSortMode): ReviewSortMode {
  return REVIEW_SORT_MODES[(REVIEW_SORT_MODES.indexOf(current) + 1) % REVIEW_SORT_MODES.length] ?? "risk";
}

function compareRiskThenPath(a: SessionHunk, b: SessionHunk): number {
  if (b.risk !== a.risk) {
    return b.risk - a.risk;
  }
  return comparePathOnly(a, b);
}

function comparePathThenRisk(a: SessionHunk, b: SessionHunk): number {
  const pathDelta = comparePathOnly(a, b);
  return pathDelta !== 0 ? pathDelta : b.risk - a.risk;
}

function comparePathOnly(a: SessionHunk, b: SessionHunk): number {
  const fileDelta = a.file.localeCompare(b.file);
  if (fileDelta !== 0) {
    return fileDelta;
  }
  return (a.newStart ?? a.oldStart ?? 0) - (b.newStart ?? b.oldStart ?? 0);
}
