import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CorpusEntry } from "./types.js";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
export const EVAL_CACHE = path.join(REPO_ROOT, ".evalcache");

export async function loadCorpusLock(): Promise<CorpusEntry[]> {
  const raw = await fs.readFile(path.join(PACKAGE_ROOT, "corpus.lock.json"), "utf8");
  return JSON.parse(raw) as CorpusEntry[];
}

export function cachePathFor(entry: CorpusEntry): string {
  return path.join(EVAL_CACHE, entry.id);
}

/** Shallow-clone (or update) a corpus repo. Never builds/installs/executes package code. */
export async function ensureCorpusClone(entry: CorpusEntry, commitWindow: number): Promise<string> {
  await fs.mkdir(EVAL_CACHE, { recursive: true });
  const dest = cachePathFor(entry);
  const depth = Math.max(commitWindow + 5, 50);

  if (!existsSync(path.join(dest, ".git"))) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
    await runGit(["clone", "--filter=blob:none", "--no-checkout", entry.url, dest]);
  }

  await runGit(["-C", dest, "fetch", "--depth", String(depth), "origin", entry.sha]);
  await runGit(["-C", dest, "checkout", "--force", entry.sha]);
  return dest;
}

/** Most recent N non-merge commits reachable from the pinned SHA (newest first). */
export async function listReplayCommits(repoPath: string, tipSha: string, limit: number): Promise<string[]> {
  const { stdout } = await runGit([
    "-C",
    repoPath,
    "rev-list",
    "--no-merges",
    `--max-count=${limit}`,
    tipSha
  ]);
  return stdout
    .toString()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function parentOf(repoPath: string, sha: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["-C", repoPath, "rev-parse", `${sha}^`]);
    return stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

export async function runGit(args: string[]): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return execFileAsync("git", args, {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    encoding: "buffer"
  }) as Promise<{ stdout: Buffer; stderr: Buffer }>;
}

export function filterCorpus(entries: CorpusEntry[], repoFilter?: string): CorpusEntry[] {
  if (!repoFilter) {
    return entries;
  }
  const wanted = new Set(
    repoFilter
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
  return entries.filter((entry) => wanted.has(entry.id));
}
