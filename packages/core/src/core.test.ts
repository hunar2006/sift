import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ParsedHunk } from "./types.js";
import { parseUnifiedDiff, unquoteGitPath } from "./parse.js";
import { assignHunkIds, baseHunkId } from "./identity.js";
import { analyzeDiff } from "./pipeline.js";
import { bandForRisk } from "./score.js";
import { computeStats, renderStats, sparkline } from "./stats.js";
import {
  BulkApproveBlockedError,
  approveGroup,
  emptyState,
  mergeReviewState,
  readReviewState,
  updateHunkStatus
} from "./state.js";
import { renderMarkdownReport } from "./report.js";
import { computeRiskSignals } from "./classify/signals.js";
import {
  discoverRepoRoot,
  generatedPathsFromGitAttributes,
  listUntracked,
  readWorktreeFile,
  runGit,
  syntheticDiffForUntracked
} from "./git.js";
import { ingestDiff } from "./ingest.js";
import { isConfigPath, isDocsPath, isTestPath } from "./classify/categories.js";
import { normalizeRepoRelative } from "./path-utils.js";
import { attachFirstSeenAt, pruneSeen, readSeen, seenPath } from "./seen.js";

const execFileAsync = promisify(execFile);

describe("parseUnifiedDiff", () => {
  it("parses rename plus edit and line numbers", () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/a.ts b/src/b.ts
similarity index 84%
rename from src/a.ts
rename to src/b.ts
--- a/src/a.ts
+++ b/src/b.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`);
    expect(parsed.files[0]).toMatchObject({ path: "src/b.ts", oldPath: "src/a.ts", status: "renamed" });
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]?.lines.find((line) => line.kind === "add")).toMatchObject({ newLine: 2 });
  });

  it("keeps binary parser output as a file with zero parsed hunks", () => {
    const parsed = parseUnifiedDiff(`diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`);
    expect(parsed.files[0]).toMatchObject({ path: "img.png", status: "binary" });
    expect(parsed.hunks).toHaveLength(0);
  });

  it("decodes quoted git paths and truncates giant lines", () => {
    expect(unquoteGitPath('"a/path with spaces/\\303\\251.txt"')).toBe("a/path with spaces/é.txt");
    const giant = "x".repeat(10050);
    const parsed = parseUnifiedDiff(`diff --git "a/path with spaces/\\303\\251.txt" "b/path with spaces/\\303\\251.txt"
--- "a/path with spaces/\\303\\251.txt"
+++ "b/path with spaces/\\303\\251.txt"
@@ -1 +1 @@
-old
+${giant}
`);
    expect(parsed.files[0]?.path).toBe("path with spaces/é.txt");
    expect(parsed.hunks[0]?.parserReasons[0]?.code).toBe("TRUNCATED_LINE");
    expect(parsed.hunks[0]?.lines.find((line) => line.kind === "add")?.text.length).toBeLessThan(4050);
  });
});

describe("git ingest", () => {
  it("discovers a repo, reads worktree files, and includes untracked synthetic diffs", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-git-"));
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.email", "test@sift.local"]);
    await git(repoRoot, ["config", "user.name", "Sift Test"]);
    await fs.writeFile(path.join(repoRoot, "tracked.ts"), "export const a = 1;\n", "utf8");
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "base"]);
    await fs.writeFile(path.join(repoRoot, "tracked.ts"), "export const a = 2;\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "new.ts"), "export const b = 1;\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "new file.ts"), "export const c = 1;\n", "utf8");

    expect(await discoverRepoRoot(repoRoot)).toBe(repoRoot);
    expect(await readWorktreeFile(repoRoot, "tracked.ts")).toContain("a = 2");
    expect(await generatedPathsFromGitAttributes(repoRoot, ["tracked.ts"])).toBeInstanceOf(Set);
    expect(await listUntracked(repoRoot)).toEqual(expect.arrayContaining(["new.ts", "new file.ts"]));
    expect(await syntheticDiffForUntracked(repoRoot, "new.ts")).toContain("+++ b/new.ts");
    expect(await runGit(["rev-parse", "--show-toplevel"], repoRoot)).toContain(repoRoot.replace(/\\/g, "/").split("/").at(-1) ?? "");

    const ingested = await ingestDiff({ cwd: repoRoot });
    expect(ingested.diffSpec).toBe("WORKTREE");
    expect(ingested.patch).toContain("tracked.ts");
    expect(ingested.patch).toContain("new.ts");
  });
});

describe("Windows path normalization", () => {
  it("uses POSIX-normalized paths for category matching", () => {
    expect(normalizeRepoRelative("a\\tests\\auth.test.ts")).toBe("tests/auth.test.ts");
    expect(isTestPath("src\\tests\\auth.test.ts")).toBe(true);
    expect(isConfigPath(".github\\workflows\\ci.yml")).toBe(true);
    expect(isDocsPath("docs\\windows.md")).toBe(true);
  });
});

describe("first-seen hunk state", () => {
  it("persists first-seen timestamps across reloads and bounds the sidecar", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-seen-"));
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/fresh.ts b/src/fresh.ts
--- a/src/fresh.ts
+++ b/src/fresh.ts
@@ -0,0 +1 @@
+export const fresh = true;
`
    });
    const first = await attachFirstSeenAt(model);
    const firstSeenAt = first.hunks[0]?.firstSeenAt;
    expect(firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(await readSeen(repoRoot)).toMatchObject({ [first.hunks[0]?.id ?? "missing"]: firstSeenAt });
    expect(seenPath(repoRoot)).toContain(path.join(".sift", "seen.json"));

    const reloaded = await attachFirstSeenAt(model);
    expect(reloaded.hunks[0]?.firstSeenAt).toBe(firstSeenAt);

    const many = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, index) => [`h${index}`, new Date(1_700_000_000_000 + index).toISOString()])
    );
    const pruned = pruneSeen(many);
    expect(Object.keys(pruned)).toHaveLength(5_000);
    expect(pruned.h5000).toBeDefined();
    expect(pruned.h0).toBeUndefined();
  });
});

describe("signals, state, stats, and reports", () => {
  it("fires representative risk signals with evidence", () => {
    const hunk: ParsedHunk = {
      file: ".env.local",
      language: "text",
      header: "@@",
      lines: [
        { kind: "add", text: 'API_KEY = "sk-12345678901234567890"', newLine: 1 },
        { kind: "add", text: 'const q = "SELECT * FROM users WHERE id=" + id;', newLine: 2 },
        { kind: "add", text: "console.log(q); // TODO remove", newLine: 3 }
      ],
      addedLines: 3,
      removedLines: 0,
      parserReasons: []
    };
    const codes = computeRiskSignals(hunk, "logic").map((reason) => reason.code);
    expect(codes).toEqual(expect.arrayContaining(["SECRET_LIKE", "SQL_CONCAT", "ENV_FILE", "DEBUG_LEFTOVER", "TODO_ADDED"]));
  });

  it("persists state, merges statuses, blocks hot bulk approval, and renders stats/report", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-state-"));
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1 +1,2 @@
 export const session = true;
+export const unsafe = { rejectUnauthorized: false };
diff --git a/docs/guide.md b/docs/guide.md
--- a/docs/guide.md
+++ b/docs/guide.md
@@ -1 +1,2 @@
 # Guide
+More detail.
`
    });
    const first = model.hunks[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    await updateHunkStatus(repoRoot, first.id, "flagged", "check tls");
    const { state } = await readReviewState(repoRoot);
    expect(state.hunks[first.id]?.status).toBe("flagged");
    expect(mergeReviewState(model, state).hunks[0]?.note).toBe("check tls");
    await expect(approveGroup(repoRoot, model, first.groupId)).rejects.toBeInstanceOf(BulkApproveBlockedError);
    const stats = computeStats(model, state);
    expect(renderStats(stats, [stats, { ...stats, debt: 0.25 }])).toContain("Debt trend:");
    expect(sparkline([0.9, 0.5, 0.1])).toHaveLength(3);
    expect(renderMarkdownReport(model, state, stats)).toContain("## Flagged (1)");
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

describe("identity", () => {
  const hunk = (file: string, addText: string, start: number): ParsedHunk => ({
    file,
    language: "typescript",
    header: `@@ -${start},1 +${start},1 @@`,
    oldStart: start,
    newStart: start,
    lines: [
      { kind: "context", text: "const before = true;", oldLine: start, newLine: start },
      { kind: "add", text: addText, newLine: start + 1 }
    ],
    addedLines: 1,
    removedLines: 0,
    parserReasons: []
  });

  it("is stable across line shifts but changes by file and content", () => {
    expect(baseHunkId(hunk("a.ts", "const value = 1;", 1))).toBe(
      baseHunkId(hunk("a.ts", "const value = 1;", 50))
    );
    expect(baseHunkId(hunk("a.ts", "const value = 1;", 1))).not.toBe(
      baseHunkId(hunk("a.ts", "const value = 2;", 1))
    );
    expect(baseHunkId(hunk("a.ts", "const value = 1;", 1))).not.toBe(
      baseHunkId(hunk("b.ts", "const value = 1;", 1))
    );
  });

  it("disambiguates identical hunks in one file", () => {
    const ids = assignHunkIds([hunk("a.ts", "same", 1), hunk("a.ts", "same", 100)]).map((item) => item.id);
    expect(ids[0]).toMatch(/^h_/);
    expect(ids[1]).toBe(`${ids[0]}~2`);
  });
});

describe("analysis pipeline", () => {
  it("classifies hot security hunks ahead of skim groups", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,2 +1,5 @@
 export function makeSession() {
+  const API_KEY = "sk-12345678901234567890";
+  return { rejectUnauthorized: false };
 }
diff --git a/src/format.ts b/src/format.ts
--- a/src/format.ts
+++ b/src/format.ts
@@ -1 +1 @@
-  const x = 1;
+    const x = 1;
`
    });
    expect(model.hunks[0]?.file).toBe("src/auth/session.ts");
    expect(model.hunks[0]?.band).toBe("high");
    expect(model.hunks[0]?.reasons.map((reason) => reason.code)).toContain("SECRET_LIKE");
    expect(model.groups.map((group) => group.id)).toContain("formatting-whitespace");
  });

  it("computes band boundaries and debt", () => {
    expect(bandForRisk(9)).toBe("skim");
    expect(bandForRisk(10)).toBe("low");
    expect(bandForRisk(40)).toBe("medium");
    expect(bandForRisk(70)).toBe("high");
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: null },
      patch: `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 export const a = 1;
+export const b = 2;
`
    });
    const state = emptyState();
    const first = model.hunks[0];
    if (first) {
      state.hunks[first.id] = { status: "approved", reviewedAt: new Date().toISOString(), via: "single" };
    }
    expect(computeStats(model, state).debt).toBe(0);
  });
});
