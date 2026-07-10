import { describe, expect, it } from "vitest";
import { FORBIDDEN_VERDICT_PATTERNS, type ReviewModelWithState } from "@sift-review/core";
import {
  REVIEW_BRIEF_TEMPLATE_PHRASES,
  assertTemplateAvoidsVerdicts,
  renderReviewBrief,
  selectReviewBriefHunks
} from "./review-brief.js";

function modelFor(): ReviewModelWithState {
  return {
    meta: {
      siftVersion: "0.4.0",
      repoRoot: "/repo/example",
      diffSpec: "WORKTREE",
      generatedAt: "2026-07-10T00:00:00.000Z",
      git: { headSha: "abc", branch: "main" },
      astCoverage: 1
    },
    files: [],
    hunks: [
      {
        id: "flagged",
        file: "src/auth.ts",
        language: "typescript",
        header: "@@",
        lines: Array.from({ length: 121 }, (_, index) => ({ kind: "add" as const, text: `line ${index}`, newLine: index + 1 })),
        addedLines: 121,
        removedLines: 0,
        category: "logic",
        categoryReason: "DEFAULT_LOGIC",
        risk: 90,
        band: "high",
        reasons: [{ code: "TLS_DISABLED", label: "TLS verification is disabled", weight: 45 }],
        groupId: "attention",
        digest: { headline: "Changes token verification", details: [], source: "auto" },
        status: "flagged",
        note: "looks good only after the TLS issue is fixed"
      },
      {
        id: "high-unreviewed",
        file: "src/session.ts",
        language: "typescript",
        header: "@@",
        lines: [{ kind: "add", text: "session.rotate();", newLine: 8 }],
        addedLines: 1,
        removedLines: 0,
        category: "logic",
        categoryReason: "DEFAULT_LOGIC",
        risk: 75,
        band: "high",
        reasons: [{ code: "AUTH_CHANGE", label: "Authentication behavior changed", weight: 20 }],
        groupId: "attention",
        digest: { headline: "Updates session rotation", details: [], source: "auto" },
        status: "unreviewed"
      }
    ],
    groups: [{ id: "attention", title: "Attention", kind: "attention", order: 1, hunkIds: ["flagged", "high-unreviewed"], totalAdded: 122, totalRemoved: 0 }],
    totals: { changedLines: 122, attentionLines: 122, reviewableLines: 122, files: 2 }
  };
}

describe("agent review brief", () => {
  it("selects flagged or unreviewed high hunks", () => {
    const model = modelFor();
    expect(selectReviewBriefHunks(model, "flagged").map((hunk) => hunk.id)).toEqual(["flagged"]);
    expect(selectReviewBriefHunks(model, "unreviewed-high").map((hunk) => hunk.id)).toEqual(["high-unreviewed"]);
  });

  it("renders reviewer notes verbatim and marks a patch truncated after 120 lines", () => {
    const brief = renderReviewBrief(modelFor(), "flagged", new Date("2026-07-10T00:00:00.000Z"));
    expect(brief).toContain("Sift review brief — example (WORKTREE) — 2026-07-10");
    expect(brief).toContain("Reviewer note: looks good only after the TLS issue is fixed");
    expect(brief).toContain("Reasons: TLS verification is disabled");
    expect(brief).toContain("… truncated");
    expect(brief?.match(/^\+line /gmu)).toHaveLength(120);
    expect(brief).toContain("After making fixes, run sift again. Previously approved hunks stay approved; changed hunks will reappear as unreviewed.");
  });

  it("prints the empty state and keeps template language free of verdicts", () => {
    const model = modelFor();
    model.hunks = model.hunks.map((hunk) => ({ ...hunk, status: "approved" as const }));
    expect(renderReviewBrief(model, "flagged")).toBeNull();
    expect(() => assertTemplateAvoidsVerdicts()).not.toThrow();
    for (const phrase of REVIEW_BRIEF_TEMPLATE_PHRASES) {
      expect(FORBIDDEN_VERDICT_PATTERNS.some((pattern) => pattern.test(phrase))).toBe(false);
    }
  });
});
