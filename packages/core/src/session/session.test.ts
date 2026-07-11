import { describe, expect, it } from "vitest";
import type { StatsSnapshot } from "../types.js";
import { ReviewSession, sortReviewHunks, type SessionHunk, type SessionModel } from "./index.js";

const hunk = (overrides: Partial<SessionHunk> & Pick<SessionHunk, "id" | "file" | "risk">): SessionHunk => ({
  language: "typescript",
  header: "@@",
  lines: [],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  band: "low",
  reasons: [],
  groupId: "logic",
  digest: { headline: "Modifies `hunk`", details: [], source: "auto" },
  status: "unreviewed",
  ...overrides
});

const modelFor = (hunks: SessionHunk[]): SessionModel => ({
  meta: {
    siftVersion: "0.2.0",
    repoRoot: "/repo",
    diffSpec: "WORKTREE",
    generatedAt: "2026-01-01T00:00:00.000Z",
    git: { headSha: "abc", branch: "main" },
    astCoverage: 0
  },
  files: [],
  hunks,
  groups: [
    {
      id: "logic",
      title: "Logic",
      kind: "attention",
      order: 10,
      hunkIds: hunks.map((item) => item.id),
      totalAdded: hunks.length,
      totalRemoved: 0
    }
  ],
  totals: { changedLines: hunks.length, attentionLines: hunks.length, reviewableLines: hunks.length, files: hunks.length }
});

describe("sortReviewHunks", () => {
  it("supports risk, reading, and path modes", () => {
    const hunks = [
      hunk({ id: "use", file: "src/a-use.ts", risk: 60, readingRank: 1, newStart: 20 }),
      hunk({ id: "def", file: "src/z-defs.ts", risk: 10, readingRank: 0, newStart: 5 })
    ];
    const model = modelFor(hunks);

    expect(sortReviewHunks(hunks, model, "risk").map((item) => item.id)).toEqual(["use", "def"]);
    expect(sortReviewHunks(hunks, model, "reading").map((item) => item.id)).toEqual(["def", "use"]);
    expect(sortReviewHunks(hunks, model, "path").map((item) => item.id)).toEqual(["use", "def"]);
  });
});

describe("ReviewSession", () => {
  it("cycles sort mode and collapses hunks", () => {
    const session = new ReviewSession({ sortMode: "risk", model: modelFor([hunk({ id: "h1", file: "a.ts", risk: 10 })]) });
    session.cycleSortMode();
    session.toggleHunkCollapsed("h1");
    expect(session.getState().sortMode).toBe("reading");
    expect(session.getState().hunkCollapsed.h1).toBe(true);
  });

  it("tracks fresh live hunks, preserves the nearest selection, and clears fresh on visit or decision", () => {
    const previous = modelFor([
      hunk({ id: "one", file: "src/one.ts", risk: 40 }),
      hunk({ id: "gone", file: "src/gone.ts", risk: 30 })
    ]);
    const next = modelFor([
      hunk({ id: "one", file: "src/one.ts", risk: 40 }),
      hunk({ id: "fresh", file: "src/fresh.ts", risk: 80 })
    ]);
    const session = new ReviewSession({
      model: previous,
      stats: {} as StatsSnapshot,
      selectedId: "gone",
      freshIds: {},
      freshOnly: false
    });

    session.applyLiveData(next, {} as StatsSnapshot, ["fresh"], ["gone"]);
    expect(session.getState().selectedId).toBe("one");
    expect(session.getState().freshIds).toEqual({ fresh: true });
    expect(session.getState().toast).toBe("1 new hunks · 1 removed");

    session.setSelected("fresh");
    expect(session.getState().freshIds).toEqual({});
    session.applyLiveData(next, {} as StatsSnapshot, ["fresh"], []);
    session.setStatus("fresh", "approved");
    expect(session.getState().freshIds).toEqual({});
  });

  it("records and pops undo entries", () => {
    const session = new ReviewSession({
      model: modelFor([hunk({ id: "h1", file: "a.ts", risk: 10 })])
    });
    session.pushUndoEntry([{ hunkId: "h1", prevStatus: "unreviewed" }]);
    session.setStatus("h1", "approved");
    const result = session.popUndoEntry();
    expect(result.restore).toEqual([{ hunkId: "h1", prevStatus: "unreviewed" }]);
  });
});
