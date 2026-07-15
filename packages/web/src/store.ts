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
const NITS_STORAGE_KEY = "sift.nitsOpen";
const HELP_DISMISSED_STORAGE_KEY = "sift.firstRunHelpDismissed";
const FRESH_SESSION_STARTED_KEY = "sift.freshSessionStartedAt";
const FRESH_VISITED_KEY = "sift.freshVisited";
const FLAGGED_ONLY_STORAGE_KEY = "sift.flaggedOnly";
const CODE_SIZE_STORAGE_KEY = "sift.codeSize";
const SORT_MODES: ReviewSortMode[] = ["risk", "reading", "path"];
const THEME_MODES = ["graphite", "assay", "paper"] as const;
const CODE_SIZES = [12, 13, 14] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type CodeSize = (typeof CODE_SIZES)[number];

const browserFresh: FreshPersistence = {
  readSessionStartedAt: readFreshSessionStartedAt,
  readVisitedIds: readFreshVisitedIds,
  markVisited: markFreshVisited
};

const session = new ReviewSession(
  {
    sortMode: readStoredSortMode(),
    flaggedOnly: readStoredFlaggedOnly()
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
  flaggedOnly: boolean;
  theme: ThemeMode;
  codeSize: CodeSize;
  sortMode: ReviewSortMode;
  collapsed: Record<string, boolean>;
  hunkCollapsed: Record<string, boolean>;
  nitsOpen: boolean;
  toast?: string;
  /** Decisions the UI has kept locally because their persistence request failed. */
  unsaved: Record<string, true>;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pushUndoEntry(entry: UndoEntry): void;
  popUndoEntry(): UndoResult;
  popRedoEntry(): UndoResult;
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
  toggleFlaggedOnly(): void;
  setTheme(theme: ThemeMode): void;
  toggleTheme(): void;
  cycleCodeSize(): void;
  setSortMode(mode: ReviewSortMode): void;
  cycleSortMode(): void;
  setCollapsed(groupId: string, collapsed: boolean): void;
  collapseAll(collapsed: boolean): void;
  toggleHunkCollapsed(id: string): void;
  setNitsOpen(open: boolean): void;
  toggleNits(): void;
  setToast(toast?: string): void;
  markUnsaved(ids: string[]): void;
  markSaved(ids: string[]): void;
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
  | "flaggedOnly"
  | "sortMode"
  | "collapsed"
  | "hunkCollapsed"
  | "toast"
  | "undoStack"
  | "redoStack"
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
    flaggedOnly: state.flaggedOnly,
    sortMode: state.sortMode,
    collapsed: state.collapsed,
    hunkCollapsed: state.hunkCollapsed,
    toast: state.toast,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
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
  codeSize: readStoredCodeSize(),
  nitsOpen: readStoredNitsOpen(),
  meta: undefined,
  unsaved: {},
  pushUndoEntry: (entry) => {
    session.pushUndoEntry(entry);
    set(syncFromSession());
  },
  popUndoEntry: () => {
    const result = session.popUndoEntry();
    set(syncFromSession());
    return result;
  },
  popRedoEntry: () => {
    const result = session.popRedoEntry();
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
  toggleFlaggedOnly: () => {
    session.toggleFlaggedOnly();
    writeStorage(FLAGGED_ONLY_STORAGE_KEY, String(session.getState().flaggedOnly));
    set(syncFromSession());
  },
  setTheme: (theme) => {
    writeStorage(THEME_STORAGE_KEY, theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const theme = THEME_MODES[(THEME_MODES.indexOf(state.theme) + 1) % THEME_MODES.length]!;
      writeStorage(THEME_STORAGE_KEY, theme);
      return { theme };
    }),
  cycleCodeSize: () =>
    set((state) => {
      const codeSize = CODE_SIZES[(CODE_SIZES.indexOf(state.codeSize) + 1) % CODE_SIZES.length]!;
      writeStorage(CODE_SIZE_STORAGE_KEY, String(codeSize));
      return { codeSize };
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
  setNitsOpen: (nitsOpen) => {
    writeStorage(NITS_STORAGE_KEY, String(nitsOpen));
    set({ nitsOpen });
  },
  toggleNits: () =>
    set((state) => {
      const nitsOpen = !state.nitsOpen;
      writeStorage(NITS_STORAGE_KEY, String(nitsOpen));
      return { nitsOpen };
    }),
  setToast: (toast) => {
    session.setToast(toast);
    set(syncFromSession());
  },
  markUnsaved: (ids) =>
    set((state) => ({ unsaved: { ...state.unsaved, ...Object.fromEntries(ids.map((id) => [id, true])) } })),
  markSaved: (ids) =>
    set((state) => {
      const unsaved = { ...state.unsaved };
      for (const id of ids) {
        delete unsaved[id];
      }
      return { unsaved };
    })
}));

/**
 * Decision-facing counts deliberately derive from the in-memory session model.
 * Server stats are a snapshot for metadata/coverage only; a persistence round-trip
 * must never change the UI's denominator or throw away an optimistic decision.
 */
export function deriveLiveStats(model: ReviewModel | undefined, base: StatsSnapshot | undefined): StatsSnapshot | undefined {
  if (!model || !base) {
    return base;
  }
  const attentionGroups = new Set(model.groups.filter((group) => group.kind === "attention").map((group) => group.id));
  const reviewable = model.hunks.filter((hunk) => attentionGroups.has(hunk.groupId));
  const reviewedReviewableLines = reviewable
    .filter((hunk) => hunk.status !== "unreviewed")
    .reduce((total, hunk) => total + hunk.addedLines + hunk.removedLines, 0);
  const flaggedHunks = model.hunks.filter((hunk) => hunk.status === "flagged").length;
  return {
    ...base,
    changedLines: model.totals.changedLines,
    reviewableLines: model.totals.reviewableLines,
    reviewedReviewableLines,
    flaggedHunks,
    debt: 1 - reviewedReviewableLines / Math.max(model.totals.reviewableLines, 1)
  };
}

/** Decision-facing progress is deliberately hunk-based so it is the exact
 * same unit shown by every queue group tally. */
export function deriveDecisionProgress(model: ReviewModel | undefined): { reviewed: number; total: number } {
  const hunks = model?.hunks ?? [];
  return { reviewed: hunks.filter((hunk) => hunk.status !== "unreviewed").length, total: hunks.length };
}

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
    return "paper";
  }
  return "graphite";
}

function readStoredCodeSize(): CodeSize {
  const value = Number.parseInt(readStorage(CODE_SIZE_STORAGE_KEY) ?? "13", 10);
  return CODE_SIZES.includes(value as CodeSize) ? (value as CodeSize) : 13;
}

function readStoredNitsOpen(): boolean {
  return readStorage(NITS_STORAGE_KEY) === "true";
}

function readStoredFlaggedOnly(): boolean {
  return readStorage(FLAGGED_ONLY_STORAGE_KEY) === "true";
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
