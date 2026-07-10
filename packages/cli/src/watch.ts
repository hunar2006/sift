import { watch, type FSWatcher } from "chokidar";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PipelineResult } from "./pipeline-runner.js";

export interface ModelUpdate {
  addedIds: string[];
  removedIds: string[];
  totals: PipelineResult["model"]["totals"];
  generatedAt: string;
}

export interface LiveWatcherOptions {
  repoRoot: string;
  reanalyze(): Promise<PipelineResult>;
  current(): PipelineResult;
  apply(result: PipelineResult, update: ModelUpdate): void;
  onWarning(message: string): void;
}

export interface LiveWatcher {
  close(): Promise<void>;
}

export interface RefreshScheduler {
  request(): void;
  close(): void;
}

/** Runs one refresh after the last change and coalesces changes during analysis. */
export function createRefreshScheduler(
  refresh: () => Promise<void>,
  onWarning: (message: string) => void,
  debounceMs = 400
): RefreshScheduler {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  let closed = false;

  const execute = async (): Promise<void> => {
    if (closed || running) {
      return;
    }
    running = true;
    try {
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onWarning(`Watch update failed: ${message}`);
    } finally {
      running = false;
      if (queued && !closed) {
        queued = false;
        void execute();
      }
    }
  };

  return {
    request() {
      if (closed) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (running) {
          queued = true;
          return;
        }
        void execute();
      }, debounceMs);
    },
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}

export async function startLiveWatcher(options: LiveWatcherOptions): Promise<LiveWatcher> {
  const gitIndex = path.join(options.repoRoot, ".git", "index");
  const gitHead = path.join(options.repoRoot, ".git", "HEAD");
  const ignored = await createIgnoredPathPredicate(options.repoRoot, new Set([gitIndex, gitHead]));
  const scheduler = createRefreshScheduler(async () => {
    const previous = options.current();
    const result = await options.reanalyze();
    options.apply(result, modelUpdate(previous, result));
  }, options.onWarning);
  const watcher = watch(options.repoRoot, { ignoreInitial: true, ignored, persistent: true });

  watcher.add([gitIndex, gitHead]);
  watcher.on("all", () => scheduler.request());
  watcher.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    options.onWarning(`Watch error: ${message}`);
  });
  await watcherReady(watcher);

  return {
    async close() {
      scheduler.close();
      await watcher.close();
    }
  };
}

export function modelUpdate(previous: PipelineResult, next: PipelineResult): ModelUpdate {
  const previousIds = new Set(previous.model.hunks.map((hunk) => hunk.id));
  const nextIds = new Set(next.model.hunks.map((hunk) => hunk.id));
  return {
    addedIds: [...nextIds].filter((id) => !previousIds.has(id)).sort(),
    removedIds: [...previousIds].filter((id) => !nextIds.has(id)).sort(),
    totals: next.model.totals,
    generatedAt: next.model.meta.generatedAt
  };
}

async function createIgnoredPathPredicate(repoRoot: string, allowedGitPaths: ReadonlySet<string>): Promise<(filePath: string) => boolean> {
  const ignoredTopLevel = await readTopLevelGitignoreEntries(repoRoot);
  const normalizedAllowed = new Set([...allowedGitPaths].map((filePath) => path.resolve(filePath)));
  return (filePath: string): boolean => {
    const absolute = path.resolve(filePath);
    if (normalizedAllowed.has(absolute)) {
      return false;
    }
    const relative = path.relative(repoRoot, absolute).replaceAll("\\", "/");
    if (!relative || relative === ".") {
      return false;
    }
    if (relative === "node_modules" || relative.startsWith("node_modules/")) {
      return true;
    }
    if (relative === ".git" || relative.startsWith(".git/")) {
      return true;
    }
    if (relative === ".sift" || relative.startsWith(".sift/")) {
      return true;
    }
    return ignoredTopLevel.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
  };
}

async function readTopLevelGitignoreEntries(repoRoot: string): Promise<string[]> {
  try {
    const source = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
    return source
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^\//u, "").replace(/\/$/u, ""))
      .filter(
        (entry) =>
          entry &&
          !entry.startsWith("#") &&
          !entry.startsWith("!") &&
          !entry.includes("?") &&
          !entry.includes("*") &&
          !entry.includes("[") &&
          !entry.includes("/")
      );
  } catch {
    return [];
  }
}

function watcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => watcher.once("ready", resolve));
}
