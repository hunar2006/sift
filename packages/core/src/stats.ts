import { promises as fs } from "node:fs";
import type { ReviewModel, ReviewStateFile, StatsSnapshot } from "./types.js";
import { historyPath, ensureSiftDir } from "./state.js";
import { statsSnapshotSchema } from "./types.js";
import { coverageRatioForHunks } from "./coverage.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function computeStats(model: ReviewModel, state: ReviewStateFile): StatsSnapshot {
  const attentionGroups = new Set(model.groups.filter((group) => group.kind === "attention").map((group) => group.id));
  const reviewable = model.hunks.filter((hunk) => attentionGroups.has(hunk.groupId));
  const reviewedReviewableLines = reviewable
    .filter((hunk) => (state.hunks[hunk.id]?.status ?? "unreviewed") !== "unreviewed")
    .reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0);
  const flaggedHunks = model.hunks.filter((hunk) => state.hunks[hunk.id]?.status === "flagged").length;
  const attention = model.hunks.filter((hunk) => attentionGroups.has(hunk.groupId));
  const withProvenance = attention.filter((hunk) => Boolean(hunk.provenance)).length;
  const coverageOnChangedLines = coverageRatioForHunks(model.hunks);
  return {
    at: new Date().toISOString(),
    diffSpec: model.meta.diffSpec,
    changedLines: model.totals.changedLines,
    reviewableLines: model.totals.reviewableLines,
    reviewedReviewableLines,
    flaggedHunks,
    debt: 1 - reviewedReviewableLines / Math.max(model.totals.reviewableLines, 1),
    provenanceCoverage: attention.length === 0 ? 0 : withProvenance / attention.length,
    coverageOnChangedLines
  };
}

export async function appendStats(repoRoot: string, snapshot: StatsSnapshot): Promise<void> {
  await ensureSiftDir(repoRoot);
  await fs.appendFile(historyPath(repoRoot), `${JSON.stringify(snapshot)}\n`, "utf8");
}

export async function readHistory(repoRoot: string): Promise<StatsSnapshot[]> {
  const raw = await fs.readFile(historyPath(repoRoot), "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [statsSnapshotSchema.parse(JSON.parse(line))];
      } catch {
        return [];
      }
    });
}

export function renderStats(snapshot: StatsSnapshot, history: StatsSnapshot[] = []): string {
  const reviewedPct = snapshot.reviewableLines === 0
    ? 100
    : (snapshot.reviewedReviewableLines / snapshot.reviewableLines) * 100;
  const lines = [
    `Changed lines: ${snapshot.changedLines}`,
    `Reviewable lines: ${snapshot.reviewableLines}`,
    `Reviewed: ${reviewedPct.toFixed(1)}%`,
    `Debt: ${(snapshot.debt * 100).toFixed(1)}%`,
    `Flagged hunks: ${snapshot.flaggedHunks}`,
    `Provenance coverage: ${(snapshot.provenanceCoverage * 100).toFixed(0)}%`
  ];
  if (snapshot.coverageOnChangedLines !== undefined) {
    lines.push(`Coverage on changed lines: ${(snapshot.coverageOnChangedLines * 100).toFixed(0)}%`);
  }
  if (history.length >= 2) {
    lines.push(`Debt trend: ${sparkline(history.slice(-10).map((item) => item.debt))}`);
  }
  return lines.join("\n");
}

export function sparkline(values: number[]): string {
  if (values.length === 0) {
    return "";
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return BLOCKS[0]?.repeat(values.length) ?? "";
  }
  return values
    .map((value) => {
      const bucket = Math.round(((value - min) / (max - min)) * (BLOCKS.length - 1));
      return BLOCKS[bucket] ?? BLOCKS[0] ?? "";
    })
    .join("");
}
