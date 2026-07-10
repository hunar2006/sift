import path from "node:path";
import {
  containsForbiddenVerdict,
  FORBIDDEN_VERDICT_PATTERNS,
  type HunkWithState,
  type ReviewModelWithState
} from "@sift-review/core";

const MAX_PATCH_LINES = 120;

export const REVIEW_BRIEF_TEMPLATE_PHRASES = [
  "Sift review brief",
  "Reviewer note:",
  "Reasons:",
  "After making fixes, run sift again. Previously approved hunks stay approved; changed hunks will reappear as unreviewed."
] as const;

export type ReviewBriefMode = "flagged" | "unreviewed-high";

export function selectReviewBriefHunks(model: ReviewModelWithState, mode: ReviewBriefMode): HunkWithState[] {
  return model.hunks
    .filter((hunk) => (mode === "flagged" ? hunk.status === "flagged" : hunk.status === "unreviewed" && hunk.risk >= 70))
    .sort((left, right) => right.risk - left.risk || left.file.localeCompare(right.file) || hunkLine(left) - hunkLine(right));
}

export function renderReviewBrief(model: ReviewModelWithState, mode: ReviewBriefMode, now = new Date()): string | null {
  const selected = selectReviewBriefHunks(model, mode);
  if (selected.length === 0) {
    return null;
  }
  assertTemplateAvoidsVerdicts();
  const repo = path.basename(model.meta.repoRoot);
  const sections = selected.flatMap((hunk) => {
    const reasons = hunk.reasons
      .filter((reason) => reason.tier !== "nit")
      .filter((reason) => !containsForbiddenVerdict(reason.label))
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
      .slice(0, 3)
      .map((reason) => reason.label)
      .join("; ");
    return [
      `### ${hunk.file}:${hunkLine(hunk)} \u2014 ${safeGeneratedText(hunk.digest.headline, "Changed hunk")}`,
      "",
      `Reviewer note: ${hunk.note ?? "(none)"}`,
      `Reasons: ${reasons || "No primary reasons recorded."}`,
      "",
      "```diff",
      renderPatch(hunk),
      "```",
      ""
    ];
  });
  return [
    `Sift review brief \u2014 ${repo} (${model.meta.diffSpec}) \u2014 ${now.toISOString().slice(0, 10)}`,
    "",
    ...sections,
    "After making fixes, run sift again. Previously approved hunks stay approved; changed hunks will reappear as unreviewed."
  ].join("\n");
}

export function assertTemplateAvoidsVerdicts(): void {
  for (const phrase of REVIEW_BRIEF_TEMPLATE_PHRASES) {
    if (FORBIDDEN_VERDICT_PATTERNS.some((pattern) => pattern.test(phrase))) {
      throw new Error("Review brief template must not contain verdict language.");
    }
  }
}

function renderPatch(hunk: HunkWithState): string {
  const lines = hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);
  return [...lines.slice(0, MAX_PATCH_LINES), ...(lines.length > MAX_PATCH_LINES ? ["\u2026 truncated"] : [])].join("\n");
}

function hunkLine(hunk: HunkWithState): number {
  return hunk.newStart ?? hunk.oldStart ?? 0;
}

function safeGeneratedText(value: string, fallback: string): string {
  return containsForbiddenVerdict(value) ? fallback : value;
}
