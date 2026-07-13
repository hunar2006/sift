export const FIRST_RUN_OVERLAY_STEPS = ["Move", "Decide", "Skim groups", "Palette"] as const;

export const HELP_OVERLAY_LINES = [
  "j/k hunk | J/K file",
  "n/p attention | a/x decide",
  "u reset | i note",
  "space collapse | o split",
  "/ filter | r refresh",
  "? help | Esc close"
] as const;

export function copyWordCount(lines: readonly string[]): number {
  return lines.join(" ").match(/[A-Za-z0-9/]+/gu)?.length ?? 0;
}
