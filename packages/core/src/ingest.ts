import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IngestedDiff } from "./types.js";
import {
  EMPTY_TREE,
  discoverRepoRoot,
  getGitMeta,
  GitError,
  gitDiff,
  hasHead,
  listUntracked,
  syntheticDiffForUntracked
} from "./git.js";

const execFileAsync = promisify(execFile);

export interface PullRequestListItem {
  number: number;
  title: string;
  author: string;
}

export interface GhResult {
  stdout: string | Buffer;
}

export type GhRunner = (args: string[], cwd: string) => Promise<GhResult>;

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

export function normalizePrReference(value: string): string {
  const input = value.trim();
  if (/^\d+$/u.test(input)) {
    return input;
  }
  const url = input.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/iu);
  if (url) {
    return `${url[1]}/${url[2]}#${url[3]}`;
  }
  if (/^[^/\s]+\/[^#\s]+#\d+$/u.test(input)) {
    return input;
  }
  throw new GitError("Pull request must be a number, GitHub URL, or owner/repo#number.");
}

export function ghInstallMessage(platform = process.platform): string {
  return platform === "win32"
    ? "GitHub CLI is required: winget install GitHub.cli"
    : "GitHub CLI is required: brew install gh";
}

export const GH_AUTH_MESSAGE = "GitHub CLI needs sign-in — Run: gh auth login";

export async function ensureGitHubCli(cwd: string, gh: GhRunner = defaultGh): Promise<void> {
  try {
    await gh(["--version"], cwd);
  } catch {
    throw new GitError(ghInstallMessage());
  }
  try {
    await gh(["auth", "status"], cwd);
  } catch {
    throw new GitError(GH_AUTH_MESSAGE);
  }
}

export async function listPullRequests(cwd: string, gh: GhRunner = defaultGh): Promise<PullRequestListItem[]> {
  await ensureGitHubCli(cwd, gh);
  let stdout: string | Buffer;
  try {
    ({ stdout } = await gh(["pr", "list", "--limit", "10", "--json", "number,title,author"], cwd));
  } catch {
    throw new GitError("Could not list pull requests.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.toString());
  } catch {
    throw new GitError("GitHub CLI returned an invalid pull request list.");
  }
  if (!Array.isArray(parsed)) {
    throw new GitError("GitHub CLI returned an invalid pull request list.");
  }
  return parsed.flatMap((item): PullRequestListItem[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as { number?: unknown; title?: unknown; author?: unknown };
    const author = candidate.author && typeof candidate.author === "object" && "login" in candidate.author
      ? (candidate.author as { login?: unknown }).login
      : undefined;
    if (typeof candidate.number !== "number" || typeof candidate.title !== "string" || typeof author !== "string") {
      return [];
    }
    return [{ number: candidate.number, title: candidate.title, author }];
  });
}

export async function ingestPrDiff(cwd: string, pr: string, gh: GhRunner = defaultGh): Promise<IngestedDiff> {
  const reference = normalizePrReference(pr);
  const repoRoot = await discoverRepoRoot(cwd);
  const git = await getGitMeta(repoRoot);
  const { number, repo } = splitPrReference(reference);
  await ensureGitHubCli(repoRoot, gh);
  try {
    const { stdout } = await gh(["pr", "diff", number, "--patch", ...(repo ? ["--repo", repo] : [])], repoRoot);
    return { repoRoot, diffSpec: `pr/${reference}`, git, patch: stdout.toString() };
  } catch {
    throw new GitError(`Could not read pull request #${number}.`);
  }
}

function splitPrReference(reference: string): { number: string; repo?: string } {
  const scoped = reference.match(/^([^#]+)#(\d+)$/u);
  return scoped?.[1] && scoped[2] ? { repo: scoped[1], number: scoped[2] } : { number: reference };
}

async function defaultGh(args: string[], cwd: string): Promise<GhResult> {
  const { stdout } = await execFileAsync("gh", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  return { stdout };
}
