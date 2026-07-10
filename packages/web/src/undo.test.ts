import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAG_REASONS,
  MAX_FLAG_REASONS,
  UNDO_STACK_DEPTH,
  normalizeFlagReasons,
  popUndo,
  pushUndo,
  type UndoEntry
} from "./undo.js";

describe("undo stack", () => {
  it("restores a single decision", () => {
    const stack = pushUndo([], [{ hunkId: "h1", prevStatus: "unreviewed" }]);
    const result = popUndo(stack, new Set(["h1"]));
    expect(result.restore).toEqual([{ hunkId: "h1", prevStatus: "unreviewed" }]);
    expect(result.stack).toEqual([]);
    expect(result.message).toBeNull();
  });

  it("restores a compound group-approve entry in one pop", () => {
    const entry: UndoEntry = [
      { hunkId: "a", prevStatus: "unreviewed" },
      { hunkId: "b", prevStatus: "flagged", prevNote: "Needs tests" },
      { hunkId: "c", prevStatus: "unreviewed" }
    ];
    const result = popUndo(pushUndo([], entry), new Set(["a", "b", "c"]));
    expect(result.restore).toHaveLength(3);
    expect(result.restore[1]).toEqual({ hunkId: "b", prevStatus: "flagged", prevNote: "Needs tests" });
  });

  it("caps the stack depth", () => {
    let stack: UndoEntry[] = [];
    for (let index = 0; index < UNDO_STACK_DEPTH + 5; index += 1) {
      stack = pushUndo(stack, [{ hunkId: `h${index}`, prevStatus: "unreviewed" }]);
    }
    expect(stack).toHaveLength(UNDO_STACK_DEPTH);
    expect(stack[0]?.[0]?.hunkId).toBe("h5");
  });

  it("reports nothing to undo on an empty stack", () => {
    const result = popUndo([], new Set());
    expect(result.restore).toEqual([]);
    expect(result.message).toBe("Nothing to undo");
  });

  it("drops a stale entry whose hunk no longer exists after refresh", () => {
    const stack = pushUndo([], [{ hunkId: "gone", prevStatus: "approved" }]);
    const result = popUndo(stack, new Set(["other"]));
    expect(result.restore).toEqual([]);
    expect(result.message).toBe("Nothing to undo here");
    expect(result.stack).toEqual([]);
  });

  it("restores only surviving hunks from a partially-stale compound entry", () => {
    const entry: UndoEntry = [
      { hunkId: "kept", prevStatus: "unreviewed" },
      { hunkId: "gone", prevStatus: "unreviewed" }
    ];
    const result = popUndo(pushUndo([], entry), new Set(["kept"]));
    expect(result.restore).toEqual([{ hunkId: "kept", prevStatus: "unreviewed" }]);
    expect(result.message).toBeNull();
  });
});

describe("flag reasons config", () => {
  it("falls back to defaults when unset or empty", () => {
    expect(normalizeFlagReasons(undefined)).toEqual([...DEFAULT_FLAG_REASONS]);
    expect(normalizeFlagReasons([])).toEqual([...DEFAULT_FLAG_REASONS]);
    expect(normalizeFlagReasons(["   "])).toEqual([...DEFAULT_FLAG_REASONS]);
  });

  it("trims and caps custom reasons", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const normalized = normalizeFlagReasons(many);
    expect(normalized).toHaveLength(MAX_FLAG_REASONS);
    expect(normalized).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
