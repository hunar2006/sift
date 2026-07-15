import type { StatsSnapshot } from "../types.js";
import { REVIEW_SORT_MODES, type ReviewSortMode } from "../order.js";
import { nextSortMode, sortReviewHunks, visibleHunks, type SessionHunk, type SessionModel } from "./queue.js";
import {
  applyHunkStatus,
  hydrateFreshIds,
  mergeFreshIds,
  omitFresh,
  preserveNearestSelection
} from "./selection.js";
import { popRedo, popUndo, pushUndo, type UndoEntry, type UndoResult } from "./undo.js";
import type { HunkStatus } from "../types.js";

export interface SessionState {
  model?: SessionModel;
  stats?: StatsSnapshot;
  selectedId?: string;
  filter: string;
  freshIds: Record<string, true>;
  freshOnly: boolean;
  flaggedOnly: boolean;
  sortMode: ReviewSortMode;
  collapsed: Record<string, boolean>;
  hunkCollapsed: Record<string, boolean>;
  toast?: string;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
}

export type SessionListener = (state: SessionState) => void;

export interface FreshPersistence {
  readSessionStartedAt(): string;
  readVisitedIds(): Set<string>;
  markVisited(id: string): void;
}

const memoryFresh: FreshPersistence = (() => {
  const startedAt = new Date().toISOString();
  const visited = new Set<string>();
  return {
    readSessionStartedAt: () => startedAt,
    readVisitedIds: () => visited,
    markVisited: (id) => {
      visited.add(id);
    }
  };
})();

export function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    filter: "",
    freshIds: {},
    freshOnly: false,
    flaggedOnly: false,
    sortMode: "risk",
    collapsed: {},
    hunkCollapsed: {},
    undoStack: [],
    redoStack: [],
    ...overrides
  };
}

/** Tiny event-emitting store over pure session reducers. Zero DOM/React/Ink. */
export class ReviewSession {
  private state: SessionState;
  private listeners = new Set<SessionListener>();
  private fresh: FreshPersistence;

  constructor(initial: Partial<SessionState> = {}, fresh: FreshPersistence = memoryFresh) {
    this.state = createSessionState(initial);
    this.fresh = fresh;
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)): void {
    const nextPatch = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...nextPatch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  visible(): SessionHunk[] {
    return visibleHunks(
      this.state.model,
      this.state.filter,
      this.state.collapsed,
      this.state.sortMode,
      this.state.freshIds,
      this.state.freshOnly,
      this.state.flaggedOnly
    );
  }

  pushUndoEntry(entry: UndoEntry): void {
    this.set((state) => ({ undoStack: pushUndo(state.undoStack, entry), redoStack: [] }));
  }

  popUndoEntry(): UndoResult {
    const existing = new Set((this.state.model?.hunks ?? []).map((hunk) => hunk.id));
    const result = popUndo(this.state.undoStack, existing);
    this.set((state) => ({
      undoStack: result.stack,
      redoStack: result.entry ? pushUndo(state.redoStack, result.entry) : state.redoStack
    }));
    return result;
  }

  popRedoEntry(): UndoResult {
    const existing = new Set((this.state.model?.hunks ?? []).map((hunk) => hunk.id));
    const result = popRedo(this.state.redoStack, existing);
    this.set((state) => ({
      redoStack: result.stack,
      undoStack: result.entry ? pushUndo(state.undoStack, result.entry) : state.undoStack
    }));
    return result;
  }

  setModel(model: SessionModel, stats?: StatsSnapshot): void {
    this.set((state) => ({
      model,
      stats: stats ?? state.stats,
      freshIds: hydrateFreshIds(
        model.hunks,
        state.freshIds,
        this.fresh.readSessionStartedAt(),
        this.fresh.readVisitedIds()
      ),
      selectedId:
        state.selectedId && model.hunks.some((hunk) => hunk.id === state.selectedId)
          ? state.selectedId
          : model.hunks[0]?.id
    }));
  }

  applyLiveData(model: SessionModel, stats: StatsSnapshot | undefined, addedIds: string[], removedIds: string[]): void {
    this.set((state) => {
      const available = new Set(model.hunks.map((hunk) => hunk.id));
      const freshIds = mergeFreshIds(state.freshIds, addedIds, available);
      const selectedId =
        preserveNearestSelection(state.model?.hunks ?? [], state.selectedId, available) ?? model.hunks[0]?.id;
      return {
        model,
        stats: stats ?? state.stats,
        freshIds,
        selectedId,
        toast: `${addedIds.length} new hunks · ${removedIds.length} removed`
      };
    });
  }

  setSelected(id?: string): void {
    this.set((state) => {
      if (id && state.freshIds[id]) {
        this.fresh.markVisited(id);
      }
      return { selectedId: id, freshIds: id ? omitFresh(state.freshIds, id) : state.freshIds };
    });
  }

  setStatus(id: string, status: HunkStatus, note?: string): void {
    this.set((state) => {
      if (!state.model) {
        return {};
      }
      return {
        model: applyHunkStatus(state.model, id, status, note),
        freshIds: status === "unreviewed" ? state.freshIds : omitFresh(state.freshIds, id)
      };
    });
  }

  setFilter(filter: string): void {
    this.set({ filter });
  }

  toggleFreshOnly(): void {
    this.set((state) => ({ freshOnly: !state.freshOnly }));
  }

  toggleFlaggedOnly(): void {
    this.set((state) => ({ flaggedOnly: !state.flaggedOnly }));
  }

  setSortMode(sortMode: ReviewSortMode): void {
    this.set({ sortMode });
  }

  cycleSortMode(): void {
    this.set((state) => ({ sortMode: nextSortMode(state.sortMode) }));
  }

  setCollapsed(groupId: string, collapsed: boolean): void {
    this.set((state) => ({ collapsed: { ...state.collapsed, [groupId]: collapsed } }));
  }

  collapseAll(collapsed: boolean): void {
    const groups = this.state.model?.groups ?? [];
    this.set({ collapsed: Object.fromEntries(groups.map((group) => [group.id, collapsed])) });
  }

  toggleHunkCollapsed(id: string): void {
    this.set((state) => ({ hunkCollapsed: { ...state.hunkCollapsed, [id]: !state.hunkCollapsed[id] } }));
  }

  setToast(toast?: string): void {
    this.set({ toast });
  }
}

export { sortReviewHunks, visibleHunks, nextSortMode, REVIEW_SORT_MODES };
