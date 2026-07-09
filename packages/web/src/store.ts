import { create } from "zustand";
import type { ApiMeta, ReviewModel, ReviewHunk } from "./types.js";
import type { ReviewSortMode, StatsSnapshot } from "@sift-review/core";

const SORT_STORAGE_KEY = "sift.sortMode";
const SPLIT_STORAGE_KEY = "sift.split";
const THEME_STORAGE_KEY = "sift.theme";
const HELP_DISMISSED_STORAGE_KEY = "sift.firstRunHelpDismissed";
const SORT_MODES: ReviewSortMode[] = ["risk", "reading", "path"];
const THEME_MODES = ["dark", "light"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

interface ReviewStore {
  model?: ReviewModel;
  stats?: StatsSnapshot;
  meta?: ApiMeta;
  selectedId?: string;
  split: boolean;
  helpOpen: boolean;
  helpTour: boolean;
  paletteOpen: boolean;
  timelineOpen: boolean;
  statsOpen: boolean;
  filter: string;
  theme: ThemeMode;
  sortMode: ReviewSortMode;
  collapsed: Record<string, boolean>;
  hunkCollapsed: Record<string, boolean>;
  nitsOpen: boolean;
  toast?: string;
  setData(model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta): void;
  setSelected(id?: string): void;
  setStatus(id: string, status: ReviewHunk["status"], note?: string): void;
  setSplit(split: boolean): void;
  setHelp(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  setTimelineOpen(open: boolean): void;
  setStatsOpen(open: boolean): void;
  setFilter(filter: string): void;
  setTheme(theme: ThemeMode): void;
  toggleTheme(): void;
  setSortMode(mode: ReviewSortMode): void;
  cycleSortMode(): void;
  setCollapsed(groupId: string, collapsed: boolean): void;
  collapseAll(collapsed: boolean): void;
  toggleHunkCollapsed(id: string): void;
  setNitsOpen(open: boolean): void;
  toggleNits(): void;
  setToast(toast?: string): void;
}

const showFirstRunHelp = shouldShowFirstRunHelp();

export const useReviewStore = create<ReviewStore>((set, get) => ({
  split: readStoredSplit(),
  helpOpen: showFirstRunHelp,
  helpTour: showFirstRunHelp,
  paletteOpen: false,
  timelineOpen: false,
  statsOpen: false,
  filter: "",
  theme: readStoredTheme(),
  sortMode: readStoredSortMode(),
  collapsed: {},
  hunkCollapsed: {},
  nitsOpen: false,
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
  setSplit: (split) => {
    writeStorage(SPLIT_STORAGE_KEY, String(split));
    set({ split });
  },
  setHelp: (helpOpen) => {
    if (!helpOpen) {
      writeStorage(HELP_DISMISSED_STORAGE_KEY, "1");
      set({ helpOpen, helpTour: false });
      return;
    }
    set({ helpOpen, helpTour: shouldShowFirstRunHelp() });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  setStatsOpen: (statsOpen) => set({ statsOpen }),
  setFilter: (filter) => set({ filter }),
  setTheme: (theme) => {
    writeStorage(THEME_STORAGE_KEY, theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const theme = state.theme === "dark" ? "light" : "dark";
      writeStorage(THEME_STORAGE_KEY, theme);
      return { theme };
    }),
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
  toggleHunkCollapsed: (id) =>
    set((state) => ({ hunkCollapsed: { ...state.hunkCollapsed, [id]: !state.hunkCollapsed[id] } })),
  setNitsOpen: (nitsOpen) => set({ nitsOpen }),
  toggleNits: () => set((state) => ({ nitsOpen: !state.nitsOpen })),
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
  const stored = readStorage(SORT_STORAGE_KEY);
  return SORT_MODES.includes(stored as ReviewSortMode) ? (stored as ReviewSortMode) : "risk";
}

function writeStoredSortMode(mode: ReviewSortMode): void {
  writeStorage(SORT_STORAGE_KEY, mode);
}

function readStoredSplit(): boolean {
  const stored = readStorage(SPLIT_STORAGE_KEY);
  if (stored === "true" || stored === "false") {
    return stored === "true";
  }
  return typeof window !== "undefined" ? window.innerWidth >= 1200 : false;
}

function readStoredTheme(): ThemeMode {
  const stored = readStorage(THEME_STORAGE_KEY);
  if (THEME_MODES.includes(stored as ThemeMode)) {
    return stored as ThemeMode;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function shouldShowFirstRunHelp(): boolean {
  return readStorage(HELP_DISMISSED_STORAGE_KEY) !== "1";
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {
    // Local storage can be disabled; preferences are optional.
  }
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
