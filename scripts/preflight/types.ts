export type StageId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type StageStatus = "PASS" | "FAIL" | "SKIP";

export interface StageResult {
  id: StageId;
  name: string;
  status: StageStatus;
  summary: string;
  details: string[];
  durationMs: number;
  metrics?: Record<string, number | string>;
}

export interface PreflightOptions {
  fast: boolean;
  json: boolean;
  only?: StageId;
}

export interface PreflightContext {
  root: string;
  options: PreflightOptions;
  artifactsDir: string;
}

export type Stage = (context: PreflightContext) => Promise<StageResult>;

export interface MechanicalSample {
  repo: string;
  sha: string;
  hunkId: string;
  file: string;
  categoryReason: string;
  band: string;
  risk: number;
  headline: string;
  patch: string;
}
