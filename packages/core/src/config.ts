import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_FLAG_REASONS = 6;

export const DEFAULT_FLAG_REASONS = [
  "Needs tests",
  "Security concern",
  "Doesn't match intent",
  "Unnecessary change"
];

/**
 * Read `.sift/config.json` → `flagReasons` (trimmed, non-empty, capped at
 * MAX_FLAG_REASONS). Falls back to the defaults when unset or invalid; never
 * throws so analysis stays fail-open.
 */
export async function loadFlagReasons(repoRoot: string): Promise<string[]> {
  try {
    const text = await fs.readFile(path.join(repoRoot, ".sift", "config.json"), "utf8");
    const parsed = JSON.parse(text) as { flagReasons?: unknown };
    if (Array.isArray(parsed.flagReasons)) {
      const cleaned = parsed.flagReasons
        .filter((reason): reason is string => typeof reason === "string")
        .map((reason) => reason.trim())
        .filter((reason) => reason.length > 0)
        .slice(0, MAX_FLAG_REASONS);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  } catch {
    // Missing or invalid config falls back to defaults.
  }
  return [...DEFAULT_FLAG_REASONS];
}
