import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import type { StatsSnapshot } from "@sift-review/core";
import {
  approveGroup,
  fetchFile,
  fetchMeta,
  fetchReview,
  fetchStats,
  fetchTimeline,
  refreshReview,
  setHunkStatus
} from "./api.js";
import { keyboardCommand, nextAttentionUnreviewed, nextUnreviewedAfter } from "./keyboard.js";
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
    theme,
    sortMode,
    collapsed,
    hunkCollapsed,
    nitsOpen,
    toast,
    setData,
    setSelected,
    setStatus,
    setSplit,
    setHelp,
    setPaletteOpen,
    setTimelineOpen,
    setStatsOpen,
    setFilter,
    toggleTheme,
    cycleSortMode,
    setCollapsed,
    collapseAll,
    toggleHunkCollapsed,
    toggleNits,
    setToast
  } = useReviewStore();
  const [pendingG, setPendingG] = useState(false);
  const [filterFocused, setFilterFocused] = useState(false);
  const [fileModal, setFileModal] = useState<{ path: string; text: string } | null>(null);
  const [timeline, setTimeline] = useState<ProvenanceTimelineSession[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadAll(setData, setToast);
  }, [setData, setToast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

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
    () => visibleHunks(model, filter, collapsed, sortMode),
    [model, filter, collapsed, sortMode]
  );
  const selected = visible.find((hunk) => hunk.id === selectedId) ?? visible[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const isInput =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const isPaletteToggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (isInput && event.key !== "Escape" && !isPaletteToggle) {
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
        void updateStatus(selected, command.status);
      }
      if (command.type === "toggle-split") {
        setSplit(!split);
      }
      if (command.type === "toggle-help") {
        setHelp(!helpOpen);
      }
      if (command.type === "toggle-palette") {
        setPaletteOpen(!paletteOpen);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    collapseAll,
    cycleSortMode,
    filterFocused,
    helpOpen,
    paletteOpen,
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
    visible
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

  async function updateStatus(hunk: ReviewHunk, status: ReviewHunk["status"], note?: string): Promise<void> {
    const previous = hunk.status;
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
  const coverageLine =
    stats.coverageOnChangedLines === undefined ? undefined : `coverage ${stats.coverageOnChangedLines.toFixed(0)}%`;
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
      void approveGroup(selected.groupId)
        .then(() => refresh())
        .catch(() => setToast("Group contains hunks requiring individual approval."));
    },
    setSplit,
    cycleSortMode,
    toggleTheme,
    toggleNits,
    openTimeline: () => setTimelineOpen(true),
    openStats: () => setStatsOpen(true),
    openHelp: () => setHelp(true),
    setToast
  });

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandline">
          <strong>sift</strong>
          <span>{repoName(meta.repoRoot)}</span>
          <span>{meta.diffSpec}</span>
        </div>
        <div className="headline">
          <span className="progress">{reviewedPct.toFixed(0)}%</span>
          <span>
            {model.totals.changedLines.toLocaleString()} changed, {model.totals.attentionLines.toLocaleString()} attn
          </span>
          {coverageLine && <span>{coverageLine}</span>}
          <button onClick={() => setPaletteOpen(true)}>Palette</button>
          <button onClick={() => setTimelineOpen(true)}>Timeline</button>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

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
            <button className="sort-mode" onClick={() => cycleSortMode()}>
              Sort: {sortLabel(sortMode)}
            </button>
          </div>
          {model.groups.map((group) => {
            const groupHunks = sortReviewHunks(
              model.hunks.filter((hunk) => hunk.groupId === group.id),
              model,
              sortMode
            );
            const reviewed = groupHunks.filter((hunk) => hunk.status !== "unreviewed").length;
            const isCollapsed = Boolean(collapsed[group.id]);
            const totalLines = group.totalAdded + group.totalRemoved;
            return (
              <div key={group.id} className={`queue-group ${group.kind}`}>
                <button className="group-row" onClick={() => setCollapsed(group.id, !isCollapsed)}>
                  <span>{isCollapsed ? "+" : "-"}</span>
                  <span>{group.title}</span>
                  <span>
                    {reviewed}/{group.hunkIds.length}
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
                    onClick={() =>
                      void approveGroup(group.id)
                        .then(() => refresh())
                        .catch(() => setToast("Group contains hunks requiring individual approval."))
                    }
                  >
                    Approve group
                  </button>
                )}
                {!isCollapsed &&
                  groupHunks
                    .filter((hunk) => !filter || hunk.file.toLowerCase().includes(filter.toLowerCase()))
                    .map((hunk) => (
                      <button
                        key={hunk.id}
                        className={`hunk-row ${visualBand(hunk)} ${selected?.id === hunk.id ? "selected" : ""}`}
                        onClick={() => setSelected(hunk.id)}
                      >
                        <span className={`band ${visualBand(hunk)}`}>{visualLabel(hunk)}</span>
                        <span className="path">{hunk.file}</span>
                        <span className="risk">{hunk.risk}</span>
                      </button>
                    ))}
              </div>
            );
          })}
        </aside>

        <DiffViewer
          hunk={selected}
          hunks={visible}
          selectedId={selected?.id}
          split={split}
          collapsed={Boolean(selected && hunkCollapsed[selected.id])}
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
          noteRef={noteRef}
          nitsOpen={nitsOpen}
          onToggleNits={toggleNits}
          onStatus={(status, note) => selected && void updateStatus(selected, status, note)}
        />
      </section>

      <footer className="footer">
        j/k hunk | n/p unreviewed attention | a approve | x flag | i note | space collapse | Ctrl/Cmd+K palette
      </footer>
      {toast && (
        <button className="toast" onClick={() => setToast(undefined)}>
          {toast}
        </button>
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
  onOpenFile
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
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: collapsed ? 0 : hunk?.lines.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 12
  });
  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    if (!hunk || collapsed) {
      return () => {
        cancelled = true;
      };
    }
    void highlightDiffLines(hunk.id, hunk.language, hunk.lines).then((html) => {
      if (!cancelled) {
        setHighlightedLines(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [collapsed, hunk]);
  if (!hunk) {
    return <section className="diff">No hunk selected</section>;
  }
  const reasonLines = new Set(hunk.reasons.flatMap((reason) => (reason.line ? [reason.line] : [])));
  return (
    <section className={`diff ${split ? "split" : "unified"} ${visualBand(hunk)}`}>
      <div className="diff-header">
        <div className="diff-title">
          <strong>{hunk.file}</strong>
          <span>{hunk.header}</span>
          <ReasonChips hunk={hunk} />
          <CoverageBadge hunk={hunk} />
        </div>
        <div className="diff-actions">
          <button onClick={onToggleCollapsed}>{collapsed ? "Expand" : "Collapse"}</button>
          <button onClick={onToggleSplit}>{split ? "Unified" : "Split"}</button>
          <button onClick={() => onOpenFile(hunk)}>Open full file</button>
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
                  className={`diff-line ${line.kind} ${marked ? "marked" : ""}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className="oldno">{line.oldLine ?? ""}</span>
                  <span className="newno">{line.newLine ?? ""}</span>
                  {highlightedLines?.[virtualRow.index] ? (
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
      <MiniMap hunks={hunks} selectedId={selectedId} onSelect={onSelect} />
    </section>
  );
}

function renderInlineCode(text: string): ReactNode {
  const parts = text.split("`");
  return parts.map((part, index) =>
    index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>
  );
}

export function DigestBlock({ hunk }: { hunk: ReviewHunk }) {
  return (
    <section className="digest-block" aria-label="Change digest">
      <p className="digest-headline">{renderInlineCode(hunk.digest.headline)}</p>
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

function Inspector({
  hunk,
  noteRef,
  nitsOpen,
  onToggleNits,
  onStatus
}: {
  hunk?: ReviewHunk;
  noteRef: RefObject<HTMLTextAreaElement>;
  nitsOpen: boolean;
  onToggleNits(): void;
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
  return (
    <aside className="inspector">
      <div className="scoreline">
        <strong>Risk {hunk.risk}</strong>
        <span className={`band ${visualBand(hunk)}`}>{visualLabel(hunk)}</span>
        <CoverageBadge hunk={hunk} />
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
        <h2>Category</h2>
        <p>
          {hunk.category} | {hunk.categoryReason}
        </p>
      </section>
      <section>
        <h2>Provenance</h2>
        {hunk.provenance ? (
          <div className="provenance">
            <p>
              {sourceLabel(hunk.provenance.source)} session {hunk.provenance.sessionId.slice(0, 8)} | line match{" "}
              {(hunk.provenance.confidence * 100).toFixed(0)}%
            </p>
            <button onClick={() => void navigator.clipboard.writeText(hunk.provenance?.transcriptPath ?? "")}>
              Copy transcript path
            </button>
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
          <button onClick={() => onStatus("approved", note)}>Approve</button>
          <button onClick={() => onStatus("flagged", note)}>Flag</button>
          <button onClick={() => onStatus("unreviewed", note)}>Undo</button>
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
      {!loading && sessions && sessions.length === 0 && (
        <div className="empty-state">
          <strong>No matched sessions yet</strong>
          <p>See docs/PROVENANCE.md for the open JSONL format, or run `sift hooks install` for Claude Code.</p>
        </div>
      )}
      {!loading &&
        sessions?.map((session) => (
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
  onSelect
}: {
  hunks: ReviewHunk[];
  selectedId?: string;
  onSelect(id?: string): void;
}) {
  if (hunks.length === 0) {
    return null;
  }
  return (
    <div className="minimap" aria-label="Diff minimap">
      {hunks.map((hunk, index) => {
        const top = hunks.length === 1 ? 50 : (index / (hunks.length - 1)) * 100;
        const height = Math.min(24, Math.max(6, Math.log2(hunk.addedLines + hunk.removedLines + 1) * 3));
        return (
          <button
            key={hunk.id}
            className={`minimap-marker ${visualBand(hunk)} ${selectedId === hunk.id ? "current" : ""}`}
            style={{ top: `${top}%`, height: `${height}px` }}
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
        <p>/ filter | r refresh | [ collapse all | ] expand all | ? help | Esc close</p>
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
  const shown = primary.slice(0, 2);
  const hidden = primary.length - shown.length;
  if (shown.length === 0) {
    return null;
  }
  return (
    <span className="reason-chips">
      {shown.map((reason) => (
        <span key={`${reason.code}-${reason.line ?? ""}`} className={`reason-chip ${reason.weight < 0 ? "reducer" : ""}`}>
          {reason.weight < 0 ? "-" : "+"}
          {Math.abs(reason.weight)} {reason.code}
        </span>
      ))}
      {hidden > 0 && <span className="reason-more">+{hidden} more</span>}
    </span>
  );
}

function ReasonDetail({ reason }: { reason: ReviewHunk["reasons"][number] }) {
  return (
    <details className={`reason-detail ${reason.weight < 0 ? "reducer" : ""}`}>
      <summary>
        {reason.code} {formatWeight(reason.weight)}
      </summary>
      <p>{reason.label}</p>
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
  setSplit(split: boolean): void;
  cycleSortMode(): void;
  toggleTheme(): void;
  toggleNits(): void;
  openTimeline(): void;
  openStats(): void;
  openHelp(): void;
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
    { id: "toggle-split", title: split ? "Switch to unified diff" : "Switch to split diff", run: () => setSplit(!split) },
    { id: "cycle-sort", title: "Cycle sort mode", run: cycleSortMode },
    { id: "toggle-theme", title: "Toggle theme", run: toggleTheme },
    { id: "toggle-nits", title: nitsOpen ? "Collapse nits" : "Expand nits", run: toggleNits },
    { id: "timeline", title: "Open timeline", run: openTimeline },
    { id: "stats", title: `Open stats (${(stats.debt * 100).toFixed(0)}% debt)`, run: openStats },
    { id: "help", title: "Open help", run: openHelp }
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

function visualLabel(hunk: ReviewHunk): string {
  return visualBand(hunk);
}

function formatWeight(weight: number): string {
  return weight > 0 ? `+${weight}` : String(weight);
}

function sourceLabel(source: string): string {
  return source === "claude-code" ? "Claude Code" : source;
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
