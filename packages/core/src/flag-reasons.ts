export const MAX_FLAG_REASONS = 6;

export const DEFAULT_FLAG_REASONS = [
  "Needs tests",
  "Security concern",
  "Doesn't match intent",
  "Unnecessary change"
] as const;

/** Validate and normalize a user-configured flag-reason list (cap MAX_FLAG_REASONS). */
export function normalizeFlagReasons(reasons: readonly string[] | undefined): string[] {
  if (!reasons || reasons.length === 0) {
    return [...DEFAULT_FLAG_REASONS];
  }
  const cleaned = reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)
    .slice(0, MAX_FLAG_REASONS);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_FLAG_REASONS];
}
