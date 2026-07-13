import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDiff } from "../pipeline.js";
import type { ParsedHunk, RiskReason } from "../types.js";
import { languageForPath } from "./languages.js";
import { directiveCommentToken, isDirectiveComment } from "./directives.js";
import { computeRiskSignals } from "./signals.js";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "diffs");

const directiveCases = [
  ["src/compat.ts", "// @ts-ignore", "@ts-ignore"],
  ["src/compat.ts", "// @ts-expect-error", "@ts-expect-error"],
  ["src/compat.ts", "// @ts-nocheck", "@ts-nocheck"],
  ["src/compat.ts", "// eslint-disable", "eslint-disable"],
  ["src/compat.ts", "// eslint-disable-next-line", "eslint-disable-next-line"],
  ["src/compat.ts", "// eslint-disable-line", "eslint-disable-line"],
  ["src/compat.ts", "// prettier-ignore", "prettier-ignore"],
  ["src/compat.ts", "// biome-ignore lint/suspicious", "biome-ignore"],
  ["src/compat.ts", "// istanbul ignore next", "istanbul ignore"],
  ["src/compat.ts", "// c8 ignore next", "c8 ignore"],
  ["src/compat.ts", "/* webpackIgnore: true */", "webpackIgnore: true"],
  ["src/compat.ts", "/** @jsx h */", "@jsx"],
  ["src/compat.ts", "/** @jsxImportSource preact */", "@jsxImportSource"],
  ["src/app.py", "# noqa", "# noqa"],
  ["src/app.py", "# type: ignore", "# type: ignore"],
  ["src/app.py", "# pragma: no cover", "# pragma: no cover"],
  ["src/app.py", "# mypy: ignore-errors", "# mypy:"],
  ["src/app.py", "# ruff: noqa", "# ruff: noqa"],
  ["src/app.py", "# fmt: off", "# fmt: off"],
  ["src/app.py", "# fmt: on", "# fmt: on"],
  ["pkg/check.go", "//nolint:revive", "//nolint"],
  ["pkg/check.go", "//go:build linux", "//go:build"],
  ["pkg/check.go", "//go:generate go run ./tools", "//go:generate"],
  ["middleware/realip.go", "// Deprecated: Use ClientIPFromHeader instead.", "// Deprecated:"],
  ["src/format.rs", "// rustfmt::skip", "// rustfmt::skip"],
  ["src/Service.java", "// noinspection SpellCheckingInspection", "// noinspection"],
  ["src/Service.kt", "// NOSONAR", "NOSONAR"],
  ["src/coverage.ts", "// coverage:ignore", "coverage:ignore"],
  ["src/coverage.py", "# codecov ignore", "codecov ignore"],
  ["src/compat.ts", "/** @deprecated Use the replacement. */", "@deprecated"],
  ["src/compat.js", "/** @internal */", "@internal"],
  ["types/reply.d.ts", " * @deprecated use send", "@deprecated"],
  ["types/reply.d.ts", " * @internal", "@internal"],
  ["types/reply.pyi", "# @deprecated", "@deprecated"],
  ["types/reply.pyi", "# @internal", "@internal"]
] as const;

describe("directive comments", () => {
  it.each(directiveCases)("fires LINT_SUPPRESSED for %s: %s", (file, line, token) => {
    const reasons = computeRiskSignals(hunk(file, [line]), "logic");
    expect(reason(reasons, "LINT_SUPPRESSED")).toMatchObject({
      label: "Adds a compiler/linter directive comment",
      weight: 25,
      tier: "primary",
      evidence: `added: ${token}`
    });
    expect(directiveCommentToken(line, languageForPath(file))).toBe(token);
    expect(isDirectiveComment(line, languageForPath(file))).toBe(true);
  });

  it("rejects prose and detectable string-literal near misses", () => {
    const nearMisses = [
      ["src/compat.ts", "const note = '@ts-ignore';"],
      ["src/compat.ts", "// This workaround is deprecated but harmless."],
      ["src/compat.ts", "// @deprecated This is not a JSDoc comment."],
      ["src/app.py", "message = '# noqa'"],
      ["types/reply.ts", "/** This deprecated API is kept for now. */"]
    ] as const;
    for (const [file, line] of nearMisses) {
      expect(isDirectiveComment(line, languageForPath(file))).toBe(false);
      expect(computeRiskSignals(hunk(file, [line]), "logic").map((item) => item.code)).not.toContain("LINT_SUPPRESSED");
    }
  });

  it("blocks comment-only demotion even without relying on score weight", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: patchFor("src/compat.ts", ["// @ts-ignore"])
    });
    expect(model.hunks[0]).toMatchObject({ category: "logic", categoryReason: "DEFAULT_LOGIC", band: "medium" });
    expect(model.hunks[0]?.reasons.map((item) => item.code)).toContain("LINT_SUPPRESSED");
    expect(model.groups.find((group) => group.kind === "skim")?.hunkIds ?? []).not.toContain(model.hunks[0]?.id);
  });

  it.each([
    ["src/compat.ts", "// @ts-expect-error", "@ts-expect-error"],
    ["middleware/realip.go", "// Deprecated: Use ClientIPFromHeader instead.", "// Deprecated:"]
  ])("signals removed directives because removal can break the build", (file, line, token) => {
    const reasonForRemoval = reason(computeRiskSignals(hunk(file, [], [line]), "logic"), "LINT_SUPPRESSED");
    expect(reasonForRemoval).toMatchObject({ evidence: `removed: ${token}`, weight: 25 });
  });

  it("keeps the named fastify declaration fixture out of mechanical skim", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: readFileSync(path.join(fixtureRoot, "fastify-deprecated-dts.patch"), "utf8")
    });
    expect(model.hunks[0]).toMatchObject({ file: "types/reply.d.ts", category: "logic", band: "medium" });
    expect(reason(model.hunks[0]?.reasons ?? [], "LINT_SUPPRESSED").evidence).toBe("added: @deprecated");
  });

  it("keeps the named chi realip deprecation fixture out of mechanical skim", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "3b171578ca44dfd75ca3c5cbddc7b44c600a7b49",
      git: { headSha: "3b171578ca44dfd75ca3c5cbddc7b44c600a7b49", branch: "master" },
      patch: readFileSync(path.join(fixtureRoot, "chi-realip-deprecated.patch"), "utf8")
    });
    expect(model.hunks[0]).toMatchObject({ file: "middleware/realip.go", category: "logic", band: "medium" });
    expect(reason(model.hunks[0]?.reasons ?? [], "LINT_SUPPRESSED").evidence).toBe("added: // Deprecated:");
  });
});

function hunk(file: string, added: string[], removed: string[] = []): ParsedHunk {
  return {
    file,
    language: languageForPath(file).name,
    header: "@@",
    lines: [
      ...removed.map((text, index) => ({ kind: "del" as const, text, oldLine: index + 1 })),
      ...added.map((text, index) => ({ kind: "add" as const, text, newLine: index + 1 }))
    ],
    addedLines: added.length,
    removedLines: removed.length,
    parserReasons: []
  };
}

function reason(reasons: RiskReason[], code: string): RiskReason {
  const found = reasons.find((item) => item.code === code);
  expect(found, `expected ${code} reason`).toBeDefined();
  return found!;
}

function patchFor(file: string, added: string[]): string {
  return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1 +1,${added.length + 1} @@
 export const existing = true;
${added.map((line) => `+${line}`).join("\n")}
`;
}
