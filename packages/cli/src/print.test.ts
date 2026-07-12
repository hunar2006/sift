import { describe, expect, it } from "vitest";
import { emptyState, type Hunk, type ReviewModel, type StatsSnapshot } from "@sift-review/core";
import { printPayload, renderPrintReport } from "./print.js";

describe("print renderer", () => {
  it("renders a compact terminal summary without color", () => {
    const output = renderPrintReport(model(), emptyState(), stats(), { color: false });
    expect(output).toContain("Sift: 26 lines changed, 21 need attention");
    expect(output).toContain("critical src/auth.ts:12 - score 84 - unreviewed - TLS_DISABLED");
    expect(output).toContain("Mechanical: 1 hunks, 5 lines");
    expect(output).not.toContain("\u001B[");
  });

  it("returns valid automation payload fields", () => {
    const payload = printPayload(model(), emptyState(), stats());
    expect(payload.headline).toMatchObject({
      changedLines: 26,
      coverageOnChangedLines: 0.75,
      provenanceCoverage: 0.5
    });
    expect(payload.topRiskyHunks[0]).toMatchObject({
      file: "src/auth.ts",
      score: 84,
      topReason: "TLS_DISABLED"
    });
    expect(payload.skimBundles[0]).toMatchObject({
      title: "Mechanical",
      lines: 5
    });
  });

  it("renders rename-only pseudo-hunks without an empty patch", () => {
    const renamed = { ...model(), hunks: [...model().hunks, renameHunk()] };
    expect(renderPrintReport(renamed, emptyState(), stats(), { color: false })).toContain(
      "renamed: src/old.ts → src/new.ts"
    );
    expect(printPayload(renamed, emptyState(), stats()).renameOnlyHunks).toEqual([
      { file: "src/new.ts", patch: "renamed: src/old.ts → src/new.ts" }
    ]);
  });
});

function model(): ReviewModel {
  const high = hunk("h1", "src/auth.ts", 84, "high", "attention", 12);
  const medium = hunk("h2", "src/cache.ts", 45, "medium", "attention", 3);
  const skim = hunk("h3", "src/format.ts", 0, "skim", "skim", 1);
  return {
    meta: {
      siftVersion: "0.2.0",
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      generatedAt: "2026-01-01T00:00:00.000Z",
      git: { headSha: "abc", branch: "main" },
      astCoverage: 0
    },
    files: [],
    hunks: [high, medium, skim],
    groups: [
      {
        id: "attention",
        title: "Needs review",
        kind: "attention",
        order: 10,
        hunkIds: ["h1", "h2"],
        totalAdded: 21,
        totalRemoved: 0
      },
      {
        id: "skim",
        title: "Mechanical",
        kind: "skim",
        order: 20,
        hunkIds: ["h3"],
        totalAdded: 5,
        totalRemoved: 0
      }
    ],
    totals: { changedLines: 26, attentionLines: 21, reviewableLines: 21, files: 3 }
  };
}

function hunk(id: string, file: string, risk: number, band: Hunk["band"], groupId: string, line: number): Hunk {
  return {
    id,
    file,
    language: "typescript",
    header: "@@",
    lines: [{ kind: "add", text: "const changed = true;", newLine: line }],
    addedLines: groupId === "skim" ? 5 : 10,
    removedLines: 0,
    category: groupId === "skim" ? "mechanical" : "logic",
    categoryReason: "test",
    risk,
    band,
    reasons: risk > 70 ? [{ code: "TLS_DISABLED", label: "TLS validation disabled", weight: 45 }] : [],
    groupId,
    newStart: line,
    digest: { headline: `Modifies \`${file}\``, details: [], source: "auto" }
  };
}

function renameHunk(): Hunk {
  return {
    id: "rename",
    file: "src/new.ts",
    oldPath: "src/old.ts",
    language: "typescript",
    header: "RENAME_ONLY",
    lines: [],
    addedLines: 0,
    removedLines: 0,
    category: "mechanical",
    categoryReason: "RENAME_ONLY",
    risk: 0,
    band: "skim",
    reasons: [],
    groupId: "skim",
    isRenameOnly: true,
    digest: { headline: "Renames `old.ts` → `new.ts`", details: [], source: "auto" }
  };
}

function stats(): StatsSnapshot {
  return {
    at: "2026-01-01T00:00:00.000Z",
    diffSpec: "WORKTREE",
    changedLines: 26,
    reviewableLines: 21,
    reviewedReviewableLines: 0,
    flaggedHunks: 0,
    debt: 1,
    provenanceCoverage: 0.5,
    coverageOnChangedLines: 0.75
  };
}
