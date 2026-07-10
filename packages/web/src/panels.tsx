import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { StatsSnapshot } from "@sift-review/core";
import type { ReviewHunk, ReviewModel } from "./types.js";
import { DEFAULT_FLAG_REASONS } from "./undo.js";

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
  const options = reasons && reasons.length > 0 ? reasons.slice(0, 4) : [...DEFAULT_FLAG_REASONS];
  const [freeNote, setFreeNote] = useState<string | null>(null);

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
    <div className="quick-flag" role="dialog" aria-label="Flag reason">
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
            autoFocus
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
    <div className="modal-backdrop" role="dialog" aria-label="Approve group" onClick={onCancel}>
      <div className="modal group-preview" onClick={(event) => event.stopPropagation()}>
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
  onBackToQueue
}: {
  model: ReviewModel;
  stats: StatsSnapshot;
  onCopyReport(): void;
  onBackToQueue(): void;
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
        Reviewed. {model.totals.changedLines.toLocaleString()} lines ·{" "}
        {model.totals.attentionLines.toLocaleString()} needed attention
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
          <p>Nothing flagged.</p>
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
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
