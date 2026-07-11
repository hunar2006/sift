import { promises as fs } from "node:fs";
import path from "node:path";
import { siftDir } from "@sift-review/core";

export type LockSurface = "web" | "tui";

export interface SiftLockFile {
  pid: number;
  surface: LockSurface;
  startedAt: string;
}

export function lockPath(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "lock.json");
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readLock(repoRoot: string): Promise<SiftLockFile | null> {
  try {
    const raw = await fs.readFile(lockPath(repoRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<SiftLockFile>;
    if (typeof parsed.pid !== "number" || (parsed.surface !== "web" && parsed.surface !== "tui")) {
      return null;
    }
    return {
      pid: parsed.pid,
      surface: parsed.surface,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString()
    };
  } catch {
    return null;
  }
}

/** Acquire lock; returns a warning if another live Sift process already holds one. */
export async function acquireLock(repoRoot: string, surface: LockSurface): Promise<string | undefined> {
  await fs.mkdir(siftDir(repoRoot), { recursive: true });
  const existing = await readLock(repoRoot);
  let warning: string | undefined;
  if (existing && existing.pid !== process.pid && isPidAlive(existing.pid)) {
    warning = `state is also open in another sift process — last write wins`;
  }
  const next: SiftLockFile = {
    pid: process.pid,
    surface,
    startedAt: new Date().toISOString()
  };
  await fs.writeFile(lockPath(repoRoot), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return warning;
}

/** Remove lock only if it still belongs to this process. */
export async function releaseLock(repoRoot: string): Promise<void> {
  const existing = await readLock(repoRoot);
  if (!existing || existing.pid !== process.pid) {
    return;
  }
  await fs.unlink(lockPath(repoRoot)).catch(() => undefined);
}
