import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompletionScreen, GroupApprovePreview, QuickFlagPicker } from "./panels.js";
import type { ReviewHunk, ReviewModel } from "./types.js";
import type { StatsSnapshot } from "@sift-review/core";

function hunk(overrides: Partial<ReviewHunk>): ReviewHunk {
  return {
    id: "h1",
    file: "src/a.ts",
    language: "typescript",
    header: "@@",
    lines: [],
    addedLines: 4,
    removedLines: 1,
    category: "logic",
    categoryReason: "DEFAULT_LOGIC",
    risk: 40,
    band: "medium",
    reasons: [],
    groupId: "g",
    digest: { headline: "Adds `rotate()`", details: [], source: "auto" },
    status: "unreviewed",
    ...overrides
  };
}

describe("QuickFlagPicker", () => {
  it("renders numbered canned reasons and a free-note option", () => {
    const html = renderToStaticMarkup(
      <QuickFlagPicker reasons={["Needs tests", "Security concern"]} onPick={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Needs tests");
    expect(html).toContain("Security concern");
    expect(html).toContain("Write a note");
  });
});

describe("GroupApprovePreview", () => {
  const group = { title: "Lockfiles", digest: "2 hunks — lockfiles (30 lines)", totalAdded: 20, totalRemoved: 10 };

  it("lists per-hunk headlines and a confirm total", () => {
    const html = renderToStaticMarkup(
      <GroupApprovePreview
        group={group}
        hunks={[hunk({ id: "a", file: "a.ts" }), hunk({ id: "b", file: "b.ts" })]}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(html).toContain("Lockfiles");
    expect(html).toContain("rotate()");
    expect(html).toContain("Approve 2 (30 lines)");
  });

  it("shows the blocked notice and disables confirm when a hot signal blocks bulk approval", () => {
    const html = renderToStaticMarkup(
      <GroupApprovePreview
        group={group}
        hunks={[hunk({ id: "a" })]}
        blockedIds={["a"]}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(html).toContain("individual approval");
    expect(html).toContain("disabled");
  });
});

describe("CompletionScreen", () => {
  const model = {
    meta: { repoRoot: "/repo", diffSpec: "WORKTREE" },
    hunks: [
      hunk({ id: "a", status: "approved", addedLines: 10, removedLines: 0 }),
      hunk({ id: "b", status: "flagged", note: "Needs tests", digest: { headline: "Adds `login()`", details: [], source: "auto" } })
    ],
    groups: [{ id: "skim", title: "Formatting", kind: "skim", order: 9, hunkIds: [], totalAdded: 100, totalRemoved: 12 }],
    totals: { changedLines: 2314, attentionLines: 178, reviewableLines: 178, files: 3 }
  } as unknown as ReviewModel;
  const stats = { debt: 0.12, coverageOnChangedLines: 0.85 } as StatsSnapshot;

  it("renders the completion headline, stats, flagged list, and actions", () => {
    const html = renderToStaticMarkup(
      <CompletionScreen model={model} stats={stats} onCopyReport={() => undefined} onBackToQueue={() => undefined} onShowDecisions={() => undefined} />
    );
    expect(html).toContain("Reviewed:");
    expect(html).toContain("2,314 lines");
    expect(html).toContain("login()");
    expect(html).toContain("Needs tests");
    expect(html).toContain("Copy report");
    expect(html).toContain("Back to queue");
  });
});
