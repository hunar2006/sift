import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReviewModel } from "./types.js";
import { ensureSiftDir, siftDir } from "./state.js";

const MAX_SEEN_HUNKS = 5_000;

export function seenPath(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "seen.json");
}

/** Adds stable first-seen timestamps to a model and persists its hunk IDs. */
export async function attachFirstSeenAt(model: ReviewModel): Promise<ReviewModel> {
  const existing = await readSeen(model.meta.repoRoot);
  const now = new Date().toISOString();
  const next = { ...existing };
  let changed = false;
  const hunks = model.hunks.map((hunk) => {
    const firstSeenAt = existing[hunk.id] ?? now;
    if (!existing[hunk.id]) {
      next[hunk.id] = firstSeenAt;
      changed = true;
    }
    return { ...hunk, firstSeenAt };
  });
  const pruned = pruneSeen(next);
  if (changed || Object.keys(pruned).length !== Object.keys(existing).length) {
    await writeSeen(model.meta.repoRoot, pruned);
  }
  return { ...model, hunks };
}

export async function readSeen(repoRoot: string): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(seenPath(repoRoot), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !Number.isNaN(Date.parse(entry[1])))
    );
  } catch {
    return {};
  }
}

export async function writeSeen(repoRoot: string, seen: Record<string, string>): Promise<void> {
  await ensureSiftDir(repoRoot);
  const file = seenPath(repoRoot);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(seen, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

export function pruneSeen(seen: Record<string, string>, maximum = MAX_SEEN_HUNKS): Record<string, string> {
  return Object.fromEntries(
    Object.entries(seen)
      .sort(([, a], [, b]) => b.localeCompare(a))
      .slice(0, maximum)
  );
}
