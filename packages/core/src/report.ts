import path from "node:path";
import { provenanceSourceLabel } from "./provenance.js";
import type { ReviewModel, ReviewStateFile, StatsSnapshot } from "./types.js";

export function renderMarkdownReport(model: ReviewModel, state: ReviewStateFile, stats: StatsSnapshot): string {
  const repo = path.basename(model.meta.repoRoot);
  const flagged = model.hunks.filter((hunk) => state.hunks[hunk.id]?.status === "flagged");
  const approvedHigh = model.hunks.filter(
    (hunk) => hunk.band === "high" && state.hunks[hunk.id]?.status === "approved"
  );
  const skimGroups = model.groups.filter((group) => group.kind === "skim");
  const provenanceSessions = new Set(
    model.hunks.flatMap((hunk) => (hunk.provenance ? [`${hunk.provenance.source}:${hunk.provenance.sessionId}`] : []))
  );
  const provenanceSources = new Set(
    model.hunks.flatMap((hunk) => (hunk.provenance ? [provenanceSourceLabel(hunk.provenance.source)] : []))
  );
  const topPrompt = model.hunks.find((hunk) => hunk.provenance?.userPromptExcerpt)?.provenance?.userPromptExcerpt;

  return [
    `# Sift review - ${repo} (${model.meta.diffSpec}) - ${new Date(stats.at).toLocaleDateString()}`,
    "",
    `**${stats.changedLines} lines changed | ${model.totals.attentionLines} needed attention | debt ${(
      stats.debt * 100
    ).toFixed(1)}% | provenance ${(stats.provenanceCoverage * 100).toFixed(0)}%${coverageSummary(stats)}**`,
    "",
    `## Flagged (${flagged.length})`,
    ...(flagged.length === 0
      ? ["- None"]
      : flagged.map((hunk) => {
          const stored = state.hunks[hunk.id];
          const reasonCodes = hunk.reasons.map((reason) => reason.code).join(", ");
          const line = hunk.newStart ? ` L${hunk.newStart}` : "";
          const note = stored?.note ? ` - note: "${stored.note}"` : "";
          return `- \`${hunk.file}\`${line} - risk ${hunk.risk} (${reasonCodes || "no signals"})${note}`;
        })),
    "",
    `## High risk, approved (${approvedHigh.length})`,
    ...(approvedHigh.length === 0
      ? ["- None"]
      : approvedHigh.map((hunk) => {
          const reasonCodes = hunk.reasons.map((reason) => reason.code).join(", ");
          return `- \`${hunk.file}\` - risk ${hunk.risk} (${reasonCodes || "no signals"}) - approved by review`;
        })),
    "",
    "## Skimmed in bulk",
    skimGroups.length === 0
      ? "None"
      : skimGroups.map((group) => `${group.title} ${group.totalAdded + group.totalRemoved} lines`).join(" | "),
    "",
    "## Provenance",
    `${(stats.provenanceCoverage * 100).toFixed(0)}% of attention hunks matched provenance sessions (${provenanceSessions.size} sessions${
      provenanceSources.size > 0 ? ` from ${[...provenanceSources].join(", ")}` : ""
    }).${
      topPrompt ? ` Top prompt: "${topPrompt}"` : ""
    }`,
    ...(stats.coverageOnChangedLines === undefined
      ? []
      : [
          "",
          "## Coverage",
          `${(stats.coverageOnChangedLines * 100).toFixed(0)}% of changed executable lines were covered by parsed artifacts.`
        ]),
    ""
  ].join("\n");
}

function coverageSummary(stats: StatsSnapshot): string {
  return stats.coverageOnChangedLines === undefined
    ? ""
    : ` | coverage ${(stats.coverageOnChangedLines * 100).toFixed(0)}%`;
}
