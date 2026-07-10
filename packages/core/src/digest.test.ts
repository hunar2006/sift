import { describe, expect, it } from "vitest";
import {
  attachDigests,
  computeGroupDigest,
  computeHunkDigest,
  containsForbiddenVerdict,
  FORBIDDEN_VERDICT_PATTERNS
} from "./digest.js";
import { phraseForReason, DIGEST_PHRASES, BUILT_IN_PRIMARY_SIGNAL_CODES } from "./digestPhrases.js";
import type {
  DiffLine,
  FileChange,
  HunkGroup,
  RiskReason,
  UndigestedHunk
} from "./types.js";

function line(kind: DiffLine["kind"], text: string): DiffLine {
  return { kind, text };
}

function hunk(overrides: Partial<UndigestedHunk> = {}): UndigestedHunk {
  return {
    id: overrides.id ?? "h1",
    file: overrides.file ?? "src/session.ts",
    language: overrides.language ?? "typescript",
    header: "@@",
    lines: overrides.lines ?? [],
    addedLines: overrides.addedLines ?? 0,
    removedLines: overrides.removedLines ?? 0,
    category: overrides.category ?? "logic",
    categoryReason: overrides.categoryReason ?? "DEFAULT_LOGIC",
    risk: overrides.risk ?? 20,
    band: overrides.band ?? "low",
    reasons: overrides.reasons ?? [],
    groupId: overrides.groupId ?? "low-risk-logic",
    ...overrides
  };
}

function reason(code: string, weight: number, extra: Partial<RiskReason> = {}): RiskReason {
  return { code, label: code, weight, ...extra };
}

const headline = (h: UndigestedHunk, ctx: Parameters<typeof computeHunkDigest>[1] = {}) =>
  computeHunkDigest(h, ctx).headline;

describe("digest headline templates", () => {
  it("1 · rename-pattern group member", () => {
    expect(
      headline(hunk({ categoryReason: "RENAME_PATTERN:formatDate->renderDate" }), {
        rename: { from: "formatDate", to: "renderDate", ordinal: 2, files: 3 }
      })
    ).toBe("Renames `formatDate` → `renderDate` (2 of 3 files)");
  });

  it("2 · ast-format-only mechanical", () => {
    expect(
      headline(hunk({ category: "mechanical", categoryReason: "ast-format-only" }))
    ).toBe("Reformats code — no token changes");
  });

  it("3 · comment-only mechanical", () => {
    expect(headline(hunk({ category: "mechanical", categoryReason: "COMMENT_ONLY" }))).toBe(
      "Comment-only edit"
    );
  });

  it("4 · import reorder", () => {
    expect(
      headline(hunk({ category: "mechanical", categoryReason: "IMPORT_REORDER_ONLY" }))
    ).toBe("Reorders imports — same modules");
  });

  it("5 · rename-only file", () => {
    expect(
      headline(hunk({ isRenameOnly: true, oldPath: "src/old.ts", file: "src/new.ts" }))
    ).toBe("Renames file `src/old.ts` → `src/new.ts`");
  });

  it("6 · dependency add", () => {
    expect(
      headline(
        hunk({
          category: "deps",
          file: "package.json",
          lines: [line("add", '"jose": "^5.0.0"')]
        })
      )
    ).toBe("Adds dependency `jose`");
  });

  it("6 · dependency bump with versions", () => {
    expect(
      headline(
        hunk({
          category: "deps",
          file: "package.json",
          lines: [line("del", '"lodash": "1.2.0"'), line("add", '"lodash": "1.4.1"')]
        })
      )
    ).toBe("Bumps `lodash` 1.2.0 → 1.4.1");
  });

  it("6 · multiple dependencies capped at 3 names", () => {
    expect(
      headline(
        hunk({
          category: "deps",
          file: "package.json",
          lines: [
            line("add", '"a": "^1.0.0"'),
            line("add", '"b": "^1.0.0"'),
            line("add", '"c": "^1.0.0"'),
            line("add", '"d": "^1.0.0"')
          ]
        })
      )
    ).toBe("Adds 4 dependencies: a, b, c…");
  });

  it("7 · lockfile churn", () => {
    expect(
      headline(
        hunk({ category: "deps", file: "pnpm-lock.yaml", addedLines: 40, removedLines: 12 })
      )
    ).toBe("Lockfile churn (+40/−12 lines)");
  });

  it("8 · new file with symbols", () => {
    expect(
      headline(hunk({ file: "src/auth.ts", addedLines: 60, defines: ["signIn", "signOut", "refresh"] }), {
        fileStatus: "added"
      })
    ).toBe("New file — defines `refresh`, `signIn` +1 more (+60 lines)");
  });

  it("9 · new file without symbols", () => {
    expect(
      headline(hunk({ file: "src/blank.ts", addedLines: 12 }), { fileStatus: "added" })
    ).toBe("New file (+12 lines)");
  });

  it("10 · deleted file", () => {
    expect(
      headline(hunk({ file: "src/legacy.ts", removedLines: 88 }), { fileStatus: "deleted" })
    ).toBe("Deletes `src/legacy.ts` (−88 lines)");
  });

  it("11 · adds test", () => {
    expect(
      headline(
        hunk({
          category: "tests",
          file: "src/token.test.ts",
          lines: [line("add", "  it('rotates refresh token', () => {")]
        })
      )
    ).toBe("Adds test: 'rotates refresh token'");
  });

  it("11 · skips test", () => {
    expect(
      headline(
        hunk({
          category: "tests",
          file: "src/token.test.ts",
          reasons: [reason("SKIPPED_TEST", 20)],
          lines: [line("add", "  it.skip('rotates refresh token', () => {")]
        })
      )
    ).toBe("Skips test: 'rotates refresh token'");
  });

  it("11 · weakens assertions", () => {
    expect(
      headline(
        hunk({
          category: "tests",
          file: "src/token.test.ts",
          reasons: [reason("TEST_WEAKENED", 20)],
          lines: [line("add", "  it('rotates refresh token', () => {")]
        })
      )
    ).toBe("Weakens assertions in 'rotates refresh token'");
  });

  it("11 · edits tests fallback", () => {
    expect(
      headline(hunk({ category: "tests", file: "src/token.test.ts", lines: [line("add", "const x = 1;")] }))
    ).toBe("Edits tests in `src/token.test.ts`");
  });

  it("12 · migration", () => {
    expect(
      headline(
        hunk({
          category: "logic",
          file: "migrations/003.sql",
          reasons: [reason("MIGRATION", 30)],
          lines: [line("add", "DROP TABLE legacy_sessions;")]
        })
      )
    ).toBe("Migration: DROP TABLE legacy_sessions");
  });

  it("13 · CI workflow", () => {
    expect(
      headline(hunk({ category: "config", file: ".github/workflows/ci.yml" }))
    ).toBe("Edits CI workflow `ci.yml`");
  });

  it("14 · config keys", () => {
    expect(
      headline(
        hunk({
          category: "config",
          file: "app.config.json",
          lines: [line("add", '  "timeout": 30,'), line("add", '  "retries": 5,')]
        })
      )
    ).toBe("Changes config keys: timeout, retries");
  });

  it("15 · adds logic symbol", () => {
    expect(
      headline(hunk({ category: "logic", defines: ["rotate"], addedLines: 24 }))
    ).toBe("Adds `rotate()` (+24 lines)");
  });

  it("16 · removes logic symbol", () => {
    expect(
      headline(hunk({ category: "logic", removedDefines: ["rotate"], removedLines: 24 }))
    ).toBe("Removes `rotate()` (−24 lines)");
  });

  it("17 · modifies enclosing symbol", () => {
    expect(
      headline(hunk({ category: "logic", enclosingSymbol: "rotate", addedLines: 4, removedLines: 2 }))
    ).toBe("Modifies `rotate()` (+4/−2)");
  });

  it("18 · binary / mode / submodule", () => {
    expect(headline(hunk({ isBinary: true, category: "binary" }))).toBe("Binary file changed");
    expect(headline(hunk({ isModeChange: true, newMode: "100755" }))).toBe(
      "Mode change → executable"
    );
    expect(
      headline(hunk({ categoryReason: "SUBMODULE_BUMP", file: "vendor/lib" }))
    ).toBe("Bumps submodule `vendor/lib`");
  });

  it("19 · fallback", () => {
    expect(
      headline(hunk({ category: "logic", file: "src/misc.ts", addedLines: 3, removedLines: 1 }))
    ).toBe("Modifies `src/misc.ts` (+3/−1)");
  });
});

describe("digest details priority", () => {
  it("orders primary signals by weight, then coverage, then imports", () => {
    const digest = computeHunkDigest(
      hunk({
        category: "logic",
        addedLines: 20,
        defines: ["x"],
        coverage: { covered: 0, total: 12, stale: false },
        reasons: [reason("TLS_DISABLED", 45), reason("CONCURRENCY_HAZARD", 20)],
        lines: [line("add", "import { z } from 'zod';"), line("add", "new Worker(url)")]
      })
    );
    expect(digest.details[0]).toBe("Disables TLS certificate verification");
    expect(digest.details).toContain("0 of 12 changed lines covered");
    expect(digest.details.length).toBeLessThanOrEqual(3);
  });

  it("omits nit-tier signals from details", () => {
    const digest = computeHunkDigest(
      hunk({ reasons: [reason("TODO_ADDED", 2, { tier: "nit" })] })
    );
    expect(digest.details).toEqual([]);
  });
});

describe("group digests", () => {
  it("summarizes formatting-only groups", () => {
    const group: HunkGroup = {
      id: "formatting-whitespace",
      title: "Formatting",
      kind: "skim",
      order: 9,
      hunkIds: ["a", "b"],
      totalAdded: 400,
      totalRemoved: 212
    };
    const members = [
      hunk({ id: "a", category: "mechanical", categoryReason: "ast-format-only" }),
      hunk({ id: "b", category: "mechanical", categoryReason: "WHITESPACE_ONLY" })
    ];
    expect(computeGroupDigest(group, members)).toBe("2 hunks — formatting only (612 lines)");
  });

  it("summarizes rename-pattern groups", () => {
    const group: HunkGroup = {
      id: "rename-pattern-formatdate",
      title: "Rename",
      kind: "skim",
      order: 5,
      hunkIds: ["a", "b", "c"],
      totalAdded: 6,
      totalRemoved: 6
    };
    const members = [
      hunk({ id: "a", file: "a.ts", categoryReason: "RENAME_PATTERN:formatDate->renderDate" }),
      hunk({ id: "b", file: "b.ts", categoryReason: "RENAME_PATTERN:formatDate->renderDate" }),
      hunk({ id: "c", file: "c.ts", categoryReason: "RENAME_PATTERN:formatDate->renderDate" })
    ];
    expect(computeGroupDigest(group, members)).toBe(
      "Rename: formatDate → renderDate across 3 files"
    );
  });
});

describe("forbidden verdict guardrail", () => {
  it("flags reassuring language", () => {
    for (const phrase of ["looks good", "safe to approve", "ready to approve", "LGTM"]) {
      expect(containsForbiddenVerdict(phrase)).toBe(true);
    }
  });

  it("passes factual descriptions", () => {
    expect(containsForbiddenVerdict("Adds `rotate()` (+24 lines)")).toBe(false);
  });

  it("no headline template or phrase contains a verdict word", () => {
    const samples = [
      headline(hunk({ category: "mechanical", categoryReason: "ast-format-only" })),
      headline(hunk({ category: "logic", defines: ["rotate"], addedLines: 24 })),
      ...BUILT_IN_PRIMARY_SIGNAL_CODES.map((code) =>
        phraseForReason(reason(code, 30, { evidence: "lodahs~lodash" }), hunk({
          removedLines: 5,
          lines: [line("add", "new Worker(x)"), line("add", "eval(x)")]
        })) ?? ""
      )
    ];
    for (const sample of samples) {
      for (const pattern of FORBIDDEN_VERDICT_PATTERNS) {
        expect(pattern.test(sample)).toBe(false);
      }
    }
  });
});

describe("phrase map completeness", () => {
  it("every built-in primary signal code has a phrase", () => {
    for (const code of BUILT_IN_PRIMARY_SIGNAL_CODES) {
      expect(Object.prototype.hasOwnProperty.call(DIGEST_PHRASES, code)).toBe(true);
      const phrase = phraseForReason(reason(code, 30), hunk());
      expect(typeof phrase).toBe("string");
      expect((phrase ?? "").length).toBeGreaterThan(0);
    }
  });
});

describe("attachDigests", () => {
  it("attaches digests to hunks and groups", () => {
    const files: FileChange[] = [
      { path: "src/session.ts", status: "modified", hunkIds: ["h1"] }
    ];
    const hunks = [hunk({ category: "logic", defines: ["rotate"], addedLines: 10 })];
    const groups: HunkGroup[] = [
      {
        id: "low-risk-logic",
        title: "Low-risk logic",
        kind: "attention",
        order: 3,
        hunkIds: ["h1"],
        totalAdded: 10,
        totalRemoved: 0
      }
    ];
    const result = attachDigests(hunks, groups, files);
    expect(result.hunks[0]?.digest.headline).toBe("Adds `rotate()` (+10 lines)");
    expect(result.hunks[0]?.digest.source).toBe("auto");
    expect(result.groups[0]?.digest).toContain("low-risk logic");
  });
});
