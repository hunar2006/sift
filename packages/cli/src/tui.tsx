import { Box, Text, useApp, useInput, render } from "ink";
import React, { useEffect, useState } from "react";
import {
  BulkApproveBlockedError,
  approveGroup,
  computeStats,
  loadFlagReasons,
  mergeReviewState,
  readReviewState,
  revertScopeFor,
  snapshotAndRevert,
  undoRevert,
  updateHunkStatus,
  wordDiffLines,
  type HunkWithState,
  type ReviewModel,
  type StatsSnapshot
} from "@sift-review/core";
import {
  ReviewSession,
  nextAttentionUnreviewed,
  relativeHunkId,
  type SessionHunk
} from "@sift-review/core/session";
import { openHunkInEditor } from "./editor.js";
import { acquireLock, releaseLock } from "./lock.js";
import { renderPrintReport } from "./print.js";
import type { PipelineResult } from "./pipeline-runner.js";
import { startLiveWatcher, type LiveWatcher } from "./watch.js";

const PATCH_COLLAPSE = 200;
const BAND_COLOR: Record<string, string> = {
  high: "red",
  medium: "yellow",
  low: "cyan",
  skim: "gray"
};

export interface TuiOptions {
  result: PipelineResult;
  reanalyze: () => Promise<PipelineResult>;
  watch?: boolean;
  printFrame?: boolean;
}

type Mode = "review" | "flag" | "flag-note" | "group-confirm" | "revert-confirm" | "help";

function bandColor(band: string): string {
  return BAND_COLOR[band] ?? "white";
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function patchLines(hunk: HunkWithState): Array<{ prefix: string; text: string; kind: HunkWithState["lines"][number]["kind"]; segments?: HunkWithState["lines"][number]["segments"] }> {
  return wordDiffLines(hunk.lines).map((line) => {
    const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
    return { prefix, text: line.text, kind: line.kind, segments: line.segments };
  });
}

export async function runTui(options: TuiOptions): Promise<void> {
  const { state: initialState } = await readReviewState(options.result.model.meta.repoRoot);
  const flagReasons = await loadFlagReasons(options.result.model.meta.repoRoot);
  let latestResult = options.result;
  let latestState = initialState;

  if (options.printFrame) {
    const model = mergeReviewState(latestResult.model, latestState);
    const stats = computeStats(latestResult.model, latestState);
    const frame = renderFrameText(model, stats);
    process.stdout.write(`${frame}\n`);
    return;
  }

  const lockWarning = await acquireLock(latestResult.model.meta.repoRoot, "tui");
  if (lockWarning) {
    console.warn(lockWarning);
  }

  let watcher: LiveWatcher | undefined;
  let exitSummary = "";

  const session = new ReviewSession();
  session.setModel(mergeReviewState(latestResult.model, latestState), computeStats(latestResult.model, latestState));

  const app = render(
    React.createElement(TuiApp, {
      session,
      flagReasons,
      getRepoRoot: () => latestResult.model.meta.repoRoot,
      getModel: () => latestResult.model,
      persistStatus: async (id, status, note, options) => {
        const file = latestResult.model.hunks.find((hunk) => hunk.id === id)?.file;
        await updateHunkStatus(latestResult.model.meta.repoRoot, id, status, note, { file, ...options });
        const { state } = await readReviewState(latestResult.model.meta.repoRoot);
        latestState = state;
      },
      persistGroupApprove: async (groupId) => {
        await approveGroup(latestResult.model.meta.repoRoot, latestResult.model, groupId);
        const { state } = await readReviewState(latestResult.model.meta.repoRoot);
        latestState = state;
        session.setModel(mergeReviewState(latestResult.model, latestState), computeStats(latestResult.model, latestState));
      },
      performRevert: async (hunk) => {
        const model = latestResult.model;
        if (!revertScopeFor(model.meta.diffSpec)) {
          throw new Error("Revert works on the working tree. This diff is historical.");
        }
        const { state } = await readReviewState(model.meta.repoRoot);
        const reverted = await snapshotAndRevert({
          repoRoot: model.meta.repoRoot,
          filePath: hunk.file,
          diffSpec: model.meta.diffSpec,
          hunkStates: model.hunks.filter((candidate) => candidate.file === hunk.file).map((candidate) => {
            const stored = state.hunks[candidate.id] ?? { status: "unreviewed" as const };
            return { hunkId: candidate.id, status: stored.status, note: stored.note };
          })
        });
        latestResult = await options.reanalyze();
        latestState = (await readReviewState(latestResult.model.meta.repoRoot)).state;
        session.setModel(mergeReviewState(latestResult.model, latestState), computeStats(latestResult.model, latestState));
        return reverted;
      },
      undoFileRevert: async (id) => {
        await undoRevert(latestResult.model.meta.repoRoot, id);
        latestResult = await options.reanalyze();
        latestState = (await readReviewState(latestResult.model.meta.repoRoot)).state;
        session.setModel(mergeReviewState(latestResult.model, latestState), computeStats(latestResult.model, latestState));
      },
      onExit: (summary) => {
        exitSummary = summary;
        app.unmount();
      }
    })
  );

  if (options.watch) {
    watcher = await startLiveWatcher({
      repoRoot: latestResult.model.meta.repoRoot,
      reanalyze: options.reanalyze,
      current: () => latestResult,
      apply: (next, update) => {
        latestResult = next;
        void readReviewState(next.model.meta.repoRoot).then(({ state }) => {
          latestState = state;
          const model = mergeReviewState(next.model, state);
          const stats = computeStats(next.model, state);
          session.applyLiveData(model, stats, update.addedIds, update.removedIds);
          if (update.addedIds.length > 0) {
            session.setToast(`+${update.addedIds.length} new`);
          }
        });
      },
      onWarning: (message) => session.setToast(message)
    });
  }

  try {
    await app.waitUntilExit();
  } finally {
    await watcher?.close();
    await releaseLock(latestResult.model.meta.repoRoot);
  }
  if (exitSummary) {
    process.stdout.write(`${exitSummary}\n`);
  } else {
    const { state } = await readReviewState(latestResult.model.meta.repoRoot);
    process.stdout.write(
      `${renderPrintReport(latestResult.model, state, computeStats(latestResult.model, state), { color: false })}\n`
    );
  }
}

function renderFrameText(model: ReturnType<typeof mergeReviewState>, stats: StatsSnapshot): string {
  const lines = [
    `SIFT TUI FRAME · ${model.hunks.length} hunks · ${model.groups.length} groups · debt ${Math.round(stats.debt * 100)}%`
  ];
  for (const group of model.groups.slice(0, 8)) {
    lines.push(`[${group.kind}] ${group.title} (${group.hunkIds.length})`);
  }
  const first = model.hunks[0];
  if (first) {
    lines.push(`-- ${first.file} · ${first.band} ${first.risk} · ${first.digest.headline}`);
  }
  lines.push("footer: n of m · j/k move · a approve · x flag · u unreview · z undo · Shift+Z redo · R revert · q quit");
  return lines.join("\n");
}

interface TuiAppProps {
  session: ReviewSession;
  flagReasons: string[];
  getRepoRoot: () => string;
  getModel: () => ReviewModel;
  persistStatus: (
    id: string,
    status: "approved" | "flagged" | "unreviewed",
    note?: string,
    options?: { via?: "undo" | "redo" }
  ) => Promise<void>;
  persistGroupApprove: (groupId: string) => Promise<void>;
  performRevert: (hunk: SessionHunk) => Promise<{ id: string; path: string }>;
  undoFileRevert: (id: string) => Promise<void>;
  onExit: (summary: string) => void;
}

function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<Mode>("review");
  const [stamp, setStamp] = useState<string | undefined>();
  const [flagNote, setFlagNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<string | undefined>();
  const [pendingRevert, setPendingRevert] = useState<SessionHunk | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => props.session.subscribe(() => setTick((value) => value + 1)), [props.session]);

  const state = props.session.getState();
  const visible = props.session.visible();
  const selected = visible.find((hunk) => hunk.id === state.selectedId) ?? visible[0];
  const selectedIndex = Math.max(0, visible.findIndex((hunk) => hunk.id === selected?.id));
  void tick;

  const columns = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 28;
  const railWidth = Math.min(34, Math.max(24, Math.floor(columns * 0.34)));

  useInput((input, key) => {
    if (mode === "help") {
      if (input === "?" || key.escape || input === "q") {
        setMode("review");
      }
      return;
    }
    if (mode === "flag-note") {
      if (key.escape) {
        setMode("review");
        setFlagNote("");
        return;
      }
      if (key.return && selected) {
        void decide(selected, "flagged", flagNote.trim() || undefined);
        setFlagNote("");
        setMode("review");
        return;
      }
      if (key.backspace || key.delete) {
        setFlagNote((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFlagNote((value) => `${value}${input}`);
      }
      return;
    }
    if (mode === "flag") {
      if (key.escape) {
        setMode("review");
        return;
      }
      if (input === "i") {
        setMode("flag-note");
        return;
      }
      const index = Number.parseInt(input, 10);
      if (selected && index >= 1 && index <= props.flagReasons.length) {
        void decide(selected, "flagged", props.flagReasons[index - 1]);
        setMode("review");
      }
      return;
    }
    if (mode === "group-confirm") {
      if (key.escape || input === "n") {
        setMode("review");
        setPendingGroupId(undefined);
        return;
      }
      if ((input === "y" || key.return) && pendingGroupId) {
        void props
          .persistGroupApprove(pendingGroupId)
          .then(() => {
            setMessage("group approved");
            setMode("review");
            setPendingGroupId(undefined);
          })
          .catch((error: unknown) => {
            if (error instanceof BulkApproveBlockedError) {
              setMessage("refused: group has hot signals (weight ≥ 15)");
            } else {
              setMessage(error instanceof Error ? error.message : String(error));
            }
            setMode("review");
            setPendingGroupId(undefined);
          });
      }
      return;
    }
    if (mode === "revert-confirm") {
      if (key.escape || input === "n") {
        setMode("review");
        setPendingRevert(undefined);
        return;
      }
      if ((input === "y" || key.return) && pendingRevert) {
        void props
          .performRevert(pendingRevert)
          .then((record) => {
            props.session.pushUndoEntry([{
              hunkId: pendingRevert.id,
              prevStatus: pendingRevert.status,
              prevNote: pendingRevert.note,
              nextStatus: "unreviewed",
              revertId: record.id,
              revertPath: record.path
            }]);
            setMessage(`reverted ${record.path} — Z to undo`);
          })
          .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
          .finally(() => {
            setMode("review");
            setPendingRevert(undefined);
          });
      }
      return;
    }

    if (input === "q") {
      const model = props.getModel();
      void readReviewState(props.getRepoRoot()).then(({ state: reviewState }) => {
        const summary = renderPrintReport(model, reviewState, computeStats(model, reviewState), { color: false });
        props.onExit(summary);
        exit();
      });
      return;
    }
    if (input === "?") {
      setMode("help");
      return;
    }
    if (input === "j" || key.downArrow) {
      props.session.setSelected(relativeHunkId(visible.map((h) => h.id), selected?.id, 1));
      return;
    }
    if (input === "k" || key.upArrow) {
      props.session.setSelected(relativeHunkId(visible.map((h) => h.id), selected?.id, -1));
      return;
    }
    if (input === "g") {
      props.session.setSelected(visible[0]?.id);
      return;
    }
    if (input === "G") {
      props.session.setSelected(visible[visible.length - 1]?.id);
      return;
    }
    if (input === "n") {
      props.session.setSelected(nextAttentionUnreviewed(visible, selected?.id, 1));
      return;
    }
    if (input === "p") {
      props.session.setSelected(nextAttentionUnreviewed(visible, selected?.id, -1));
      return;
    }
    if (input === "a" && selected) {
      void decide(selected, "approved");
      return;
    }
    if (input === "x") {
      setMode("flag");
      return;
    }
    if (input === "u" && selected) {
      void decide(selected, "unreviewed");
      return;
    }
    if (input === "z") {
      const undone = props.session.popUndoEntry();
      if (undone.restore.length > 0) {
        const reverted = undone.restore.find((change) => change.revertId);
        if (reverted?.revertId) {
          void props.undoFileRevert(reverted.revertId).then(() => setMessage(`undid revert of ${reverted.revertPath ?? "file"}`)).catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : String(error));
          });
          return;
        }
        for (const change of undone.restore) {
          props.session.setStatus(change.hunkId, change.prevStatus, change.prevNote);
          void props.persistStatus(change.hunkId, change.prevStatus, change.prevNote, { via: "undo" });
        }
        setMessage("undone");
      } else if (undone.message) {
        setMessage(undone.message);
      }
      return;
    }
    if (input === "Z") {
      const redone = props.session.popRedoEntry();
      if (redone.restore.length > 0) {
        for (const change of redone.restore) {
          if (change.nextStatus) {
            props.session.setStatus(change.hunkId, change.nextStatus, change.nextNote);
            void props.persistStatus(change.hunkId, change.nextStatus, change.nextNote, { via: "redo" });
          }
        }
        setMessage("redone");
      } else if (redone.message) {
        setMessage(redone.message);
      }
      return;
    }
    if (input === "A" && selected) {
      setPendingGroupId(selected.groupId);
      setMode("group-confirm");
      return;
    }
    if (input === " ") {
      setExpanded((value) => !value);
      return;
    }
    if (input === "o" && selected) {
      void openHunkInEditor(props.getRepoRoot(), props.getModel(), selected.id).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    }
    if (input === "R" && selected) {
      if (!revertScopeFor(props.getModel().meta.diffSpec)) {
        setMessage("Revert works on the working tree. This diff is historical.");
        return;
      }
      setPendingRevert(selected);
      setMode("revert-confirm");
    }
  });

  async function decide(hunk: SessionHunk, status: "approved" | "flagged" | "unreviewed", note?: string): Promise<void> {
    props.session.pushUndoEntry([
      {
        hunkId: hunk.id,
        prevStatus: hunk.status,
        prevNote: hunk.note,
        nextStatus: status,
        nextNote: note
      }
    ]);
    props.session.setStatus(hunk.id, status, note);
    await props.persistStatus(hunk.id, status, note);
    if (status === "approved") {
      setStamp("VERIFIED");
      setTimeout(() => setStamp(undefined), 600);
      const next = nextAttentionUnreviewed(
        props.session.visible().map((item) =>
          item.id === hunk.id ? { ...item, status } : item
        ),
        hunk.id,
        1
      );
      // After approve, advance toward next unreviewed attention when possible
      const after = props.session.visible();
      const nextId =
        after.find((item) => item.id !== hunk.id && item.status === "unreviewed" && (item.band === "high" || item.band === "medium"))
          ?.id ?? after.find((item) => item.id !== hunk.id && item.status === "unreviewed")?.id;
      if (nextId) {
        props.session.setSelected(nextId);
      } else if (next) {
        props.session.setSelected(next);
      }
    }
  }

  const groups = state.model?.groups ?? [];
  const patch = selected ? patchLines(selected) : [];
  const shownPatch = expanded ? patch : patch.slice(0, PATCH_COLLAPSE);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexGrow={1}>
        <Box width={railWidth} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          {groups.map((group) => {
            const members = visible.filter((hunk) => hunk.groupId === group.id);
            if (group.kind === "skim") {
              return (
                <Text key={group.id} dimColor>
                  ▸ {truncate(group.title, railWidth - 6)} · {group.hunkIds.length}
                </Text>
              );
            }
            return (
              <Box key={group.id} flexDirection="column" marginBottom={1}>
                <Text bold>
                  {truncate(group.title, railWidth - 4)} ({group.hunkIds.length})
                </Text>
                {members.slice(0, 12).map((hunk) => {
                  const active = hunk.id === selected?.id;
                  return (
                    <Text key={hunk.id} color={active ? "green" : bandColor(hunk.band)} wrap="truncate">
                      {active ? "›" : " "}
                      {String(hunk.risk).padStart(3, " ")} {truncate(hunk.file, 12)} {hunk.status === "flagged" ? `âš‘ ${truncate(hunk.note?.trim() || "Flagged", Math.max(8, railWidth - 20))}` : truncate(hunk.digest.headline, railWidth - 20)}
                    </Text>
                  );
                })}
              </Box>
            );
          })}
        </Box>
        <Box flexGrow={1} flexDirection="column" paddingX={1}>
          {selected ? (
            <>
              <Text>
                {selected.file}:{selected.newStart ?? "?"} · {selected.band} {selected.risk} · {selected.status}
                {stamp ? ` · ${stamp}` : ""}
              </Text>
              <Text bold>{selected.digest.headline}</Text>
              {selected.digest.details?.slice(0, 3).map((line) => (
                <Text key={line} dimColor>
                  · {line}
                </Text>
              ))}
              {selected.reasons.slice(0, 5).map((reason) => (
                <Text key={`${reason.code}-${reason.label}`} color="yellow">
                  {reason.label} · +{reason.weight}
                </Text>
              ))}
              <Box flexDirection="column" marginTop={1}>
                {shownPatch.map((line, index) => (
                  <Text
                    key={`${index}-${line.text.slice(0, 24)}`}
                    color={line.kind === "add" ? "green" : line.kind === "del" ? "red" : undefined}
                  >
                    {line.prefix}
                    {line.segments ? (
                      line.segments.map((segment, segmentIndex) => (
                        <Text key={`${segmentIndex}-${segment.text}`} bold={segment.changed}>
                          {segment.text}
                        </Text>
                      ))
                    ) : (
                      truncate(line.text, Math.max(20, columns - railWidth - 4))
                    )}
                  </Text>
                ))}
                {!expanded && patch.length > PATCH_COLLAPSE ? (
                  <Text dimColor>… {patch.length - PATCH_COLLAPSE} more (space to expand)</Text>
                ) : null}
              </Box>
            </>
          ) : (
            <Text dimColor>Nothing to review.</Text>
          )}
        </Box>
      </Box>
      <Box>
        <Text>
          {selectedIndex + 1} of {visible.length} · j/k move · a approve · x flag · u unreview · z undo · A group · o
           editor · R revert · ? help · q quit
          {state.toast ? ` · ${state.toast}` : ""}
          {message ? ` · ${message}` : ""}
        </Text>
      </Box>
      {mode === "flag" ? (
        <Box flexDirection="column">
          <Text>Flag reason (1–{props.flagReasons.length}, i note, Esc cancel):</Text>
          {props.flagReasons.map((reason, index) => (
            <Text key={reason}>
              {index + 1}. {reason}
            </Text>
          ))}
        </Box>
      ) : null}
      {mode === "revert-confirm" && pendingRevert ? (
        <Text color="red">Revert {pendingRevert.file}? +{pendingRevert.addedLines}/−{pendingRevert.removedLines} discarded, snapshot kept [y/N]</Text>
      ) : null}
      {mode === "flag-note" ? <Text>Note: {flagNote}█</Text> : null}
      {mode === "group-confirm" ? <Text>Approve group? y/N</Text> : null}
      {mode === "help" ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Sift TUI</Text>
          <Text>j/k hunk · g/G first/last · n/p next/prev unreviewed attention</Text>
          <Text>a approve · x flag · u unreview · z undo · A group · space expand · o editor · q quit</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export { TuiApp };
