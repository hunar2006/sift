import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GitMeta } from "./types.js";
import { normalizeRepoRelative, toPosixPath } from "./path-utils.js";

const execFileAsync = promisify(execFile);
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_UNTRACKED_BYTES = 1024 * 1024;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export async function runGit(args: string[], cwd: string, allowFailure = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    return stdout.toString();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    const message = error instanceof Error ? error.message : "git command failed";
    throw new GitError(message);
  }
}

export async function discoverRepoRoot(cwd: string): Promise<string> {
  const root = (await runGit(["rev-parse", "--show-toplevel"], cwd, true)).trim();
  if (!root) {
    throw new GitError("Not a git repository. Run sift inside a git checkout.");
  }
  return path.resolve(root);
}

export async function hasHead(repoRoot: string): Promise<boolean> {
  const head = await runGit(["rev-parse", "--verify", "HEAD"], repoRoot, true);
  return head.trim().length > 0;
}

export async function getGitMeta(repoRoot: string): Promise<GitMeta> {
  const headExists = await hasHead(repoRoot);
  const headSha = headExists ? (await runGit(["rev-parse", "HEAD"], repoRoot)).trim() : EMPTY_TREE;
  const branchText = headExists
    ? (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot, true)).trim()
    : "";
  return {
    headSha,
    branch: branchText.length > 0 && branchText !== "HEAD" ? branchText : null
  };
}

export async function gitDiff(repoRoot: string, args: string[]): Promise<string> {
  return runGit(["diff", ...args, "--no-color", "--no-ext-diff", "--find-renames", "--unified=3"], repoRoot);
}

export async function listUntracked(repoRoot: string): Promise<string[]> {
  const output = await runGit(["ls-files", "--others", "--exclude-standard"], repoRoot);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function syntheticDiffForUntracked(repoRoot: string, relativePath: string): Promise<string> {
  const fullPath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(fullPath);
  const posixPath = toPosixPath(relativePath);
  if (stat.size > MAX_UNTRACKED_BYTES || (await isBinaryFile(fullPath))) {
    return [
      `diff --git a/${posixPath} b/${posixPath}`,
      "new file mode 100644",
      "index 0000000..0000000",
      `--- /dev/null`,
      `+++ b/${posixPath}`,
      `Binary files /dev/null and b/${posixPath} differ`
    ].join("\n");
  }
  const text = await fs.readFile(fullPath, "utf8");
  const lines = text.length === 0 ? [] : text.replace(/\r?\n$/u, "").split(/\n/u);
  const hunkSize = lines.length;
  return [
    `diff --git a/${posixPath} b/${posixPath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${posixPath}`,
    `@@ -0,0 +1,${hunkSize} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}

export async function isBinaryFile(fullPath: string): Promise<boolean> {
  const handle = await fs.open(fullPath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export async function generatedPathsFromGitAttributes(repoRoot: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) {
    return new Set();
  }
  const output = await runGit(["check-attr", "linguist-generated", "--", ...paths], repoRoot, true);
  const generated = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(.*): linguist-generated: (.*)$/);
    if (match && match[2] === "true") {
      generated.add(normalizeRepoRelative(match[1] ?? ""));
    }
  }
  return generated;
}

export async function readWorktreeFile(repoRoot: string, relativePath: string, maxBytes = 2 * 1024 * 1024): Promise<string | null> {
  const fullPath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat || stat.size > maxBytes || (await isBinaryFile(fullPath))) {
    return null;
  }
  return fs.readFile(fullPath, "utf8");
}

export async function readGitFile(repoRoot: string, rev: string, relativePath: string): Promise<string | null> {
  const output = await runGit(["show", `${rev}:${relativePath}`], repoRoot, true);
  return output.length > 2 * 1024 * 1024 ? null : output;
}
