import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDiff } from "./pipeline.js";
import { parseUnifiedDiff } from "./parse.js";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "diffs");

function fixture(name: string): string {
  const raw = readFileSync(path.join(fixtureRoot, name), "utf8");
  return raw.replace("__SIFT_OVERSIZED_LINE__", "x".repeat(10_050));
}

describe("parser fixtures", () => {
  it("parses rename-only as a pseudo hunk", () => {
    const parsed = parseUnifiedDiff(fixture("rename.patch"));
    expect(parsed.files[0]).toMatchObject({ path: "src/new.ts", oldPath: "src/old.ts", status: "renamed" });
    expect(parsed.hunks[0]).toMatchObject({ isRenameOnly: true, addedLines: 0, removedLines: 0 });
  });

  it("parses rename plus edit with line numbers", () => {
    const parsed = parseUnifiedDiff(fixture("rename-edit.patch"));
    expect(parsed.files[0]).toMatchObject({ path: "src/new.ts", oldPath: "src/old.ts", status: "renamed" });
    expect(parsed.hunks[0]?.lines.find((line) => line.kind === "add")).toMatchObject({ newLine: 2 });
  });

  it("keeps binary files listed with zero parser hunks", () => {
    const parsed = parseUnifiedDiff(fixture("binary.patch"));
    expect(parsed.files[0]).toMatchObject({ path: "assets/logo.png", status: "binary" });
    expect(parsed.hunks).toHaveLength(0);
  });

  it("synthesizes executable mode-only hunks", () => {
    const parsed = parseUnifiedDiff(fixture("mode-only.patch"));
    expect(parsed.files[0]).toMatchObject({ path: "scripts/run.sh", status: "mode" });
    expect(parsed.hunks[0]).toMatchObject({ isModeChange: true, newMode: "100755" });
  });

  it("ignores no-newline markers", () => {
    const parsed = parseUnifiedDiff(fixture("no-newline-at-eof.patch"));
    expect(parsed.hunks[0]?.lines).toHaveLength(2);
  });

  it("preserves CRLF content text enough for line numbering", () => {
    const parsed = parseUnifiedDiff(fixture("crlf.patch"));
    expect(parsed.hunks[0]?.lines.find((line) => line.kind === "del")).toMatchObject({ oldLine: 2 });
    expect(parsed.hunks[0]?.lines.find((line) => line.kind === "add")).toMatchObject({ newLine: 2 });
  });

  it("decodes quoted unicode paths", () => {
    const parsed = parseUnifiedDiff(fixture("quoted-unicode-path.patch"));
    expect(parsed.files[0]?.path).toBe("path with spaces/é.txt");
  });

  it("truncates oversized single lines", () => {
    const parsed = parseUnifiedDiff(fixture("oversized-single-line.patch"));
    expect(parsed.hunks[0]?.parserReasons[0]?.code).toBe("TRUNCATED_LINE");
  });

  it("handles new empty files", () => {
    const parsed = parseUnifiedDiff(fixture("new-empty-file.patch"));
    expect(parsed.files[0]).toMatchObject({ status: "added", path: "src/empty.ts" });
    expect(parsed.hunks).toHaveLength(0);
  });

  it("handles deleted files", () => {
    const parsed = parseUnifiedDiff(fixture("deleted-file.patch"));
    expect(parsed.files[0]).toMatchObject({ status: "deleted", path: "src/deleted.ts" });
    expect(parsed.hunks[0]?.removedLines).toBe(2);
  });

  it("classifies lockfiles through the full model", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: fixture("lockfile.patch")
    });
    expect(model.hunks[0]).toMatchObject({ file: "pnpm-lock.yaml", category: "deps" });
  });

  it("surfaces submodule bumps as config signals", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: fixture("submodule-bump.patch")
    });
    expect(model.hunks[0]).toMatchObject({ category: "config", categoryReason: "SUBMODULE_BUMP" });
    expect(model.hunks[0]?.reasons.map((reason) => reason.code)).toContain("SUBMODULE_BUMP");
  });

  it("does not treat Go build constraint edits as COMMENT_ONLY", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: fixture("go-build-tags.patch")
    });
    expect(model.hunks[0]?.categoryReason).not.toBe("COMMENT_ONLY");
    expect(model.hunks[0]?.category).not.toBe("mechanical");
  });
});
