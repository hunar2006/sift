import pc from "picocolors";
import { mergeReviewState, type HunkGroup, type HunkWithState, type ReviewModel, type ReviewStateFile, type StatsSnapshot } from "@sift-review/core";

export interface PrintOptions {
  color?: boolean;
}

export interface PrintPayload {
  headline: {
    changedLines: number;
    attentionLines: number;
    reviewableLines: number;
    debt: number;
    flaggedHunks: number;
    coverageOnChangedLines?: number;
    provenanceCoverage: number;
  };
  topRiskyHunks: Array<{
    id: string;
    file: string;
    line?: number;
    score: number;
    band: string;
    status: string;
    headline: string;
    topReason?: string;
  }>;
  skimBundles: Array<{
    id: string;
    title: string;
    hunks: number;
    lines: number;
  }>;
}

export function printPayload(model: ReviewModel, state: ReviewStateFile, stats: StatsSnapshot): PrintPayload {
  const withState = mergeReviewState(model, state);
  return {
    headline: {
      changedLines: stats.changedLines,
      attentionLines: model.totals.attentionLines,
      reviewableLines: stats.reviewableLines,
      debt: stats.debt,
      flaggedHunks: stats.flaggedHunks,
      coverageOnChangedLines: stats.coverageOnChangedLines,
      provenanceCoverage: stats.provenanceCoverage
    },
    topRiskyHunks: [...withState.hunks]
      .sort((a, b) => b.risk - a.risk || a.file.localeCompare(b.file) || (a.newStart ?? 0) - (b.newStart ?? 0))
      .slice(0, 10)
      .map((hunk) => ({
        id: hunk.id,
        file: hunk.file,
        line: hunk.newStart,
        score: hunk.risk,
        band: hunk.band,
        status: hunk.status,
        headline: hunk.digest.headline,
        topReason: topReason(hunk)
      })),
    skimBundles: model.groups.filter((group) => group.kind === "skim").map(skimSummary)
  };
}

export function renderPrintReport(model: ReviewModel, state: ReviewStateFile, stats: StatsSnapshot, options: PrintOptions = {}): string {
  const payload = printPayload(model, state, stats);
  const color = options.color !== false;
  const headline = payload.headline;
  const lines = [
    colorize(`Sift: ${headline.changedLines} lines changed, ${headline.attentionLines} need attention`, "title", color),
    [
      `debt ${pct(headline.debt)}`,
      `flagged ${headline.flaggedHunks}`,
      `provenance ${pct(headline.provenanceCoverage)}`,
      headline.coverageOnChangedLines === undefined ? undefined : `coverage ${pct(headline.coverageOnChangedLines)}`
    ]
      .filter(Boolean)
      .join(" | "),
    "",
    "Top risky hunks:"
  ];

  if (payload.topRiskyHunks.length === 0) {
    lines.push("  none");
  } else {
    for (const hunk of payload.topRiskyHunks) {
      const location = `${hunk.file}${hunk.line ? `:${hunk.line}` : ""}`;
      const reason = hunk.topReason ? ` - ${hunk.topReason}` : "";
      lines.push(`  ${riskLabel(hunk.score, color)} ${location} - score ${hunk.score} - ${hunk.status}${reason}`);
      lines.push(`      ${colorize(hunk.headline, "muted", color)}`);
    }
  }

  lines.push("", "Skim bundles:");
  if (payload.skimBundles.length === 0) {
    lines.push("  none");
  } else {
    for (const group of payload.skimBundles) {
      lines.push(`  ${group.title}: ${group.hunks} hunks, ${group.lines} lines`);
    }
  }

  return lines.join("\n");
}

function skimSummary(group: HunkGroup): PrintPayload["skimBundles"][number] {
  return {
    id: group.id,
    title: group.title,
    hunks: group.hunkIds.length,
    lines: group.totalAdded + group.totalRemoved
  };
}

function topReason(hunk: HunkWithState): string | undefined {
  const reason = hunk.reasons.find((candidate) => candidate.tier !== "nit") ?? hunk.reasons[0];
  return reason ? `${reason.code}${reason.evidence ? ` (${reason.evidence})` : ""}` : undefined;
}

function riskLabel(score: number, color: boolean): string {
  if (score >= 80) {
    return colorize("critical", "critical", color);
  }
  if (score >= 70) {
    return colorize("high", "high", color);
  }
  if (score >= 40) {
    return colorize("medium", "medium", color);
  }
  return colorize("low", "low", color);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function colorize(value: string, kind: "title" | "critical" | "high" | "medium" | "low" | "muted", enabled: boolean): string {
  if (!enabled) {
    return value;
  }
  if (kind === "title") {
    return pc.bold(value);
  }
  if (kind === "muted") {
    return pc.dim(value);
  }
  if (kind === "critical") {
    return pc.red(pc.bold(value));
  }
  if (kind === "high") {
    return pc.red(value);
  }
  if (kind === "medium") {
    return pc.yellow(value);
  }
  return pc.gray(value);
}
