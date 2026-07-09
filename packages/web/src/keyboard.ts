import type { ReviewHunk } from "./types.js";

export interface KeyboardState {
  selectedId?: string;
  split: boolean;
  helpOpen: boolean;
  filterOpen: boolean;
  allIds: string[];
  hunks: ReviewHunk[];
  pendingG: boolean;
}

export type KeyboardCommand =
  | { type: "none" }
  | { type: "select"; id?: string; pendingG?: boolean }
  | { type: "status"; status: "approved" | "flagged" | "unreviewed" }
  | { type: "toggle-split" }
  | { type: "toggle-help" }
  | { type: "filter" }
  | { type: "refresh" }
  | { type: "cycle-sort" }
  | { type: "collapse-all"; collapsed: boolean }
  | { type: "focus-note" };

export function keyboardCommand(state: KeyboardState, key: string): KeyboardCommand {
  if (state.helpOpen && key === "Escape") {
    return { type: "toggle-help" };
  }
  if (state.pendingG && key === "g") {
    return { type: "select", id: state.allIds[0], pendingG: false };
  }
  if (key !== "g" && state.pendingG) {
    return { type: "select", id: state.selectedId, pendingG: false };
  }
  switch (key) {
    case "j":
      return { type: "select", id: relativeId(state, 1) };
    case "k":
      return { type: "select", id: relativeId(state, -1) };
    case "J":
      return { type: "select", id: nextFileId(state, 1) };
    case "K":
      return { type: "select", id: nextFileId(state, -1) };
    case "g":
      return { type: "select", id: state.selectedId, pendingG: true };
    case "G":
      return { type: "select", id: state.allIds.at(-1) };
    case "a":
      return { type: "status", status: "approved" };
    case "x":
      return { type: "status", status: "flagged" };
    case "u":
      return { type: "status", status: "unreviewed" };
    case "o":
      return { type: "toggle-split" };
    case "?":
      return { type: "toggle-help" };
    case "/":
      return { type: "filter" };
    case "r":
      return { type: "refresh" };
    case "s":
      return { type: "cycle-sort" };
    case "[":
      return { type: "collapse-all", collapsed: true };
    case "]":
      return { type: "collapse-all", collapsed: false };
    case "n":
      return { type: "focus-note" };
    default:
      return { type: "none" };
  }
}

export function nextUnreviewedAfter(hunks: ReviewHunk[], currentId: string): string | undefined {
  const index = Math.max(0, hunks.findIndex((hunk) => hunk.id === currentId));
  const ordered = [...hunks.slice(index + 1), ...hunks.slice(0, index + 1)];
  return ordered.find((hunk) => hunk.status === "unreviewed")?.id ?? hunks[index]?.id;
}

function relativeId(state: KeyboardState, delta: number): string | undefined {
  if (state.allIds.length === 0) {
    return undefined;
  }
  const index = Math.max(0, state.allIds.findIndex((id) => id === state.selectedId));
  const next = Math.min(state.allIds.length - 1, Math.max(0, index + delta));
  return state.allIds[next];
}

function nextFileId(state: KeyboardState, delta: number): string | undefined {
  const current = state.hunks.find((hunk) => hunk.id === state.selectedId);
  if (!current) {
    return relativeId(state, delta);
  }
  const index = state.hunks.findIndex((hunk) => hunk.id === current.id);
  const scan = delta > 0 ? state.hunks.slice(index + 1) : state.hunks.slice(0, index).reverse();
  return scan.find((hunk) => hunk.file !== current.file)?.id ?? current.id;
}
