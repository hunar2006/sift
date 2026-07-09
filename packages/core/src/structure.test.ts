import { describe, expect, it } from "vitest";
import { analyzeDiff } from "./pipeline.js";

describe("structural layer", () => {
  it("classifies line-wrapped token-identical changes as format-only mechanical", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/date.ts b/src/date.ts
--- a/src/date.ts
+++ b/src/date.ts
@@ -1 +1,3 @@
-const label = formatDate(value);
+const label = formatDate(
+  value
+);
`
    });

    expect(model.hunks[0]).toMatchObject({ category: "mechanical", categoryReason: "ast-format-only" });
    expect(model.groups[0]).toMatchObject({ id: "formatting-whitespace", kind: "skim" });
  });

  it("does not mark a one-token behavior change as mechanical", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/date.ts b/src/date.ts
--- a/src/date.ts
+++ b/src/date.ts
@@ -1 +1 @@
-const label = formatDate(value);
+const label = formatDate(otherValue);
`
    });

    expect(model.hunks[0]?.category).toBe("logic");
  });

  it("extracts definitions and referenced identifiers from added lines", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/date.ts b/src/date.ts
--- a/src/date.ts
+++ b/src/date.ts
@@ -1 +1,3 @@
 export const existing = true;
+export function renderDate(value: Date) {
+  return formatDate(value);
+}
`
    });

    expect(model.hunks[0]?.defines).toContain("renderDate");
    expect(model.hunks[0]?.references).toEqual(expect.arrayContaining(["renderDate", "formatDate", "value"]));
  });

  it("creates a skim rename-pattern group for a repeated cross-file identifier rename", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: [renamePatch("src/a.ts"), renamePatch("src/b.ts"), renamePatch("src/c.ts")].join("")
    });

    const group = model.groups.find((item) => item.title === "Rename: formatDate -> renderDate");
    expect(group).toMatchObject({ kind: "skim" });
    expect(group?.hunkIds).toHaveLength(3);
    expect(model.hunks.every((hunk) => hunk.groupId === group?.id && hunk.band === "skim")).toBe(true);
  });
});

function renamePatch(file: string): string {
  return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1,2 +1,2 @@
-const a = formatDate(value);
-const b = formatDate(otherValue);
+const a = renderDate(value);
+const b = renderDate(otherValue);
`;
}
