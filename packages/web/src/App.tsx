import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode, RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { shortcutForPaletteAction } from "@sift-review/core/keymap";
import type { JournalEntry, ReviewBrief, StatsSnapshot } from "@sift-review/core";
import {
  approveGroup,
  fetchBrief,
  fetchFile,
  fetchJournal,
  fetchMeta,
  openHunkInEditor,
  fetchReport,
  fetchReview,
  fetchStats,
  fetchTimeline,
  refreshReview,
  revertHunk,
  setHunkStatus,
  targetedUndo
} from "./api.js";
import { keyboardCommand, nextAttentionUnreviewed, nextUnreviewedAfter } from "./keyboard.js";
import {
  CompletionScreen,
  DecisionLogPanel,
  FlaggedReviewScreen,
  GroupApprovePreview,
  QuickFlagPicker,
  renderInlineCode
} from "./panels.js";
import { deriveDecisionProgress, deriveLiveStats, sortReviewHunks, useReviewStore, visibleHunks } from "./store.js";
import type { ApiMeta, ProvenanceTimelineSession, ReviewHunk, ReviewModel } from "./types.js";
import { highlightDiffLines } from "./highlight.js";
import { suppressionRuleFor } from "./suppression-rule.js";
import { FIRST_RUN_OVERLAY_STEPS, HELP_OVERLAY_LINES } from "./copy.js";
import { captureFocus, focusDiffPane, focusElement, focusNote, isTextEntryTarget, restoreFocus } from "./focus.js";
import { motionTransition, SPRING } from "./motion.js";
import "./styles.css";

interface CommandAction {
  id: string;
  title: string;
  keywords?: string;
  shortcut?: string;
  run(): void;
}

interface SearchHit {
  hunkId: string;
  lineIndex?: number;
}

export function App() {
  const reducedMotion = useReducedMotion();
  const {
    model,
    stats,
    meta,
    selectedId,
    split,
    helpOpen,
    helpTour,
    paletteOpen,
    timelineOpen,
    statsOpen,
    filter,
    freshIds,
    freshOnly,
    flaggedOnly,
    theme,
    codeSize,
    sortMode,
    collapsed,
    hunkCollapsed,
    nitsOpen,
    toast,
    unsaved,
    setData,
    applyLiveData,
    setSelected,
    setStatus,
    setSplit,
    setHelp,
    setPaletteOpen,
    setTimelineOpen,
    setStatsOpen,
    setFilter,
    toggleFreshOnly,
    toggleFlaggedOnly,
    setTheme,
    toggleTheme,
    cycleCodeSize,
    cycleSortMode,
    setCollapsed,
    collapseAll,
    toggleHunkCollapsed,
    toggleNits,
    setToast,
    markUnsaved,
    markSaved,
    pushUndoEntry,
    popUndoEntry,
    popRedoEntry
  } = useReviewStore();
  const [pendingG, setPendingG] = useState(false);
  const [filterFocused, setFilterFocused] = useState(false);
  const [fileModal, setFileModal] = useState<{ path: string; text: string } | null>(null);
  const [timeline, setTimeline] = useState<ProvenanceTimelineSession[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [brief, setBrief] = useState<ReviewBrief | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [flagPickerFor, setFlagPickerFor] = useState<string | null>(null);
  const [groupPreview, setGroupPreview] = useState<{ groupId: string; blockedIds?: string[] } | null>(null);
  const [revertDialog, setRevertDialog] = useState<ReviewHunk | null>(null);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [flaggedCheckpointDismissed, setFlaggedCheckpointDismissed] = useState(false);
  const [flaggedCheckpointActive, setFlaggedCheckpointActive] = useState(false);
  const [stamp, setStamp] = useState<"verified" | "flagged" | null>(null);
  const [paneFade, setPaneFade] = useState(false);
  const [shortcutsHint, setShortcutsHint] = useState(() => !hasSeenShortcutsHint());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [toastStack, setToastStack] = useState<string[]>([]);
  const [decisionToast, setDecisionToast] = useState<{ message: string; target: string } | null>(null);
  const [decisionLogOpen, setDecisionLogOpen] = useState(false);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>([]);
  const [watchPulse, setWatchPulse] = useState(0);
  const [revertingHunkIds, setRevertingHunkIds] = useState<Set<string>>(() => new Set());
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [pulseHunkId, setPulseHunkId] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const diffPaneRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreSearchFocus = useRef<HTMLElement | null>(null);
  const decisionToastTimer = useRef<number | undefined>(undefined);
  const toastTimers = useRef(new Map<string, number>());
  const retryPersist = useRef(new Map<string, () => Promise<void>>());
  const paneFadeTriggered = useRef(false);

  function dismissShortcutsHint(): void {
    if (!shortcutsHint) {
      return;
    }
    setShortcutsHint(false);
    markShortcutsHintSeen();
  }

  function showStamp(kind: "verified" | "flagged"): void {
    setStamp(kind);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // The hallmark is the one orchestrated moment: long enough to be read,
    // short enough to never interrupt the next decision.
    window.setTimeout(() => setStamp(null), reduced ? 240 : 640);
  }

  function dismissDecisionToast(): void {
    if (decisionToastTimer.current !== undefined) {
      window.clearTimeout(decisionToastTimer.current);
      decisionToastTimer.current = undefined;
    }
    setDecisionToast(null);
  }

  function dismissToast(message: string): void {
    const timer = toastTimers.current.get(message);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimers.current.delete(message);
    }
    setToastStack((messages) => messages.filter((candidate) => candidate !== message));
  }

  function scheduleToastDismiss(message: string): void {
    const existing = toastTimers.current.get(message);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    toastTimers.current.set(
      message,
      window.setTimeout(() => dismissToast(message), 6_000)
    );
  }

  function enqueueToast(message: string): void {
    setToastStack((messages) => {
      const next = [...messages.filter((candidate) => candidate !== message), message].slice(-3);
      for (const evicted of messages.filter((candidate) => !next.includes(candidate))) {
        const timer = toastTimers.current.get(evicted);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          toastTimers.current.delete(evicted);
        }
      }
      return next;
    });
    scheduleToastDismiss(message);
  }

  function scheduleDecisionToastDismiss(): void {
    if (!decisionToast) {
      return;
    }
    if (decisionToastTimer.current !== undefined) {
      window.clearTimeout(decisionToastTimer.current);
    }
    decisionToastTimer.current = window.setTimeout(() => {
      decisionToastTimer.current = undefined;
      setDecisionToast(null);
    }, 6_000);
  }

  function showDecisionToast(message: string, target: string): void {
    enqueueToast(message);
    dismissDecisionToast();
    setDecisionToast({ message, target });
    decisionToastTimer.current = window.setTimeout(() => {
      decisionToastTimer.current = undefined;
      setDecisionToast(null);
    }, 6_000);
  }

  useEffect(() => {
    void loadAll(setData, setToast);
    void fetchBrief()
      .then((result) => setBrief(result))
      .catch(() => undefined);
  }, [setData, setToast]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    const onModelUpdated = (event: Event) => {
      try {
        const update = JSON.parse((event as MessageEvent<string>).data) as LiveUpdateEvent;
        void reloadLiveUpdate(update, applyLiveData);
      } catch {
        // A malformed local event is ignored; EventSource quietly reconnects.
      }
    };
    events.addEventListener("model-updated", onModelUpdated);
    return () => events.close();
  }, [applyLiveData]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.codeSize = String(codeSize);
    document.documentElement.style.colorScheme = theme === "paper" ? "light" : "dark";
  }, [codeSize, theme]);

  useEffect(() => {
    if (model) {
      focusDiffPane(diffPaneRef);
    }
  }, [model?.meta.generatedAt]);

  useEffect(() => () => {
    if (decisionToastTimer.current !== undefined) {
      window.clearTimeout(decisionToastTimer.current);
    }
    for (const timer of toastTimers.current.values()) {
      window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(unsaved).length === 0) {
        return;
      }
      event.preventDefault();
      event.returnValue = "Sift still has decisions waiting to be saved.";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [unsaved]);

  useEffect(() => {
    if (!decisionLogOpen) {
      return;
    }
    void fetchJournal().then(setJournal).catch(() => setToast("Decision log unavailable."));
  }, [decisionLogOpen, setToast]);

  useEffect(() => {
    if (!model || !stats || !meta || paneFadeTriggered.current || hasSeenPaneFade()) {
      return;
    }
    paneFadeTriggered.current = true;
    markPaneFadeSeen();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    setPaneFade(true);
    const timer = window.setTimeout(() => setPaneFade(false), 240);
    return () => window.clearTimeout(timer);
  }, [meta, model, stats]);

  useEffect(() => {
    if (!timelineOpen) {
      return;
    }
    setTimelineLoading(true);
    void fetchTimeline()
      .then((sessions) => setTimeline(sessions))
      .catch(() => setToast("Retry timeline."))
      .finally(() => setTimelineLoading(false));
  }, [setToast, timelineOpen]);

  const visible = useMemo(
    () => visibleHunks(model, filter, collapsed, sortMode, freshIds, freshOnly, flaggedOnly),
    [model, filter, collapsed, sortMode, freshIds, freshOnly, flaggedOnly]
  );
  const selected = visible.find((hunk) => hunk.id === selectedId) ?? visible[0];
  const searchHits = useMemo(() => findSearchHits(model, searchQuery), [model, searchQuery]);
  const searchHitIds = useMemo(() => new Set(searchHits.map((hit) => hit.hunkId)), [searchHits]);
  const activeSearchHit = searchHits.length > 0 ? searchHits[searchIndex % searchHits.length] : undefined;

  function openSearch(): void {
    restoreSearchFocus.current = captureFocus();
    setSearchOpen(true);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    restoreFocus(restoreSearchFocus.current);
  }

  function cycleSearch(delta: 1 | -1): void {
    if (searchHits.length > 0) {
      setSearchIndex((index) => (index + delta + searchHits.length) % searchHits.length);
    }
  }

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    focusElement(searchRef.current);
  }, [searchOpen]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    enqueueToast(toast);
    setToast(undefined);
  }, [setToast, toast]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!pulseHunkId) {
      return;
    }
    const timer = window.setTimeout(() => setPulseHunkId(null), 300);
    return () => window.clearTimeout(timer);
  }, [pulseHunkId]);

  useEffect(() => {
    if (searchOpen && activeSearchHit) {
      setSelected(activeSearchHit.hunkId);
    }
  }, [activeSearchHit, searchOpen, setSelected]);

  useEffect(() => {
    if (!model) {
      return;
    }
    const attentionGroups = new Set(model.groups.filter((group) => group.kind === "attention").map((group) => group.id));
    const attention = model.hunks.filter((hunk) => attentionGroups.has(hunk.groupId));
    if (attention.length > 0 && attention.every((hunk) => hunk.status !== "unreviewed") && model.hunks.some((hunk) => hunk.status === "flagged")) {
      setFlaggedCheckpointActive(true);
    }
  }, [model]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isInput = isTextEntryTarget(event.target);
      const isPaletteToggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      // Radix owns escape, focus trapping, and restore-on-close for every
      // modal surface. The diff search is intentionally inline rather than a
      // modal, so it is the only overlay closed here.
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (searchOpen) {
        return;
      }
      if (isInput && event.key !== "Escape" && !isPaletteToggle && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f")) {
        return;
      }
      // A visible Radix layer owns keys; this only prevents workbench
      // shortcuts from leaking into it.
      if (flagPickerFor || groupPreview || revertDialog || fileModal || decisionLogOpen || timelineOpen || statsOpen || paletteOpen || helpOpen || focusMode) {
        return;
      }
      const command = keyboardCommand(
        {
          selectedId: selected?.id,
          split,
          helpOpen,
          paletteOpen,
          timelineOpen,
          statsOpen,
          filterOpen: filterFocused,
          allIds: visible.map((hunk) => hunk.id),
          hunks: visible,
          pendingG,
          flaggedOnly
        },
        event.key,
        { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }
      );
      if (command.type !== "none") {
        event.preventDefault();
      }
      if (command.type === "select") {
        setPendingG(Boolean(command.pendingG));
        setSelected(command.id);
      }
      if (command.type === "status" && selected) {
        if (command.status === "flagged") {
          setFlagPickerFor(selected.id);
        } else {
          void updateStatus(selected, command.status);
        }
      }
      if (command.type === "toggle-split") {
        setSplit(!split);
      }
      if (command.type === "toggle-help") {
        if (!helpOpen) {
          dismissShortcutsHint();
        }
        setHelp(!helpOpen);
      }
      if (command.type === "toggle-palette") {
        if (!paletteOpen) {
          dismissShortcutsHint();
        }
        setPaletteOpen(!paletteOpen);
      }
      if (command.type === "toggle-search") {
        openSearch();
      }
      if (command.type === "toggle-timeline") {
        setTimelineOpen(!timelineOpen);
      }
      if (command.type === "toggle-stats") {
        setStatsOpen(!statsOpen);
      }
      if (command.type === "toggle-theme") {
        toggleTheme();
      }
      if (command.type === "toggle-current-collapse" && selected) {
        toggleHunkCollapsed(selected.id);
      }
      if (command.type === "filter") {
        setFilterFocused(true);
        focusElement(document.getElementById("queue-filter"));
      }
      if (command.type === "refresh") {
        void refresh();
      }
      if (command.type === "cycle-sort") {
        cycleSortMode();
      }
      if (command.type === "collapse-all") {
        collapseAll(command.collapsed);
      }
      if (command.type === "focus-note") {
        focusNote(noteRef);
      }
      if (command.type === "undo") {
        void performUndo();
      }
      if (command.type === "redo") {
        void performRedo();
      }
      if (command.type === "toggle-flagged") {
        toggleFlaggedOnly();
      }
      if (command.type === "toggle-focus") {
        setFocusMode((value) => !value);
      }
      if (command.type === "open-editor" && selected) {
        void openHunkInEditor(selected.id)
          .then(() => setToast("Opened editor."))
          .catch((error: unknown) => setToast(editorError(error)));
      }
      if (command.type === "revert" && selected) {
        if (canRevert(meta?.diffSpec)) {
          setRevertDialog(selected);
        } else {
          setToast("Revert works on the working tree. This diff is historical.");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    collapseAll,
    cycleSortMode,
    filterFocused,
    helpOpen,
    paletteOpen,
    searchOpen,
    focusMode,
    flagPickerFor,
    groupPreview,
    fileModal,
    revertDialog,
    decisionLogOpen,
    pendingG,
    selected,
    setHelp,
    setPaletteOpen,
    setSelected,
    setSplit,
    setStatsOpen,
    setTimelineOpen,
    split,
    statsOpen,
    timelineOpen,
    toggleHunkCollapsed,
    toggleFlaggedOnly,
    toggleTheme,
    visible,
    flaggedOnly,
    activeSearchHit
  ]);

  async function refresh(): Promise<void> {
    try {
      const fresh = await refreshReview();
      const [nextStats, nextMeta] = await Promise.all([fetchStats(), fetchMeta()]);
      setData(fresh, nextStats, nextMeta);
      setWatchPulse((value) => value + 1);
      setToast(`Refreshed — ${fresh.hunks.length} hunks`);
      if (timelineOpen) {
        setTimeline(await fetchTimeline());
      }
    } catch {
      setToast("Retry with r.");
    }
  }

  async function persistStatus(
    hunkId: string,
    status: ReviewHunk["status"],
    note: string | undefined,
    via: "single" | "undo" | "redo" | "targeted-undo"
  ): Promise<void> {
    try {
      await setHunkStatus(hunkId, status, note, via);
      retryPersist.current.delete(hunkId);
      markSaved([hunkId]);
    } catch (error) {
      // A local decision is the reviewer’s source of truth until a retry succeeds.
      console.error("Sift could not persist a review decision", error);
      markUnsaved([hunkId]);
      retryPersist.current.set(hunkId, () => persistStatus(hunkId, status, note, via));
      const count = Object.keys(useReviewStore.getState().unsaved).length + (useReviewStore.getState().unsaved[hunkId] ? 0 : 1);
      setToast(`Couldn't save ${count} decision${count === 1 ? "" : "s"} — Retry`);
    }
  }

  async function retryUnsaved(): Promise<void> {
    const retries = [...retryPersist.current.values()];
    if (retries.length === 0) {
      return;
    }
    await Promise.all(retries.map((retry) => retry()));
  }

  async function updateStatus(
    hunk: ReviewHunk,
    status: ReviewHunk["status"],
    note?: string,
    options: { record?: boolean; via?: "single" | "undo" | "redo" | "targeted-undo"; keepSelection?: boolean } = {}
  ): Promise<void> {
    const previous = hunk.status;
    const nextNote = note ?? hunk.note;
    const changed = status !== previous || nextNote !== hunk.note;
    if (options.record !== false && changed) {
      pushUndoEntry([
        { hunkId: hunk.id, prevStatus: previous, prevNote: hunk.note, nextStatus: status, nextNote }
      ]);
      showDecisionToast(status === previous ? `Updated note for ${hunk.file}` : `${statusVerb(status)} ${hunk.file}`, hunk.id);
      if (focusMode && status === "approved") {
        showStamp("verified");
      } else if (focusMode && status === "flagged") {
        showStamp("flagged");
      }
    }
    setStatus(hunk.id, status, nextNote);
    if (!options.keepSelection && (status === "approved" || status === "flagged")) {
      setSelected(nextUnreviewedAfter(visible, hunk.id));
    }
    if (changed) {
      focusDiffPane(diffPaneRef);
    }
    await persistStatus(hunk.id, status, nextNote, options.via ?? "single");
  }

  async function performUndo(): Promise<void> {
    const result = popUndoEntry();
    if (result.message) {
      try {
        const persisted = await fetchJournal();
        setJournal(persisted);
        const latestDecision = persisted.find((entry) => entry.kind !== "revert" || entry.action === "Reverted");
        if (latestDecision) {
          await undoJournalEntry(latestDecision);
          return;
        }
      } catch {
        // Fall through to the truthful empty-history message below.
      }
      setToast("Undo unavailable.");
      return;
    }
    const hunksById = new Map((model?.hunks ?? []).map((hunk) => [hunk.id, hunk]));
    const target = result.restore[0];
    const revertChange = result.restore.find((change) => change.revertId);
    if (revertChange?.revertId) {
      try {
        await targetedUndo(revertChange.revertId);
        await refresh();
        setToast(`Undid revert of ${revertChange.revertPath ?? "file"}`);
      } catch (error) {
        setToast(error instanceof Error && error.message.includes("File changed since") ? "File changed since." : "Undo unavailable.");
      }
      return;
    }
    if (target) {
      setSelected(target.hunkId);
      setPulseHunkId(target.hunkId);
    }
    for (const change of result.restore) {
      const hunk = hunksById.get(change.hunkId);
      if (hunk) {
        await updateStatus(hunk, change.prevStatus, change.prevNote, { record: false, via: "undo", keepSelection: true });
      }
    }
    focusDiffPane(diffPaneRef);
    setToast(result.restore.length > 1 ? `Undid ${result.restore.length} decisions` : "Undid last decision");
  }

  async function performRedo(): Promise<void> {
    const result = popRedoEntry();
    if (result.message) {
      setToast("Redo unavailable.");
      return;
    }
    const changes = result.restore.filter((change) => change.nextStatus !== undefined);
    if (changes.length === 0) {
      setToast("Redo unavailable.");
      return;
    }
    const hunksById = new Map((model?.hunks ?? []).map((hunk) => [hunk.id, hunk]));
    const revertChange = changes.find((change) => change.revertId);
    if (revertChange) {
      const hunk = hunksById.get(revertChange.hunkId);
      if (hunk) {
        setRevertDialog(hunk);
      }
      return;
    }
    const target = changes[0];
    if (target) {
      setSelected(target.hunkId);
      setPulseHunkId(target.hunkId);
    }
    for (const change of changes) {
      const hunk = hunksById.get(change.hunkId);
      if (hunk && change.nextStatus) {
        await updateStatus(hunk, change.nextStatus, change.nextNote, { record: false, via: "redo", keepSelection: true });
      }
    }
    focusDiffPane(diffPaneRef);
    setToast(changes.length > 1 ? `Redid ${changes.length} decisions` : "Redid last decision");
  }

  async function confirmRevert(hunk: ReviewHunk): Promise<void> {
    try {
      const result = await revertHunk(hunk.id);
      pushUndoEntry([
        {
          hunkId: hunk.id,
          prevStatus: hunk.status,
          prevNote: hunk.note,
          nextStatus: "unreviewed",
          revertId: result.id,
          revertPath: result.path
        }
      ]);
      setRevertDialog(null);
      setRevertingHunkIds(new Set(result.hunkIds.length > 0 ? result.hunkIds : [hunk.id]));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
      await refresh();
      setRevertingHunkIds(new Set());
      setToast(`Reverted ${result.path} — Z to undo`);
    } catch (error) {
      setRevertingHunkIds(new Set());
      setToast(error instanceof Error ? error.message : "Revert failed.");
    }
  }

  async function undoJournalEntry(entry: JournalEntry): Promise<void> {
    try {
      const result = await targetedUndo(entry.id);
      await refresh();
      const target = result.hunkIds[0];
      if (target) {
        setSelected(target);
        setPulseHunkId(target);
      }
      focusDiffPane(diffPaneRef);
      setJournal(await fetchJournal());
      setToast(entry.kind === "revert" ? `Undid revert of ${entry.file}` : result.compound ? `Undid ${result.hunkIds.length} grouped decisions` : `Undid ${entry.file}`);
    } catch (error) {
      setToast(error instanceof Error && error.message.includes("File changed since") ? "File changed since." : "Undo unavailable.");
    }
  }

  async function confirmGroupApprove(groupId: string): Promise<void> {
    const changed = (model?.hunks ?? []).filter(
      (hunk) => hunk.groupId === groupId && hunk.status !== "approved"
    );
    const blockedIds = changed.filter((hunk) => hunk.reasons.some((reason) => reason.weight >= 15)).map((hunk) => hunk.id);
    if (blockedIds.length > 0) {
      setGroupPreview({ groupId, blockedIds });
      return;
    }
    setGroupPreview(null);
    if (changed.length === 0) {
      return;
    }
    pushUndoEntry(
      changed.map((hunk) => ({
        hunkId: hunk.id,
        prevStatus: hunk.status,
        prevNote: hunk.note,
        nextStatus: "approved" as const
      }))
    );
    for (const hunk of changed) {
      setStatus(hunk.id, "approved", hunk.note);
    }
    showDecisionToast(`Approved ${model?.groups.find((group) => group.id === groupId)?.title ?? "group"}`, groupId);
    focusDiffPane(diffPaneRef);
    try {
      const result = await approveGroup(groupId);
      if (!result.ok) {
        setGroupPreview({ groupId, blockedIds: result.blockedIds });
        return;
      }
      markSaved(changed.map((hunk) => hunk.id));
    } catch (error) {
      console.error("Sift could not persist a group approval", error);
      const ids = changed.map((hunk) => hunk.id);
      markUnsaved(ids);
      retryPersist.current.set(`group:${groupId}`, () => confirmPersistedGroupApprove(groupId, ids));
      const count = Object.keys(useReviewStore.getState().unsaved).length + ids.filter((id) => !useReviewStore.getState().unsaved[id]).length;
      setToast(`Couldn't save ${count} decisions — Retry`);
    }
  }

  async function confirmPersistedGroupApprove(groupId: string, ids: string[]): Promise<void> {
    try {
      const result = await approveGroup(groupId);
      if (!result.ok) {
        setGroupPreview({ groupId, blockedIds: result.blockedIds });
        return;
      }
      retryPersist.current.delete(`group:${groupId}`);
      markSaved(ids);
    } catch (error) {
      console.error("Sift could not persist a group approval", error);
      setToast(`Couldn't save ${Object.keys(useReviewStore.getState().unsaved).length} decisions — Retry`);
    }
  }

  if (!model || !stats || !meta) {
    return <main className="loading">Loading Sift</main>;
  }

  const liveStats = deriveLiveStats(model, stats) ?? stats;

  if (model.hunks.length === 0) {
    return (
      <main className="empty">
        <h1>Nothing to review</h1>
        <p>{model.meta.diffSpec}</p>
      </main>
    );
  }

  // The workbench counter intentionally counts decisions, matching every
  // group `reviewed/total` tally. Line-based reviewability remains available
  // in Stats, but must not be mixed into this decision-facing invariant.
  const decisionProgress = deriveDecisionProgress(model);
  const reviewedHunkCount = decisionProgress.reviewed;
  const reviewedPct = decisionProgress.total === 0 ? 100 : (reviewedHunkCount / decisionProgress.total) * 100;
  const groupBoundaryPercents = (() => {
    if (decisionProgress.total === 0) {
      return [];
    }
    let reviewedSpace = 0;
    return model.groups.slice(0, -1).flatMap((group) => {
      reviewedSpace += group.hunkIds.length;
      return reviewedSpace < decisionProgress.total ? [(reviewedSpace / decisionProgress.total) * 100] : [];
    });
  })();
  const attentionGroupIds = new Set(
    model.groups.filter((group) => group.kind === "attention").map((group) => group.id)
  );
  const focusHunks = model.hunks.filter((hunk) => attentionGroupIds.has(hunk.groupId));
  const undecidedAttention = focusHunks.filter((hunk) => hunk.status === "unreviewed");
  const reviewComplete = focusHunks.length > 0 && undecidedAttention.length === 0;
  const flaggedHunks = model.hunks.filter((hunk) => hunk.status === "flagged");
  const flaggedCount = flaggedHunks.length;
  const focusHunk =
    focusHunks.find((hunk) => hunk.id === selected?.id) ?? undecidedAttention[0] ?? focusHunks[0];
  const focusIndex = focusHunk ? focusHunks.findIndex((hunk) => hunk.id === focusHunk.id) : -1;

  async function copyReport(): Promise<void> {
    setToast("Copied report.");
    try {
      const markdown = await fetchReport();
      await navigator.clipboard.writeText(markdown);
    } catch {
      setToast("Copy failed.");
    }
  }
  const coverageSecondary =
    liveStats.coverageOnChangedLines === undefined
      ? undefined
      : ` · coverage ${(liveStats.coverageOnChangedLines * 100).toFixed(0)}%`;
  const actions = buildCommandActions({
    model,
    stats: liveStats,
    selected,
    visible,
    split,
    nitsOpen,
    selectHunk: setSelected,
    updateStatus: (status) => selected && void updateStatus(selected, status),
    approveCurrentGroup: () => {
      if (!selected) {
        return;
      }
      setGroupPreview({ groupId: selected.groupId });
    },
    enterFocus: () => setFocusMode(true),
    setSplit,
    cycleSortMode,
    toggleTheme,
    setTheme,
    cycleCodeSize,
    toggleFlaggedOnly,
    toggleNits,
    openTimeline: () => setTimelineOpen(true),
    openStats: () => setStatsOpen(true),
    openHelp: () => {
      dismissShortcutsHint();
      setHelp(true);
    },
    openSearch,
    openDecisionLog: () => setDecisionLogOpen(true),
    openRevert: () => {
      if (!selected) {
        return;
      }
      if (canRevert(meta.diffSpec)) {
        setRevertDialog(selected);
      } else {
        setToast("Revert works on the working tree. This diff is historical.");
      }
    },
    setToast
  });

  return (
    <main className={paneFade ? "shell pane-fade" : "shell"}>
      <header className="topbar">
        <div className="brandline">
          <Logomark />
          <span className="brand-name">Sift</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="repo-name">{repoName(meta.repoRoot)}</span>
          <span className="eyebrow-chip">{meta.diffSpec}</span>
        </div>
        <div className="headline hud">
          <div className="hud-stats">
            <span className="hud-primary">
              {reviewedHunkCount.toLocaleString()} / {decisionProgress.total.toLocaleString()} reviewed
            </span>
            <span className="hud-secondary">
              {model.totals.changedLines.toLocaleString()} lines changed
              {coverageSecondary}
            </span>
          </div>
          {Object.keys(freshIds).length > 0 && (
            <button className={freshOnly ? "fresh-filter active" : "fresh-filter"} onClick={toggleFreshOnly}>
              New ({Object.keys(freshIds).length})
            </button>
          )}
          {(flaggedCount > 0 || flaggedOnly) && (
            <button className={flaggedOnly ? "flagged-filter active" : "flagged-filter"} onClick={toggleFlaggedOnly}>
              Flagged ({flaggedCount}){flaggedOnly ? " ×" : ""}
            </button>
          )}
          <div className="hud-actions">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="ghost theme-trigger" aria-label="Theme">
                  Theme · {themeLabel(theme)}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="theme-menu" align="end" sideOffset={8}>
                  <DropdownMenu.Label>Room</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
                    {(["graphite", "assay", "paper"] as const).map((option) => (
                      <DropdownMenu.RadioItem key={option} value={option} className="theme-menu-item">
                        <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                        {themeLabel(option)}
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <button
              className="ghost"
              onClick={() => {
                dismissShortcutsHint();
                setPaletteOpen(true);
              }}
            >
              <span className="keycap">{modKeycap()}</span> Palette
            </button>
            <button className="ghost" onClick={() => setTimelineOpen(true)}>
              Timeline
            </button>
            <button className="ghost icon-btn history-control" aria-label="History" title="History" onClick={() => setDecisionLogOpen(true)}>
              ↶
            </button>
            <button className="ghost icon-btn redo-control" aria-label="Redo" title="Redo (Shift+Z)" onClick={() => void performRedo()}>
              Redo
            </button>
            <button className="ghost icon-btn" aria-label="Refresh" title="Refresh" onClick={() => void refresh()}>
              ↻
            </button>
          </div>
        </div>
        <div className="hud-progress-ticks" aria-hidden="true">
          {groupBoundaryPercents.map((left) => (
            <span key={left} className="hud-progress-tick" style={{ left: `${left}%` }} />
          ))}
        </div>
        <motion.div
          className="hud-progress-fill"
          initial={false}
          animate={{ width: `${Math.min(100, Math.max(0, reviewedPct))}%` }}
          transition={motionTransition(reducedMotion, SPRING.glide)}
          aria-label={`${reviewedPct.toFixed(0)}% reviewed`}
        >
          {meta.watchActive && (
            <motion.span
              key={watchPulse}
              className="live-dot"
              aria-label="Watch mode active"
              initial={reducedMotion ? false : { opacity: 0.45, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={motionTransition(reducedMotion, SPRING.snap)}
            />
          )}
        </motion.div>
      </header>

      {brief && <Briefing brief={brief} diffKey={`${meta.diffSpec}:${model.meta.git.headSha}`} />}

      <section className="workspace">
        <aside className="queue" aria-label="Review queue">
          <div className="queue-tools">
            <input
              id="queue-filter"
              value={filter}
              placeholder="filter path"
              onChange={(event) => setFilter(event.target.value)}
              onFocus={() => setFilterFocused(true)}
              onBlur={() => setFilterFocused(false)}
            />
            <button className="sort-mode ghost" onClick={() => cycleSortMode()}>
              Sort · {sortLabel(sortMode)} ▾
            </button>
          </div>
          {flaggedOnly && flaggedCount === 0 ? (
            <div className="queue-empty" role="status">No flagged hunks — F to exit</div>
          ) : model.groups.map((group) => {
            const groupHunks = sortReviewHunks(
              model.hunks.filter(
                (hunk) =>
                  hunk.groupId === group.id &&
                  (!freshOnly || freshIds[hunk.id]) &&
                  (!flaggedOnly || hunk.status === "flagged")
              ),
              model,
              sortMode
            );
            if (groupHunks.length === 0) {
              return null;
            }
            const reviewed = model.hunks.filter((hunk) => hunk.groupId === group.id && hunk.status !== "unreviewed").length;
            const isCollapsed = Boolean(collapsed[group.id]);
            const totalLines = group.totalAdded + group.totalRemoved;
            return (
              <div key={group.id} className={`queue-group ${group.kind}`}>
                <button className="group-row" onClick={() => setCollapsed(group.id, !isCollapsed)}>
                  <span className="group-chevron" aria-hidden="true">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="group-title">
                    <span className="group-title-text">{group.title}</span>
                    <span className="group-tally">· {reviewed}/{group.hunkIds.length}</span>
                  </span>
                  <span className="group-ledger" aria-label={`${reviewed} of ${group.hunkIds.length} verdicts`}>
                    {model.hunks
                      .filter((hunk) => hunk.groupId === group.id)
                      .map((hunk) => {
                        const displayStatus = revertingHunkIds.has(hunk.id) ? "reverted" : hunk.status;
                        return <span key={hunk.id} className={`ledger-tick ${displayStatus}`} aria-hidden="true" />;
                      })}
                  </span>
                </button>
                {group.kind === "skim" && (
                  <div className="skim-summary">
                    <span>{group.hunkIds.length} hunks</span>
                    <span>{totalLines.toLocaleString()} lines</span>
                  </div>
                )}
                {group.kind === "skim" && (
                  <button
                    className="approve-group"
                    title="Bulk approval is rejected if any hunk has a hot risk signal"
                    onClick={() => setGroupPreview({ groupId: group.id })}
                  >
                    Approve group
                  </button>
                )}
                {!isCollapsed &&
                  groupHunks
                    .filter((hunk) => !filter || hunk.file.toLowerCase().includes(filter.toLowerCase()))
                    .map((hunk, index) => {
                      const band = visualBand(hunk);
                      const displayStatus = revertingHunkIds.has(hunk.id) ? "reverted" : hunk.status;
                      const firstForFile = groupHunks.findIndex((candidate) => candidate.file === hunk.file) === index;
                      return (
                        <motion.button
                          layout="position"
                          transition={motionTransition(reducedMotion, SPRING.glide)}
                          key={hunk.id}
                          className={`hunk-row ${band} status-${displayStatus} ${firstForFile ? "file-first" : "same-file"} ${selected?.id === hunk.id ? "selected" : ""}`}
                          onClick={() => setSelected(hunk.id)}
                        >
                          <span className={`verdict-rail ${band}`} aria-hidden="true">
                            <motion.span
                              className="verdict-rail-fill"
                              initial={false}
                              animate={{ scaleY: displayStatus === "unreviewed" || displayStatus === "reverted" ? 0 : 1 }}
                              transition={motionTransition(reducedMotion, SPRING.snap)}
                            />
                          </span>
                          <span className="hunk-row-body">
                            <span className="hunk-row-top">
                              {firstForFile ? (
                                <span className="path" title={hunk.file}>
                                  {middleEllipsis(hunk.file, 44)}
                                </span>
                              ) : (
                                <span className="hunk-row-indent" aria-hidden="true" />
                              )}
                              {freshIds[hunk.id] && <span className="fresh-dot" aria-label="Fresh hunk" />}
                              {unsaved[hunk.id] && <span className="unsaved-dot" aria-label="Unsaved decision" />}
                              {hunk.status === "approved" && <span className="mini-stamp verified">✓</span>}
                              {hunk.status === "flagged" && <span className="mini-stamp flagged">⚑</span>}
                            </span>
                            <span className={hunk.status === "flagged" ? "hunk-row-digest flagged-reason" : "hunk-row-digest"}>
                              {hunk.status === "flagged" ? `⚑ ${hunk.note?.trim() || "Flagged"}` : hunk.digest.headline}
                            </span>
                          </span>
                          <span className="hunk-row-score">
                            {band === "critical" && <span className="crit-tag">CRIT</span>}
                            <span className={`risk ${band}`}>{hunk.risk}</span>
                          </span>
                        </motion.button>
                      );
                    })}
              </div>
            );
          })}
        </aside>

        <DiffViewer
          hunk={selected}
          hunks={visible}
          selectedId={selected?.id}
          diffPaneRef={diffPaneRef}
          pulse={selected?.id === pulseHunkId}
          searchLineIndex={selected?.id === activeSearchHit?.hunkId ? activeSearchHit?.lineIndex : undefined}
          searchHunkIds={searchHitIds}
          split={split}
          collapsed={Boolean(selected && hunkCollapsed[selected.id])}
          theme={theme}
          codeSize={codeSize}
          onSelect={setSelected}
          onToggleSplit={() => setSplit(!split)}
          onCycleCodeSize={cycleCodeSize}
          onToggleCollapsed={() => selected && toggleHunkCollapsed(selected.id)}
          onOpenFile={(hunk) =>
            void fetchFile(hunk.file, "new")
              .then((text) => setFileModal({ path: hunk.file, text }))
              .catch(() => setToast("Open failed."))
          }
        />

        <Inspector
          hunk={selected}
          fresh={Boolean(selected && freshIds[selected.id])}
          noteRef={noteRef}
          diffPaneRef={diffPaneRef}
          nitsOpen={nitsOpen}
          onToggleNits={toggleNits}
          onOpenEditor={(hunk) =>
            void openHunkInEditor(hunk.id)
              .then(() => setToast("Opened editor."))
              .catch((error: unknown) => setToast(editorError(error)))
          }
          onCopySuppression={(reason, hunk) =>
            void navigator.clipboard
              .writeText(suppressionRuleFor(reason.code, hunk.file, reason.label))
              .then(() => setToast("Copied rule - paste into .sift/rules.yml"))
              .catch(() => setToast("Copy failed."))
          }
          flagOpen={Boolean(selected && flagPickerFor === selected.id && !focusMode)}
          flagReasons={meta.flagReasons}
          onOpenFlag={() => selected && setFlagPickerFor(selected.id)}
          onPickFlag={(note) => {
            if (selected) {
              setFlagPickerFor(null);
              void updateStatus(selected, "flagged", note.length > 0 ? note : selected.note);
            }
          }}
          onCancelFlag={() => setFlagPickerFor(null)}
           onStatus={(status, note) => selected && void updateStatus(selected, status, note)}
           onUndo={() => void performUndo()}
           onRevert={(hunk) => {
             if (canRevert(meta.diffSpec)) {
               setRevertDialog(hunk);
             } else {
               setToast("Revert works on the working tree. This diff is historical.");
             }
           }}
           canRevert={canRevert(meta.diffSpec)}
         />
      </section>

      {shortcutsHint && <div className="shortcuts-hint">? shortcuts</div>}
      {toastStack.length > 0 && (
        <div className="toast-stack" aria-live="polite" aria-label="Notifications">
          <AnimatePresence initial={!reducedMotion}>
            {toastStack.map((message) => (
              <motion.button
                className="toast"
                key={message}
                layout
                initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                transition={motionTransition(reducedMotion, SPRING.settle)}
                onMouseEnter={() => {
                  const timer = toastTimers.current.get(message);
                  if (timer !== undefined) {
                    window.clearTimeout(timer);
                    toastTimers.current.delete(message);
                  }
                }}
                onMouseLeave={() => scheduleToastDismiss(message)}
                onClick={() => dismissToast(message)}
              >
                {message}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
      {Object.keys(unsaved).length > 0 && (
        <div className="unsaved-notice" role="alert">
          <span>{Object.keys(unsaved).length} decision{Object.keys(unsaved).length === 1 ? "" : "s"} waiting to save</span>
          <button onClick={() => void retryUnsaved()}>Retry</button>
        </div>
      )}
      <AnimatePresence initial={!reducedMotion}>
        {decisionToast && (
          <motion.div
            className="decision-toast"
            aria-live="polite"
            initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={motionTransition(reducedMotion, SPRING.settle)}
            onMouseEnter={() => {
              if (decisionToastTimer.current !== undefined) {
                window.clearTimeout(decisionToastTimer.current);
                decisionToastTimer.current = undefined;
              }
            }}
            onMouseLeave={scheduleDecisionToastDismiss}
          >
            <span>{decisionToast.message}</span>
            <button onClick={() => void performUndo()}>Undo</button>
            <button aria-label="Dismiss decision notice" onClick={dismissDecisionToast}>×</button>
          </motion.div>
        )}
      </AnimatePresence>
      {searchOpen && (
        <div className="diff-search" role="dialog" aria-label="Search diff">
          <input
            ref={searchRef}
            value={searchQuery}
            placeholder="Search changes — use / to filter files"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
              if (event.key === "Enter") {
                event.preventDefault();
                cycleSearch(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span>{searchQuery.trim().length === 0 ? "0/0" : `${searchHits.length === 0 ? 0 : (searchIndex % searchHits.length) + 1}/${searchHits.length}`}</span>
          <button aria-label="Previous search match" onClick={() => cycleSearch(-1)}>‹</button>
          <button aria-label="Next search match" onClick={() => cycleSearch(1)}>›</button>
          <button aria-label="Close search" onClick={closeSearch}>Esc</button>
        </div>
      )}
      {paletteOpen && (
        <CommandPalette
          actions={actions}
          recentIds={recentCommandIds}
          onClose={() => setPaletteOpen(false)}
          onExecute={(action) => setRecentCommandIds((ids) => [action.id, ...ids.filter((id) => id !== action.id)].slice(0, 5))}
        />
      )}
      {timelineOpen && (
        <TimelinePanel
          sessions={timeline}
          loading={timelineLoading}
          hunks={model.hunks}
          onSelect={(id) => {
            setSelected(id);
            setTimelineOpen(false);
          }}
          onClose={() => setTimelineOpen(false)}
        />
      )}
      {statsOpen && <StatsPanel stats={liveStats} model={model} onClose={() => setStatsOpen(false)} />}
      {decisionLogOpen && (
        <DecisionLogPanel entries={journal} onUndo={(entry) => void undoJournalEntry(entry)} onClose={() => setDecisionLogOpen(false)} />
      )}
      {helpOpen && <HelpOverlay tour={helpTour} onClose={() => setHelp(false)} />}
      {fileModal && <FileModal modal={fileModal} onClose={() => setFileModal(null)} />}
      {groupPreview &&
        (() => {
          const group = model.groups.find((candidate) => candidate.id === groupPreview.groupId);
          if (!group) {
            return null;
          }
          return (
            <GroupApprovePreview
              group={group}
              hunks={model.hunks.filter((hunk) => hunk.groupId === group.id)}
              blockedIds={groupPreview.blockedIds}
              onConfirm={() => void confirmGroupApprove(group.id)}
              onCancel={() => setGroupPreview(null)}
            />
          );
         })()}
      {revertDialog && <RevertConfirm hunk={revertDialog} onConfirm={() => void confirmRevert(revertDialog)} onCancel={() => setRevertDialog(null)} />}
      <AnimatePresence initial={false}>
        {focusMode && focusHunk && (
          <FocusMode
          hunk={focusHunk}
          index={focusIndex}
          total={focusHunks.length}
          split={split}
          onApprove={() => void updateStatus(focusHunk, "approved")}
          onFlag={() => setFlagPickerFor(focusHunk.id)}
          flagOpen={flagPickerFor === focusHunk.id}
          flagReasons={meta.flagReasons}
          onPickFlag={(note) => {
            setFlagPickerFor(null);
            void updateStatus(focusHunk, "flagged", note.length > 0 ? note : focusHunk.note);
          }}
          onCancelFlag={() => setFlagPickerFor(null)}
          onSkip={() => setSelected(nextUnreviewedAfter(focusHunks, focusHunk.id))}
          onUndo={() => void performUndo()}
          onRevert={(hunk) => {
            if (canRevert(meta.diffSpec)) {
              setRevertDialog(hunk);
            } else {
              setToast("Revert works on the working tree. This diff is historical.");
            }
          }}
          onToggleSplit={() => setSplit(!split)}
          onExit={() => setFocusMode(false)}
          onOpenEditor={(hunk) =>
            void openHunkInEditor(hunk.id)
              .then(() => setToast("Opened editor."))
              .catch((error: unknown) => setToast(editorError(error)))
          }
          onOpenFile={(hunk) =>
            void fetchFile(hunk.file, "new")
              .then((text) => setFileModal({ path: hunk.file, text }))
              .catch(() => setToast("Open failed."))
          }
          />
        )}
      </AnimatePresence>
      {stamp &&
        // The shell's isolation traps child z-indexes below Radix portals;
        // the hallmark must punch above the focus dialog, so it portals out.
        createPortal(
          <div className="stamp-overlay" aria-hidden="true">
            <Stamp kind={stamp} />
          </div>,
          document.body
        )}
      {flaggedCheckpointActive && !completionDismissed && flaggedCount > 0 && !flaggedCheckpointDismissed && (
        <FlaggedReviewScreen
          hunks={flaggedHunks}
          onUnflag={(hunk) => {
            setFlaggedCheckpointActive(false);
            setFlaggedCheckpointDismissed(false);
            void updateStatus(hunk, "unreviewed", hunk.note);
          }}
          onContinue={() => setFlaggedCheckpointDismissed(true)}
        />
      )}
      {(reviewComplete || flaggedCheckpointActive) && !completionDismissed && (flaggedCount === 0 || flaggedCheckpointDismissed) && (
        <CompletionScreen
          model={model}
          stats={liveStats}
          onCopyReport={() => void copyReport()}
          onShowDecisions={() => setDecisionLogOpen(true)}
          onBackToQueue={() => {
            setCompletionDismissed(true);
            setFlaggedCheckpointActive(false);
            setFocusMode(false);
          }}
        />
      )}
    </main>
  );
}

function sortLabel(mode: "risk" | "reading" | "path"): string {
  return mode === "risk" ? "Risk" : mode === "reading" ? "Reading" : "Path";
}

function themeLabel(theme: "graphite" | "assay" | "paper"): string {
  return theme === "graphite" ? "Graphite" : theme === "assay" ? "Assay" : "Paper";
}

function canRevert(diffSpec: string | undefined): boolean {
  const scope = diffSpec?.trim().toUpperCase();
  return scope === "WORKTREE" || scope === "STAGED";
}

function editorError(error: unknown): string {
  return error instanceof Error ? error.message : "Editor could not be opened.";
}

function aiAnnotationsFor(hunk: ReviewHunk): NonNullable<ReviewHunk["aiAnnotations"]> {
  if (hunk.aiAnnotations && hunk.aiAnnotations.length > 0) {
    return hunk.aiAnnotations;
  }
  if (!hunk.aiSummary) {
    return [];
  }
  return [
    {
      provider: "unknown",
      model: "legacy",
      summary: hunk.aiSummary,
      concern: hunk.aiConcern ?? null,
      drift: null
    }
  ];
}

function providerLabel(provider: string): string {
  return provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "AI";
}

function DiffViewer({
  hunk,
  hunks,
  selectedId,
  diffPaneRef,
  pulse = false,
  split,
  collapsed,
  onSelect,
  onToggleSplit,
  onToggleCollapsed,
  onOpenFile,
  searchLineIndex,
  searchHunkIds,
  theme = "graphite",
  codeSize = 13,
  onCycleCodeSize
}: {
  hunk?: ReviewHunk;
  hunks: ReviewHunk[];
  selectedId?: string;
  diffPaneRef?: RefObject<HTMLElement>;
  pulse?: boolean;
  split: boolean;
  collapsed: boolean;
  onSelect(id?: string): void;
  onToggleSplit(): void;
  onToggleCollapsed(): void;
  onOpenFile(hunk: ReviewHunk): void;
  searchLineIndex?: number;
  searchHunkIds?: Set<string>;
  theme?: "graphite" | "assay" | "paper";
  codeSize?: 12 | 13 | 14;
  onCycleCodeSize(): void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const [widePath, setWidePath] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1280px)").matches : true
  );
  const rowVirtualizer = useVirtualizer({
    count: collapsed ? 0 : hunk?.lines.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => codeSize * 1.55 + 4,
    overscan: 12
  });
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setWidePath(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    if (!hunk || collapsed) {
      return () => {
        cancelled = true;
      };
    }
    void highlightDiffLines(hunk.id, hunk.language, hunk.lines, theme).then((html) => {
      if (!cancelled) {
        setHighlightedLines(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [collapsed, hunk, theme]);
  useEffect(() => {
    if (searchLineIndex !== undefined && !collapsed) {
      rowVirtualizer.scrollToIndex(searchLineIndex, { align: "center" });
    }
  }, [collapsed, rowVirtualizer, searchLineIndex]);
  if (!hunk) {
    return <section ref={diffPaneRef} className="diff" tabIndex={-1}>No hunk selected</section>;
  }
  const reasonLines = new Set(hunk.reasons.flatMap((reason) => (reason.line ? [reason.line] : [])));
  const displayPath = widePath ? hunk.file : middleEllipsis(hunk.file, 36);
  const band = visualBand(hunk);
  return (
    <section ref={diffPaneRef} className={`diff band-${band} ${split ? "split" : "unified"} ${pulse ? "decision-pulse" : ""}`} tabIndex={-1}>
      <div className="diff-header">
        <div className="diff-title">
          <strong className={`diff-path ${displayPath !== hunk.file ? "is-truncated" : ""}`} title={hunk.file}>
            {displayPath}
          </strong>
          <span className="diff-header-meta">{hunk.header}</span>
          <ReasonChips hunk={hunk} />
          <CoverageBadge hunk={hunk} />
        </div>
        <div className="diff-actions">
          <button className="ghost" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button className="ghost" onClick={onToggleSplit}>
            {split ? "Unified" : "Split"}
          </button>
          <button className="ghost" aria-label="Cycle code size" title="Cycle code size" onClick={onCycleCodeSize}>
            {codeSize}px
          </button>
          <button className="ghost" onClick={() => onOpenFile(hunk)}>
            Open full file
          </button>
        </div>
      </div>
      {collapsed ? (
        <div className="diff-collapsed">
          <strong>Hunk body collapsed</strong>
          <span>
            {hunk.addedLines.toLocaleString()} added, {hunk.removedLines.toLocaleString()} removed
          </span>
        </div>
      ) : (
        <div ref={parentRef} className="diff-body">
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const line = hunk.lines[virtualRow.index];
              if (!line) {
                return null;
              }
              const marked = line.newLine && reasonLines.has(line.newLine);
              return (
                <div
                  key={virtualRow.key}
                  className={`diff-line ${line.kind} ${marked ? "marked" : ""} ${searchLineIndex === virtualRow.index ? "search-hit" : ""}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className="oldno">{line.oldLine ?? ""}</span>
                  <span className="newno">{line.newLine ?? ""}</span>
                  {highlightedLines?.[virtualRow.index] ? (
                    <code dangerouslySetInnerHTML={{ __html: highlightedLines[virtualRow.index] ?? "" }} />
                  ) : line.segments ? (
                    <code>
                      {line.segments.map((segment, index) => (
                        <span key={`${index}-${segment.text}`} className={segment.changed ? "word-change" : undefined}>
                          {segment.text}
                        </span>
                      ))}
                    </code>
                  ) : (
                    <code>{line.text}</code>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <MiniMap hunks={hunks} selectedId={selectedId} onSelect={onSelect} searchHunkIds={searchHunkIds} />
    </section>
  );
}

export function Logomark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="logomark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" transform="rotate(-8 12 12)" />
      <circle cx="8" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Stamp({ kind }: { kind: "verified" | "flagged" }) {
  const reducedMotion = useReducedMotion();
  return (
    <span className="stamp-wrap">
      <motion.span
        className={`stamp-shock stamp-${kind}`}
        aria-hidden="true"
        initial={reducedMotion ? false : { opacity: 0.5, scale: 0.86 }}
        animate={{ opacity: 0, scale: 1.16 }}
        transition={motionTransition(reducedMotion, { duration: 0.42, ease: "easeOut" })}
      />
      <motion.span
        className={`stamp stamp-${kind}`}
        role="img"
        aria-label={kind === "verified" ? "Verified" : "Flagged"}
        initial={reducedMotion ? false : { opacity: 0, scale: 1.24, rotate: -6 }}
        animate={{ opacity: 1, scale: 1, rotate: -6 }}
        transition={motionTransition(reducedMotion, { type: "spring", stiffness: 640, damping: 27 })}
      >
        {kind === "verified" ? "VERIFIED" : "FLAGGED"}
      </motion.span>
    </span>
  );
}

export function DigestBlock({ hunk }: { hunk: ReviewHunk }) {
  const aiLine = aiHeadlineFor(hunk);
  return (
    <section className="digest-block" aria-label="Change digest">
      <p className="digest-headline">{renderInlineCode(hunk.digest.headline)}</p>
      {aiLine && (
        <p className="digest-ai-line">
          <span className="chip ai-chip">AI · {providerLabel(aiLine.provider)}</span>
          <span className="digest-ai-text">{aiLine.summary}</span>
        </p>
      )}
      {hunk.digest.details.length > 0 && (
        <ul className="digest-details">
          {hunk.digest.details.map((detail, index) => (
            <li key={index}>{renderInlineCode(detail)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function aiHeadlineFor(hunk: ReviewHunk): { provider: string; summary: string } | undefined {
  const annotations = aiAnnotationsFor(hunk);
  const primary = annotations.find((annotation) => annotation.provider !== "unknown") ?? annotations[0];
  return primary?.summary ? { provider: primary.provider, summary: primary.summary } : undefined;
}

export function IntentBlock({ provenance }: { provenance: NonNullable<ReviewHunk["provenance"]> }) {
  const [expanded, setExpanded] = useState(false);
  const reasoning = provenance.reasoningExcerpt;
  return (
    <section className="intent-block" aria-label="Intent">
      <div className="intent-source">
        <span className="chip source-chip">{sourceLabel(provenance.source)}</span>
        <span className="intent-match">line match {(provenance.confidence * 100).toFixed(0)}%</span>
      </div>
      {provenance.userPromptExcerpt && (
        <p className="intent-line">
          <span className="intent-label">Asked</span>
          <span className="intent-text">&ldquo;{provenance.userPromptExcerpt}&rdquo;</span>
        </p>
      )}
      {reasoning && (
        <p className="intent-line">
          <span className="intent-label">Agent</span>
          <span className={`intent-text intent-reasoning${expanded ? " expanded" : ""}`}>
            &ldquo;{reasoning}&rdquo;
          </span>
          {reasoning.length > 120 && (
            <button className="intent-expand" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "less" : "more"}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

function FocusMode({
  hunk,
  index,
  total,
  split,
  onApprove,
  onFlag,
  flagOpen,
  flagReasons,
  onPickFlag,
  onCancelFlag,
  onSkip,
  onUndo,
  onRevert,
  onToggleSplit,
  onExit,
  onOpenEditor,
  onOpenFile
}: {
  hunk: ReviewHunk;
  index: number;
  total: number;
  split: boolean;
  onApprove(): void;
  onFlag(): void;
  flagOpen: boolean;
  flagReasons?: string[];
  onPickFlag(note: string): void;
  onCancelFlag(): void;
  onSkip(): void;
  onUndo(): void;
  onRevert(hunk: ReviewHunk): void;
  onToggleSplit(): void;
  onExit(): void;
  onOpenEditor(hunk: ReviewHunk): void;
  onOpenFile(hunk: ReviewHunk): void;
}) {
  const reducedMotion = useReducedMotion();
  const primaryReasons = hunk.reasons.filter((reason) => reason.tier !== "nit");
  const band = visualBand(hunk);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "R" && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        onRevert(hunk);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hunk, onRevert]);
  return (
    <InstrumentDialog className="focus-backdrop" label="Focus mode" onClose={onExit}>
      <motion.article
        className={`focus-card band-${band}`}
        initial={reducedMotion ? false : { opacity: 0, x: 16, rotate: 2 }}
        animate={{ opacity: 1, x: 0, rotate: 0 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 16, rotate: 2 }}
        transition={motionTransition(reducedMotion, SPRING.settle)}
      >
        <header className="focus-head">
          <span className="focus-crumb">{hunk.file}</span>
          <span className={`focus-band ${band}`}>{bandLabel(band)}</span>
          <span className="focus-counter">
            {index + 1} of {total}
          </span>
          <button className="focus-exit" onClick={onExit} aria-label="Exit focus mode">
            <span className="keycap">esc</span>
          </button>
        </header>
        <DigestBlock hunk={hunk} />
        {hunk.provenance && <IntentBlock provenance={hunk.provenance} />}
        {primaryReasons.length > 0 && (
          <div className="focus-reasons">
            {primaryReasons.map((reason) => (
              <div key={`${reason.code}-${reason.line ?? ""}`} className="focus-reason">
                <span className="reason-label">
                  {reason.weight < 0 ? `− ${reason.label}` : reason.label}
                </span>
                <span className="reason-meta">
                  {reason.code} · {formatWeight(reason.weight)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="focus-diff">
          <DiffViewer
            hunk={hunk}
            hunks={[hunk]}
            selectedId={hunk.id}
            split={split}
            collapsed={false}
            onSelect={() => undefined}
            onToggleSplit={onToggleSplit}
            onCycleCodeSize={() => undefined}
            onToggleCollapsed={() => undefined}
            onOpenFile={onOpenFile}
          />
        </div>
        <CoverageBadge hunk={hunk} />
        <div className="focus-actions">
          <button className="primary" onClick={onApprove}>
            <span className="keycap">a</span> Approve
          </button>
          <QuickFlagPicker
            open={flagOpen}
            reasons={flagReasons}
            onPick={onPickFlag}
            onCancel={onCancelFlag}
            trigger={
              <button className="danger" onClick={onFlag}>
                <span className="keycap">x</span> Flag
              </button>
            }
          />
          <button className="ghost" onClick={onSkip}>
            <span className="keycap">j</span> Skip
          </button>
          <button className="ghost" onClick={onUndo}>
            <span className="keycap">z</span> Undo
          </button>
          <button className="ghost" onClick={() => onRevert(hunk)}>
            <span className="keycap">R</span> Revert
          </button>
          <button className="ghost" onClick={() => onOpenEditor(hunk)}>
            <span className="keycap">e</span> Open in editor
          </button>
        </div>
      </motion.article>
    </InstrumentDialog>
  );
}

export function Briefing({ brief, diffKey }: { brief: ReviewBrief; diffKey: string }) {
  const storageKey = `sift-briefing-${diffKey}`;
  const [state, setState] = useState<"expanded" | "collapsed" | "dismissed">(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored === "collapsed" || stored === "dismissed" ? stored : "expanded";
    } catch {
      return "expanded";
    }
  });
  function persist(next: "expanded" | "collapsed" | "dismissed"): void {
    setState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Persistence is best-effort.
    }
  }
  if (state === "dismissed") {
    return null;
  }
  return (
    <section className="briefing" aria-label="AI briefing">
      <div className="briefing-head">
        <span className="chip ai-chip">AI · {providerLabel(brief.provider)}</span>
        <button
          className="briefing-toggle"
          onClick={() => persist(state === "expanded" ? "collapsed" : "expanded")}
        >
          Briefing {state === "expanded" ? "▾" : "▸"}
        </button>
        <button className="briefing-dismiss" onClick={() => persist("dismissed")} aria-label="Dismiss briefing">
          ✕
        </button>
      </div>
      {state === "expanded" && (
        <div className="briefing-body">
          <p className="briefing-story">{brief.story}</p>
          {brief.readingHint && (
            <p className="briefing-hint">
              <span className="intent-label">Start</span> {brief.readingHint}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Inspector({
  hunk,
  fresh,
  noteRef,
  diffPaneRef,
  nitsOpen,
  onToggleNits,
  onOpenEditor,
  onCopySuppression,
  flagOpen,
  flagReasons,
  onOpenFlag,
  onPickFlag,
  onCancelFlag,
  onStatus,
  onUndo,
  onRevert,
  canRevert
}: {
  hunk?: ReviewHunk;
  fresh: boolean;
  noteRef: RefObject<HTMLTextAreaElement>;
  diffPaneRef: RefObject<HTMLElement>;
  nitsOpen: boolean;
  onToggleNits(): void;
  onOpenEditor(hunk: ReviewHunk): void;
  onCopySuppression(reason: ReviewHunk["reasons"][number], hunk: ReviewHunk): void;
  flagOpen: boolean;
  flagReasons?: string[];
  onOpenFlag(): void;
  onPickFlag(note: string): void;
  onCancelFlag(): void;
  onStatus(status: ReviewHunk["status"], note?: string): void;
  onUndo(): void;
  onRevert(hunk: ReviewHunk): void;
  canRevert: boolean;
}) {
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote(hunk?.note ?? "");
  }, [hunk?.id, hunk?.note]);
  if (!hunk) {
    return <aside className="inspector">No hunk selected</aside>;
  }
  const aiAnnotations = aiAnnotationsFor(hunk);
  const judgesDisagree =
    aiAnnotations.length > 1 && new Set(aiAnnotations.map((annotation) => Boolean(annotation.concern))).size > 1;
  const primaryReasons = hunk.reasons.filter((reason) => reason.tier !== "nit");
  const nitReasons = hunk.reasons.filter((reason) => reason.tier === "nit");
  const band = visualBand(hunk);
  return (
    <aside className="inspector">
      <div className="risk-lockup-row">
        <div className="risk-lockup">
          <span className={`risk-score ${band}`}>{hunk.risk}</span>
          <span className={`risk-band-name ${band}`}>{bandLabel(band)}</span>
        </div>
        {fresh && <span className="fresh-chip">fresh</span>}
      </div>
      <div className="risk-gauge" aria-hidden="true">
        <span className={`risk-gauge-needle ${band}`} style={{ left: `${Math.min(100, Math.max(0, hunk.risk))}%` }} />
      </div>
      <section className="review-pinned" aria-label="Review actions">
        <div className="review-actions">
          <button className="primary" onClick={() => onStatus("approved", note)}>
            <span className="keycap">a</span> Approve
          </button>
          <QuickFlagPicker
            open={flagOpen}
            reasons={flagReasons}
            onPick={onPickFlag}
            onCancel={onCancelFlag}
            trigger={
              <button className="danger" onClick={onOpenFlag}>
                <span className="keycap">x</span> Flag
              </button>
            }
          />
          <button className="ghost" onClick={onUndo}>
            <span className="keycap">z</span> Undo
          </button>
          <button className="ghost" onClick={() => onOpenEditor(hunk)}>
            <span className="keycap">e</span> Open in editor
          </button>
          <button
            className="ghost"
            title={canRevert ? "Revert this file (R)" : "Revert works on the working tree. This diff is historical."}
            disabled={!canRevert}
            onClick={() => onRevert(hunk)}
          >
            <span className="keycap">R</span> Revert
          </button>
        </div>
      </section>
      <DigestBlock hunk={hunk} />
      {hunk.provenance && <IntentBlock provenance={hunk.provenance} />}
      <section>
        <h2>Reasons</h2>
        {hunk.reasons.length === 0 ? (
          <p>No extra signals.</p>
        ) : (
          <>
            {primaryReasons.map((reason) => (
              <ReasonDetail
                key={`${reason.code}-${reason.line ?? ""}`}
                reason={reason}
                onCopy={() => onCopySuppression(reason, hunk)}
              />
            ))}
            {nitReasons.length > 0 && (
              <details className="nit-section" open={nitsOpen} onToggle={onToggleNits}>
                <summary>Nits ({nitReasons.length})</summary>
                {nitReasons.map((reason) => (
                  <ReasonDetail
                    key={`${reason.code}-${reason.line ?? ""}`}
                    reason={reason}
                    onCopy={() => onCopySuppression(reason, hunk)}
                  />
                ))}
              </details>
            )}
          </>
        )}
      </section>
      <section>
        <h2>Coverage</h2>
        {hunk.coverage ? <CoverageBadge hunk={hunk} /> : <p>No coverage evidence.</p>}
      </section>
      <section>
        <h2>Provenance</h2>
        {hunk.provenance ? (
          <div className="provenance">
            <p>
              {sourceLabel(hunk.provenance.source)} session {hunk.provenance.sessionId.slice(0, 8)}
            </p>
            <div className="provenance-actions">
              <button
                className="ghost"
                onClick={() => void navigator.clipboard.writeText(hunk.provenance?.transcriptPath ?? "")}
              >
                <span className="copy-icon" aria-hidden="true">
                  ⎘
                </span>
                Copy transcript path
              </button>
            </div>
          </div>
        ) : (
          <p>No provenance. Run `sift hooks install` or emit JSONL.</p>
        )}
      </section>
      {aiAnnotations.length > 0 && (
        <section>
          <h2>
            AI {judgesDisagree && <span className="ai-badge">judges disagree</span>}
          </h2>
          {aiAnnotations.map((annotation) => (
            <div className="ai-annotation" key={`${annotation.provider}-${annotation.model}`}>
              <p>
                <strong>{providerLabel(annotation.provider)}</strong> {annotation.summary}
              </p>
              {annotation.concern && <p>{annotation.concern}</p>}
              {annotation.drift && (
                <p>
                  <span className="ai-badge">drift?</span> {annotation.drift}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="review-note">
        <textarea
          ref={noteRef}
          value={note}
          placeholder="note"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            onStatus(hunk.status, note);
            focusDiffPane(diffPaneRef);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              focusDiffPane(diffPaneRef);
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              onStatus(hunk.status, note);
            }
          }}
        />
      </section>
    </aside>
  );
}

function InstrumentDialog({
  label,
  onClose,
  className,
  children
}: {
  label: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className={`dialog-content ${className ?? ""}`} aria-label={label}>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RevertConfirm({ hunk, onConfirm, onCancel }: { hunk: ReviewHunk; onConfirm(): void; onCancel(): void }) {
  return (
    <InstrumentDialog className="revert-overlay" label="Confirm file revert" onClose={onCancel}>
      <article className="revert-confirm">
        <h1>Revert {hunk.file}?</h1>
        <p>Discards +{hunk.addedLines}/−{hunk.removedLines} of changes to this file.</p>
        <p>A snapshot is kept — Z undoes this.</p>
        <div className="review-actions">
          <button className="danger destructive" onClick={onConfirm}>Revert</button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </article>
    </InstrumentDialog>
  );
}

function CommandPalette({
  actions,
  recentIds,
  onClose,
  onExecute
}: {
  actions: CommandAction[];
  recentIds: string[];
  onClose(): void;
  onExecute(action: CommandAction): void;
}) {
  const reducedMotion = useReducedMotion();
  const recent = recentIds
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is CommandAction => Boolean(action));
  const groups = ["Review", "Navigate", "View", "Setup"].map((name) => ({
    name,
    actions: actions.filter((action) => commandGroup(action) === name && !recentIds.includes(action.id))
  }));

  function execute(action: CommandAction): void {
    action.run();
    onExecute(action);
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="dialog-content palette-dialog" aria-label="Command palette">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <motion.div
            className="palette"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={motionTransition(reducedMotion, SPRING.settle)}
          >
            <Command label="Command palette">
              <Command.Input aria-label="Search commands" placeholder="Run command or jump to file" />
              <Command.List>
                <Command.Empty>No matching commands</Command.Empty>
                {recent.length > 0 && <CommandGroup heading="Recent commands" actions={recent} onSelect={execute} />}
                {groups.map((group) =>
                  group.actions.length > 0 ? <CommandGroup key={group.name} heading={group.name} actions={group.actions} onSelect={execute} /> : null
                )}
              </Command.List>
            </Command>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandGroup({ heading, actions, onSelect }: { heading: string; actions: CommandAction[]; onSelect(action: CommandAction): void }) {
  return (
    <Command.Group heading={heading}>
      {actions.map((action) => (
        <Command.Item key={action.id} value={`${action.title} ${action.keywords ?? ""}`} onSelect={() => onSelect(action)}>
          <span>{action.title}</span>
          <span className="palette-key keycap">{action.shortcut ?? "—"}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}

function TimelinePanel({
  sessions,
  loading,
  hunks,
  onSelect,
  onClose
}: {
  sessions: ProvenanceTimelineSession[] | null;
  loading: boolean;
  hunks: ReviewHunk[];
  onSelect(id: string): void;
  onClose(): void;
}) {
  const hunkById = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  return (
    <InstrumentDialog className="timeline-dialog" label="Provenance timeline" onClose={onClose}>
      <aside className="timeline-panel" aria-label="Provenance timeline">
      <div className="panel-heading">
        <h1>Timeline</h1>
        <button onClick={onClose}>Close</button>
      </div>
      {loading && <p>Loading timeline</p>}
      {!loading && (!sessions || sessions.length === 0) && (
        <div className="timeline-empty">
          <Logomark size={40} />
          <p>No agent sessions matched this diff.</p>
          <p className="empty-hint">
            <code className="inline-code-chip">sift hooks install</code>
            {" · "}
            <a href="docs/PROVENANCE.md#sift-provenance">Learn how</a>
          </p>
        </div>
      )}
      {!loading &&
        sessions &&
        sessions.length > 0 &&
        sessions.map((session) => (
          <section className="timeline-session" key={`${session.source}-${session.sessionId}`}>
            <div className="session-head">
              <span className="source-badge">{sourceLabel(session.source)}</span>
              <span>{timeRange(session)}</span>
            </div>
            <strong>{session.sessionId.slice(0, 12)}</strong>
            {session.promptExcerpts.slice(0, 3).map((excerpt) => (
              <p key={excerpt}>{excerpt}</p>
            ))}
            <div className="timeline-hunks">
              {session.hunkIds.map((id) => {
                const hunk = hunkById.get(id);
                return (
                  <button key={id} className={`hunk-chip ${hunk ? visualBand(hunk) : ""}`} onClick={() => onSelect(id)}>
                    {hunk ? `${hunk.file}:${hunk.newStart ?? hunk.oldStart ?? 0}` : id.slice(0, 8)}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </aside>
    </InstrumentDialog>
  );
}

function StatsPanel({ stats, model, onClose }: { stats: StatsSnapshot; model: ReviewModel; onClose(): void }) {
  return (
    <InstrumentDialog label="Stats" onClose={onClose}>
      <div className="stats-panel">
        <div className="panel-heading">
          <h1>Stats</h1>
          <button onClick={onClose}>Close</button>
        </div>
        <dl>
          <div>
            <dt>Changed lines</dt>
            <dd>{stats.changedLines.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Reviewable lines</dt>
            <dd>{stats.reviewableLines.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Debt</dt>
            <dd>{(stats.debt * 100).toFixed(0)}%</dd>
          </div>
          <div>
            <dt>Flagged hunks</dt>
            <dd>{stats.flaggedHunks}</dd>
          </div>
          <div>
            <dt>Line match</dt>
            <dd>{(stats.provenanceCoverage * 100).toFixed(0)}%</dd>
          </div>
          {stats.coverageOnChangedLines !== undefined && (
            <div>
              <dt>Coverage on changed lines</dt>
              <dd>{(stats.coverageOnChangedLines * 100).toFixed(0)}%</dd>
            </div>
          )}
          <div>
            <dt>Groups</dt>
            <dd>{model.groups.length}</dd>
          </div>
        </dl>
      </div>
    </InstrumentDialog>
  );
}

function MiniMap({
  hunks,
  selectedId,
  onSelect,
  searchHunkIds
}: {
  hunks: ReviewHunk[];
  selectedId?: string;
  onSelect(id?: string): void;
  searchHunkIds?: Set<string>;
}) {
  if (hunks.length === 0) {
    return null;
  }
  return (
    <Tooltip.Provider delayDuration={180}>
      <div className="minimap" aria-label="Diff minimap">
        {hunks.map((hunk, index) => {
          const top = hunks.length === 1 ? 50 : (index / (hunks.length - 1)) * 100;
          return (
            <Tooltip.Root key={hunk.id}>
              <Tooltip.Trigger asChild>
                <button
                  className={`minimap-marker ${visualBand(hunk)} ${selectedId === hunk.id ? "current" : ""} ${searchHunkIds?.has(hunk.id) ? "search-match" : ""}`}
                  style={{ top: `${top}%` }}
                  aria-label={`${hunk.file} · score ${hunk.risk}`}
                  onClick={() => onSelect(hunk.id)}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="minimap-tooltip" side="left" sideOffset={8}>
                  {hunk.file} · {hunk.risk}
                  <Tooltip.Arrow />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </div>
    </Tooltip.Provider>
  );
}

function HelpOverlay({ tour, onClose }: { tour: boolean; onClose(): void }) {
  return (
    <InstrumentDialog label="Keyboard shortcuts" onClose={onClose}>
      <div className="help">
        <button onClick={onClose}>Close</button>
        <h1>Keys</h1>
        {tour && (
          <div className="tour-strip">
            {FIRST_RUN_OVERLAY_STEPS.map((step) => (
              <span key={step}>{step}</span>
            ))}
          </div>
        )}
        {HELP_OVERLAY_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </InstrumentDialog>
  );
}

function FileModal({ modal, onClose }: { modal: { path: string; text: string }; onClose(): void }) {
  return (
    <InstrumentDialog label={`File ${modal.path}`} onClose={onClose}>
      <div className="file-modal">
        <button onClick={onClose}>Close</button>
        <h1>{modal.path}</h1>
        <pre>{modal.text}</pre>
      </div>
    </InstrumentDialog>
  );
}

function ReasonChips({ hunk }: { hunk: ReviewHunk }) {
  const primary = hunk.reasons
    .filter((reason) => reason.tier !== "nit")
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const top = primary[0];
  const hidden = primary.length - 1;
  if (!top) {
    return null;
  }
  const band = visualBand(hunk);
  return (
    <span className="reason-chips">
      <span className={`reason-chip ${band} ${top.weight < 0 ? "reducer" : ""}`}>{top.label}</span>
      {hidden > 0 && <span className="reason-more">+{hidden}</span>}
    </span>
  );
}

function ReasonDetail({ reason, onCopy }: { reason: ReviewHunk["reasons"][number]; onCopy(): void }) {
  return (
    <details className={`reason-detail ${reason.weight < 0 ? "reducer" : ""}`}>
      <summary>
        <button
          className="copy-suppression"
          type="button"
          aria-label={`Copy suppression rule for ${reason.code}`}
          onClick={(event) => {
            event.preventDefault();
            onCopy();
          }}
        >
          Copy rule
        </button>
        <span className="reason-label">{reason.weight < 0 ? `− ${reason.label}` : reason.label}</span>
        <span className="reason-meta">
          {reason.code} · {formatWeight(reason.weight)}
        </span>
      </summary>
      {reason.evidence && <code>{reason.evidence}</code>}
    </details>
  );
}

function CoverageBadge({ hunk }: { hunk: ReviewHunk }) {
  if (!hunk.coverage) {
    return null;
  }
  const { covered, total, stale } = hunk.coverage;
  const ratio = total === 0 ? 0 : covered / total;
  const tone = stale ? "stale" : total === 0 || covered === 0 ? "empty" : ratio >= 0.8 ? "good" : "partial";
  return <span className={`coverage-badge ${tone}`}>cov {covered}/{total}{stale ? " stale" : ""}</span>;
}

function buildCommandActions({
  model,
  stats,
  selected,
  visible,
  split,
  nitsOpen,
  selectHunk,
  updateStatus,
  approveCurrentGroup,
  setSplit,
  cycleSortMode,
  toggleTheme,
  setTheme,
  cycleCodeSize,
  toggleFlaggedOnly,
  toggleNits,
  openTimeline,
  openStats,
  openHelp,
  openSearch,
  openDecisionLog,
  openRevert,
  enterFocus,
  setToast
}: {
  model: ReviewModel;
  stats: StatsSnapshot;
  selected?: ReviewHunk;
  visible: ReviewHunk[];
  split: boolean;
  nitsOpen: boolean;
  selectHunk(id?: string): void;
  updateStatus(status: ReviewHunk["status"]): void;
  approveCurrentGroup(): void;
  enterFocus(): void;
  setSplit(split: boolean): void;
  cycleSortMode(): void;
  toggleTheme(): void;
  setTheme(theme: "graphite" | "assay" | "paper"): void;
  cycleCodeSize(): void;
  toggleFlaggedOnly(): void;
  toggleNits(): void;
  openTimeline(): void;
  openStats(): void;
  openHelp(): void;
  openSearch(): void;
  openDecisionLog(): void;
  openRevert(): void;
  setToast(message?: string): void;
}): CommandAction[] {
  const selectRelative = (title: string, id: string, predicate: (hunk: ReviewHunk) => boolean, delta: 1 | -1) => ({
    id,
    title,
    run: () => {
      const hunk = findRelativeHunk(visible, selected?.id, predicate, delta);
      if (hunk) {
        selectHunk(hunk.id);
      } else {
        setToast("Refine search.");
      }
    }
  });
  const actions: CommandAction[] = [
    selectRelative("Next high-risk hunk", "next-high", (hunk) => hunk.risk >= 70, 1),
    selectRelative("Previous high-risk hunk", "prev-high", (hunk) => hunk.risk >= 70, -1),
    {
      id: "next-unreviewed",
      title: "Next unreviewed attention hunk",
      run: () =>
        selectHunk(
          nextAttentionUnreviewed(
            {
              selectedId: selected?.id,
              split,
              helpOpen: false,
              filterOpen: false,
              allIds: visible.map((hunk) => hunk.id),
              hunks: visible,
              pendingG: false
            },
            1
          )
        )
    },
    {
      id: "prev-unreviewed",
      title: "Previous unreviewed attention hunk",
      run: () =>
        selectHunk(
          nextAttentionUnreviewed(
            {
              selectedId: selected?.id,
              split,
              helpOpen: false,
              filterOpen: false,
              allIds: visible.map((hunk) => hunk.id),
              hunks: visible,
              pendingG: false
            },
            -1
          )
        )
    },
    selectRelative("Next flagged hunk", "next-flagged", (hunk) => hunk.status === "flagged", 1),
    { id: "approve", title: "Approve current hunk", run: () => updateStatus("approved") },
    { id: "flag", title: "Flag current hunk", run: () => updateStatus("flagged") },
    { id: "unreview", title: "Mark current hunk unreviewed", run: () => updateStatus("unreviewed") },
    { id: "approve-group", title: "Approve current group", run: approveCurrentGroup },
    { id: "focus", title: "Enter focus mode", run: enterFocus },
    { id: "toggle-split", title: split ? "Switch to unified diff" : "Switch to split diff", run: () => setSplit(!split) },
    { id: "cycle-sort", title: "Cycle sort mode", run: cycleSortMode },
    { id: "toggle-theme", title: "Toggle theme", run: toggleTheme },
    { id: "theme-graphite", title: "Use Graphite theme", keywords: "theme dark", run: () => setTheme("graphite") },
    { id: "theme-assay", title: "Use Assay theme", keywords: "theme dark", run: () => setTheme("assay") },
    { id: "theme-paper", title: "Use Paper theme", keywords: "theme light", run: () => setTheme("paper") },
    { id: "cycle-code-size", title: "Cycle code size (12 / 13 / 14px)", run: cycleCodeSize },
    { id: "show-flagged", title: "Show flagged only", keywords: "F filter", run: toggleFlaggedOnly },
    { id: "recent-decisions", title: "Recent decisions", keywords: "history undo", run: openDecisionLog },
    { id: "revert-file", title: "Revert current file", keywords: "R destructive snapshot", run: openRevert },
    { id: "toggle-nits", title: nitsOpen ? "Collapse nits" : "Expand nits", run: toggleNits },
    { id: "timeline", title: "Open timeline", run: openTimeline },
    { id: "stats", title: `Open stats (${(stats.debt * 100).toFixed(0)}% debt)`, run: openStats },
    { id: "help", title: "Open help", run: openHelp },
    { id: "search", title: "Search diff text", keywords: "find Ctrl Cmd F", run: openSearch }
  ];
  for (const file of model.files) {
    const firstHunk = visible.find((hunk) => hunk.file === file.path);
    if (!firstHunk) {
      continue;
    }
    actions.push({
      id: `file:${file.path}`,
      title: `Go to file: ${file.path}`,
      keywords: `${file.status} ${file.oldPath ?? ""}`,
      run: () => selectHunk(firstHunk.id)
    });
  }
  return actions.map((action) => ({
    ...action,
    shortcut: action.shortcut ?? shortcutForPaletteAction(action.id)
  }));
}

function findSearchHits(model: ReviewModel | undefined, query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!model || needle.length === 0) {
    return [];
  }
  return model.hunks.flatMap((hunk) => {
    const hits: SearchHit[] = [];
    const summary = `${hunk.file}\n${hunk.digest.headline}\n${hunk.digest.details.join("\n")}`.toLocaleLowerCase();
    if (summary.includes(needle)) {
      hits.push({ hunkId: hunk.id });
    }
    hunk.lines.forEach((line, lineIndex) => {
      if (line.text.toLocaleLowerCase().includes(needle)) {
        hits.push({ hunkId: hunk.id, lineIndex });
      }
    });
    return hits;
  });
}

function commandGroup(action: CommandAction): "Review" | "Navigate" | "View" | "Setup" {
  if (action.id.startsWith("file:") || action.id.startsWith("next") || action.id.startsWith("prev")) return "Navigate";
  if (["approve", "flag", "unreview", "approve-group", "focus", "revert-file", "recent-decisions"].includes(action.id)) return "Review";
  if (["toggle-split", "cycle-sort", "toggle-theme", "theme-graphite", "theme-assay", "theme-paper", "cycle-code-size", "show-flagged", "toggle-nits", "search"].includes(action.id)) return "View";
  return "Setup";
}

function findRelativeHunk(
  hunks: ReviewHunk[],
  selectedId: string | undefined,
  predicate: (hunk: ReviewHunk) => boolean,
  delta: 1 | -1
): ReviewHunk | undefined {
  if (hunks.length === 0) {
    return undefined;
  }
  const currentIndex = Math.max(0, hunks.findIndex((hunk) => hunk.id === selectedId));
  const ordered =
    delta > 0
      ? [...hunks.slice(currentIndex + 1), ...hunks.slice(0, currentIndex + 1)]
      : [...hunks.slice(0, currentIndex).reverse(), ...hunks.slice(currentIndex).reverse()];
  return ordered.find(predicate);
}

function visualBand(hunk: ReviewHunk): "critical" | ReviewHunk["band"] {
  return hunk.risk >= 80 ? "critical" : hunk.band;
}

function bandLabel(band: "critical" | ReviewHunk["band"]): string {
  return band === "critical" ? "Critical" : band === "high" ? "High" : band === "medium" ? "Medium" : band === "low" ? "Low" : "Skim";
}

function formatWeight(weight: number): string {
  return weight > 0 ? `+${weight}` : String(weight);
}

function middleEllipsis(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const keep = Math.max(4, Math.floor((max - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function modKeycap(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘K" : "Ctrl+K";
}

function sourceLabel(source: string): string {
  return source === "claude-code" ? "Claude Code" : source;
}

function statusVerb(status: ReviewHunk["status"]): string {
  return status === "approved" ? "Approved" : status === "flagged" ? "Flagged" : "Reset";
}

function timeRange(session: ProvenanceTimelineSession): string {
  if (!session.firstTs && !session.lastTs) {
    return "time unknown";
  }
  if (session.firstTs === session.lastTs || !session.lastTs) {
    return formatTime(session.firstTs);
  }
  return `${formatTime(session.firstTs)} - ${formatTime(session.lastTs)}`;
}

function formatTime(value?: string): string {
  if (!value) {
    return "time unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function loadAll(
  setData: (model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta) => void,
  setToast: (toast?: string) => void
): Promise<void> {
  try {
    const [model, stats, meta] = await Promise.all([fetchReview(), fetchStats(), fetchMeta()]);
    setData(model, stats, meta);
  } catch {
    setToast("Retry with r.");
  }
}

interface LiveUpdateEvent {
  addedIds: string[];
  removedIds: string[];
}

async function reloadLiveUpdate(
  update: LiveUpdateEvent,
  applyLiveData: (model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta, addedIds: string[], removedIds: string[]) => void
): Promise<void> {
  try {
    const [model, stats, meta] = await Promise.all([fetchReview(), fetchStats(), fetchMeta()]);
    applyLiveData(model, stats, meta, update.addedIds, update.removedIds);
  } catch {
    // Retain the last complete model; the next event or manual refresh can recover.
  }
}

function repoName(repoRoot: string): string {
  return repoRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? repoRoot;
}

function hasSeenPaneFade(): boolean {
  try {
    return sessionStorage.getItem("sift.paneFadeSeen") === "1";
  } catch {
    return false;
  }
}

function markPaneFadeSeen(): void {
  try {
    sessionStorage.setItem("sift.paneFadeSeen", "1");
  } catch {
    // The effect is purely presentational when browser storage is unavailable.
  }
}

function hasSeenShortcutsHint(): boolean {
  try {
    return localStorage.getItem("sift.shortcutsHintSeen") === "1";
  } catch {
    return false;
  }
}

function markShortcutsHintSeen(): void {
  try {
    localStorage.setItem("sift.shortcutsHintSeen", "1");
  } catch {
    // Hint dismissal is best-effort.
  }
}
