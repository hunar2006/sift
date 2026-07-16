import { createInterface } from "node:readline/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureSiftDir, GitError, runGit, siftDir } from "@sift-review/core";

export type CleanWorktreeSelection =
  | { kind: "last" }
  | { kind: "staged" }
  | { kind: "range"; range: string }
  | { kind: "demo" }
  | { kind: "quit" };

export interface CleanWorktreePickerInfo {
  lastSubject: string;
  hasStagedChanges: boolean;
}

export interface PickerIo {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream & { isTTY?: boolean };
}

export const FIRST_RUN_HINT = "New here? sift setup wires hooks, gates, and your editor.";

export const CLEAN_WORKTREE_HINT = "Try: sift last · sift --help";

export function emptyReviewMessage(): string {
  return `Nothing to review.\n${CLEAN_WORKTREE_HINT}`;
}

export function isInteractiveTerminal(io: PickerIo = { input: process.stdin, output: process.stdout }): boolean {
  return io.input.isTTY === true && io.output.isTTY === true;
}

/** A bare review is the only time Sift should offer setup without being asked. */
export function isBareSiftInvocation(argv: readonly string[]): boolean {
  return argv.length === 2;
}

/** Record the one welcome hint by creating the repo-local Sift marker once. */
export async function firstRunHint(repoRoot: string): Promise<string | undefined> {
  const dir = siftDir(repoRoot);
  const existing = await fs.stat(dir).then(
    () => true,
    () => false
  );
  if (existing) {
    return undefined;
  }
  await ensureSiftDir(repoRoot);
  const marker = path.join(dir, "onboarding.json");
  try {
    await fs.writeFile(marker, '{"hintShown":true}\n', { encoding: "utf8", flag: "wx" });
    return FIRST_RUN_HINT;
  } catch (error) {
    if (isAlreadyExists(error)) {
      return undefined;
    }
    throw error;
  }
}

export function pickerLines(info: CleanWorktreePickerInfo): string[] {
  const lines = [
    "Nothing to review. Choose a diff:",
    `  1  Last commit — HEAD~1..HEAD · ${info.lastSubject}`
  ];
  if (info.hasStagedChanges) {
    lines.push("  2  Staged changes");
  }
  lines.push("  3  Enter a range", "  4  Demo", "  q  Quit");
  return lines;
}

export async function pickCleanWorktree(
  info: CleanWorktreePickerInfo,
  io: PickerIo = { input: process.stdin, output: process.stdout }
): Promise<CleanWorktreeSelection> {
  const prompt = createInterface({ input: io.input, output: io.output });
  io.output.write(`${pickerLines(info).join("\n")}\n`);
  try {
    const choice = (await prompt.question("> ")).trim().toLowerCase();
    if (choice === "1") {
      return { kind: "last" };
    }
    if (choice === "2" && info.hasStagedChanges) {
      return { kind: "staged" };
    }
    if (choice === "3") {
      const range = (await prompt.question("Range: ")).trim();
      return range ? { kind: "range", range } : { kind: "quit" };
    }
    if (choice === "4") {
      return { kind: "demo" };
    }
    return { kind: "quit" };
  } finally {
    prompt.close();
  }
}

export function pipelineTargetFor(selection: CleanWorktreeSelection): { range?: string; staged?: boolean } | undefined {
  if (selection.kind === "last") {
    return { range: "HEAD~1..HEAD" };
  }
  if (selection.kind === "staged") {
    return { staged: true };
  }
  if (selection.kind === "range") {
    return { range: selection.range };
  }
  return undefined;
}

export function lastCount(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new GitError("Commit count must be a positive integer.");
  }
  return count;
}

export function lastRange(count: number): string {
  return `HEAD~${count}..HEAD`;
}

type GitRunner = (args: string[], cwd: string, allowFailure?: boolean) => Promise<string>;

export async function ensureLastHistory(repoRoot: string, count: number, git: GitRunner = runGit): Promise<void> {
  const commitCount = Number.parseInt((await git(["rev-list", "--count", "HEAD"], repoRoot, true)).trim(), 10) || 0;
  if (commitCount <= count) {
    throw new GitError(`Cannot review ${count} commit(s): history is shorter than ${count}.`);
  }
}

export async function cleanWorktreePickerInfo(repoRoot: string, git: GitRunner = runGit): Promise<CleanWorktreePickerInfo> {
  const [subject, staged] = await Promise.all([
    git(["log", "-1", "--format=%s"], repoRoot, true),
    git(["diff", "--cached", "--name-only"], repoRoot)
  ]);
  return {
    lastSubject: subject.trim() || "no commits",
    hasStagedChanges: staged.trim().length > 0
  };
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}
