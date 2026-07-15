import { z } from "zod";
import type { CoverageData } from "./coverage-types.js";
import type { EffectiveRules } from "./rules-types.js";

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
  segments?: Array<{ text: string; changed: boolean }>;
}

export interface ProvenanceRef {
  source: string;
  sessionId: string;
  transcriptPath: string;
  matchedVia: "hook-log" | "transcript-scan" | "generic-jsonl";
  confidence: number;
  modelFamily?: "anthropic" | "openai" | "unknown";
  userPromptExcerpt?: string;
  reasoningExcerpt?: string;
  toolName?: string;
  timestamp?: string;
}

export interface AiAnnotation {
  provider: "anthropic" | "openai" | "unknown";
  model: string;
  summary: string;
  concern: string | null;
  drift: string | null;
}

export interface RenameCandidate {
  from: string;
  to: string;
}

export interface HunkDigest {
  headline: string;
  details: string[];
  source: "auto";
}

export interface ReviewBrief {
  story: string;
  readingHint: string | null;
  provider: "anthropic" | "openai";
  model: string;
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
  removedDefines?: string[];
  references?: string[];
  enclosingSymbol?: string;
  readingRank?: number;
  groupId: string;
  oldStart?: number;
  newStart?: number;
  provenance?: ProvenanceRef;
  aiAnnotations?: AiAnnotation[];
  aiSummary?: string;
  aiConcern?: string;
  isRenameOnly?: boolean;
  isModeChange?: boolean;
  isBinary?: boolean;
  newMode?: string;
  firstSeenAt?: string;
  digest: HunkDigest;
}

export type UndigestedHunk = Omit<Hunk, "digest">;

export interface HunkGroup {
  id: string;
  title: string;
  kind: "attention" | "skim";
  order: number;
  hunkIds: string[];
  totalAdded: number;
  totalRemoved: number;
  digest?: string;
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
    astCoverage: number;
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
  via?: "single" | "group" | "undo" | "redo" | "targeted-undo";
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
  removedDefines?: string[];
  references?: string[];
  enclosingSymbol?: string;
  astFormatOnly?: boolean;
  astImportReorderOnly?: boolean;
  renameCandidates?: RenameCandidate[];
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
  newFileSources?: ReadonlyMap<string, string>;
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
  source: z.string(),
  sessionId: z.string(),
  transcriptPath: z.string(),
  matchedVia: z.union([z.literal("hook-log"), z.literal("transcript-scan"), z.literal("generic-jsonl")]),
  confidence: z.number().min(0).max(1),
  modelFamily: z.union([z.literal("anthropic"), z.literal("openai"), z.literal("unknown")]).optional(),
  userPromptExcerpt: z.string().max(200).optional(),
  reasoningExcerpt: z.string().max(400).optional(),
  toolName: z.string().optional(),
  timestamp: z.string().optional()
});

export const aiAnnotationSchema: z.ZodType<AiAnnotation> = z.object({
  provider: z.union([z.literal("anthropic"), z.literal("openai"), z.literal("unknown")]),
  model: z.string(),
  summary: z.string().max(180),
  concern: z.string().nullable(),
  drift: z.string().max(220).nullable()
});

export const diffLineSchema: z.ZodType<DiffLine> = z.object({
  kind: z.union([z.literal("add"), z.literal("del"), z.literal("context")]),
  text: z.string(),
  oldLine: z.number().optional(),
  newLine: z.number().optional(),
  segments: z.array(z.object({ text: z.string(), changed: z.boolean() })).optional()
});

export const hunkDigestSchema: z.ZodType<HunkDigest> = z.object({
  headline: z.string().min(1).max(90),
  details: z.array(z.string().max(100)).max(3),
  source: z.literal("auto")
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
  removedDefines: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  enclosingSymbol: z.string().optional(),
  readingRank: z.number().optional(),
  groupId: z.string(),
  oldStart: z.number().optional(),
  newStart: z.number().optional(),
  provenance: provenanceSchema.optional(),
  aiAnnotations: z.array(aiAnnotationSchema).optional(),
  aiSummary: z.string().optional(),
  aiConcern: z.string().optional(),
  isRenameOnly: z.boolean().optional(),
  isModeChange: z.boolean().optional(),
  isBinary: z.boolean().optional(),
  newMode: z.string().optional(),
  firstSeenAt: z.string().datetime().optional(),
  digest: hunkDigestSchema
});

export const storedHunkStateSchema: z.ZodType<StoredHunkState> = z.object({
  status: z.union([z.literal("unreviewed"), z.literal("approved"), z.literal("flagged")]),
  note: z.string().optional(),
  reviewedAt: z.string().optional(),
  via: z.union([z.literal("single"), z.literal("group"), z.literal("undo"), z.literal("redo"), z.literal("targeted-undo")]).optional()
});

export const reviewStateFileSchema: z.ZodType<ReviewStateFile> = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  hunks: z.record(storedHunkStateSchema)
});

export const statusUpdateSchema = z.object({
  status: z.union([z.literal("unreviewed"), z.literal("approved"), z.literal("flagged")]),
  note: z.string().optional(),
  via: z.union([z.literal("single"), z.literal("group"), z.literal("undo"), z.literal("redo"), z.literal("targeted-undo")]).optional()
});

export const openHunkSchema = z.object({
  hunkId: z.string().min(1).max(200)
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
