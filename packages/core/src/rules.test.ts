import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiffLine, ParsedHunk } from "./types.js";
import { analyzeDiff } from "./pipeline.js";
import { applyRulesToReasons, lintRuleFiles, loadRules, matchesGlob } from "./rules.js";

describe("user rules", () => {
  it("matches the supported in-house glob forms", () => {
    expect(matchesGlob("src/**", "src/ui/Button.tsx")).toBe(true);
    expect(matchesGlob("src/*.ts", "src/index.ts")).toBe(true);
    expect(matchesGlob("src/*.ts", "src/ui/Button.ts")).toBe(false);
    expect(matchesGlob("infra/**", "src/infra/main.tf")).toBe(false);
  });

  it("loads global then repo rules with repo custom ids winning", async () => {
    const { repoRoot, homeDir } = await tempRuleRoots();
    await writeRules(homeDir, "global", `
version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: Uses old auth
    paths: ["src/**"]
    pattern: "legacyAuth\\\\."
    weight: 20
adjust:
  - code: ERROR_SWALLOWED
    weight: 8
`);
    await writeRules(repoRoot, "repo", `
version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: Uses deprecated internal auth client
    paths: ["src/**"]
    pattern: "legacyAuth\\\\."
    weight: 40
adjust:
  - code: ERROR_SWALLOWED
    paths: ["src/ui/**"]
    weight: 0
`);

    const loaded = await loadRules(repoRoot, { homeDir });

    expect(loaded.reports.map((report) => report.status)).toEqual(["ok", "ok"]);
    expect(loaded.rules.rules).toHaveLength(1);
    expect(loaded.rules.rules[0]).toMatchObject({ id: "BAN_LEGACY_AUTH", weight: 40 });
    expect(loaded.rules.adjust).toHaveLength(2);
  });

  it("suppresses built-in hot signals before mechanical demotion", async () => {
    const { repoRoot } = await tempRuleRoots();
    const rules = {
      rules: [],
      adjust: [{ code: "SEC_PATH", paths: ["src/auth/**"], exclude: [], weight: 0, source: "test" }]
    };
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      rules,
      patch: `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1 +1 @@
-const value = 1;
+  const value = 1;
`
    });

    expect(model.hunks[0]).toMatchObject({ category: "mechanical", categoryReason: "WHITESPACE_ONLY" });
    expect(model.hunks[0]?.reasons.map((reason) => reason.code)).not.toContain("SEC_PATH");
  });

  it("applies custom rules with negative weights and path scoping", () => {
    const rules = {
      rules: [
        {
          id: "SAFE_INDEX",
          message: "Concurrent index build lowers migration risk",
          paths: ["db/migrations/**"],
          exclude: [],
          pattern: "CREATE INDEX CONCURRENTLY",
          weight: -10,
          tier: "primary" as const,
          source: "test"
        },
        {
          id: "CONSOLE_NIT",
          message: "Console output in app code",
          paths: ["src/**"],
          exclude: ["src/vendor/**"],
          pattern: "console\\.log",
          weight: 3,
          tier: "nit" as const,
          source: "test"
        }
      ],
      adjust: []
    };

    const migration = applyRulesToReasons(
      hunk("db/migrations/002_index.sql", ["CREATE INDEX CONCURRENTLY idx_users ON users(id);"]),
      [],
      rules
    );
    expect(migration[0]).toMatchObject({ code: "USER_SAFE_INDEX", weight: -10 });

    const app = applyRulesToReasons(hunk("src/app.ts", ["console.log(value);"]), [], rules);
    expect(app[0]).toMatchObject({ code: "USER_CONSOLE_NIT", tier: "nit", weight: 3 });

    const vendor = applyRulesToReasons(hunk("src/vendor/app.ts", ["console.log(value);"]), [], rules);
    expect(vendor).toHaveLength(0);
  });

  it("skips invalid files during load but reports them for lint", async () => {
    const { repoRoot, homeDir } = await tempRuleRoots();
    await writeRules(homeDir, "global", `
version: 1
rules:
  - id: broken
    message: bad id
    paths: ["src/**"]
    pattern: "["
    weight: 10
`);
    await writeRules(repoRoot, "repo", `
version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: Uses deprecated auth
    paths: ["src/**"]
    pattern: "legacyAuth\\\\."
    weight: 40
`);

    const loaded = await loadRules(repoRoot, { homeDir });
    const lint = await lintRuleFiles(repoRoot, { homeDir });

    expect(loaded.reports[0]).toMatchObject({ status: "error" });
    expect(loaded.reports[0]?.error).toContain("must be UPPER_SNAKE");
    expect(loaded.rules.rules.map((rule) => rule.id)).toEqual(["BAN_LEGACY_AUTH"]);
    expect(lint.map((report) => report.status)).toEqual(["error", "ok"]);
  });
});

async function tempRuleRoots(): Promise<{ repoRoot: string; homeDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-rules-"));
  const repoRoot = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  return { repoRoot, homeDir };
}

async function writeRules(root: string, scope: "global" | "repo", content: string): Promise<void> {
  const file =
    scope === "global" ? path.join(root, ".sift", "rules.yml") : path.join(root, ".sift", "rules.yml");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content.trimStart(), "utf8");
}

function hunk(file: string, added: string[]): ParsedHunk {
  const lines: DiffLine[] = added.map((text, index) => ({ kind: "add", text, newLine: index + 1 }));
  return {
    file,
    language: "text",
    header: "@@",
    lines,
    addedLines: added.length,
    removedLines: 0,
    parserReasons: []
  };
}
