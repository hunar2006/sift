import { z } from "zod";
import type { EffectiveRules } from "./rules.js";
import type { CoverageData } from "./coverage.js";

export type HunkCategory =
  | "logic"
  | "tests"
  | "config"
  | "deps"
  | "docs"
  | "mechanical"
  | "generated"
  | "binary";

export type RiskBand = "high" | "medium" | "low" | "skim";

export interface RiskReason {
  code: string;
  label: string;
  weight: number;
  tier?: "primary" | "nit";
  line?: number;
  evidence?: string;
}

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ProvenanceRef {
  source: "claude-code";
  sessionId: string;
  transcriptPath: string;
  matchedVia: "hook-log" | "transcript-scan";
  confidence: number;
  userPromptExcerpt?: string;
  reasoningExcerpt?: string;
  toolName?: string;
  timestamp?: string;
}

export interface Hunk {
  id: string;
  file: string;
  oldPath?: string;
  language: string;
  header: string;
  lines: DiffLine[];
  addedLines: number;
  removedLines: number;
  category: HunkCategory;
  categoryReason: string;
  risk: number;
  band: RiskBand;
  reasons: RiskReason[];
  coverage?: CoverageSummary;
  defines?: string[];
  references?: string[];
  readingRank?: number;
  groupId: string;
  oldStart?: number;
  newStart?: number;
  provenance?: ProvenanceRef;
  aiSummary?: string;
  aiConcern?: string;
}

export interface HunkGroup {
  id: string;
  title: string;
  kind: "attention" | "skim";
  order: number;
  hunkIds: string[];
  totalAdded: number;
  totalRemoved: number;
}

export interface FileChange {
  path: string;
  oldPath?: string;
  status: "modified" | "added" | "deleted" | "renamed" | "binary" | "mode";
  hunkIds: string[];
}

export interface ReviewModel {
  meta: {
    siftVersion: string;
    repoRoot: string;
    diffSpec: string;
    generatedAt: string;
    git: { headSha: string; branch: string | null };
  };
  files: FileChange[];
  hunks: Hunk[];
  groups: HunkGroup[];
  totals: {
    changedLines: number;
    attentionLines: number;
    reviewableLines: number;
    files: number;
  };
}

export type HunkStatus = "unreviewed" | "approved" | "flagged";

export interface StoredHunkState {
  status: HunkStatus;
  note?: string;
  reviewedAt?: string;
  via?: "single" | "group";
}

export interface ReviewStateFile {
  version: 1;
  updatedAt: string;
  hunks: Record<string, StoredHunkState>;
}

export interface StatsSnapshot {
  at: string;
  diffSpec: string;
  changedLines: number;
  reviewableLines: number;
  reviewedReviewableLines: number;
  flaggedHunks: number;
  debt: number;
  provenanceCoverage: number;
  coverageOnChangedLines?: number;
}

export interface CoverageSummary {
  covered: number;
  total: number;
  stale: boolean;
}

export interface ParsedHunk {
  id?: string;
  file: string;
  oldPath?: string;
  language: string;
  header: string;
  oldStart?: number;
  newStart?: number;
  lines: DiffLine[];
  addedLines: number;
  removedLines: number;
  parserReasons: RiskReason[];
  coverage?: CoverageSummary;
  defines?: string[];
  references?: string[];
  isRenameOnly?: boolean;
  isModeChange?: boolean;
  isBinary?: boolean;
  newMode?: string;
}

export interface ParsedDiff {
  files: FileChange[];
  hunks: ParsedHunk[];
}

export interface GitMeta {
  headSha: string;
  branch: string | null;
}

export interface IngestedDiff {
  repoRoot: string;
  diffSpec: string;
  patch: string;
  git: GitMeta;
}

export interface AnalyzeOptions {
  repoRoot: string;
  diffSpec: string;
  patch: string;
  git: GitMeta;
  provenance?: ProvenanceRef[];
  generatedPaths?: Set<string>;
  rules?: EffectiveRules;
  coverage?: CoverageData;
}

export type HunkWithState = Hunk & StoredHunkState;
export type ReviewModelWithState = Omit<ReviewModel, "hunks"> & { hunks: HunkWithState[] };

const riskReasonSchema: z.ZodType<RiskReason> = z.object({
  code: z.string(),
  label: z.string(),
  weight: z.number().min(-50).max(50),
  tier: z.union([z.literal("primary"), z.literal("nit")]).optional().default("primary"),
  line: z.number().optional(),
  evidence: z.string().max(120).optional()
});

export const coverageSummarySchema: z.ZodType<CoverageSummary> = z.object({
  covered: z.number().min(0),
  total: z.number().min(0),
  stale: z.boolean()
});

const provenanceSchema: z.ZodType<ProvenanceRef> = z.object({
  source: z.literal("claude-code"),
  sessionId: z.string(),
  transcriptPath: z.string(),
  matchedVia: z.union([z.literal("hook-log"), z.literal("transcript-scan")]),
  confidence: z.number().min(0).max(1),
  userPromptExcerpt: z.string().max(200).optional(),
  reasoningExcerpt: z.string().max(400).optional(),
  toolName: z.string().optional(),
  timestamp: z.string().optional()
});

export const diffLineSchema: z.ZodType<DiffLine> = z.object({
  kind: z.union([z.literal("add"), z.literal("del"), z.literal("context")]),
  text: z.string(),
  oldLine: z.number().optional(),
  newLine: z.number().optional()
});

export const hunkSchema: z.ZodType<Hunk> = z.object({
  id: z.string(),
  file: z.string(),
  oldPath: z.string().optional(),
  language: z.string(),
  header: z.string(),
  lines: z.array(diffLineSchema),
  addedLines: z.number(),
  removedLines: z.number(),
  category: z.union([
    z.literal("logic"),
    z.literal("tests"),
    z.literal("config"),
    z.literal("deps"),
    z.literal("docs"),
    z.literal("mechanical"),
    z.literal("generated"),
    z.literal("binary")
  ]),
  categoryReason: z.string(),
  risk: z.number().min(0).max(100),
  band: z.union([z.literal("high"), z.literal("medium"), z.literal("low"), z.literal("skim")]),
  reasons: z.array(riskReasonSchema),
  coverage: coverageSummarySchema.optional(),
  defines: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  readingRank: z.number().optional(),
  groupId: z.string(),
  oldStart: z.number().optional(),
  newStart: z.number().optional(),
  provenance: provenanceSchema.optional(),
  aiSummary: z.string().optional(),
  aiConcern: z.string().optional()
});

export const storedHunkStateSchema: z.ZodType<StoredHunkState> = z.object({
  status: z.union([z.literal("unreviewed"), z.literal("approved"), z.literal("flagged")]),
  note: z.string().optional(),
  reviewedAt: z.string().optional(),
  via: z.union([z.literal("single"), z.literal("group")]).optional()
});

export const reviewStateFileSchema: z.ZodType<ReviewStateFile> = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  hunks: z.record(storedHunkStateSchema)
});

export const statusUpdateSchema = z.object({
  status: z.union([z.literal("unreviewed"), z.literal("approved"), z.literal("flagged")]),
  note: z.string().optional()
});

export const statsSnapshotSchema: z.ZodType<StatsSnapshot> = z.object({
  at: z.string(),
  diffSpec: z.string(),
  changedLines: z.number(),
  reviewableLines: z.number(),
  reviewedReviewableLines: z.number(),
  flaggedHunks: z.number(),
  debt: z.number(),
  provenanceCoverage: z.number(),
  coverageOnChangedLines: z.number().optional()
});
