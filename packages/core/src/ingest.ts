import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IngestedDiff } from "./types.js";
import {
  EMPTY_TREE,
  discoverRepoRoot,
  getGitMeta,
  gitDiff,
  hasHead,
  listUntracked,
  syntheticDiffForUntracked
} from "./git.js";

const execFileAsync = promisify(execFile);

export interface IngestOptions {
  cwd: string;
  staged?: boolean;
  range?: string;
}

export async function ingestDiff(options: IngestOptions): Promise<IngestedDiff> {
  const repoRoot = await discoverRepoRoot(options.cwd);
  const git = await getGitMeta(repoRoot);
  const headExists = await hasHead(repoRoot);
  if (options.staged) {
    const base = headExists ? "HEAD" : EMPTY_TREE;
    return {
      repoRoot,
      diffSpec: "STAGED",
      git,
      patch: await gitDiff(repoRoot, ["--cached", base])
    };
  }
  if (options.range) {
    const diffRange = options.range.includes("..") ? options.range : `${options.range}..HEAD`;
    return {
      repoRoot,
      diffSpec: diffRange,
      git,
      patch: await gitDiff(repoRoot, [diffRange])
    };
  }
  const base = headExists ? "HEAD" : EMPTY_TREE;
  const tracked = await gitDiff(repoRoot, [base]);
  const untracked = await listUntracked(repoRoot);
  const synthetic = await Promise.all(
    untracked.map(async (file) => syntheticDiffForUntracked(repoRoot, file))
  );
  return {
    repoRoot,
    diffSpec: "WORKTREE",
    git,
    patch: [tracked, ...synthetic].filter((part) => part.trim().length > 0).join("\n")
  };
}

export async function ingestPrDiff(cwd: string, pr: string): Promise<IngestedDiff> {
  const repoRoot = await discoverRepoRoot(cwd);
  const git = await getGitMeta(repoRoot);
  const number = pr.match(/\/pull\/(\d+)/)?.[1] ?? pr;
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "diff", number, "--patch"], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    return { repoRoot, diffSpec: `pr/${number}`, git, patch: stdout.toString() };
  } catch {
    throw new Error("GitHub PR diffs require the gh CLI. Install it, authenticate, then run sift pr again.");
  }
}
