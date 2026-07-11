import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { discoverRepoRoot, ensureSiftDir, siftDir } from "@sift-review/core";

const CONFIG_STARTER = `{
  "_comment": "Sift local config. Safe to edit. Unknown keys are ignored.",
  "editor": "cursor",
  "coverage": null,
  "flagReasons": [
    "Needs tests",
    "Security concern",
    "Doesn't match intent",
    "Unnecessary change"
  ]
}
`;

const RULES_STARTER = `# Sift rules — examples below are commented out.
# Uncomment and edit. See docs for glob + pattern forms.
version: 1

# rules:
#   - id: BAN_LEGACY_AUTH
#     message: Uses legacy auth client
#     paths: ["src/**"]
#     pattern: "legacyAuth\\\\."
#     weight: 20
#
#   - id: REQUIRE_OWNER
#     message: Touches ownership-sensitive path
#     paths: ["infra/**"]
#     pattern: "."
#     weight: 10
#
# adjust:
#   - code: ERROR_SWALLOWED
#     weight: 8
#
# suppress:
#   - code: DEBUG_LEFTOVER
#     paths: ["**/*.test.ts"]
`;

export async function runInit(cwd = process.cwd()): Promise<string[]> {
  const repoRoot = await discoverRepoRoot(cwd);
  await ensureSiftDir(repoRoot);
  const dir = siftDir(repoRoot);
  const notes: string[] = [];

  const configPath = path.join(dir, "config.json");
  if (existsSync(configPath)) {
    notes.push(`exists  ${path.relative(repoRoot, configPath)}`);
  } else {
    await fs.writeFile(configPath, CONFIG_STARTER, "utf8");
    notes.push(`wrote   ${path.relative(repoRoot, configPath)}`);
  }

  const rulesPath = path.join(dir, "rules.yml");
  if (existsSync(rulesPath)) {
    notes.push(`exists  ${path.relative(repoRoot, rulesPath)}`);
  } else {
    await fs.writeFile(rulesPath, RULES_STARTER, "utf8");
    notes.push(`wrote   ${path.relative(repoRoot, rulesPath)}`);
  }

  return notes;
}

export function initQuickstart(): string {
  return [
    "Quickstart:",
    "  sift            # web cockpit",
    "  sift tui         # terminal cockpit",
    "  sift --watch     # live refresh",
    "  ?                # help inside web/TUI"
  ].join("\n");
}
