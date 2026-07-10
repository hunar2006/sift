import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeDiff } from "./pipeline.js";
import {
  initializeTreeSitter,
  TREE_SITTER_BUDGET_MS,
  TREE_SITTER_MAX_BYTES,
  TREE_SITTER_MAX_LINES
} from "./structure/index.js";

const require = createRequire(import.meta.url);
const grammarDirectory = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");

beforeAll(async () => {
  await initializeTreeSitter({ grammarDirectory });
});

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

  it("uses AST structure for token-identical formatting and import reorders", () => {
    const formatting = analyzeDiff({
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
`,
      newFileSources: new Map([["src/date.ts", "const label = formatDate(\n  value\n);\n"]])
    });
    expect(formatting.meta.astCoverage).toBe(1);
    expect(formatting.hunks[0]).toMatchObject({ category: "mechanical", categoryReason: "ast-format-only" });

    const imports = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/imports.ts b/src/imports.ts
--- a/src/imports.ts
+++ b/src/imports.ts
@@ -1,2 +1,2 @@
-import { beta } from "beta";
-import { alpha } from "alpha";
+import { alpha } from "alpha";
+import { beta } from "beta";
`,
      newFileSources: new Map([
        ["src/imports.ts", 'import { alpha } from "alpha";\nimport { beta } from "beta";\n']
      ])
    });
    expect(imports.meta.astCoverage).toBe(1);
    expect(imports.hunks[0]).toMatchObject({ category: "mechanical", categoryReason: "IMPORT_REORDER_ONLY" });
  });

  for (const fixture of languageFixtures()) {
    it(`extracts AST definitions, references, and enclosing symbols for ${fixture.name}`, () => {
      const model = analyzeDiff({
        repoRoot: "/repo",
        diffSpec: "WORKTREE",
        git: { headSha: "abc", branch: "main" },
        patch: fixture.patch,
        newFileSources: new Map([[fixture.file, fixture.source]])
      });

      expect(model.meta.astCoverage).toBe(1);
      const enclosingHunk = model.hunks.find((hunk) => hunk.newStart === fixture.enclosingLine);
      const definitionHunk = model.hunks.find((hunk) => hunk.newStart === fixture.definitionLine);
      expect(enclosingHunk?.enclosingSymbol).toBe(fixture.enclosingSymbol);
      expect(enclosingHunk?.references).toContain("helper");
      expect(definitionHunk?.defines).toContain(fixture.definedSymbol);
      expect(definitionHunk?.references).toContain("helper");
    });
  }

  it("extracts removed definitions from the AST removed side", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,3 +1,3 @@
-export function previous(value: string) {
+export function next(value: string) {
   return helper(value);
 }
`,
      newFileSources: new Map([
        ["src/service.ts", "export function next(value: string) {\n  return helper(value);\n}\n"]
      ])
    });

    expect(model.meta.astCoverage).toBe(1);
    expect(model.hunks[0]?.defines).toContain("next");
    expect(model.hunks[0]?.removedDefines).toContain("previous");
  });

  it("finds an enclosing symbol from changed rows even when hunk context crosses its boundary", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/context.ts b/src/context.ts
--- a/src/context.ts
+++ b/src/context.ts
@@ -1,6 +1,6 @@
 export function outer() {
   const before = true;
-  const changed = oldHelper();
+  const changed = helper();
   return changed;
 }
 const outside = true;
`,
      newFileSources: new Map([
        [
          "src/context.ts",
          "export function outer() {\n  const before = true;\n  const changed = helper();\n  return changed;\n}\nconst outside = true;\n"
        ]
      ])
    });

    expect(model.meta.astCoverage).toBe(1);
    expect(model.hunks[0]?.enclosingSymbol).toBe("outer");
  });

  it("falls back per file when tree-sitter sees a deliberately broken file", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/broken.ts b/src/broken.ts
--- a/src/broken.ts
+++ b/src/broken.ts
@@ -2 +2 @@
-  const value = oldValue;
+  const value = helper();
@@ -4,0 +5 @@
+export function fallbackAdded() {}
`,
      newFileSources: new Map([
        ["src/broken.ts", "function outer() {\n  const value = ;\n  return value;\n}\nexport function fallbackAdded() {}\n"]
      ])
    });

    expect(model.meta.astCoverage).toBe(0);
    expect(model.hunks.find((hunk) => hunk.newStart === 2)?.enclosingSymbol).toBe("outer");
    expect(model.hunks.find((hunk) => hunk.newStart === 5)?.defines).toContain("fallbackAdded");
  });

  it("keeps tokenizer facts when byte and line guards skip AST parsing", () => {
    expect(TREE_SITTER_BUDGET_MS).toBe(2_500);
    const oversized = guardedModel(
      "src/oversized.ts",
      `export function byteFallback() {}\n${"x".repeat(TREE_SITTER_MAX_BYTES)}`,
      "byteFallback"
    );
    expect(oversized.meta.astCoverage).toBe(0);
    expect(oversized.hunks[0]?.defines).toContain("byteFallback");

    const tooManyLines = guardedModel(
      "src/many-lines.ts",
      `export function lineFallback() {}\n${"\n".repeat(TREE_SITTER_MAX_LINES)}`,
      "lineFallback"
    );
    expect(tooManyLines.meta.astCoverage).toBe(0);
    expect(tooManyLines.hunks[0]?.defines).toContain("lineFallback");
  });

  it("excludes generated, binary, and dependency files from AST coverage", () => {
    const generated = guardedModel(
      "dist/generated.ts",
      "export function generatedFallback() {}\n",
      "generatedFallback"
    );
    expect(generated.meta.astCoverage).toBe(0);
    expect(generated.hunks[0]).toMatchObject({ category: "generated", defines: ["generatedFallback"] });

    const binary = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: "diff --git a/src/image.ts b/src/image.ts\nBinary files a/src/image.ts and b/src/image.ts differ\n",
      newFileSources: new Map([["src/image.ts", "export function shouldNotParse() {}\n"]])
    });
    expect(binary.meta.astCoverage).toBe(0);
    expect(binary.hunks[0]?.category).toBe("binary");

    const dependency = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,4 +1,5 @@
 {
   "dependencies": {
+    "zod": "3.24.2",
     "yaml": "2.9.0"
   }
`,
      newFileSources: new Map([
        ["package.json", '{\n  "dependencies": {\n    "zod": "3.24.2",\n    "yaml": "2.9.0"\n  }\n}\n']
      ])
    });
    expect(dependency.meta.astCoverage).toBe(0);
    expect(dependency.hunks[0]?.category).toBe("deps");
  });

  it("uses AST rename sites while preserving the cross-file rename thresholds", () => {
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: files.map(renamePatch).join(""),
      newFileSources: new Map(
        files.map((file) => [file, "const a = renderDate(value);\nconst b = renderDate(otherValue);\n"])
      )
    });

    expect(model.meta.astCoverage).toBe(1);
    expect(model.groups.find((group) => group.title === "Rename: formatDate -> renderDate")?.hunkIds).toHaveLength(3);
  });
});

interface LanguageFixture {
  name: string;
  file: string;
  source: string;
  patch: string;
  enclosingLine: number;
  definitionLine: number;
  enclosingSymbol: string;
  definedSymbol: string;
}

function languageFixtures(): LanguageFixture[] {
  return [
    fixture(
      "TypeScript",
      "src/typescript.ts",
      "export class Formatter {\n  format(value: string) {\n    const output = helper(value);\n    return output;\n  }\n}\n\nexport function addedTs(value: string) {\n  return helper(value);\n}\n",
      3,
      8,
      "format",
      "addedTs",
      "    const output = helper(value);",
      "export function addedTs(value: string) {\n  return helper(value);\n}"
    ),
    fixture(
      "TSX",
      "src/view.tsx",
      "export class View {\n  render() {\n    return <Panel value={helper()} />;\n  }\n}\n\nexport function AddedView() {\n  return <Panel value={helper()} />;\n}\n",
      3,
      7,
      "render",
      "AddedView",
      "    return <Panel value={helper()} />;",
      "export function AddedView() {\n  return <Panel value={helper()} />;\n}"
    ),
    fixture(
      "JavaScript",
      "src/javascript.js",
      "export class Formatter {\n  format(value) {\n    const output = helper(value);\n    return output;\n  }\n}\n\nexport function addedJs(value) {\n  return helper(value);\n}\n",
      3,
      8,
      "format",
      "addedJs",
      "    const output = helper(value);",
      "export function addedJs(value) {\n  return helper(value);\n}"
    ),
    fixture(
      "Python",
      "src/python.py",
      "class Formatter:\n    def format(self, value):\n        output = helper(value)\n        return output\n\ndef added_py(value):\n    return helper(value)\n",
      3,
      6,
      "format",
      "added_py",
      "        output = helper(value)",
      "def added_py(value):\n    return helper(value)"
    ),
    fixture(
      "Go",
      "src/service.go",
      "package demo\n\ntype Formatter struct{}\n\nfunc (Formatter) Format(value string) string {\n    output := helper(value)\n    return output\n}\n\nfunc AddedGo(value string) string {\n    return helper(value)\n}\n",
      6,
      10,
      "Format",
      "AddedGo",
      "    output := helper(value)",
      "func AddedGo(value string) string {\n    return helper(value)\n}"
    )
  ];
}

function fixture(
  name: string,
  file: string,
  source: string,
  enclosingLine: number,
  definitionLine: number,
  enclosingSymbol: string,
  definedSymbol: string,
  changedLine: string,
  definition: string
): LanguageFixture {
  return {
    name,
    file,
    source,
    enclosingLine,
    definitionLine,
    enclosingSymbol,
    definedSymbol,
    patch: `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -${enclosingLine} +${enclosingLine} @@
-${changedLine.replace("helper", "oldHelper")}
+${changedLine}
@@ -${definitionLine - 1},0 +${definitionLine},${definition.split("\n").length} @@
${definition.split("\n").map((line) => `+${line}`).join("\n")}
`
  };
}

function guardedModel(file: string, source: string, symbol: string) {
  return analyzeDiff({
    repoRoot: "/repo",
    diffSpec: "WORKTREE",
    git: { headSha: "abc", branch: "main" },
    patch: `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -0,0 +1 @@
+export function ${symbol}() {}
`,
    newFileSources: new Map([[file, source]])
  });
}

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
