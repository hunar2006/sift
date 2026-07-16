import { keymapKeys } from "@sift-review/core/keymap";

export const FIRST_RUN_OVERLAY_STEPS = ["Move", "Decide", "Skim groups", "Palette"] as const;

interface HelpKeymapGroup {
  ids: readonly string[];
  label?: string;
}

export const WEB_HELP_KEYMAP_ROWS: readonly (readonly HelpKeymapGroup[])[] = [
  [{ ids: ["shared-next-hunk", "shared-prev-hunk"], label: "hunk" }, { ids: ["web-next-file", "web-prev-file"] }],
  [{ ids: ["shared-next-attention", "shared-prev-attention"] }, { ids: ["shared-approve", "shared-flag"], label: "decide" }],
  [{ ids: ["shared-unreview"], label: "reset" }, { ids: ["web-focus-note"], label: "note" }],
  [{ ids: ["shared-undo"], label: "undo" }, { ids: ["shared-redo"], label: "redo" }],
  [{ ids: ["web-focus"], label: "focus" }, { ids: ["web-flagged-only"], label: "flagged" }, { ids: ["shared-revert"], label: "revert" }],
  [{ ids: ["web-search"] }, { ids: ["web-editor"], label: "editor" }, { ids: ["web-refresh"], label: "refresh" }],
  [{ ids: ["web-collapse-current"], label: "collapse" }, { ids: ["web-split"], label: "split" }],
  [{ ids: ["shared-help"], label: "help" }, { ids: ["web-close"], label: "close" }]
];

export function formatWebHelpRow(groups: readonly HelpKeymapGroup[]): string {
  return groups
    .map(({ ids, label }) => `${keymapKeys(ids)}${label ? ` ${label}` : ""}`)
    .join(" | ");
}

export const HELP_OVERLAY_LINES = WEB_HELP_KEYMAP_ROWS.map((row) => formatWebHelpRow(row));

export function copyWordCount(lines: readonly string[]): number {
  return lines.join(" ").match(/[A-Za-z0-9/]+/gu)?.length ?? 0;
}
