import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeDiff,
  generatedPathsFromGitAttributes,
  initializeTreeSitter,
  ingestDiff,
  normalizeRepoRelative,
  parseUnifiedDiff,
  readGitFile,
  TREE_SITTER_MAX_BYTES,
  type FileChange,
  type ReviewModel
} from "@sift-review/core";

const require = createRequire(import.meta.url);

let treeSitterReady: Promise<void> | undefined;

function grammarDirectory(): string {
  return path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
}

async function ensureTreeSitter(): Promise<void> {
  treeSitterReady ??= initializeTreeSitter({ grammarDirectory: grammarDirectory() });
  await treeSitterReady;
}

function targetRevisionFor(diffSpec: string): string | undefined {
  return diffSpec.match(/\.{2,3}(.+)$/u)?.[1];
}

function safeRepoRelativePath(repoRoot: string, file: string): string | undefined {
  const normalized = normalizeRepoRelative(file);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    return undefined;
  }
  const absolute = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    return undefined;
  }
  return normalized;
}

async function loadNewFileSources(
  repoRoot: string,
  diffSpec: string,
  files: FileChange[]
): Promise<Map<string, string>> {
  const targetRevision = targetRevisionFor(diffSpec);
  if (targetRevision === undefined) {
    return new Map();
  }
  const entries = await Promise.all(
    files.map(async (file): Promise<readonly [string, string] | null> => {
      if (file.status === "deleted" || file.status === "binary") {
        return null;
      }
      const safePath = safeRepoRelativePath(repoRoot, file.path);
      if (!safePath) {
        return null;
      }
      try {
        const source = await readGitFile(repoRoot, targetRevision, safePath, TREE_SITTER_MAX_BYTES);
        return source === null ? null : ([safePath, source] as const);
      } catch {
        return null;
      }
    })
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}

/** Full pipeline for one commit range with provenance/AI/coverage off. */
export async function analyzeCommitRange(repoRoot: string, range: string): Promise<ReviewModel> {
  await ensureTreeSitter();
  const ingested = await ingestDiff({ cwd: repoRoot, range });
  const parsed = parseUnifiedDiff(ingested.patch);
  const [generatedPaths, newFileSources] = await Promise.all([
    generatedPathsFromGitAttributes(
      ingested.repoRoot,
      parsed.files.map((file) => file.path)
    ),
    loadNewFileSources(ingested.repoRoot, ingested.diffSpec, parsed.files)
  ]);
  return analyzeDiff({
    ...ingested,
    generatedPaths,
    newFileSources
  });
}

export function countChangedLines(model: ReviewModel): number {
  let count = 0;
  for (const hunk of model.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add" || line.kind === "del") {
        count += 1;
      }
    }
  }
  return count;
}

export function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}
