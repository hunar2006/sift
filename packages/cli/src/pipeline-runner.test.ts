import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDiff, runGit, TREE_SITTER_MAX_BYTES, type FileChange, type IngestedDiff } from "@sift-review/core";
import { loadNewFileSources, resolveGrammarDirectory } from "./pipeline-runner.js";
import { createSiftApp } from "./server.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("tree-sitter pipeline preparation", () => {
  it("resolves all package-provided grammars in development", () => {
    const grammarDirectory = resolveGrammarDirectory();
    for (const grammar of ["typescript", "tsx", "javascript", "python", "go"]) {
      expect(existsSync(path.join(grammarDirectory, `tree-sitter-${grammar}.wasm`))).toBe(true);
    }
  });

  it("loads bounded worktree sources and rejects traversal and oversized files", async () => {
    const repoRoot = await tempRoot();
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src", "ok.ts"), "export function ok() {}\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src", "large.ts"), "x".repeat(TREE_SITTER_MAX_BYTES + 1), "utf8");
    await fs.writeFile(path.join(repoRoot, "outside.ts"), "export function outside() {}\n", "utf8");

    const sources = await loadNewFileSources(ingested(repoRoot, "WORKTREE"), [
      file("src/ok.ts"),
      file("src/large.ts"),
      file("../outside.ts")
    ]);

    expect(sources.get("src/ok.ts")).toContain("function ok");
    expect(sources.has("src/large.ts")).toBe(false);
    expect(sources.has("../outside.ts")).toBe(false);
  });

  it("loads the staged version from the index instead of an unstaged worktree edit", async () => {
    const repoRoot = await tempRoot();
    await runGit(["init"], repoRoot);
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    const sourcePath = path.join(repoRoot, "src", "staged.ts");
    await fs.writeFile(sourcePath, "export const value = 'staged';\n", "utf8");
    await runGit(["add", "src/staged.ts"], repoRoot);
    await fs.writeFile(sourcePath, "export const value = 'worktree';\n", "utf8");

    const sources = await loadNewFileSources(ingested(repoRoot, "STAGED"), [file("src/staged.ts")]);

    expect(sources.get("src/staged.ts")).toContain("'staged'");
    expect(sources.get("src/staged.ts")).not.toContain("'worktree'");
  });

  it("serves astCoverage from the meta endpoint", async () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      patch: "",
      git: { headSha: "abc", branch: "main" }
    });
    const app = createSiftApp({
      model,
      provenanceRecords: 0,
      aiRan: false,
      refresh: () => Promise.resolve({ model, provenanceRecords: 0, aiRan: false })
    });

    const response = await app.request("/api/meta");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ astCoverage: 0 });
  });

  it("serves a markdown report without snapshotting review state", async () => {
    const repoRoot = await tempRoot();
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      patch: "",
      git: { headSha: "abc", branch: "main" }
    });
    const app = createSiftApp({
      model,
      provenanceRecords: 0,
      aiRan: false,
      refresh: () => Promise.resolve({ model, provenanceRecords: 0, aiRan: false })
    });

    const response = await app.request("/api/report?format=md");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("# Sift review");
    expect(body).toContain("## Top attention");
    await expect(fs.stat(path.join(repoRoot, ".sift", "history.jsonl"))).rejects.toBeTruthy();
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-tree-sitter-"));
  tempRoots.push(root);
  return root;
}

function ingested(repoRoot: string, diffSpec: string): IngestedDiff {
  return {
    repoRoot,
    diffSpec,
    patch: "",
    git: { headSha: "abc", branch: "main" }
  };
}

function file(filePath: string): FileChange {
  return {
    path: filePath,
    status: "modified",
    hunkIds: []
  };
}
