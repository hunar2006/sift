import { create } from "zustand";
import type { ApiMeta, ReviewModel, ReviewHunk } from "./types.js";
import type { StatsSnapshot } from "@sift-review/core";

interface ReviewStore {
  model?: ReviewModel;
  stats?: StatsSnapshot;
  meta?: ApiMeta;
  selectedId?: string;
  split: boolean;
  helpOpen: boolean;
  filter: string;
  collapsed: Record<string, boolean>;
  toast?: string;
  setData(model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta): void;
  setSelected(id?: string): void;
  setStatus(id: string, status: ReviewHunk["status"], note?: string): void;
  setSplit(split: boolean): void;
  setHelp(open: boolean): void;
  setFilter(filter: string): void;
  setCollapsed(groupId: string, collapsed: boolean): void;
  collapseAll(collapsed: boolean): void;
  setToast(toast?: string): void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  split: false,
  helpOpen: false,
  filter: "",
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
  setCollapsed: (groupId, collapsed) =>
    set((state) => ({ collapsed: { ...state.collapsed, [groupId]: collapsed } })),
  collapseAll: (collapsed) => {
    const groups = get().model?.groups ?? [];
    set({ collapsed: Object.fromEntries(groups.map((group) => [group.id, collapsed])) });
  },
  setToast: (toast) => set({ toast })
}));

export function visibleHunks(model: ReviewModel | undefined, filter: string, collapsed: Record<string, boolean>): ReviewHunk[] {
  if (!model) {
    return [];
  }
  const groupById = new Map(model.groups.map((group) => [group.id, group]));
  const needle = filter.trim().toLowerCase();
  return model.hunks.filter((hunk) => {
    if (needle && !hunk.file.toLowerCase().includes(needle)) {
      return false;
    }
    const group = groupById.get(hunk.groupId);
    return group ? !collapsed[group.id] : true;
  });
}
