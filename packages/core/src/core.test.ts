import { describe, expect, it } from "vitest";
import type { ParsedHunk } from "./types.js";
import { parseUnifiedDiff, unquoteGitPath } from "./parse.js";
import { assignHunkIds, baseHunkId } from "./identity.js";
import { analyzeDiff } from "./pipeline.js";
import { bandForRisk } from "./score.js";
import { computeStats } from "./stats.js";
import { emptyState } from "./state.js";

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
