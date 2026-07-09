import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type { StatsSnapshot } from "@sift-review/core";
import {
  approveGroup,
  fetchFile,
  fetchMeta,
  fetchReview,
  fetchStats,
  refreshReview,
  setHunkStatus
} from "./api.js";
import { keyboardCommand, nextUnreviewedAfter } from "./keyboard.js";
import { sortReviewHunks, useReviewStore, visibleHunks } from "./store.js";
import type { ApiMeta, ReviewHunk, ReviewModel } from "./types.js";
import { highlightDiffLines } from "./highlight.js";
import "./styles.css";

export function App() {
  const {
    model,
    stats,
    meta,
    selectedId,
    split,
    helpOpen,
    filter,
    sortMode,
    collapsed,
    toast,
    setData,
    setSelected,
    setStatus,
    setSplit,
    setHelp,
    setFilter,
    cycleSortMode,
    setCollapsed,
    collapseAll,
    setToast
  } = useReviewStore();
  const [pendingG, setPendingG] = useState(false);
  const [filterFocused, setFilterFocused] = useState(false);
  const [fileModal, setFileModal] = useState<{ path: string; text: string } | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadAll(setData, setToast);
  }, [setData, setToast]);

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
      if (isInput && event.key !== "Escape") {
        return;
      }
      const command = keyboardCommand(
        {
          selectedId: selected?.id,
          split,
          helpOpen,
          filterOpen: filterFocused,
          allIds: visible.map((hunk) => hunk.id),
          hunks: visible,
          pendingG
        },
        event.key
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
    pendingG,
    selected,
    setHelp,
    setSelected,
    setSplit,
    split,
    visible
  ]);

  async function refresh(): Promise<void> {
    try {
      const fresh = await refreshReview();
      const [nextStats, nextMeta] = await Promise.all([fetchStats(), fetchMeta()]);
      setData(fresh, nextStats, nextMeta);
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

  const reviewedPct = model.totals.reviewableLines === 0
    ? 100
    : (stats.reviewedReviewableLines / model.totals.reviewableLines) * 100;

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
            {model.totals.changedLines.toLocaleString()} changed - {model.totals.attentionLines.toLocaleString()} attn
          </span>
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
            return (
              <div key={group.id} className="queue-group">
                <button className="group-row" onClick={() => setCollapsed(group.id, !isCollapsed)}>
                  <span>{isCollapsed ? "+" : "-"}</span>
                  <span>{group.title}</span>
                  <span>
                    {reviewed}/{group.hunkIds.length}
                  </span>
                </button>
                {group.kind === "skim" && (
                  <button
                    className="approve-group"
                    title="Bulk approval is rejected if any hunk has a hot risk signal"
                    onClick={() => void approveGroup(group.id).then(() => refresh()).catch(() => setToast("Group contains hunks requiring individual approval."))}
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
                        className={`hunk-row ${selected?.id === hunk.id ? "selected" : ""}`}
                        onClick={() => setSelected(hunk.id)}
                      >
                        <span className={`band ${hunk.band}`}>{hunk.band}</span>
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
          split={split}
          onToggleSplit={() => setSplit(!split)}
          onOpenFile={(hunk) =>
            void fetchFile(hunk.file, "new")
              .then((text) => setFileModal({ path: hunk.file, text }))
              .catch(() => setToast("Full file is unavailable."))
          }
        />

        <Inspector
          hunk={selected}
          noteRef={noteRef}
          onStatus={(status, note) => selected && void updateStatus(selected, status, note)}
        />
      </section>

      <footer className="footer">j/k hunk · J/K file · a approve · x flag · u undo · o split · s sort · ? help</footer>
      {toast && (
        <button className="toast" onClick={() => setToast(undefined)}>
          {toast}
        </button>
      )}
      {helpOpen && <HelpOverlay onClose={() => setHelp(false)} />}
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
  split,
  onToggleSplit,
  onOpenFile
}: {
  hunk?: ReviewHunk;
  split: boolean;
  onToggleSplit(): void;
  onOpenFile(hunk: ReviewHunk): void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: hunk?.lines.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 12
  });
  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    if (!hunk) {
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
  }, [hunk]);
  if (!hunk) {
    return <section className="diff">No hunk selected</section>;
  }
  const reasonLines = new Set(hunk.reasons.flatMap((reason) => (reason.line ? [reason.line] : [])));
  return (
    <section className={`diff ${split ? "split" : "unified"}`}>
      <div className="diff-header">
        <div>
          <strong>{hunk.file}</strong>
          <span>{hunk.header}</span>
        </div>
        <div className="diff-actions">
          <button onClick={onToggleSplit}>{split ? "Unified" : "Split"}</button>
          <button onClick={() => onOpenFile(hunk)}>Open full file</button>
        </div>
      </div>
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
    </section>
  );
}

function Inspector({
  hunk,
  noteRef,
  onStatus
}: {
  hunk?: ReviewHunk;
  noteRef: RefObject<HTMLTextAreaElement>;
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
  return (
    <aside className="inspector">
      <div className="scoreline">
        <strong>Risk {hunk.risk}</strong>
        <span className={`band ${hunk.band}`}>{hunk.band}</span>
      </div>
      <section>
        <h2>Reasons</h2>
        {hunk.reasons.length === 0 ? (
          <p>No signals beyond category base score.</p>
        ) : (
          hunk.reasons.map((reason) => (
            <details key={`${reason.code}-${reason.line ?? ""}`}>
              <summary>
                {reason.code} +{reason.weight}
              </summary>
              <p>{reason.label}</p>
              {reason.evidence && <code>{reason.evidence}</code>}
            </details>
          ))
        )}
      </section>
      <section>
        <h2>Category</h2>
        <p>
          {hunk.category} · {hunk.categoryReason}
        </p>
      </section>
      <section>
        <h2>Provenance</h2>
        {hunk.provenance ? (
          <div className="provenance">
            <p>
              session {hunk.provenance.sessionId.slice(0, 8)} · {(hunk.provenance.confidence * 100).toFixed(0)}%
            </p>
            {hunk.provenance.userPromptExcerpt && <p>{hunk.provenance.userPromptExcerpt}</p>}
            {hunk.provenance.reasoningExcerpt && <p>{hunk.provenance.reasoningExcerpt}</p>}
            <button onClick={() => void navigator.clipboard.writeText(hunk.provenance?.transcriptPath ?? "")}>
              Copy transcript path
            </button>
          </div>
        ) : (
          <p>No provenance found - run `sift hooks install` to enable precise tracking.</p>
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

function HelpOverlay({ onClose }: { onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="help">
        <button onClick={onClose}>Close</button>
        <h1>Keys</h1>
        <p>j/k next/prev hunk · J/K next/prev file · g g first · G last</p>
        <p>a approve · x flag · u unreviewed · n note · o split · s sort · / filter · r refresh</p>
        <p>[ collapse all · ] expand all · ? help · Esc close</p>
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
