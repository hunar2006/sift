import { describe, expect, it } from "vitest";
import { sortReviewHunks } from "./store.js";
import type { ReviewHunk, ReviewModel } from "./types.js";

const hunk = (overrides: Partial<ReviewHunk> & Pick<ReviewHunk, "id" | "file" | "risk">): ReviewHunk => ({
  language: "typescript",
  header: "@@",
  lines: [],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  band: "low",
  reasons: [],
  groupId: "logic",
  status: "unreviewed",
  ...overrides
});

const modelFor = (hunks: ReviewHunk[]): ReviewModel => ({
  meta: {
    siftVersion: "0.2.0",
    repoRoot: "/repo",
    diffSpec: "WORKTREE",
    generatedAt: "2026-01-01T00:00:00.000Z",
    git: { headSha: "abc", branch: "main" }
  },
  files: [],
  hunks,
  groups: [
    {
      id: "logic",
      title: "Logic",
      kind: "attention",
      order: 10,
      hunkIds: hunks.map((item) => item.id),
      totalAdded: hunks.length,
      totalRemoved: 0
    }
  ],
  totals: { changedLines: hunks.length, attentionLines: hunks.length, reviewableLines: hunks.length, files: hunks.length }
});

describe("sortReviewHunks", () => {
  it("supports risk, reading, and path modes", () => {
    const hunks = [
      hunk({ id: "use", file: "src/a-use.ts", risk: 60, readingRank: 1, newStart: 20 }),
      hunk({ id: "def", file: "src/z-defs.ts", risk: 10, readingRank: 0, newStart: 5 })
    ];
    const model = modelFor(hunks);

    expect(sortReviewHunks(hunks, model, "risk").map((item) => item.id)).toEqual(["use", "def"]);
    expect(sortReviewHunks(hunks, model, "reading").map((item) => item.id)).toEqual(["def", "use"]);
    expect(sortReviewHunks(hunks, model, "path").map((item) => item.id)).toEqual(["use", "def"]);
  });
});
