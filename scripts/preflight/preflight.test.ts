import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkflowGuard, isAllowedPackedFile, sampleMechanicalHunks, scanPlaceholders } from "./audit.js";
import { renderHumanReview } from "./human.js";
import { renderPreflightMarkdown, runStages } from "./index.js";
import type { MechanicalSample, PreflightContext, StageResult } from "./types.js";

const context: PreflightContext = { root: process.cwd(), options: { fast: true, json: false }, artifactsDir: path.join(os.tmpdir(), "sift-preflight-test") };

describe("preflight helpers", () => {
  it("accepts only the explicit npm package allowlist", () => {
    expect(isAllowedPackedFile("dist/index.js")).toBe(true);
    expect(isAllowedPackedFile("dist/web/assets/app.js")).toBe(true);
    expect(isAllowedPackedFile("dist/grammars/tree-sitter-typescript.wasm")).toBe(true);
    expect(isAllowedPackedFile("src/index.ts")).toBe(false);
    expect(isAllowedPackedFile("dist/secret.txt")).toBe(false);
  });

  it("reports unexpected placeholder tokens", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-placeholders-"));
    try {
      await fs.writeFile(path.join(root, "ok.md"), "PLACEHOLDER_OWNER\n", "utf8");
      await fs.writeFile(path.join(root, "bad.md"), "TBD\nPLACEHOLDER_SECRET\n", "utf8");
      await expect(scanPlaceholders(root)).resolves.toEqual(["bad.md: PLACEHOLDER_SECRET", "bad.md: TBD"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an unguarded publish workflow", () => {
    const goodRelease = `on:\n  push:\n    tags: [v*]\n  workflow_dispatch:\njobs:\n  gate:\n    steps:\n      - run: pnpm preflight --fast\n  publish:\n    needs: gate\n    steps:\n      - if: \${{ env.NPM_TOKEN != '' }}\n        run: npm publish\n`;
    const pages = `on:\n  push:\n    tags: [v*]\n`;
    expect(checkWorkflowGuard(process.cwd(), goodRelease, pages)).toEqual([]);
    expect(checkWorkflowGuard(process.cwd(), goodRelease.replace("if: ${{ env.NPM_TOKEN != '' }}\n        ", ""), pages)).toContain("npm publish is not guarded by NPM_TOKEN presence");
  });

  it("stratifies mechanical candidates before filling the ten-hunk review", () => {
    const candidates = ["format-only", "import-reorder", "comment-only", "rename"].flatMap((kind, index) =>
      Array.from({ length: 3 }, (_, offset) => sample(`repo-${offset}`, `${kind}-${offset}`, kind, index * 10 + offset))
    );
    const samples = sampleMechanicalHunks(candidates, 10);
    expect(samples).toHaveLength(10);
    expect(new Set(samples.map((item) => item.repo)).size).toBeGreaterThan(1);
    expect(samples.map((item) => item.categoryReason)).toEqual(expect.arrayContaining(["ast-format-only", "IMPORT_REORDER", "COMMENT_ONLY", "RENAME_ONLY"]));
  });

  it("keeps a rename pseudo-hunk visible in the human handoff", () => {
    const renamed = { ...sample("repo", "rename", "rename", 0), file: "src/new.ts", patch: "renamed: src/old.ts → src/new.ts" };
    expect(renderHumanReview([renamed])).toContain("renamed: src/old.ts → src/new.ts");
  });

  it("runs stages in order, emits markdown, and propagates a failure", async () => {
    const calls: string[] = [];
    const make = (id: StageResult["id"], status: StageResult["status"]): (() => Promise<StageResult>) => async () => {
      calls.push(id);
      return { id, name: id, status, summary: status, details: [], durationMs: 1 };
    };
    const stages = { A: make("A", "PASS"), B: make("B", "SKIP"), C: make("C", "FAIL"), D: make("D", "PASS"), E: make("E", "PASS"), F: make("F", "PASS"), G: make("G", "PASS"), H: make("H", "PASS") };
    const results = await runStages(stages, context);
    expect(calls).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(results.some((result) => result.status === "FAIL")).toBe(true);
    expect(renderPreflightMarkdown(results, [])).toContain("**Verdict: FAIL**");
  });
});

function sample(repo: string, id: string, kind: string, risk: number): MechanicalSample {
  return {
    repo,
    sha: "1234567890abcdef",
    hunkId: id,
    file: `${id}.ts`,
    categoryReason: kind === "format-only" ? "ast-format-only" : kind === "import-reorder" ? "IMPORT_REORDER" : kind === "rename" ? "RENAME_ONLY" : "COMMENT_ONLY",
    band: "skim",
    risk,
    headline: id,
    patch: kind === "import-reorder" ? "+import b\n-import a" : "+// comment"
  };
}
