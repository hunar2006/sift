import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { HunkStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export type RevertScope = "WORKTREE" | "STAGED";

export interface RevertHunkState {
  hunkId: string;
  status: HunkStatus;
  note?: string;
}

/** A durable snapshot is kept in Git's object database before a confirmed revert. */
export interface RevertRecord {
  id: string;
  ts: string;
  path: string;
  blobSha: string;
  mode: number;
  diffSpec: RevertScope;
  tracked: boolean;
  revertedSha?: string;
  hunkStates: RevertHunkState[];
}

export function revertPath(repoRoot: string): string {
  return path.join(repoRoot, ".sift", "reverts.json");
}

export function revertScopeFor(diffSpec: string): RevertScope | null {
  const normalized = diffSpec.trim().toUpperCase();
  return normalized === "WORKTREE" || normalized === "STAGED" ? normalized : null;
}

export async function readReverts(repoRoot: string): Promise<RevertRecord[]> {
  const raw = await fs.readFile(revertPath(repoRoot), "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(isRevertRecord);
    }
  } catch {
    // Older/interrupted files are recovered as newline-delimited records below.
  }
  return raw
    .split(/\r?\n/u)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRevertRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The sole mutable Git boundary in Sift. It first stores the exact bytes as a
 * blob; any snapshot failure rejects before checkout, restore, or deletion.
 */
export async function snapshotAndRevert(options: {
  repoRoot: string;
  filePath: string;
  diffSpec: string;
  hunkStates?: RevertHunkState[];
}): Promise<RevertRecord> {
  const scope = revertScopeFor(options.diffSpec);
  if (!scope) {
    throw new RevertUnavailableError("Revert works on the working tree. This diff is historical.");
  }
  const absolute = resolveRepoPath(options.repoRoot, options.filePath);
  await assertNoConflicts(options.repoRoot, options.filePath);

  // This write is intentionally before every destructive operation.
  const blobSha = (await gitText(["hash-object", "-w", "--no-filters", "--", options.filePath], options.repoRoot)).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(blobSha)) {
    throw new Error("Snapshot failed; file was left untouched.");
  }
  const stat = await fs.stat(absolute);
  const tracked = await isTracked(options.repoRoot, options.filePath);
  const record: RevertRecord = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    path: options.filePath,
    blobSha,
    mode: stat.mode & 0o777,
    diffSpec: scope,
    tracked,
    hunkStates: options.hunkStates ?? []
  };

  // Make the recovery record durable before a single destructive Git command.
  // If this write fails the current file is still untouched.
  const records = await readReverts(options.repoRoot);
  await writeReverts(options.repoRoot, [...records, record]);

  if (tracked) {
    if (scope === "STAGED") {
      await gitText(["restore", "--staged", "--worktree", "--", options.filePath], options.repoRoot);
    } else {
      await gitText(["checkout", "--", options.filePath], options.repoRoot);
    }
    record.revertedSha = await hashCurrent(options.repoRoot, options.filePath);
  } else {
    await fs.unlink(absolute);
  }

  // Persist the byte-match guard after the restore has a concrete target.
  await writeReverts(options.repoRoot, [...records, record]);
  return record;
}

/** Restores a recorded blob only when the reverted-to bytes have not changed. */
export async function undoRevert(repoRoot: string, revertId: string): Promise<RevertRecord> {
  const record = (await readReverts(repoRoot)).find((candidate) => candidate.id === revertId);
  if (!record) {
    throw new Error("Revert snapshot no longer exists.");
  }
  const absolute = resolveRepoPath(repoRoot, record.path);
  const current = await hashCurrent(repoRoot, record.path);
  if ((record.revertedSha && current !== record.revertedSha) || (!record.revertedSha && current !== "")) {
    throw new FileChangedSinceRevertError();
  }
  const bytes = await gitBuffer(["cat-file", "blob", record.blobSha], repoRoot);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);
  await fs.chmod(absolute, record.mode).catch(() => undefined);
  return record;
}

export class RevertUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevertUnavailableError";
  }
}

export class FileChangedSinceRevertError extends Error {
  constructor() {
    super("File changed since revert.");
    this.name = "FileChangedSinceRevertError";
  }
}

async function writeReverts(repoRoot: string, records: RevertRecord[]): Promise<void> {
  const file = revertPath(repoRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(records, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

async function assertNoConflicts(repoRoot: string, filePath: string): Promise<void> {
  const conflicts = await gitText(["diff", "--name-only", "--diff-filter=U", "--", filePath], repoRoot);
  if (conflicts.trim()) {
    throw new RevertUnavailableError("Revert is unavailable while this file has merge conflicts.");
  }
}

async function isTracked(repoRoot: string, filePath: string): Promise<boolean> {
  return (await gitText(["ls-files", "--error-unmatch", "--", filePath], repoRoot, true)).trim().length > 0;
}

async function hashCurrent(repoRoot: string, filePath: string): Promise<string> {
  const absolute = resolveRepoPath(repoRoot, filePath);
  const exists = await fs
    .stat(absolute)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return "";
  }
  return (await gitText(["hash-object", "--no-filters", "--", filePath], repoRoot)).trim();
}

function resolveRepoPath(repoRoot: string, filePath: string): string {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, filePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Revert path must stay inside the repository.");
  }
  return absolute;
}

async function gitText(args: string[], cwd: string, allowFailure = false): Promise<string> {
  try {
    return (await gitBuffer(args, cwd)).toString("utf8");
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw error;
  }
}

function gitBuffer(args: string[], cwd: string): Promise<Buffer> {
  return execFileAsync("git", args, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }).then(({ stdout }) =>
    Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  );
}

function isRevertRecord(value: unknown): value is RevertRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<RevertRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.ts === "string" &&
    typeof record.path === "string" &&
    typeof record.blobSha === "string" &&
    typeof record.mode === "number" &&
    (record.diffSpec === "WORKTREE" || record.diffSpec === "STAGED") &&
    typeof record.tracked === "boolean" &&
    Array.isArray(record.hunkStates)
  );
}
