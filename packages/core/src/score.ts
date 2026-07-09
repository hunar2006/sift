import type { HunkCategory, RiskBand, RiskReason } from "./types.js";

export const BASE_SCORE_BY_CATEGORY: Record<HunkCategory, number> = {
  logic: 35,
  config: 25,
  tests: 20,
  deps: 15,
  binary: 10,
  docs: 5,
  mechanical: 0,
  generated: 0
};

export const SIGNAL_WEIGHTS = {
  SEC_PATH: 25,
  SECRET_LIKE: 40,
  TLS_DISABLED: 30,
  DANGEROUS_API_SITE: 20,
  DANGEROUS_API_CAP: 40,
  SQL_CONCAT: 20,
  TEST_WEAKENED: 25,
  SKIPPED_TEST: 20,
  ERROR_SWALLOWED: 15,
  CI_WORKFLOW: 15,
  MIGRATION_BASE: 20,
  MIGRATION_DROP: 10,
  MIGRATION_UNSCOPED_DELETE: 10,
  ENV_FILE: 30,
  NEW_DEPENDENCY_SITE: 15,
  NEW_DEPENDENCY_CAP: 30,
  PUBLIC_API: 15,
  LARGE_NOVEL_UNIT: 25,
  LARGE_NOVEL_CAP_LINES: 300,
  MODE_EXEC: 10,
  BIG_DELETION: 10,
  DEBUG_LEFTOVER_SITE: 5,
  DEBUG_LEFTOVER_CAP: 10,
  TODO_ADDED: 5,
  TRUNCATED_LINE: 10,
  SUBMODULE_BUMP: 10
} as const;

export function clampRisk(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function bandForRisk(risk: number): RiskBand {
  if (risk >= 70) {
    return "high";
  }
  if (risk >= 40) {
    return "medium";
  }
  if (risk >= 10) {
    return "low";
  }
  return "skim";
}

export function scoreHunk(category: HunkCategory, reasons: RiskReason[]): { risk: number; band: RiskBand } {
  const risk = clampRisk(
    BASE_SCORE_BY_CATEGORY[category] + reasons.reduce((sum, reason) => sum + reason.weight, 0)
  );
  return { risk, band: bandForRisk(risk) };
}
