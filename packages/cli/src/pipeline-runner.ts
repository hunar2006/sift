import {
  analyzeDiff,
  generatedPathsFromGitAttributes,
  ingestDiff,
  ingestPrDiff,
  parseUnifiedDiff,
  type IngestedDiff,
  type ReviewModel
} from "@sift-review/core";
import {
  attachProvenance,
  loadHookLog,
  loadTranscriptRecords,
  type ProvenanceRecord
} from "@sift-review/claude-adapter";
import { annotateWithAi, type AiProvider } from "./ai.js";

export interface RunPipelineOptions {
  cwd: string;
  staged?: boolean;
  range?: string;
  pr?: string;
  ai?: true | AiProvider;
}

export interface PipelineResult {
  model: ReviewModel;
  provenanceRecords: number;
  aiRan: boolean;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const ingested = options.pr ? await ingestPrDiff(options.cwd, options.pr) : await ingestDiff(options);
  return buildModelFromIngested(ingested, options.ai);
}

export async function buildModelFromIngested(
  ingested: IngestedDiff,
  ai?: true | AiProvider
): Promise<PipelineResult> {
  const parsed = parseUnifiedDiff(ingested.patch);
  const generatedPaths = await generatedPathsFromGitAttributes(
    ingested.repoRoot,
    parsed.files.map((file) => file.path)
  );
  let model = analyzeDiff({ ...ingested, generatedPaths });
  const records = await loadProvenance(ingested.repoRoot);
  if (records.length > 0) {
    model = { ...model, hunks: attachProvenance(model.hunks, records) };
  }
  if (ai) {
    model = await annotateWithAi(model, ai);
  }
  return { model, provenanceRecords: records.length, aiRan: Boolean(ai) };
}

async function loadProvenance(repoRoot: string): Promise<ProvenanceRecord[]> {
  const hook = await loadHookLog(repoRoot);
  const transcript = await loadTranscriptRecords(repoRoot);
  return [...hook, ...transcript];
}
