import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderHunkPatch } from "./patch.js";
import { analyzeDiff } from "./pipeline.js";
import { renderMarkdownReport } from "./report.js";
import { emptyState } from "./state.js";
import { computeStats } from "./stats.js";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "diffs");

describe("rename patch rendering", () => {
  it("renders rename-only pseudo-hunks in report output instead of an empty patch", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: readFileSync(path.join(fixtureRoot, "rename.patch"), "utf8")
    });
    const state = emptyState();
    const expected = "renamed: src/old.ts → src/new.ts";
    expect(renderHunkPatch(model.hunks[0]!)).toBe(expected);
    expect(renderMarkdownReport(model, state, computeStats(model, state))).toContain(expected);
  });

  it("adds a post-it-yourself footer for PR reports", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "pr/acme/sift#123",
      git: { headSha: "abc", branch: "main" },
      patch: readFileSync(path.join(fixtureRoot, "rename.patch"), "utf8")
    });
    const state = emptyState();
    expect(renderMarkdownReport(model, state, computeStats(model, state))).toContain(
      "Post it yourself: sift report --md | gh pr comment 123 --body-file -"
    );
  });
});
