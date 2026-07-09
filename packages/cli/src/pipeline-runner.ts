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
  parseUnifiedDiff,
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
  const generatedPaths = await generatedPathsFromGitAttributes(
    ingested.repoRoot,
    parsed.files.map((file) => file.path)
  );
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
  let model = analyzeDiff({ ...ingested, generatedPaths, rules: loadedRules.rules, coverage: coverage.coverage });
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

async function loadProvenance(
  repoRoot: string
): Promise<Array<{ provider: ProvenanceProvider; records: ProvenanceRecord[] }>> {
  const providers: ProvenanceProvider[] = [new ClaudeProvenanceProvider(), new GenericJsonlProvider()];
  return Promise.all(providers.map(async (provider) => ({ provider, records: await provider.listRecords(repoRoot) })));
}
