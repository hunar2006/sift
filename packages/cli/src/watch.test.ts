import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeDiff, runGit } from "@sift-review/core";
import type { PipelineResult } from "./pipeline-runner.js";
import { createRefreshScheduler, modelUpdate, startLiveWatcher } from "./watch.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("live watcher", () => {
  it("uses a trailing debounce and one queued refresh while analysis is running", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const scheduler = createRefreshScheduler(refresh, vi.fn());

    scheduler.request();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(400);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.request();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(400);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.close();
  });

  it("isolates a failed tick and records one warning", async () => {
    vi.useFakeTimers();
    const warning = vi.fn();
    const scheduler = createRefreshScheduler(() => Promise.reject(new Error("index.lock is present")), warning);

    scheduler.request();
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(0);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("Watch update failed: index.lock is present");
    scheduler.close();
  });

  it("refreshes for a worktree edit and a staged index update", async () => {
    const repoRoot = await tempRepo();
    const source = path.join(repoRoot, "src", "value.ts");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "export const value = 1;\n", "utf8");
    await runGit(["add", "."], repoRoot);
    await runGit(["-c", "user.name=Sift", "-c", "user.email=sift@example.test", "commit", "-m", "initial"], repoRoot);

    let current = resultFor(repoRoot, 0);
    let runs = 0;
    const watcher = await startLiveWatcher({
      repoRoot,
      reanalyze: () => Promise.resolve(resultFor(repoRoot, ++runs)),
      current: () => current,
      apply: (next) => {
        current = next;
      },
      onWarning: (message) => {
        throw new Error(message);
      }
    });

    await fs.writeFile(source, "export const value = 2;\n", "utf8");
    await vi.waitFor(() => expect(runs).toBe(1), { timeout: 4_000 });

    await runGit(["add", "src/value.ts"], repoRoot);
    await vi.waitFor(() => expect(runs).toBe(2), { timeout: 4_000 });
    await watcher.close();
  });

  it("reports deterministic hunk ID deltas", async () => {
    const repoRoot = await tempRepo();
    const previous = resultFor(repoRoot, 1);
    const next = resultFor(repoRoot, 2);
    const update = modelUpdate(previous, next);

    expect(update.addedIds).toEqual(next.model.hunks.map((hunk) => hunk.id));
    expect(update.removedIds).toEqual(previous.model.hunks.map((hunk) => hunk.id));
    expect(update.generatedAt).toBe(next.model.meta.generatedAt);
  });
});

async function tempRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-watch-"));
  tempRoots.push(repoRoot);
  await runGit(["init"], repoRoot);
  return repoRoot;
}

function resultFor(repoRoot: string, value: number): PipelineResult {
  const model = analyzeDiff({
    repoRoot,
    diffSpec: "WORKTREE",
    patch: `diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-export const value = ${value - 1};\n+export const value = ${value};\n`,
    git: { headSha: "abc", branch: "main" }
  });
  return { model, provenanceRecords: 0, aiRan: false, brief: null };
}
