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
  SECRET_ENTROPY: 35,
  SECRET_COMBINED_CAP: 50,
  TLS_DISABLED: 45,
  DANGEROUS_API_SITE: 20,
  DANGEROUS_API_CAP: 40,
  DANGEROUS_API_TEST_SITE: 10,
  DANGEROUS_API_TEST_CAP: 20,
  SQL_CONCAT: 20,
  SQL_CONCAT_TEST: 10,
  TEST_WEAKENED: 25,
  SKIPPED_TEST: 20,
  ERROR_SWALLOWED: 8,
  CI_WORKFLOW: 15,
  MIGRATION_BASE: 20,
  MIGRATION_DROP: 15,
  MIGRATION_UNSCOPED_DELETE: 15,
  MIGRATION_CAP: 50,
  ENV_FILE: 30,
  NEW_DEPENDENCY_SITE: 15,
  NEW_DEPENDENCY_CAP: 30,
  TYPOSQUAT_SUSPECT: 35,
  CONCURRENCY_HAZARD_SITE: 20,
  CONCURRENCY_HAZARD_CAP: 30,
  AGENT_GUIDANCE_EDIT: 20,
  NOVEL_UNTESTED: 8,
  NOVEL_UNTESTED_COVERAGE_CONFIRMED: 12,
  UNTESTED_CHANGE: 10,
  COVERED_CHANGE: -10,
  PUBLIC_API: 15,
  MODE_EXEC: 10,
  BIG_DELETION: 10,
  DEBUG_LEFTOVER_SITE: 2,
  DEBUG_LEFTOVER_CAP: 4,
  TODO_ADDED: 3,
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
