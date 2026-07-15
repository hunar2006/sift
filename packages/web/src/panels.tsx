import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import type { JournalEntry, StatsSnapshot } from "@sift-review/core";
import type { ReviewHunk, ReviewModel } from "./types.js";
import { DEFAULT_FLAG_REASONS } from "./undo.js";
import { captureFocus, focusElement, focusFirst, restoreFocus, trapFocus } from "./focus.js";

function useModalFocus(): { ref: RefObject<HTMLDivElement>; onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void } {
  const ref = useRef<HTMLDivElement>(null!);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = captureFocus();
    focusFirst(ref.current);
    return () => restoreFocus(previous.current);
  }, []);
  return { ref, onKeyDown: (event) => trapFocus(event.nativeEvent, ref.current) };
}

export function renderInlineCode(text: string): ReactNode {
  return text
    .split("`")
    .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>));
}

/** Inline quick-flag picker: numbered canned reasons plus a free-note option. */
export function QuickFlagPicker({
  reasons,
  onPick,
  onCancel
}: {
  reasons?: string[];
  onPick(note: string): void;
  onCancel(): void;
}) {
  const modal = useModalFocus();
  const options = reasons && reasons.length > 0 ? reasons.slice(0, 4) : [...DEFAULT_FLAG_REASONS];
  const [freeNote, setFreeNote] = useState<string | null>(null);
  const freeNoteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (freeNote !== null) {
      focusElement(freeNoteRef.current);
    }
  }, [freeNote]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (freeNote !== null) {
        return;
      }
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key === "i") {
        event.preventDefault();
        setFreeNote("");
        return;
      }
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < options.length) {
        event.preventDefault();
        onPick(options[index] ?? "");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [freeNote, onCancel, onPick, options]);

  return (
    <div ref={modal.ref} className="quick-flag" role="dialog" aria-modal="true" aria-label="Flag reason" onKeyDown={modal.onKeyDown}>
      {freeNote === null ? (
        <ul className="quick-flag-list">
          {options.map((reason, index) => (
            <li key={reason}>
              <button className="quick-flag-option" onClick={() => onPick(reason)}>
                <span className="keycap">{index + 1}</span> {reason}
              </button>
            </li>
          ))}
          <li>
            <button className="quick-flag-option" onClick={() => setFreeNote("")}>
              <span className="keycap">i</span> Write a note…
            </button>
          </li>
        </ul>
      ) : (
        <form
          className="quick-flag-note"
          onSubmit={(event) => {
            event.preventDefault();
            onPick(freeNote.trim());
          }}
        >
          <input
            ref={freeNoteRef}
            value={freeNote}
            placeholder="reason"
            onChange={(event) => setFreeNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </form>
      )}
    </div>
  );
}

/** Compact preview shown before a bulk group approval. */
export function GroupApprovePreview({
  group,
  hunks,
  blockedIds,
  onConfirm,
  onCancel
}: {
  group: { title: string; digest?: string; totalAdded: number; totalRemoved: number };
  hunks: ReviewHunk[];
  blockedIds?: string[];
  onConfirm(): void;
  onCancel(): void;
}) {
  const modal = useModalFocus();
  const total = group.totalAdded + group.totalRemoved;
  const blocked = new Set(blockedIds ?? []);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div ref={modal.ref} className="modal group-preview" role="dialog" aria-modal="true" aria-label="Approve group" onKeyDown={modal.onKeyDown} onClick={(event) => event.stopPropagation()}>
        <h2>Approve {group.title}</h2>
        {group.digest && <p className="group-preview-digest">{group.digest}</p>}
        <ul className="group-preview-list">
          {hunks.map((hunk) => (
            <li key={hunk.id} className={blocked.has(hunk.id) ? "blocked" : undefined}>
              <span className="group-preview-file">{hunk.file}</span>
              <span className="group-preview-headline">{renderInlineCode(hunk.digest.headline)}</span>
              <span className="group-preview-lines">+{hunk.addedLines}/−{hunk.removedLines}</span>
            </li>
          ))}
        </ul>
        {blocked.size > 0 && (
          <p className="group-preview-blocked">
            {blocked.size} {blocked.size === 1 ? "hunk needs" : "hunks need"} individual approval — a hot risk
            signal blocks bulk approval.
          </p>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onConfirm} disabled={blocked.size > 0}>
            <span className="keycap">↵</span> Approve {hunks.length} ({total} lines)
          </button>
          <button onClick={onCancel}>
            <span className="keycap">esc</span> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Full-pane completion state shown when every attention hunk is decided. */
export function CompletionScreen({
  model,
  stats,
  onCopyReport,
  onBackToQueue,
  onShowDecisions
}: {
  model: ReviewModel;
  stats: StatsSnapshot;
  onCopyReport(): void;
  onBackToQueue(): void;
  onShowDecisions(): void;
}) {
  const flagged = useMemo(() => model.hunks.filter((hunk) => hunk.status === "flagged"), [model.hunks]);
  const approvedLines = useMemo(
    () =>
      model.hunks
        .filter((hunk) => hunk.status === "approved")
        .reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0),
    [model.hunks]
  );
  const skimLines = model.groups
    .filter((group) => group.kind === "skim")
    .reduce((sum, group) => sum + group.totalAdded + group.totalRemoved, 0);

  return (
    <section className="completion" aria-label="Review complete">
      <h1 className="completion-headline">
        Reviewed: {model.totals.changedLines.toLocaleString()} lines | {model.totals.attentionLines.toLocaleString()} attention
      </h1>
      <div className="completion-stats">
        <Stat label="Approved" value={`${approvedLines.toLocaleString()} lines`} />
        <Stat label="Flagged" value={`${flagged.length}`} />
        <Stat label="Skimmed" value={`${skimLines.toLocaleString()} lines`} />
        <Stat label="Debt" value={`${(stats.debt * 100).toFixed(0)}%`} />
        {stats.coverageOnChangedLines !== undefined && (
          <Stat label="Coverage" value={`${(stats.coverageOnChangedLines * 100).toFixed(0)}%`} />
        )}
      </div>
      <div className="completion-flagged">
        <h2>Flagged ({flagged.length})</h2>
        {flagged.length === 0 ? (
          <p>No flags.</p>
        ) : (
          <ul>
            {flagged.map((hunk) => (
              <li key={hunk.id}>
                <span className="completion-flagged-file">{hunk.file}</span>
                <span>{renderInlineCode(hunk.digest.headline)}</span>
                {hunk.note && <span className="completion-flagged-note">“{hunk.note}”</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="completion-actions">
        <button className="primary" onClick={onCopyReport}>
          Copy report
        </button>
        <button onClick={onBackToQueue}>Back to queue</button>
        <button onClick={onShowDecisions}>Recent decisions</button>
      </div>
    </section>
  );
}

export function FlaggedReviewScreen({
  hunks,
  onUnflag,
  onContinue
}: {
  hunks: ReviewHunk[];
  onUnflag(hunk: ReviewHunk): void;
  onContinue(): void;
}) {
  return (
    <section className="completion flagged-review" aria-label="Flagged review">
      <h1>Flagged review</h1>
      <p>Scan the concerns once more before the summary.</p>
      <ul className="completion-flagged">
        {hunks.map((hunk) => (
          <li key={hunk.id}>
            <span className="completion-flagged-file">{hunk.file}</span>
            <span>{hunk.note?.trim() || hunk.digest.headline}</span>
            <span className="flagged-review-actions">
              <span>Keep</span>
              <button onClick={() => onUnflag(hunk)}>Unflag</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="completion-actions">
        <button className="primary" onClick={onContinue}>Continue to summary</button>
      </div>
    </section>
  );
}

export function DecisionLogPanel({
  entries,
  onUndo,
  onClose
}: {
  entries: JournalEntry[];
  onUndo(entry: JournalEntry): void;
  onClose(): void;
}) {
  const modal = useModalFocus();
  return (
    <div ref={modal.ref} className="overlay decision-log-overlay" role="dialog" aria-modal="true" aria-label="Recent decisions" onKeyDown={modal.onKeyDown}>
      <section className="decision-log">
        <div className="panel-heading">
          <h1>Recent decisions</h1>
          <button onClick={onClose}>Close</button>
        </div>
        {entries.length === 0 ? (
          <p>No decisions yet.</p>
        ) : (
          <ol>
            {entries.slice(0, 50).map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.action}</strong> <code>{entry.file || entry.hunkId}</code>
                  <span className="decision-time">{relativeTime(entry.ts)}</span>
                </div>
                {entry.note && <p>{entry.note.slice(0, 120)}</p>}
                <button disabled={entry.kind === "revert"} title={entry.kind === "revert" ? "file changed since" : undefined} onClick={() => onUndo(entry)}>
                  Undo this
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
