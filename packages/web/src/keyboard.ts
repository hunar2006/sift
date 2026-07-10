import type { ReviewHunk } from "./types.js";

export interface KeyboardState {
  selectedId?: string;
  split: boolean;
  helpOpen: boolean;
  paletteOpen?: boolean;
  timelineOpen?: boolean;
  statsOpen?: boolean;
  filterOpen: boolean;
  allIds: string[];
  hunks: ReviewHunk[];
  pendingG: boolean;
}

export interface KeyboardModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export type KeyboardCommand =
  | { type: "none" }
  | { type: "select"; id?: string; pendingG?: boolean }
  | { type: "status"; status: "approved" | "flagged" | "unreviewed" }
  | { type: "toggle-split" }
  | { type: "toggle-help" }
  | { type: "toggle-palette" }
  | { type: "toggle-timeline" }
  | { type: "toggle-stats" }
  | { type: "toggle-theme" }
  | { type: "toggle-current-collapse" }
  | { type: "filter" }
  | { type: "refresh" }
  | { type: "cycle-sort" }
  | { type: "collapse-all"; collapsed: boolean }
  | { type: "focus-note" }
  | { type: "undo" }
  | { type: "toggle-focus" }
  | { type: "open-editor" };

export function keyboardCommand(
  state: KeyboardState,
  key: string,
  modifiers: KeyboardModifiers = {}
): KeyboardCommand {
  if ((modifiers.ctrlKey || modifiers.metaKey) && key.toLowerCase() === "k") {
    return { type: "toggle-palette" };
  }
  if (state.paletteOpen) {
    return key === "Escape" ? { type: "toggle-palette" } : { type: "none" };
  }
  if (state.helpOpen && key === "Escape") {
    return { type: "toggle-help" };
  }
  if (state.timelineOpen && key === "Escape") {
    return { type: "toggle-timeline" };
  }
  if (state.statsOpen && key === "Escape") {
    return { type: "toggle-stats" };
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
    case "t":
      return { type: "toggle-timeline" };
    case "T":
      return { type: "toggle-theme" };
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
      return { type: "select", id: nextAttentionUnreviewed(state, 1) };
    case "p":
      return { type: "select", id: nextAttentionUnreviewed(state, -1) };
    case "i":
      return { type: "focus-note" };
    case "z":
      return { type: "undo" };
    case "f":
      return { type: "toggle-focus" };
    case "e":
      return { type: "open-editor" };
    case " ":
    case "Spacebar":
      return { type: "toggle-current-collapse" };
    default:
      return { type: "none" };
  }
}

export function nextUnreviewedAfter(hunks: ReviewHunk[], currentId: string): string | undefined {
  const index = Math.max(0, hunks.findIndex((hunk) => hunk.id === currentId));
  const ordered = [...hunks.slice(index + 1), ...hunks.slice(0, index + 1)];
  return ordered.find((hunk) => hunk.status === "unreviewed")?.id ?? hunks[index]?.id;
}

export function nextAttentionUnreviewed(state: KeyboardState, delta: 1 | -1): string | undefined {
  const hunks = state.hunks;
  if (hunks.length === 0) {
    return undefined;
  }
  const currentIndex = Math.max(0, hunks.findIndex((hunk) => hunk.id === state.selectedId));
  const forward = [...hunks.slice(currentIndex + 1), ...hunks.slice(0, currentIndex + 1)];
  const backward = [...hunks.slice(0, currentIndex).reverse(), ...hunks.slice(currentIndex).reverse()];
  const ordered = delta > 0 ? forward : backward;
  return ordered.find(isUnreviewedAttentionHunk)?.id ?? state.selectedId;
}

function isUnreviewedAttentionHunk(hunk: ReviewHunk): boolean {
  return hunk.status === "unreviewed" && (hunk.band === "high" || hunk.band === "medium");
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
