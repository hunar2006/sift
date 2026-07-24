import { describe, expect, it } from "vitest";
import {
  hydrateFreshIds,
  mergeFreshIds,
  nextAttentionUnreviewed,
  nextFileHunkId,
  preserveNearestSelection,
  relativeHunkId
} from "./selection.js";
import type { SessionHunk } from "./queue.js";

function hunk(id: string, extra: Partial<SessionHunk> = {}): SessionHunk {
  return { id, status: "unreviewed", band: "low", file: `${id}.ts`, ...extra } as SessionHunk;
}

describe("preserveNearestSelection", () => {
  const previous = [hunk("a"), hunk("b"), hunk("c"), hunk("d")];

  it("keeps the current selection when it survives a refresh", () => {
    expect(preserveNearestSelection(previous, "b", new Set(["a", "b", "c"]))).toBe("b");
  });

  it("falls forward to the next surviving hunk when the selection vanishes", () => {
    // b removed; nearest below is c.
    expect(preserveNearestSelection(previous, "b", new Set(["a", "c", "d"]))).toBe("c");
  });

  it("falls back to the nearest earlier hunk when nothing below survives", () => {
    // c removed and nothing after it survives; nearest above is b.
    expect(preserveNearestSelection(previous, "c", new Set(["a", "b"]))).toBe("b");
  });

  it("returns undefined when the queue is empty", () => {
    expect(preserveNearestSelection(previous, "b", new Set())).toBeUndefined();
  });

  it("scans from the top when the previous selection is unknown", () => {
    expect(preserveNearestSelection(previous, undefined, new Set(["c", "d"]))).toBe("c");
  });
});

describe("relativeHunkId", () => {
  const ids = ["a", "b", "c"];

  it("moves by the delta", () => {
    expect(relativeHunkId(ids, "a", 1)).toBe("b");
    expect(relativeHunkId(ids, "b", -1)).toBe("a");
  });

  it("clamps at both ends instead of wrapping", () => {
    expect(relativeHunkId(ids, "a", -1)).toBe("a");
    expect(relativeHunkId(ids, "c", 5)).toBe("c");
  });

  it("returns undefined for an empty list", () => {
    expect(relativeHunkId([], "a", 1)).toBeUndefined();
  });
});

describe("nextFileHunkId", () => {
  const hunks = [hunk("a1", { file: "a.ts" }), hunk("a2", { file: "a.ts" }), hunk("b1", { file: "b.ts" })];

  it("jumps to the first hunk of the next file", () => {
    expect(nextFileHunkId(hunks, "a1", 1)).toBe("b1");
  });

  it("stays put when there is no further file in that direction", () => {
    expect(nextFileHunkId(hunks, "b1", 1)).toBe("b1");
  });

  it("jumps back to the previous file", () => {
    expect(nextFileHunkId(hunks, "b1", -1)).toBe("a2");
  });
});

describe("nextAttentionUnreviewed", () => {
  const hunks = [
    hunk("a", { band: "high", status: "approved" }),
    hunk("b", { band: "low", status: "unreviewed" }),
    hunk("c", { band: "medium", status: "unreviewed" }),
    hunk("d", { band: "high", status: "unreviewed" })
  ];

  it("skips low-band and already-decided hunks going forward", () => {
    // From a: b is low (skip), c is medium+unreviewed -> c.
    expect(nextAttentionUnreviewed(hunks, "a", 1)).toBe("c");
  });

  it("wraps around to find the earlier attention hunk going backward", () => {
    expect(nextAttentionUnreviewed(hunks, "a", -1)).toBe("d");
  });

  it("returns the current selection when nothing else needs attention", () => {
    const decided = [hunk("x", { band: "high", status: "approved" })];
    expect(nextAttentionUnreviewed(decided, "x", 1)).toBe("x");
  });
});

describe("fresh-id tracking", () => {
  it("keeps only ids that still exist after a refresh", () => {
    const merged = mergeFreshIds({ old: true }, ["new", "gone"], new Set(["old", "new"]));
    expect(merged).toEqual({ old: true, new: true });
  });

  it("marks hunks first seen this session but not yet visited", () => {
    const hunks = [
      { id: "seen-before", firstSeenAt: "2020-01-01T00:00:00Z" },
      { id: "fresh", firstSeenAt: "2020-06-01T00:00:00Z" },
      { id: "already-visited", firstSeenAt: "2020-06-01T00:00:00Z" }
    ];
    const fresh = hydrateFreshIds(hunks, {}, "2020-05-01T00:00:00Z", new Set(["already-visited"]));
    expect(fresh).toEqual({ fresh: true });
  });
});
