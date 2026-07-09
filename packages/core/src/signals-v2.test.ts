import { describe, expect, it } from "vitest";
import type { DiffLine, ParsedHunk, RiskReason } from "./types.js";
import { computeRiskSignals } from "./classify/signals.js";
import { analyzeDiff } from "./pipeline.js";
import { scoreHunk } from "./score.js";

describe("signal engine v2", () => {
  it("reweights existing signals and marks low-value findings as nits", () => {
    const reasons = computeRiskSignals(
      hunk({
        file: "src/auth/session.ts",
        added: [
          "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
          "console.log('debug');",
          "// TODO remove before merge"
        ]
      }),
      "logic",
      { testScopes: new Set(["src"]) }
    );

    expect(reason(reasons, "TLS_DISABLED")).toMatchObject({ weight: 45 });
    expect(reason(reasons, "DEBUG_LEFTOVER")).toMatchObject({ weight: 2, tier: "nit" });
    expect(reason(reasons, "TODO_ADDED")).toMatchObject({ weight: 3, tier: "nit" });
    expect(reasons.map((item) => item.code)).not.toContain("LARGE_NOVEL");
  });

  it("halves dangerous APIs and SQL concatenation in tests", () => {
    const reasons = computeRiskSignals(
      hunk({
        file: "tests/query.test.ts",
        added: [
          "eval(source);",
          "new Function(source);",
          "document.write(source);",
          "const query = 'SELECT * FROM users WHERE id=' + id;"
        ]
      }),
      "tests"
    );

    expect(reason(reasons, "DANGEROUS_API")).toMatchObject({ weight: 20 });
    expect(reason(reasons, "SQL_CONCAT")).toMatchObject({ weight: 10 });
  });

  it("caps migration risk at fifty with sharper destructive checks", () => {
    const reasons = computeRiskSignals(
      hunk({
        file: "db/migrations/001_drop_users.sql",
        added: ["DROP TABLE users;", "DELETE FROM audit_log;"]
      }),
      "config"
    );

    expect(reason(reasons, "MIGRATION")).toMatchObject({ weight: 50 });
  });

  it("merges broad except handlers into ERROR_SWALLOWED below the hot-signal demotion threshold", () => {
    const reasons = computeRiskSignals(
      hunk({
        file: "src/service.py",
        added: ["try:", "    send_event()", "except Exception as exc:", "    logger.warning(exc)"]
      }),
      "logic"
    );

    expect(reason(reasons, "ERROR_SWALLOWED")).toMatchObject({ weight: 8 });
    expect(reason(reasons, "ERROR_SWALLOWED").evidence).toContain("except Exception");
  });

  it("detects high-entropy string literals without flagging hex shas, prose, urls, or dependency hunks", () => {
    const token = 'const opaque = "mF9Kq7Vx2pLzN8rB4tYc6A0sD1eGhJ5uWiX9Qp2";';
    expect(reason(computeRiskSignals(hunk({ added: [token] }), "logic"), "SECRET_ENTROPY")).toMatchObject({
      weight: 35
    });
    expect(
      computeRiskSignals(hunk({ added: ['const sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b";'] }), "logic").map(
        (item) => item.code
      )
    ).not.toContain("SECRET_ENTROPY");
    expect(
      computeRiskSignals(hunk({ added: ['const sentence = "this is an ordinary english sentence";'] }), "logic").map(
        (item) => item.code
      )
    ).not.toContain("SECRET_ENTROPY");
    expect(
      computeRiskSignals(hunk({ added: ['const url = "https://example.com/aBcD1234EfGh5678IjKl";'] }), "logic").map(
        (item) => item.code
      )
    ).not.toContain("SECRET_ENTROPY");
    expect(computeRiskSignals(hunk({ file: "package.json", added: [token] }), "deps").map((item) => item.code)).not.toContain(
      "SECRET_ENTROPY"
    );
  });

  it("caps combined secret-like and entropy reasons at fifty", () => {
    const reasons = computeRiskSignals(
      hunk({
        added: [
          'const API_KEY = "sk-123456789012345678901234";',
          'const opaque = "mF9Kq7Vx2pLzN8rB4tYc6A0sD1eGhJ5uWiX9Qp2";'
        ]
      }),
      "logic"
    ).filter((item) => item.code.startsWith("SECRET_"));

    expect(reasons.map((item) => item.code)).toEqual(["SECRET_LIKE", "SECRET_ENTROPY"]);
    expect(reasons.reduce((sum, item) => sum + item.weight, 0)).toBe(50);
  });

  it("detects concurrency primitives by language with a per-hunk cap", () => {
    const reasons = computeRiskSignals(
      hunk({
        file: "src/workers.ts",
        added: ["const worker = new Worker(url);", "const memory = new SharedArrayBuffer(1024);"]
      }),
      "logic"
    );

    expect(reason(reasons, "CONCURRENCY_HAZARD")).toMatchObject({ weight: 30 });
    expect(reason(reasons, "CONCURRENCY_HAZARD").evidence).toContain("new Worker");
    expect(computeRiskSignals(hunk({ file: "tests/workers.test.ts", added: ["new Worker(url);"] }), "tests").map((item) => item.code)).not.toContain(
      "CONCURRENCY_HAZARD"
    );
  });

  it("detects typosquat-suspect dependencies against local and popular names", () => {
    const localReasons = computeRiskSignals(
      hunk({
        file: "package.json",
        context: ['    "lodash": "^4.17.21",'],
        added: ['    "lodahs": "^1.0.0",']
      }),
      "deps"
    );

    expect(reason(localReasons, "TYPOSQUAT_SUSPECT")).toMatchObject({ weight: 35 });
    expect(reason(localReasons, "TYPOSQUAT_SUSPECT").evidence).toContain("lodahs ~ lodash");

    const popularReasons = computeRiskSignals(
      hunk({
        file: "requirements.txt",
        added: ["requsets==1.0.0"]
      }),
      "deps"
    );
    expect(reason(popularReasons, "TYPOSQUAT_SUSPECT").evidence).toContain("requsets ~ requests");

    const exactReasons = computeRiskSignals(
      hunk({
        file: "package.json",
        context: ['    "lodash": "^4.17.21",'],
        added: ['    "lodash": "^4.17.22",']
      }),
      "deps"
    );
    expect(exactReasons.map((item) => item.code)).not.toContain("TYPOSQUAT_SUSPECT");
  });

  it("flags edits to agent guidance files only", () => {
    expect(reason(computeRiskSignals(hunk({ file: "AGENTS.md", added: ["Do the risky thing."] }), "docs"), "AGENT_GUIDANCE_EDIT")).toMatchObject({
      weight: 20
    });
    expect(computeRiskSignals(hunk({ file: "docs/guide.md", added: ["Normal docs."] }), "docs").map((item) => item.code)).not.toContain(
      "AGENT_GUIDANCE_EDIT"
    );
  });

  it("adds coverage-driven signals when coverage evidence is present", () => {
    const untested = computeRiskSignals(
      hunk({
        added: Array.from({ length: 8 }, (_, index) => `const value${index} = ${index};`),
        coverage: { covered: 0, total: 8, stale: false }
      }),
      "logic",
      { hasCoverageData: true }
    );
    expect(reason(untested, "UNTESTED_CHANGE")).toMatchObject({ weight: 10, evidence: "0/8" });

    const covered = computeRiskSignals(
      hunk({
        added: Array.from({ length: 8 }, (_, index) => `const covered${index} = ${index};`),
        coverage: { covered: 7, total: 8, stale: false }
      }),
      "logic",
      { hasCoverageData: true }
    );
    expect(reason(covered, "COVERED_CHANGE")).toMatchObject({ weight: -10, evidence: "7/8" });
    expect(scoreHunk("logic", covered).risk).toBe(25);

    const stale = computeRiskSignals(
      hunk({
        added: Array.from({ length: 8 }, (_, index) => `const stale${index} = ${index};`),
        coverage: { covered: 8, total: 8, stale: true }
      }),
      "logic",
      { hasCoverageData: true }
    );
    expect(stale.map((item) => item.code)).not.toContain("COVERED_CHANGE");
  });

  it("flags large logic additions without same-scope test hunks", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: patchFor("src/feature.ts", Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index};`))
    });

    expect(reason(model.hunks[0]?.reasons ?? [], "NOVEL_UNTESTED")).toMatchObject({ weight: 8 });
  });

  it("does not flag large logic additions when tests change under the same top-level path", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch:
        patchFor("src/feature.ts", Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index};`)) +
        patchFor("src/feature.test.ts", ["expect(value0).toBe(0);"])
    });

    expect(model.hunks.find((item) => item.file === "src/feature.ts")?.reasons.map((item) => item.code)).not.toContain(
      "NOVEL_UNTESTED"
    );
  });

  it("uses stronger NOVEL_UNTESTED weight only when coverage confirms poor coverage", () => {
    const poor = computeRiskSignals(
      hunk({
        added: Array.from({ length: 40 }, (_, index) => `export const poor${index} = ${index};`),
        coverage: { covered: 2, total: 10, stale: false }
      }),
      "logic",
      { hasCoverageData: true }
    );
    expect(reason(poor, "NOVEL_UNTESTED")).toMatchObject({ weight: 12, evidence: "2/10" });

    const enough = computeRiskSignals(
      hunk({
        added: Array.from({ length: 40 }, (_, index) => `export const enough${index} = ${index};`),
        coverage: { covered: 3, total: 10, stale: false }
      }),
      "logic",
      { hasCoverageData: true }
    );
    expect(enough.map((item) => item.code)).not.toContain("NOVEL_UNTESTED");
  });
});

function hunk(options: {
  file?: string;
  added: string[];
  removed?: string[];
  context?: string[];
  coverage?: ParsedHunk["coverage"];
}): ParsedHunk {
  const lines: DiffLine[] = [
    ...(options.context ?? []).map((text, index) => ({ kind: "context" as const, text, oldLine: index + 1, newLine: index + 1 })),
    ...(options.removed ?? []).map((text, index) => ({ kind: "del" as const, text, oldLine: index + 1 })),
    ...options.added.map((text, index) => ({ kind: "add" as const, text, newLine: index + 1 }))
  ];
  return {
    file: options.file ?? "src/app.ts",
    language: "typescript",
    header: "@@",
    lines,
    addedLines: options.added.length,
    removedLines: options.removed?.length ?? 0,
    parserReasons: [],
    coverage: options.coverage
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
