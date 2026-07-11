import { create } from "zustand";
import {
  ReviewSession,
  nextSortMode,
  sortReviewHunks,
  visibleHunks,
  type FreshPersistence,
  type UndoEntry,
  type UndoResult
} from "@sift-review/core/session";
import type { ReviewSortMode, StatsSnapshot } from "@sift-review/core";
import type { ApiMeta, ReviewModel, ReviewHunk } from "./types.js";

const SORT_STORAGE_KEY = "sift.sortMode";
const SPLIT_STORAGE_KEY = "sift.split";
const THEME_STORAGE_KEY = "sift.theme";
const HELP_DISMISSED_STORAGE_KEY = "sift.firstRunHelpDismissed";
const FRESH_SESSION_STARTED_KEY = "sift.freshSessionStartedAt";
const FRESH_VISITED_KEY = "sift.freshVisited";
const SORT_MODES: ReviewSortMode[] = ["risk", "reading", "path"];
const THEME_MODES = ["dark", "light"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

const browserFresh: FreshPersistence = {
  readSessionStartedAt: readFreshSessionStartedAt,
  readVisitedIds: readFreshVisitedIds,
  markVisited: markFreshVisited
};

const session = new ReviewSession(
  {
    sortMode: readStoredSortMode()
  },
  browserFresh
);

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
  freshIds: Record<string, true>;
  freshOnly: boolean;
  theme: ThemeMode;
  sortMode: ReviewSortMode;
  collapsed: Record<string, boolean>;
  hunkCollapsed: Record<string, boolean>;
  nitsOpen: boolean;
  toast?: string;
  undoStack: UndoEntry[];
  pushUndoEntry(entry: UndoEntry): void;
  popUndoEntry(): UndoResult;
  setData(model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta): void;
  applyLiveData(model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta, addedIds: string[], removedIds: string[]): void;
  setSelected(id?: string): void;
  setStatus(id: string, status: ReviewHunk["status"], note?: string): void;
  setSplit(split: boolean): void;
  setHelp(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  setTimelineOpen(open: boolean): void;
  setStatsOpen(open: boolean): void;
  setFilter(filter: string): void;
  toggleFreshOnly(): void;
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

function syncFromSession(
  patch: Partial<
    Pick<
      ReviewStore,
      "meta" | "split" | "helpOpen" | "helpTour" | "paletteOpen" | "timelineOpen" | "statsOpen" | "theme" | "nitsOpen"
    >
  > = {}
): Pick<
  ReviewStore,
  | "model"
  | "stats"
  | "selectedId"
  | "filter"
  | "freshIds"
  | "freshOnly"
  | "sortMode"
  | "collapsed"
  | "hunkCollapsed"
  | "toast"
  | "undoStack"
> &
  typeof patch {
  const state = session.getState();
  return {
    model: state.model,
    stats: state.stats,
    selectedId: state.selectedId,
    filter: state.filter,
    freshIds: state.freshIds,
    freshOnly: state.freshOnly,
    sortMode: state.sortMode,
    collapsed: state.collapsed,
    hunkCollapsed: state.hunkCollapsed,
    toast: state.toast,
    undoStack: state.undoStack,
    ...patch
  };
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...syncFromSession(),
  split: readStoredSplit(),
  helpOpen: showFirstRunHelp,
  helpTour: showFirstRunHelp,
  paletteOpen: false,
  timelineOpen: false,
  statsOpen: false,
  theme: readStoredTheme(),
  nitsOpen: false,
  meta: undefined,
  pushUndoEntry: (entry) => {
    session.pushUndoEntry(entry);
    set(syncFromSession());
  },
  popUndoEntry: () => {
    const result = session.popUndoEntry();
    set(syncFromSession());
    return result;
  },
  setData: (model, stats, meta) => {
    session.setModel(model, stats);
    set(syncFromSession({ meta }));
  },
  applyLiveData: (model, stats, meta, addedIds, removedIds) => {
    session.applyLiveData(model, stats, addedIds, removedIds);
    set(syncFromSession({ meta }));
  },
  setSelected: (id) => {
    session.setSelected(id);
    set(syncFromSession());
  },
  setStatus: (id, status, note) => {
    session.setStatus(id, status, note);
    set(syncFromSession());
  },
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
  setFilter: (filter) => {
    session.setFilter(filter);
    set(syncFromSession());
  },
  toggleFreshOnly: () => {
    session.toggleFreshOnly();
    set(syncFromSession());
  },
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
    session.setSortMode(sortMode);
    set(syncFromSession());
  },
  cycleSortMode: () => {
    const next = nextSortMode(get().sortMode);
    writeStoredSortMode(next);
    session.setSortMode(next);
    set(syncFromSession());
  },
  setCollapsed: (groupId, collapsed) => {
    session.setCollapsed(groupId, collapsed);
    set(syncFromSession());
  },
  collapseAll: (collapsed) => {
    session.collapseAll(collapsed);
    set(syncFromSession());
  },
  toggleHunkCollapsed: (id) => {
    session.toggleHunkCollapsed(id);
    set(syncFromSession());
  },
  setNitsOpen: (nitsOpen) => set({ nitsOpen }),
  toggleNits: () => set((state) => ({ nitsOpen: !state.nitsOpen })),
  setToast: (toast) => {
    session.setToast(toast);
    set(syncFromSession());
  }
}));

export { sortReviewHunks, visibleHunks };

function readFreshSessionStartedAt(): string {
  try {
    if (typeof sessionStorage === "undefined") {
      return new Date().toISOString();
    }
    const existing = sessionStorage.getItem(FRESH_SESSION_STARTED_KEY);
    if (existing && !Number.isNaN(Date.parse(existing))) {
      return existing;
    }
    const startedAt = new Date().toISOString();
    sessionStorage.setItem(FRESH_SESSION_STARTED_KEY, startedAt);
    return startedAt;
  } catch {
    return new Date().toISOString();
  }
}

function readFreshVisitedIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(FRESH_VISITED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function markFreshVisited(id: string): void {
  try {
    const visited = readFreshVisitedIds();
    visited.add(id);
    sessionStorage.setItem(FRESH_VISITED_KEY, JSON.stringify([...visited]));
  } catch {
    // Freshness is an optional interface hint; memory-only behavior remains useful.
  }
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
