import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "motion/react";
import type { JournalEntry, StatsSnapshot } from "@sift-review/core";
import type { ReviewHunk, ReviewModel } from "./types.js";
import { DEFAULT_FLAG_REASONS } from "./undo.js";
import { focusElement } from "./focus.js";
import { motionTransition, SPRING } from "./motion.js";

export function renderInlineCode(text: string): ReactNode {
  return text
    .split("`")
    .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>));
}

/** Inline quick-flag picker: numbered canned reasons plus a free-note option. */
export function QuickFlagPicker({
  reasons,
  onPick,
  onCancel,
  open,
  trigger
}: {
  reasons?: string[];
  onPick(note: string): void;
  onCancel(): void;
  open?: boolean;
  trigger?: ReactElement;
}) {
  const controlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlled ? open : trigger ? uncontrolledOpen : true;
  const options = reasons && reasons.length > 0 ? reasons.slice(0, 4) : [...DEFAULT_FLAG_REASONS];
  const [freeNote, setFreeNote] = useState<string | null>(null);
  const freeNoteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (freeNote !== null) {
      focusElement(freeNoteRef.current);
    }
  }, [freeNote]);

  useEffect(() => {
    if (!isOpen) {
      setFreeNote(null);
    }
  }, [isOpen]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!isOpen || freeNote !== null) {
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
  }, [freeNote, isOpen, onPick, options]);

  function handleOpenChange(nextOpen: boolean): void {
    if (!controlled && trigger) {
      setUncontrolledOpen(nextOpen);
    }
    if (!nextOpen) {
      onCancel();
    }
  }

  function handlePick(note: string): void {
    if (!controlled && trigger) {
      setUncontrolledOpen(false);
    }
    onPick(note);
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      {trigger ? (
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      ) : (
        <Popover.Anchor aria-hidden style={{ position: "fixed", right: 16, bottom: 40, width: 0, height: 0 }} />
      )}
      <Popover.Portal>
        <Popover.Content aria-label="Flag reason" side="top" align="end" sideOffset={8}>
          <div
            className="quick-flag"
            style={trigger ? { position: "static", right: "auto", bottom: "auto", zIndex: "auto" } : undefined}
          >
            {freeNote === null ? (
              <ul className="quick-flag-list">
                {options.map((reason, index) => (
                  <li key={reason}>
                    <button className="quick-flag-option" onClick={() => handlePick(reason)}>
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
                  handlePick(freeNote.trim());
                }}
              >
                <input
                  ref={freeNoteRef}
                  value={freeNote}
                  placeholder="reason"
                  onChange={(event) => setFreeNote(event.target.value)}
                />
              </form>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="dialog-content group-preview-dialog" aria-describedby={undefined}>
          <section className="modal group-preview">
            <Dialog.Title asChild>
              <h2>Approve {group.title}</h2>
            </Dialog.Title>
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
          <Dialog.Close asChild>
            <button>
            <span className="keycap">esc</span> Cancel
            </button>
          </Dialog.Close>
        </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  const reducedMotion = useReducedMotion();
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
  const completionStats = [
    { label: "Approved", value: `${approvedLines.toLocaleString()} lines` },
    { label: "Flagged", value: `${flagged.length}` },
    { label: "Skimmed", value: `${skimLines.toLocaleString()} lines` },
    { label: "Debt", value: `${(stats.debt * 100).toFixed(0)}%` },
    ...(stats.coverageOnChangedLines === undefined ? [] : [{ label: "Coverage", value: `${(stats.coverageOnChangedLines * 100).toFixed(0)}%` }])
  ];

  return (
    <section className="completion" aria-label="Review complete">
      <div className="completion-plate">
      <SieveWatermark />
      <h1 className="completion-headline">
        Reviewed: {model.totals.changedLines.toLocaleString()} lines | {model.totals.attentionLines.toLocaleString()} attention
      </h1>
      <div className="completion-stats">
        {completionStats.map((stat, index) => (
          <Stat key={stat.label} {...stat} delay={index * 0.06} reducedMotion={reducedMotion} />
        ))}
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
    <Dialog.Root open onOpenChange={(open) => !open && onContinue()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="completion flagged-review" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h1>Flagged review</h1>
          </Dialog.Title>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog-content decision-log-dialog" aria-describedby={undefined}>
          <section className="decision-log">
        <div className="panel-heading">
            <Dialog.Title asChild>
              <h1>Recent decisions</h1>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button>Close</button>
            </Dialog.Close>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Stat({ label, value, delay, reducedMotion }: { label: string; value: string; delay: number; reducedMotion: boolean | null }) {
  return (
    <motion.div
      className="stat"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransition(reducedMotion, { ...SPRING.settle, delay })}
    >
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </motion.div>
  );
}

function SieveWatermark() {
  return (
    <svg className="completion-watermark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" transform="rotate(-8 12 12)" />
      <circle cx="8" cy="8.5" r="1.15" />
      <circle cx="12" cy="12.5" r="1.15" />
      <circle cx="16" cy="16.5" r="1.15" />
    </svg>
  );
}
