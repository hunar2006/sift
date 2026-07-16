export type KeymapScope = "web" | "tui" | "shared";
export type KeymapTarget = Exclude<KeymapScope, "shared">;

export interface KeymapEntry {
  id: string;
  key: string;
  scope: KeymapScope;
  label: string;
  paletteAction?: string;
}

/**
 * The user-visible shortcut contract. `shared` entries apply to both review
 * surfaces; an explicitly scoped entry documents an intentional difference.
 */
export const KEYMAP: readonly KeymapEntry[] = [
  { id: "shared-next-hunk", key: "j", scope: "shared", label: "Next hunk" },
  { id: "shared-prev-hunk", key: "k", scope: "shared", label: "Previous hunk" },
  { id: "shared-first-hunk", key: "g", scope: "shared", label: "First hunk" },
  { id: "shared-last-hunk", key: "G", scope: "shared", label: "Last hunk" },
  { id: "shared-next-attention", key: "n", scope: "shared", label: "Next unreviewed attention hunk", paletteAction: "next-unreviewed" },
  { id: "shared-prev-attention", key: "p", scope: "shared", label: "Previous unreviewed attention hunk", paletteAction: "prev-unreviewed" },
  { id: "shared-approve", key: "a", scope: "shared", label: "Approve current hunk", paletteAction: "approve" },
  { id: "shared-flag", key: "x", scope: "shared", label: "Flag current hunk", paletteAction: "flag" },
  { id: "shared-unreview", key: "u", scope: "shared", label: "Mark current hunk unreviewed", paletteAction: "unreview" },
  { id: "shared-undo", key: "z", scope: "shared", label: "Undo latest decision" },
  { id: "shared-redo", key: "Shift+Z", scope: "shared", label: "Redo latest decision" },
  { id: "shared-help", key: "?", scope: "shared", label: "Open shortcuts", paletteAction: "help" },
  { id: "shared-revert", key: "R", scope: "shared", label: "Revert current file", paletteAction: "revert-file" },

  { id: "web-palette", key: "Ctrl/Cmd+K", scope: "web", label: "Open command palette" },
  { id: "web-search", key: "Ctrl/Cmd+F", scope: "web", label: "Search diff text", paletteAction: "search" },
  { id: "web-next-file", key: "J", scope: "web", label: "Next file" },
  { id: "web-prev-file", key: "K", scope: "web", label: "Previous file" },
  { id: "web-focus-note", key: "i", scope: "web", label: "Focus note" },
  { id: "web-focus", key: "f", scope: "web", label: "Enter focus mode", paletteAction: "focus" },
  { id: "web-flagged-only", key: "F", scope: "web", label: "Show flagged only", paletteAction: "show-flagged" },
  { id: "web-editor", key: "e", scope: "web", label: "Open current hunk in editor" },
  { id: "web-refresh", key: "r", scope: "web", label: "Refresh review" },
  { id: "web-collapse-current", key: "Space", scope: "web", label: "Collapse current hunk" },
  { id: "web-split", key: "o", scope: "web", label: "Toggle split diff", paletteAction: "toggle-split" },
  { id: "web-timeline", key: "t", scope: "web", label: "Open timeline", paletteAction: "timeline" },
  { id: "web-theme", key: "T", scope: "web", label: "Cycle theme", paletteAction: "toggle-theme" },
  { id: "web-sort", key: "s", scope: "web", label: "Cycle sort mode", paletteAction: "cycle-sort" },
  { id: "web-filter", key: "/", scope: "web", label: "Focus filter" },
  { id: "web-collapse-all", key: "[", scope: "web", label: "Collapse all groups" },
  { id: "web-expand-all", key: "]", scope: "web", label: "Expand all groups" },
  { id: "web-close", key: "Esc", scope: "web", label: "Close overlay" },

  { id: "tui-arrow-move", key: "↑/↓", scope: "tui", label: "Move selection" },
  { id: "tui-group-approve", key: "A", scope: "tui", label: "Approve current group" },
  { id: "tui-expand", key: "Space", scope: "tui", label: "Expand patch" },
  { id: "tui-editor", key: "o", scope: "tui", label: "Open selected hunk in editor" },
  { id: "tui-flag-note", key: "i", scope: "tui", label: "Enter custom flag note" },
  { id: "tui-quit", key: "q", scope: "tui", label: "Quit review" }
];

export function keymapEntries(target: KeymapTarget): readonly KeymapEntry[] {
  return KEYMAP.filter((entry) => entry.scope === "shared" || entry.scope === target);
}

export function findKeymapEntry(id: string): KeymapEntry | undefined {
  return KEYMAP.find((entry) => entry.id === id);
}

export function shortcutForPaletteAction(action: string): string | undefined {
  return keymapEntries("web").find((entry) => entry.paletteAction === action)?.key;
}

export function keymapKeys(ids: readonly string[]): string {
  return ids.map((id) => {
    const entry = findKeymapEntry(id);
    if (!entry) {
      throw new Error(`Unknown keymap entry: ${id}`);
    }
    return entry.key;
  }).join("/");
}

export function formatKeymapLine(ids: readonly string[]): string {
  const groups: Array<{ label: string; keys: string[] }> = [];
  for (const id of ids) {
    const entry = findKeymapEntry(id);
    if (!entry) {
      throw new Error(`Unknown keymap entry: ${id}`);
    }
    const group = groups.find((candidate) => candidate.label === entry.label);
    if (group) {
      group.keys.push(entry.key);
    } else {
      groups.push({ label: entry.label, keys: [entry.key] });
    }
  }
  return groups.map((group) => `${group.keys.join("/")} ${group.label}`).join(" | ");
}
