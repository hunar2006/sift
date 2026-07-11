import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { analyzeDiff, parseUnifiedDiff, type ParsedDiff } from "@sift-review/core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DIR = path.join(ROOT, "fixtures", "diffs");
const REGRESSION_DIR = path.join(ROOT, "packages", "eval", "fuzz-regressions");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadFixturePatches(): string[] {
  const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".patch"));
  return files.map((name) => {
    const raw = readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    return raw.replace("__SIFT_OVERSIZED_LINE__", "x".repeat(10_050));
  });
}

function loadRegressionPatches(): string[] {
  try {
    return readdirSync(REGRESSION_DIR)
      .filter((name) => name.endsWith(".patch"))
      .map((name) => readFileSync(path.join(REGRESSION_DIR, name), "utf8"));
  } catch {
    return [];
  }
}

function isStructurallyValid(parsed: ParsedDiff): boolean {
  if (!Array.isArray(parsed.files) || !Array.isArray(parsed.hunks)) {
    return false;
  }
  for (const file of parsed.files) {
    if (typeof file.path !== "string" || !file.status) {
      return false;
    }
  }
  for (const hunk of parsed.hunks) {
    if (typeof hunk.file !== "string" || typeof hunk.header !== "string" || !Array.isArray(hunk.lines)) {
      return false;
    }
    for (const line of hunk.lines) {
      if (line.kind !== "add" && line.kind !== "del" && line.kind !== "context") {
        return false;
      }
      if (typeof line.text !== "string") {
        return false;
      }
      if (line.text.includes("...[truncated]") && line.text.length > 4016) {
        return false;
      }
      if (!line.text.includes("...[truncated]") && line.text.length > 4000) {
        return false;
      }
    }
  }
  return true;
}

function mutatePatch(base: string, seed: number): string {
  const ops = seed % 10;
  switch (ops) {
    case 0:
      return base.slice(0, Math.max(0, seed % Math.max(base.length, 1)));
    case 1:
      return base.replace(/@@[^@]+@@/g, "@@ corrupted @@");
    case 2:
      return `${base}\n${String.fromCharCode(0, 1, 2, 255)}\nbinary\x00junk`;
    case 3:
      return Buffer.from(base, "utf8").toString("latin1") + "\uFFFD\uD800";
    case 4:
      return base.replace(/\n\+[^\n]*/u, `\n+${"Y".repeat(50_000)}`);
    case 5: {
      const hunks = base.match(/@@[\s\S]*?(?=\ndiff --git |\n@@ |$)/g) ?? [];
      return hunks.length > 0 ? `${base}\n${hunks[0]}` : `${base}\n${base}`;
    }
    case 6:
      return base.replace(/\n/g, "\r\n");
    case 7:
      return base.replace(/diff --git a\/([^\s]+) b\/([^\s]+)/, 'diff --git "a/path with spaces/$1" "b/path with spaces/$2"');
    case 8:
      return `@@ -1,999999 +1,999999 @@\n${base}\n<<<<<<<\n=======\n>>>>>>>`;
    default:
      return `${base.slice(seed % 17)}\n${base.slice(0, seed % 23)}\0${base}`;
  }
}

const GIT_META = { headSha: "fuzz", branch: "fuzz" };

function syntheticDiff(seed: number): string {
  const paths = [
    "src/app.ts",
    "src/util.js",
    "pkg/handler.go",
    "lib/mod.py",
    "README.md",
    "package.json",
    ".github/workflows/ci.yml",
    "tests/test_foo.py",
    "pnpm-lock.yaml",
    "scripts/run.sh"
  ];
  const file = paths[seed % paths.length] ?? "src/app.ts";
  const triggers = [
    "password = 'hunter2'",
    "eval(userInput)",
    "TODO: fixme",
    "console.log('debug')",
    "export function publicApi() {}",
    "assert.equal(1, 1)",
    "DROP TABLE users;",
    "import fs from 'fs'",
    "  const x = 1;",
    "const x=1;"
  ];
  const added = triggers[seed % triggers.length] ?? "const x = 1;";
  const removed = triggers[(seed * 3) % triggers.length] ?? "const y = 2;";
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,3 +1,3 @@",
    `-${removed}`,
    `+${added}`,
    " context",
    ""
  ].join("\n");
}

export async function runFuzz(): Promise<void> {
  const parserCases = envInt("FUZZ_PARSER", process.env.CI ? 1500 : 10_000);
  const pipelineCases = envInt("FUZZ_PIPELINE", process.env.CI ? 200 : 1000);
  const seed = envInt("FUZZ_SEED", 0x5f17);

  console.error(`fuzz: parser=${parserCases} pipeline=${pipelineCases} seed=${seed}`);

  const bases = [...loadFixturePatches(), ...loadRegressionPatches()];
  if (bases.length === 0) {
    throw new Error("No fixture patches found for fuzzing");
  }

  // Permanent regression fixtures first
  for (const patch of loadRegressionPatches()) {
    const parsed = parseUnifiedDiff(patch);
    if (!isStructurallyValid(parsed)) {
      throw new Error("Regression fixture failed structural validity");
    }
  }

  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: bases.length - 1 }), (n, idx) => {
      const base = bases[idx] ?? bases[0]!;
      const patch = mutatePatch(base, n);
      let parsed: ParsedDiff;
      try {
        parsed = parseUnifiedDiff(patch);
      } catch (error) {
        throw new Error(`parse threw: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!isStructurallyValid(parsed)) {
        throw new Error("parse returned structurally invalid model");
      }
      return true;
    }),
    { numRuns: parserCases, seed, endOnFailure: true }
  );
  console.error("fuzz: parser OK");

  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
      const patch = n % 2 === 0 ? syntheticDiff(n) : mutatePatch(bases[n % bases.length]!, n);
      let first;
      let second;
      try {
        first = analyzeDiff({ repoRoot: "/fuzz", diffSpec: "FUZZ", git: GIT_META, patch });
        second = analyzeDiff({ repoRoot: "/fuzz", diffSpec: "FUZZ", git: GIT_META, patch });
      } catch (error) {
        throw new Error(`pipeline threw: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (first.hunks.some((h) => !h.digest?.headline)) {
        throw new Error("missing digest headline");
      }
      const fp = (model: typeof first): string =>
        JSON.stringify(
          model.hunks.map((h) => ({ id: h.id, category: h.category, risk: h.risk, headline: h.digest.headline }))
        );
      if (fp(first) !== fp(second)) {
        throw new Error("pipeline non-deterministic");
      }
      return true;
    }),
    { numRuns: pipelineCases, seed: seed ^ 0x9e37, endOnFailure: true }
  );
  console.error("fuzz: pipeline OK");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain || process.argv[1]?.endsWith("fuzz.ts")) {
  try {
    await runFuzz();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
