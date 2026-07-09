import { describe, expect, it } from "vitest";
import type { ReviewHunk } from "./types.js";
import { keyboardCommand, nextUnreviewedAfter } from "./keyboard.js";

const hunk = (id: string, file: string, status: ReviewHunk["status"] = "unreviewed"): ReviewHunk => ({
  id,
  file,
  language: "typescript",
  header: "@@",
  lines: [],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  risk: 35,
  band: "low",
  reasons: [],
  groupId: "low-risk-logic",
  status
});

describe("keyboardCommand", () => {
  const hunks = [
    hunk("a", "a.ts", "approved"),
    { ...hunk("b", "a.ts"), band: "medium" as const, risk: 45 },
    { ...hunk("c", "b.ts"), band: "high" as const, risk: 80 },
    hunk("d", "c.ts")
  ];
  const state = {
    selectedId: "a",
    split: false,
    helpOpen: false,
    filterOpen: false,
    allIds: hunks.map((item) => item.id),
    hunks,
    pendingG: false
  };

  it("moves by hunk and file", () => {
    expect(keyboardCommand(state, "j")).toEqual({ type: "select", id: "b" });
    expect(keyboardCommand(state, "J")).toEqual({ type: "select", id: "c" });
  });

  it("uses n/p for unreviewed attention hunks", () => {
    expect(keyboardCommand(state, "n")).toEqual({ type: "select", id: "b" });
    expect(keyboardCommand({ ...state, selectedId: "b" }, "p")).toEqual({ type: "select", id: "c" });
  });

  it("emits review commands", () => {
    expect(keyboardCommand(state, "a")).toEqual({ type: "status", status: "approved" });
    expect(keyboardCommand(state, "x")).toEqual({ type: "status", status: "flagged" });
    expect(keyboardCommand(state, "u")).toEqual({ type: "status", status: "unreviewed" });
  });

  it("cycles sort mode from the keyboard", () => {
    expect(keyboardCommand(state, "s")).toEqual({ type: "cycle-sort" });
  });

  it("opens the palette and toggles current hunk collapse", () => {
    expect(keyboardCommand(state, "k", { ctrlKey: true })).toEqual({ type: "toggle-palette" });
    expect(keyboardCommand(state, " ", {})).toEqual({ type: "toggle-current-collapse" });
  });

  it("moves note focus to i", () => {
    expect(keyboardCommand(state, "i")).toEqual({ type: "focus-note" });
  });

  it("advances to next unreviewed after status", () => {
    expect(nextUnreviewedAfter([hunk("a", "a.ts", "approved"), hunk("b", "b.ts")], "a")).toBe("b");
  });
});
