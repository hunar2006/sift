import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { ReviewBrief, StatsSnapshot } from "@sift-review/core";
import {
  approveGroup,
  fetchBrief,
  fetchFile,
  fetchMeta,
  openHunkInEditor,
  fetchReport,
  fetchReview,
  fetchStats,
  fetchTimeline,
  refreshReview,
  setHunkStatus
} from "./api.js";
import { keyboardCommand, nextAttentionUnreviewed, nextUnreviewedAfter } from "./keyboard.js";
import { CompletionScreen, GroupApprovePreview, QuickFlagPicker, renderInlineCode } from "./panels.js";
import { sortReviewHunks, useReviewStore, visibleHunks } from "./store.js";
import type { ApiMeta, ProvenanceTimelineSession, ReviewHunk, ReviewModel } from "./types.js";
import { highlightDiffLines } from "./highlight.js";
import "./styles.css";

interface CommandAction {
  id: string;
  title: string;
  keywords?: string;
  run(): void;
}

interface SearchHit {
  hunkId: string;
  lineIndex?: number;
}

export function App() {
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
    theme,
    sortMode,
    collapsed,
    hunkCollapsed,
    nitsOpen,
    toast,
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
    toggleTheme,
    cycleSortMode,
    setCollapsed,
    collapseAll,
    toggleHunkCollapsed,
    toggleNits,
    setToast,
    pushUndoEntry,
    popUndoEntry
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
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [stamp, setStamp] = useState<"verified" | "flagged" | null>(null);
  const [paneFade, setPaneFade] = useState(false);
  const [shortcutsHint, setShortcutsHint] = useState(() => !hasSeenShortcutsHint());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreSearchFocus = useRef<HTMLElement | null>(null);
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
    window.setTimeout(() => setStamp(null), reduced ? 200 : 340);
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
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

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
      .catch(() => setToast("Timeline is unavailable."))
      .finally(() => setTimelineLoading(false));
  }, [setToast, timelineOpen]);

  const visible = useMemo(
    () => visibleHunks(model, filter, collapsed, sortMode, freshIds, freshOnly),
    [model, filter, collapsed, sortMode, freshIds, freshOnly]
  );
  const selected = visible.find((hunk) => hunk.id === selectedId) ?? visible[0];
  const searchHits = useMemo(() => findSearchHits(model, searchQuery), [model, searchQuery]);
  const searchHitIds = useMemo(() => new Set(searchHits.map((hit) => hit.hunkId)), [searchHits]);
  const activeSearchHit = searchHits.length > 0 ? searchHits[searchIndex % searchHits.length] : undefined;

  function openSearch(): void {
    restoreSearchFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    restoreSearchFocus.current?.focus();
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
    searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (searchOpen && activeSearchHit) {
      setSelected(activeSearchHit.hunkId);
    }
  }, [activeSearchHit, searchOpen, setSelected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const isInput =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const isPaletteToggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSearchToggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      if (searchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSearch();
        }
        return;
      }
      if (isInput && event.key !== "Escape" && !isPaletteToggle) {
        return;
      }
      // While a modal owns the keyboard, let it handle its own keys.
      if (flagPickerFor || groupPreview) {
        return;
      }
      if (focusMode && event.key === "Escape") {
        event.preventDefault();
        setFocusMode(false);
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
          pendingG
        },
        event.key,
        { ctrlKey: event.ctrlKey, metaKey: event.metaKey }
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
        document.getElementById("queue-filter")?.focus();
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
        noteRef.current?.focus();
      }
      if (command.type === "undo") {
        void performUndo();
      }
      if (command.type === "toggle-focus") {
        setFocusMode((value) => !value);
      }
      if (command.type === "open-editor" && selected) {
        void openHunkInEditor(selected.id)
          .then(() => setToast("Opened in editor."))
          .catch((error: unknown) => setToast(error instanceof Error ? error.message : "Editor could not be opened."));
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
    toggleTheme,
    visible,
    activeSearchHit
  ]);

  async function refresh(): Promise<void> {
    try {
      const fresh = await refreshReview();
      const [nextStats, nextMeta] = await Promise.all([fetchStats(), fetchMeta()]);
      setData(fresh, nextStats, nextMeta);
      if (timelineOpen) {
        setTimeline(await fetchTimeline());
      }
    } catch {
      setToast("Server unavailable. Retry with r.");
    }
  }

  async function updateStatus(
    hunk: ReviewHunk,
    status: ReviewHunk["status"],
    note?: string,
    options: { record?: boolean } = {}
  ): Promise<void> {
    const previous = hunk.status;
    if (options.record !== false && status !== previous) {
      pushUndoEntry([{ hunkId: hunk.id, prevStatus: previous, prevNote: hunk.note }]);
      setToast(`${statusVerb(status)} ${repoBasename(hunk.file)} — Z to undo`);
      if (focusMode && status === "approved") {
        showStamp("verified");
      } else if (focusMode && status === "flagged") {
        showStamp("flagged");
      }
    }
    setStatus(hunk.id, status, note ?? hunk.note);
    if (status === "approved" || status === "flagged") {
      setSelected(nextUnreviewedAfter(visible, hunk.id));
    }
    try {
      await setHunkStatus(hunk.id, status, note ?? hunk.note);
      await refreshStatsOnly(setData, model, meta, setToast);
    } catch {
      setStatus(hunk.id, previous, hunk.note);
      setToast("Status update failed. Retry when the server is reachable.");
    }
  }

  async function performUndo(): Promise<void> {
    const result = popUndoEntry();
    if (result.message) {
      setToast(result.message);
      return;
    }
    const hunksById = new Map((model?.hunks ?? []).map((hunk) => [hunk.id, hunk]));
    for (const change of result.restore) {
      const hunk = hunksById.get(change.hunkId);
      if (hunk) {
        await updateStatus(hunk, change.prevStatus, change.prevNote, { record: false });
      }
    }
    setToast(result.restore.length > 1 ? `Undid ${result.restore.length} decisions` : "Undid last decision");
  }

  async function confirmGroupApprove(groupId: string): Promise<void> {
    const changed = (model?.hunks ?? []).filter(
      (hunk) => hunk.groupId === groupId && hunk.status !== "approved"
    );
    try {
      const result = await approveGroup(groupId);
      if (!result.ok) {
        setGroupPreview({ groupId, blockedIds: result.blockedIds });
        return;
      }
      setGroupPreview(null);
      if (changed.length > 0) {
        pushUndoEntry(changed.map((hunk) => ({ hunkId: hunk.id, prevStatus: hunk.status, prevNote: hunk.note })));
        setToast(`Approved ${changed.length} ${changed.length === 1 ? "hunk" : "hunks"} — Z to undo`);
      }
      await refresh();
    } catch {
      setToast("Group approval failed. Retry when the server is reachable.");
    }
  }

  if (!model || !stats || !meta) {
    return <main className="loading">Loading Sift</main>;
  }

  if (model.hunks.length === 0) {
    return (
      <main className="empty">
        <h1>Nothing to review</h1>
        <p>{model.meta.diffSpec}</p>
      </main>
    );
  }

  const reviewedPct =
    model.totals.reviewableLines === 0 ? 100 : (stats.reviewedReviewableLines / model.totals.reviewableLines) * 100;
  const attentionGroupIds = new Set(
    model.groups.filter((group) => group.kind === "attention").map((group) => group.id)
  );
  const focusHunks = visible.filter((hunk) => attentionGroupIds.has(hunk.groupId));
  const undecidedAttention = focusHunks.filter((hunk) => hunk.status === "unreviewed");
  const reviewComplete = focusHunks.length > 0 && undecidedAttention.length === 0;
  const focusHunk =
    focusHunks.find((hunk) => hunk.id === selected?.id) ?? undecidedAttention[0] ?? focusHunks[0];
  const focusIndex = focusHunk ? focusHunks.findIndex((hunk) => hunk.id === focusHunk.id) : -1;

  async function copyReport(): Promise<void> {
    try {
      const markdown = await fetchReport();
      await navigator.clipboard.writeText(markdown);
      setToast("Report copied to clipboard");
    } catch {
      setToast("Could not copy the report.");
    }
  }
  const coverageSecondary =
    stats.coverageOnChangedLines === undefined
      ? undefined
      : ` · coverage ${stats.coverageOnChangedLines.toFixed(0)}%`;
  const actions = buildCommandActions({
    model,
    stats,
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
    toggleNits,
    openTimeline: () => setTimelineOpen(true),
    openStats: () => setStatsOpen(true),
    openHelp: () => {
      dismissShortcutsHint();
      setHelp(true);
    },
    openSearch,
    setToast
  });

  return (
    <main className={paneFade ? "shell pane-fade" : "shell"}>
      <header className="topbar">
        <div className="brandline">
          <Logomark />
          <span className="repo-name">{repoName(meta.repoRoot)}</span>
          <span className="eyebrow-chip">{meta.diffSpec}</span>
        </div>
        <div className="headline hud">
          <div className="hud-stats">
            <span className="hud-primary">
              {stats.reviewedReviewableLines.toLocaleString()} / {model.totals.reviewableLines.toLocaleString()} reviewed
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
          <div className="hud-actions">
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
            <button className="ghost icon-btn" aria-label="Refresh" title="Refresh" onClick={() => void refresh()}>
              ↻
            </button>
          </div>
        </div>
        <div
          className="hud-progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, reviewedPct))}%` }}
          aria-label={`${reviewedPct.toFixed(0)}% reviewed`}
        >
          {meta.watchActive && <span className="live-dot" aria-label="Watch mode active" />}
        </div>
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
          {model.groups.map((group) => {
            const groupHunks = sortReviewHunks(
              model.hunks.filter((hunk) => hunk.groupId === group.id && (!freshOnly || freshIds[hunk.id])),
              model,
              sortMode
            );
            const reviewed = groupHunks.filter((hunk) => hunk.status !== "unreviewed").length;
            const isCollapsed = Boolean(collapsed[group.id]);
            const totalLines = group.totalAdded + group.totalRemoved;
            return (
              <div key={group.id} className={`queue-group ${group.kind}`}>
                <button className="group-row" onClick={() => setCollapsed(group.id, !isCollapsed)}>
                  <span className="group-chevron" aria-hidden="true">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="group-title">
                    {group.title} · {reviewed}/{group.hunkIds.length}
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
                    .map((hunk) => {
                      const band = visualBand(hunk);
                      return (
                        <button
                          key={hunk.id}
                          className={`hunk-row ${band} ${selected?.id === hunk.id ? "selected" : ""}`}
                          onClick={() => setSelected(hunk.id)}
                        >
                          <span className={`risk-spine ${band}`} aria-hidden="true" />
                          <span className="hunk-row-body">
                            <span className="hunk-row-top">
                              <span className="path">{hunk.file}</span>
                              {freshIds[hunk.id] && <span className="fresh-dot" aria-label="Fresh hunk" />}
                              {hunk.status === "approved" && <span className="mini-stamp verified">✓</span>}
                              {hunk.status === "flagged" && <span className="mini-stamp flagged">⚑</span>}
                            </span>
                            <span className="hunk-row-digest">{hunk.digest.headline}</span>
                          </span>
                          <span className="hunk-row-score">
                            {band === "critical" && <span className="crit-tag">CRIT</span>}
                            <span className={`risk ${band}`}>{hunk.risk}</span>
                          </span>
                        </button>
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
          searchLineIndex={selected?.id === activeSearchHit?.hunkId ? activeSearchHit?.lineIndex : undefined}
          searchHunkIds={searchHitIds}
          split={split}
          collapsed={Boolean(selected && hunkCollapsed[selected.id])}
          theme={theme}
          onSelect={setSelected}
          onToggleSplit={() => setSplit(!split)}
          onToggleCollapsed={() => selected && toggleHunkCollapsed(selected.id)}
          onOpenFile={(hunk) =>
            void fetchFile(hunk.file, "new")
              .then((text) => setFileModal({ path: hunk.file, text }))
              .catch(() => setToast("Full file is unavailable."))
          }
        />

        <Inspector
          hunk={selected}
          fresh={Boolean(selected && freshIds[selected.id])}
          noteRef={noteRef}
          nitsOpen={nitsOpen}
          onToggleNits={toggleNits}
          onOpenEditor={(hunk) =>
            void openHunkInEditor(hunk.id)
              .then(() => setToast("Opened in editor."))
              .catch((error: unknown) => setToast(error instanceof Error ? error.message : "Editor could not be opened."))
          }
          onStatus={(status, note) => selected && void updateStatus(selected, status, note)}
        />
      </section>

      {shortcutsHint && <div className="shortcuts-hint">? shortcuts</div>}
      {toast && (
        <button className="toast" onClick={() => setToast(undefined)}>
          {toast}
        </button>
      )}
      {searchOpen && (
        <div className="diff-search" role="dialog" aria-label="Search diff">
          <input
            ref={searchRef}
            value={searchQuery}
            placeholder="Search files, digests, and diff text"
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
      {paletteOpen && <CommandPalette actions={actions} onClose={() => setPaletteOpen(false)} />}
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
      {statsOpen && <StatsPanel stats={stats} model={model} onClose={() => setStatsOpen(false)} />}
      {helpOpen && <HelpOverlay tour={helpTour} onClose={() => setHelp(false)} />}
      {fileModal && <FileModal modal={fileModal} onClose={() => setFileModal(null)} />}
      {flagPickerFor && (
        <QuickFlagPicker
          reasons={meta.flagReasons}
          onPick={(note) => {
            const target = model.hunks.find((hunk) => hunk.id === flagPickerFor);
            setFlagPickerFor(null);
            if (target) {
              void updateStatus(target, "flagged", note.length > 0 ? note : target.note);
            }
          }}
          onCancel={() => setFlagPickerFor(null)}
        />
      )}
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
      {focusMode && focusHunk && (
        <FocusMode
          hunk={focusHunk}
          index={focusIndex}
          total={focusHunks.length}
          split={split}
          onApprove={() => void updateStatus(focusHunk, "approved")}
          onFlag={() => setFlagPickerFor(focusHunk.id)}
          onSkip={() => setSelected(nextUnreviewedAfter(focusHunks, focusHunk.id))}
          onUndo={() => void performUndo()}
          onToggleSplit={() => setSplit(!split)}
          onExit={() => setFocusMode(false)}
          onOpenEditor={(hunk) =>
            void openHunkInEditor(hunk.id)
              .then(() => setToast("Opened in editor."))
              .catch((error: unknown) => setToast(error instanceof Error ? error.message : "Editor could not be opened."))
          }
          onOpenFile={(hunk) =>
            void fetchFile(hunk.file, "new")
              .then((text) => setFileModal({ path: hunk.file, text }))
              .catch(() => setToast("Full file is unavailable."))
          }
        />
      )}
      {stamp && (
        <div className="stamp-overlay" aria-hidden="true">
          <Stamp kind={stamp} />
        </div>
      )}
      {reviewComplete && !completionDismissed && (
        <CompletionScreen
          model={model}
          stats={stats}
          onCopyReport={() => void copyReport()}
          onBackToQueue={() => {
            setCompletionDismissed(true);
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
  split,
  collapsed,
  onSelect,
  onToggleSplit,
  onToggleCollapsed,
  onOpenFile,
  searchLineIndex,
  searchHunkIds,
  theme = "dark"
}: {
  hunk?: ReviewHunk;
  hunks: ReviewHunk[];
  selectedId?: string;
  split: boolean;
  collapsed: boolean;
  onSelect(id?: string): void;
  onToggleSplit(): void;
  onToggleCollapsed(): void;
  onOpenFile(hunk: ReviewHunk): void;
  searchLineIndex?: number;
  searchHunkIds?: Set<string>;
  theme?: "dark" | "light";
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const [widePath, setWidePath] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1280px)").matches : true
  );
  const rowVirtualizer = useVirtualizer({
    count: collapsed ? 0 : hunk?.lines.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
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
    const assayTheme = theme === "light" ? "assay-light" : "assay-dark";
    void highlightDiffLines(hunk.id, hunk.language, hunk.lines, assayTheme).then((html) => {
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
    return <section className="diff">No hunk selected</section>;
  }
  const reasonLines = new Set(hunk.reasons.flatMap((reason) => (reason.line ? [reason.line] : [])));
  const displayPath = widePath ? hunk.file : middleEllipsis(hunk.file, 36);
  return (
    <section className={`diff ${split ? "split" : "unified"}`}>
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
                  {line.segments ? (
                    <code>
                      {line.segments.map((segment, index) => (
                        <span key={`${index}-${segment.text}`} className={segment.changed ? "word-change" : undefined}>
                          {segment.text}
                        </span>
                      ))}
                    </code>
                  ) : highlightedLines?.[virtualRow.index] ? (
                    <code dangerouslySetInnerHTML={{ __html: highlightedLines[virtualRow.index] ?? "" }} />
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
  return (
    <span className={`stamp stamp-${kind}`} role="img" aria-label={kind === "verified" ? "Verified" : "Flagged"}>
      {kind === "verified" ? "VERIFIED" : "FLAGGED"}
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
  onSkip,
  onUndo,
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
  onSkip(): void;
  onUndo(): void;
  onToggleSplit(): void;
  onExit(): void;
  onOpenEditor(hunk: ReviewHunk): void;
  onOpenFile(hunk: ReviewHunk): void;
}) {
  const primaryReasons = hunk.reasons.filter((reason) => reason.tier !== "nit");
  const band = visualBand(hunk);
  return (
    <div className="focus-backdrop" role="dialog" aria-label="Focus mode">
      <article className="focus-card">
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
            onToggleCollapsed={() => undefined}
            onOpenFile={onOpenFile}
          />
        </div>
        <CoverageBadge hunk={hunk} />
        <div className="focus-actions">
          <button className="primary" onClick={onApprove}>
            <span className="keycap">a</span> Approve
          </button>
          <button className="danger" onClick={onFlag}>
            <span className="keycap">x</span> Flag
          </button>
          <button className="ghost" onClick={onSkip}>
            <span className="keycap">j</span> Skip
          </button>
          <button className="ghost" onClick={onUndo}>
            <span className="keycap">z</span> Undo
          </button>
          <button className="ghost" onClick={() => onOpenEditor(hunk)}>
            <span className="keycap">e</span> Open in editor
          </button>
        </div>
      </article>
    </div>
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
  nitsOpen,
  onToggleNits,
  onOpenEditor,
  onStatus
}: {
  hunk?: ReviewHunk;
  fresh: boolean;
  noteRef: RefObject<HTMLTextAreaElement>;
  nitsOpen: boolean;
  onToggleNits(): void;
  onOpenEditor(hunk: ReviewHunk): void;
  onStatus(status: ReviewHunk["status"], note?: string): void;
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
      <DigestBlock hunk={hunk} />
      {hunk.provenance && <IntentBlock provenance={hunk.provenance} />}
      <section>
        <h2>Reasons</h2>
        {hunk.reasons.length === 0 ? (
          <p>No signals beyond category base score.</p>
        ) : (
          <>
            {primaryReasons.map((reason) => (
              <ReasonDetail key={`${reason.code}-${reason.line ?? ""}`} reason={reason} />
            ))}
            {nitReasons.length > 0 && (
              <details className="nit-section" open={nitsOpen} onToggle={onToggleNits}>
                <summary>Nits ({nitReasons.length})</summary>
                {nitReasons.map((reason) => (
                  <ReasonDetail key={`${reason.code}-${reason.line ?? ""}`} reason={reason} />
                ))}
              </details>
            )}
          </>
        )}
      </section>
      <section>
        <h2>Coverage</h2>
        {hunk.coverage ? <CoverageBadge hunk={hunk} /> : <p>No coverage evidence for this hunk.</p>}
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
          <p>No provenance found. Run `sift hooks install` or emit open JSONL records.</p>
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
      <section>
        <h2>Review</h2>
        <div className="review-actions">
          <button className="primary" onClick={() => onStatus("approved", note)}>
            Approve
          </button>
          <button className="danger" onClick={() => onStatus("flagged", note)}>
            Flag
          </button>
          <button className="ghost" onClick={() => onStatus("unreviewed", note)}>
            Undo
          </button>
          <button className="ghost" onClick={() => onOpenEditor(hunk)}>
            Open in editor
          </button>
        </div>
        <textarea
          ref={noteRef}
          value={note}
          placeholder="note"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => onStatus(hunk.status, note)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              onStatus(hunk.status, note);
            }
          }}
        />
      </section>
    </aside>
  );
}

function CommandPalette({ actions, onClose }: { actions: CommandAction[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => actions.filter((action) => matchesAction(action, query)).slice(0, 40), [actions, query]);
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function execute(action: CommandAction | undefined): void {
    if (!action) {
      return;
    }
    action.run();
    onClose();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      execute(filtered[activeIndex]);
    }
  }

  return (
    <div className="overlay palette-overlay" role="dialog" aria-modal="true">
      <div className="palette">
        <input
          autoFocus
          value={query}
          placeholder="Run command or jump to file"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" role="listbox">
          {filtered.map((action, index) => (
            <button
              key={action.id}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(action)}
            >
              {action.title}
            </button>
          ))}
          {filtered.length === 0 && <p>No matching commands</p>}
        </div>
      </div>
    </div>
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
  );
}

function StatsPanel({ stats, model, onClose }: { stats: StatsSnapshot; model: ReviewModel; onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
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
              <dd>{stats.coverageOnChangedLines.toFixed(0)}%</dd>
            </div>
          )}
          <div>
            <dt>Groups</dt>
            <dd>{model.groups.length}</dd>
          </div>
        </dl>
      </div>
    </div>
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
    <div className="minimap" aria-label="Diff minimap">
      {hunks.map((hunk, index) => {
        const top = hunks.length === 1 ? 50 : (index / (hunks.length - 1)) * 100;
        return (
          <button
            key={hunk.id}
            className={`minimap-marker ${visualBand(hunk)} ${selectedId === hunk.id ? "current" : ""} ${searchHunkIds?.has(hunk.id) ? "search-match" : ""}`}
            style={{ top: `${top}%` }}
            title={`${hunk.file} risk ${hunk.risk}`}
            onClick={() => onSelect(hunk.id)}
          />
        );
      })}
    </div>
  );
}

function HelpOverlay({ tour, onClose }: { tour: boolean; onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="help">
        <button onClick={onClose}>Close</button>
        <h1>Keys</h1>
        {tour && (
          <div className="tour-strip">
            <span>Navigate</span>
            <span>Approve or flag</span>
            <span>Bulk skim groups</span>
            <span>Open palette</span>
          </div>
        )}
        <p>j/k next/prev hunk | J/K next/prev file | g g first | G last</p>
        <p>n/p next/prev unreviewed attention hunk | a approve | x flag | u unreviewed | i note</p>
        <p>space collapse current hunk | o split | s sort | t timeline | T theme | Ctrl/Cmd+K palette</p>
        <p>/ filter | r refresh | e open editor | [ collapse all | ] expand all | ? help | Esc close</p>
      </div>
    </div>
  );
}

function FileModal({ modal, onClose }: { modal: { path: string; text: string }; onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="file-modal">
        <button onClick={onClose}>Close</button>
        <h1>{modal.path}</h1>
        <pre>{modal.text}</pre>
      </div>
    </div>
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

function ReasonDetail({ reason }: { reason: ReviewHunk["reasons"][number] }) {
  return (
    <details className={`reason-detail ${reason.weight < 0 ? "reducer" : ""}`}>
      <summary>
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
  toggleNits,
  openTimeline,
  openStats,
  openHelp,
  openSearch,
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
  toggleNits(): void;
  openTimeline(): void;
  openStats(): void;
  openHelp(): void;
  openSearch(): void;
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
        setToast("No matching hunk.");
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
  return actions;
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

function matchesAction(action: CommandAction, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = `${action.title} ${action.keywords ?? ""}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token) || fuzzyIncludes(haystack, token));
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return false;
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
  return status === "approved" ? "Approved" : status === "flagged" ? "Flagged" : "Unreviewed";
}

function repoBasename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] || file;
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
    setToast("Server unavailable. Retry with r.");
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

async function refreshStatsOnly(
  setData: (model: ReviewModel, stats: StatsSnapshot, meta: ApiMeta) => void,
  model: ReviewModel | undefined,
  meta: ApiMeta | undefined,
  setToast: (toast?: string) => void
): Promise<void> {
  if (!model || !meta) {
    return;
  }
  try {
    setData(model, await fetchStats(), meta);
  } catch {
    setToast("Stats refresh failed.");
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
