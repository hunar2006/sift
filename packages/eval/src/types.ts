import type { Hunk, HunkCategory, ReviewModel, RiskBand } from "@sift-review/core";

export interface CorpusEntry {
  id: string;
  url: string;
  sha: string;
  license: string;
  language: string;
}

export interface Violation {
  repo: string;
  sha: string;
  invariant: string;
  detail: string;
  repro: string;
}

export interface CommitRun {
  repo: string;
  sha: string;
  parent: string;
  changedLines: number;
  durationMs: number;
  model: ReviewModel;
  modelSecond?: ReviewModel;
}

export interface SignalFire {
  code: string;
  label: string;
  repo: string;
  sha: string;
  hunkId: string;
  file: string;
  evidence?: string;
}

export interface RepoStats {
  id: string;
  commits: number;
  hunks: number;
  categories: Record<string, number>;
  bands: Record<string, number>;
  mechanical: number;
  renameGroups: number;
  timingsMs: number[];
  signalCounts: Map<string, number>;
  signalFires: Map<string, SignalFire[]>;
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  repos: RepoStats[];
  violations: Violation[];
  spotMechanical: SpotSample[];
  spotHigh: SpotSample[];
}

export interface SpotSample {
  repo: string;
  sha: string;
  hunkId: string;
  file: string;
  category: HunkCategory;
  categoryReason: string;
  band: RiskBand;
  risk: number;
  headline: string;
  patch: string;
}

export type ModelFingerprint = {
  ids: string[];
  categories: Array<{ id: string; category: string; reason: string }>;
  scores: Array<{ id: string; risk: number; band: string }>;
  digests: Array<{ id: string; headline: string }>;
};

export function fingerprintModel(model: ReviewModel): ModelFingerprint {
  return {
    ids: model.hunks.map((h) => h.id),
    categories: model.hunks.map((h) => ({ id: h.id, category: h.category, reason: h.categoryReason })),
    scores: model.hunks.map((h) => ({ id: h.id, risk: h.risk, band: h.band })),
    digests: model.hunks.map((h) => ({ id: h.id, headline: h.digest.headline }))
  };
}

export function patchForHunk(hunk: Hunk): string {
  return hunk.lines
    .map((line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      return `${prefix}${line.text}`;
    })
    .join("\n");
}
