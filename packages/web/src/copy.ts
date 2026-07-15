export const FIRST_RUN_OVERLAY_STEPS = ["Move", "Decide", "Skim groups", "Palette"] as const;

export const HELP_OVERLAY_LINES = [
  "j/k hunk | J/K",
  "n/p | a/x decide",
  "u reset | i note",
  "z undo | Shift+Z redo",
  "f focus | F flagged | R revert",
  "Ctrl+F | e editor | r refresh",
  "space collapse | o split",
  "? help | Esc close"
] as const;

export function copyWordCount(lines: readonly string[]): number {
  return lines.join(" ").match(/[A-Za-z0-9/]+/gu)?.length ?? 0;
}
