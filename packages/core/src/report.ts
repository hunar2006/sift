import path from "node:path";
import { provenanceSourceLabel } from "./provenance.js";
import { renderHunkPatch } from "./patch.js";
import type { ReviewModel, ReviewStateFile, StatsSnapshot } from "./types.js";
import { wordDiffLines } from "./worddiff.js";

export function renderMarkdownReport(model: ReviewModel, state: ReviewStateFile, stats: StatsSnapshot): string {
  const repo = path.basename(model.meta.repoRoot);
  const flagged = model.hunks.filter((hunk) => state.hunks[hunk.id]?.status === "flagged");
  const approvedHigh = model.hunks.filter(
    (hunk) => hunk.band === "high" && state.hunks[hunk.id]?.status === "approved"
  );
  const skimGroups = model.groups.filter((group) => group.kind === "skim");
  const renameOnly = model.hunks.filter((hunk) => hunk.isRenameOnly && hunk.lines.length === 0);
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
          return `- \`${hunk.file}\`${line} - risk ${hunk.risk} - ${hunk.digest.headline} (${reasonCodes || "no signals"})${note}`;
        })),
    "",
    `## High risk, approved (${approvedHigh.length})`,
    ...(approvedHigh.length === 0
      ? ["- None"]
      : approvedHigh.map((hunk) => {
          const reasonCodes = hunk.reasons.map((reason) => reason.code).join(", ");
          return `- \`${hunk.file}\` - risk ${hunk.risk} - ${hunk.digest.headline} (${reasonCodes || "no signals"}) - approved by review`;
        })),
    "",
    `## Top attention`,
    ...(topAttention(model).length === 0
      ? ["- None"]
      : topAttention(model).map(
          (hunk) => `- \`${hunk.file}\` - risk ${hunk.risk} - ${hunk.digest.headline}`
        )),
    "",
    "## Skimmed in bulk",
    skimGroups.length === 0
      ? "None"
      : skimGroups.map((group) => `${group.title} ${group.totalAdded + group.totalRemoved} lines`).join(" | "),
    "",
    "## Rename-only files",
    ...(renameOnly.length === 0 ? ["- None"] : renameOnly.map((hunk) => `- ${renderHunkPatch(hunk)}`)),
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

export function renderHtmlReport(model: ReviewModel, state: ReviewStateFile, stats: StatsSnapshot): string {
  const repo = path.basename(model.meta.repoRoot);
  const attentionGroupIds = new Set(model.groups.filter((group) => group.kind === "attention").map((group) => group.id));
  const attention = model.hunks.filter((hunk) => attentionGroupIds.has(hunk.groupId));
  const provenanceCount = new Set(
    model.hunks.flatMap((hunk) => (hunk.provenance ? [`${hunk.provenance.source}:${hunk.provenance.sessionId}`] : []))
  ).size;
  const groups = model.groups
    .map(
      (group) =>
        `<li><strong>${escapeHtml(group.title)}</strong> · ${group.hunkIds.length.toLocaleString()} hunks · ${(group.totalAdded + group.totalRemoved).toLocaleString()} lines${group.digest ? ` · ${escapeHtml(group.digest)}` : ""}</li>`
    )
    .join("");
  const hunks = attention.length === 0 ? "<p>No attention hunks.</p>" : attention.map((hunk) => renderHtmlHunk(hunk, state)).join("\n");
  const skim = model.groups
    .filter((group) => group.kind === "skim")
    .map((group) => `${escapeHtml(group.title)} (${group.hunkIds.length.toLocaleString()} hunks)`)
    .join(" · ") || "None";
  const coverage = stats.coverageOnChangedLines === undefined ? "No coverage artifact was supplied." : `${(stats.coverageOnChangedLines * 100).toFixed(0)}% of changed executable lines were covered by parsed artifacts.`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sift review · ${escapeHtml(repo)}</title><style>
:root{--surface:#0c0f14;--surface-2:#151a23;--text:#c9d2e0;--text-lo:#8b95a8;--border:#283244;--add:#18794e;--del:#9f2f2f;--accent:#96a6ce}*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1100px;margin:auto;padding:28px}header{border-bottom:1px solid var(--border);padding-bottom:18px}h1{margin:0;font-size:24px}h2{margin-top:30px;font-size:17px}p,.muted{color:var(--text-lo)}.totals{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.total{padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2)}ul{padding-left:20px}details{margin:10px 0;border:1px solid var(--border);border-radius:6px;background:var(--surface-2)}summary{cursor:pointer;padding:10px}summary strong{color:var(--accent)}.reasons{padding:0 10px 8px;color:var(--text-lo)}pre{margin:0;padding:10px;overflow:auto;border-top:1px solid var(--border);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.line{display:block;white-space:pre}.add{background:color-mix(in srgb,var(--add) 24%,transparent)}.del{background:color-mix(in srgb,var(--del) 24%,transparent)}mark{color:inherit;padding:0}.add mark{background:color-mix(in srgb,var(--add) 76%,transparent)}.del mark{background:color-mix(in srgb,var(--del) 72%,transparent)}footer{margin-top:30px;color:var(--text-lo);font-size:12px}</style></head>
<body><main><header><h1>Sift review · ${escapeHtml(repo)}</h1><p>${escapeHtml(model.meta.diffSpec)} · generated ${escapeHtml(stats.at)}</p><div class="totals"><span class="total">${stats.changedLines.toLocaleString()} lines changed</span><span class="total">${model.totals.attentionLines.toLocaleString()} attention lines</span><span class="total">${(stats.debt * 100).toFixed(1)}% debt</span><span class="total">${(stats.provenanceCoverage * 100).toFixed(0)}% provenance</span></div></header>
<section><h2>Group summary</h2><ul>${groups}</ul><p class="muted">Skim groups: ${skim}</p></section>
<section><h2>Attention hunks</h2>${hunks}</section>
<section><h2>Coverage and provenance</h2><p>${coverage}</p><p>${provenanceCount.toLocaleString()} provenance session${provenanceCount === 1 ? "" : "s"} matched in this review.</p></section>
<footer>Static local report. No external assets or scripts are required.</footer></main></body></html>`;
}

function renderHtmlHunk(hunk: ReviewModel["hunks"][number], state: ReviewStateFile): string {
  const reasons = hunk.reasons.length === 0 ? "No signals" : hunk.reasons.map((reason) => `${reason.code} (${reason.weight > 0 ? "+" : ""}${reason.weight})`).join(" · ");
  const lines = wordDiffLines(hunk.lines)
    .map((line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      const text = line.segments
        ? line.segments.map((segment) => segment.changed ? `<mark>${escapeHtml(segment.text)}</mark>` : escapeHtml(segment.text)).join("")
        : escapeHtml(line.text);
      return `<span class="line ${line.kind}">${prefix}${text}</span>`;
    })
    .join("\n");
  const status = state.hunks[hunk.id]?.status ?? "unreviewed";
  return `<details><summary><strong>${escapeHtml(hunk.file)}</strong> · risk ${hunk.risk.toLocaleString()} · ${escapeHtml(hunk.digest.headline)} · ${status}</summary><div class="reasons">${escapeHtml(reasons)}</div><pre>${lines}</pre></details>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function topAttention(model: ReviewModel): ReviewModel["hunks"] {
  const attentionGroups = new Set(
    model.groups.filter((group) => group.kind === "attention").map((group) => group.id)
  );
  return model.hunks
    .filter((hunk) => attentionGroups.has(hunk.groupId))
    .slice()
    .sort((left, right) => right.risk - left.risk)
    .slice(0, 8);
}

function coverageSummary(stats: StatsSnapshot): string {
  return stats.coverageOnChangedLines === undefined
    ? ""
    : ` | coverage ${(stats.coverageOnChangedLines * 100).toFixed(0)}%`;
}
