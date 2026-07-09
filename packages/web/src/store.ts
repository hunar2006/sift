import { create } from "zustand";
import type { ApiMeta, ReviewModel, ReviewHunk } from "./types.js";
import type { ReviewSortMode, StatsSnapshot } from "@sift-review/core";

const SORT_STORAGE_KEY = "sift.sortMode";
const SORT_MODES: ReviewSortMode[] = ["risk", "reading", "path"];

interface ReviewStore {
  model?: ReviewModel;
  stats?: StatsSnapshot;
  meta?: ApiMeta;
  selectedId?: string;
  split: boolean;
  helpOpen: boolean;
  filter: string;
  sortMode: ReviewSortMode;
  collapsed: Record<string, boolean>;
  toast?: string;
  setData(model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta): void;
  setSelected(id?: string): void;
  setStatus(id: string, status: ReviewHunk["status"], note?: string): void;
  setSplit(split: boolean): void;
  setHelp(open: boolean): void;
  setFilter(filter: string): void;
  setSortMode(mode: ReviewSortMode): void;
  cycleSortMode(): void;
  setCollapsed(groupId: string, collapsed: boolean): void;
  collapseAll(collapsed: boolean): void;
  setToast(toast?: string): void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  split: false,
  helpOpen: false,
  filter: "",
  sortMode: readStoredSortMode(),
  collapsed: {},
  setData: (model, stats, meta) =>
    set((state) => ({
      model,
      stats,
      meta,
      selectedId: state.selectedId && model.hunks.some((hunk) => hunk.id === state.selectedId)
        ? state.selectedId
        : model.hunks[0]?.id
    })),
  setSelected: (id) => set({ selectedId: id }),
  setStatus: (id, status, note) =>
    set((state) => ({
      model: state.model
        ? {
            ...state.model,
            hunks: state.model.hunks.map((hunk) =>
              hunk.id === id ? { ...hunk, status, note, reviewedAt: new Date().toISOString() } : hunk
            )
          }
        : state.model
    })),
  setSplit: (split) => set({ split }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setFilter: (filter) => set({ filter }),
  setSortMode: (sortMode) => {
    writeStoredSortMode(sortMode);
    set({ sortMode });
  },
  cycleSortMode: () =>
    set((state) => {
      const next = nextSortMode(state.sortMode);
      writeStoredSortMode(next);
      return { sortMode: next };
    }),
  setCollapsed: (groupId, collapsed) =>
    set((state) => ({ collapsed: { ...state.collapsed, [groupId]: collapsed } })),
  collapseAll: (collapsed) => {
    const groups = get().model?.groups ?? [];
    set({ collapsed: Object.fromEntries(groups.map((group) => [group.id, collapsed])) });
  },
  setToast: (toast) => set({ toast })
}));

export function visibleHunks(
  model: ReviewModel | undefined,
  filter: string,
  collapsed: Record<string, boolean>,
  sortMode: ReviewSortMode = "risk"
): ReviewHunk[] {
  if (!model) {
    return [];
  }
  const groupById = new Map(model.groups.map((group) => [group.id, group]));
  const needle = filter.trim().toLowerCase();
  return sortReviewHunks(model.hunks, model, sortMode).filter((hunk) => {
    if (needle && !hunk.file.toLowerCase().includes(needle)) {
      return false;
    }
    const group = groupById.get(hunk.groupId);
    return group ? !collapsed[group.id] : true;
  });
}

export function sortReviewHunks(
  hunks: ReviewHunk[],
  model: ReviewModel,
  sortMode: ReviewSortMode = "risk"
): ReviewHunk[] {
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

function nextSortMode(current: ReviewSortMode): ReviewSortMode {
  return SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length] ?? "risk";
}

function readStoredSortMode(): ReviewSortMode {
  if (typeof localStorage === "undefined") {
    return "risk";
  }
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  return SORT_MODES.includes(stored as ReviewSortMode) ? (stored as ReviewSortMode) : "risk";
}

function writeStoredSortMode(mode: ReviewSortMode): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(SORT_STORAGE_KEY, mode);
}

function compareRiskThenPath(a: ReviewHunk, b: ReviewHunk): number {
  if (b.risk !== a.risk) {
    return b.risk - a.risk;
  }
  return comparePathOnly(a, b);
}

function comparePathThenRisk(a: ReviewHunk, b: ReviewHunk): number {
  const pathDelta = comparePathOnly(a, b);
  return pathDelta !== 0 ? pathDelta : b.risk - a.risk;
}

function comparePathOnly(a: ReviewHunk, b: ReviewHunk): number {
  const fileDelta = a.file.localeCompare(b.file);
  if (fileDelta !== 0) {
    return fileDelta;
  }
  return (a.newStart ?? a.oldStart ?? 0) - (b.newStart ?? b.oldStart ?? 0);
}
