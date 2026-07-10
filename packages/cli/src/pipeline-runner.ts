import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeDiff,
  generatedPathsFromGitAttributes,
  GenericJsonlProvider,
  formatRuleFileProblem,
  ingestDiff,
  ingestPrDiff,
  loadCoverage,
  loadRules,
  matchProvenanceRecords,
  initializeTreeSitter,
  normalizeRepoRelative,
  parseUnifiedDiff,
  readGitFile,
  readWorktreeFile,
  TREE_SITTER_MAX_BYTES,
  type FileChange,
  type IngestedDiff,
  type ProvenanceProvider,
  type ProvenanceRecord,
  type ReviewModel
} from "@sift-review/core";
import { ClaudeProvenanceProvider } from "@sift-review/claude-adapter";
import { annotateWithAi, type AiMode } from "./ai.js";

export interface RunPipelineOptions {
  cwd: string;
  staged?: boolean;
  range?: string;
  pr?: string;
  ai?: true | AiMode;
  coverage?: string;
}

export interface PipelineResult {
  model: ReviewModel;
  provenanceRecords: number;
  aiRan: boolean;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const ingested = options.pr ? await ingestPrDiff(options.cwd, options.pr) : await ingestDiff(options);
  return buildModelFromIngested(ingested, options.ai, options.coverage);
}

export async function buildModelFromIngested(
  ingested: IngestedDiff,
  ai?: true | AiMode,
  coveragePath?: string
): Promise<PipelineResult> {
  const parsed = parseUnifiedDiff(ingested.patch);
  const [generatedPaths, newFileSources] = await Promise.all([
    generatedPathsFromGitAttributes(
      ingested.repoRoot,
      parsed.files.map((file) => file.path)
    ),
    prepareTreeSitter(ingested, parsed.files)
  ]);
  const coverage = await loadCoverage(ingested.repoRoot, parsed.files, coveragePath);
  for (const warning of coverage.warnings) {
    console.error(warning);
  }
  const loadedRules = await loadRules(ingested.repoRoot);
  for (const report of loadedRules.reports) {
    if (report.status === "error") {
      console.error(`Ignoring invalid Sift rules file: ${formatRuleFileProblem(report)}`);
    }
  }
  let model = analyzeDiff({
    ...ingested,
    generatedPaths,
    rules: loadedRules.rules,
    coverage: coverage.coverage,
    newFileSources
  });
  const provenanceSources = await loadProvenance(ingested.repoRoot);
  for (const source of provenanceSources) {
    if (source.records.length > 0) {
      const matches = matchProvenanceRecords(model.hunks, source.records, (match) => source.provider.enrich(match));
      model = {
        ...model,
        hunks: model.hunks.map((hunk) => {
          if (hunk.provenance) {
            return hunk;
          }
          const provenance = matches.get(hunk.id);
          return provenance ? { ...hunk, provenance } : hunk;
        })
      };
    }
  }
  if (ai) {
    model = await annotateWithAi(model, ai);
  }
  return {
    model,
    provenanceRecords: provenanceSources.reduce((sum, source) => sum + source.records.length, 0),
    aiRan: Boolean(ai)
  };
}

async function prepareTreeSitter(
  ingested: IngestedDiff,
  files: FileChange[]
): Promise<ReadonlyMap<string, string>> {
  const [, sources] = await Promise.all([
    initializeTreeSitter({ grammarDirectory: resolveGrammarDirectory() }),
    loadNewFileSources(ingested, files)
  ]);
  return sources;
}

export async function loadNewFileSources(
  ingested: IngestedDiff,
  files: FileChange[]
): Promise<Map<string, string>> {
  const targetRevision = targetRevisionFor(ingested.diffSpec);
  if (ingested.diffSpec.startsWith("pr/") || (ingested.diffSpec !== "WORKTREE" && targetRevision === undefined)) {
    return new Map();
  }

  const entries = await Promise.all(
    files.map(async (file): Promise<readonly [string, string] | null> => {
      if (file.status === "deleted" || file.status === "binary") {
        return null;
      }
      const safePath = safeRepoRelativePath(ingested.repoRoot, file.path);
      if (!safePath) {
        return null;
      }
      try {
        const source =
          ingested.diffSpec === "WORKTREE"
            ? await readWorktreeFile(ingested.repoRoot, safePath, TREE_SITTER_MAX_BYTES)
            : await readGitFile(ingested.repoRoot, targetRevision ?? "", safePath, TREE_SITTER_MAX_BYTES);
        return source === null ? null : ([safePath, source] as const);
      } catch {
        return null;
      }
    })
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}

export function resolveGrammarDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.join(moduleDirectory, "grammars");
  if (existsSync(path.join(packaged, "tree-sitter-typescript.wasm"))) {
    return packaged;
  }
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
}

function targetRevisionFor(diffSpec: string): string | undefined {
  if (diffSpec === "STAGED") {
    return "";
  }
  return diffSpec.match(/\.{2,3}(.+)$/u)?.[1];
}

function safeRepoRelativePath(repoRoot: string, file: string): string | undefined {
  const normalized = normalizeRepoRelative(file);
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  const resolved = path.resolve(repoRoot, ...normalized.split("/"));
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalized;
}

async function loadProvenance(
  repoRoot: string
): Promise<Array<{ provider: ProvenanceProvider; records: ProvenanceRecord[] }>> {
  const providers: ProvenanceProvider[] = [new ClaudeProvenanceProvider(), new GenericJsonlProvider()];
  return Promise.all(providers.map(async (provider) => ({ provider, records: await provider.listRecords(repoRoot) })));
}
