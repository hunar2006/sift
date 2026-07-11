import { describe, expect, it } from "vitest";
import { sortReviewHunks, useReviewStore } from "./store.js";
import type { ApiMeta, ReviewHunk, ReviewModel } from "./types.js";
import type { StatsSnapshot } from "@sift-review/core";

const hunk = (overrides: Partial<ReviewHunk> & Pick<ReviewHunk, "id" | "file" | "risk">): ReviewHunk => ({
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

const modelFor = (hunks: ReviewHunk[]): ReviewModel => ({
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

describe("web store adapter", () => {
  it("supports risk, reading, and path modes via shared session", () => {
    const hunks = [
      hunk({ id: "use", file: "src/a-use.ts", risk: 60, readingRank: 1, newStart: 20 }),
      hunk({ id: "def", file: "src/z-defs.ts", risk: 10, readingRank: 0, newStart: 5 })
    ];
    const model = modelFor(hunks);

    expect(sortReviewHunks(hunks, model, "risk").map((item) => item.id)).toEqual(["use", "def"]);
    expect(sortReviewHunks(hunks, model, "reading").map((item) => item.id)).toEqual(["def", "use"]);
    expect(sortReviewHunks(hunks, model, "path").map((item) => item.id)).toEqual(["use", "def"]);
  });

  it("stores cockpit toggles used by keyboard and palette actions", () => {
    useReviewStore.setState({
      paletteOpen: false,
      timelineOpen: false,
      statsOpen: false,
      sortMode: "risk",
      hunkCollapsed: {},
      nitsOpen: false,
      theme: "dark"
    });

    useReviewStore.getState().setPaletteOpen(true);
    useReviewStore.getState().setTimelineOpen(true);
    useReviewStore.getState().setStatsOpen(true);
    useReviewStore.getState().cycleSortMode();
    useReviewStore.getState().toggleHunkCollapsed("h1");
    useReviewStore.getState().toggleNits();
    useReviewStore.getState().toggleTheme();

    expect(useReviewStore.getState().paletteOpen).toBe(true);
    expect(useReviewStore.getState().timelineOpen).toBe(true);
    expect(useReviewStore.getState().statsOpen).toBe(true);
    expect(useReviewStore.getState().sortMode).toBe("reading");
    expect(useReviewStore.getState().hunkCollapsed.h1).toBe(true);
    expect(useReviewStore.getState().nitsOpen).toBe(true);
    expect(useReviewStore.getState().theme).toBe("light");
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
    useReviewStore.getState().setData(previous, {} as StatsSnapshot, meta());
    useReviewStore.getState().setSelected("gone");
    useReviewStore.getState().applyLiveData(next, {} as StatsSnapshot, meta(), ["fresh"], ["gone"]);
    expect(useReviewStore.getState().selectedId).toBe("one");
    expect(useReviewStore.getState().freshIds).toEqual({ fresh: true });
    expect(useReviewStore.getState().toast).toBe("1 new hunks · 1 removed");

    useReviewStore.getState().setSelected("fresh");
    expect(useReviewStore.getState().freshIds).toEqual({});
    useReviewStore.getState().applyLiveData(next, {} as StatsSnapshot, meta(), ["fresh"], []);
    useReviewStore.getState().setStatus("fresh", "approved");
    expect(useReviewStore.getState().freshIds).toEqual({});
  });
});

function meta(): ApiMeta {
  return {
    version: "0.4.0",
    repoRoot: "/repo",
    diffSpec: "WORKTREE",
    astCoverage: 0,
    counts: { changedLines: 0, attentionLines: 0, reviewableLines: 0, files: 0 },
    provenanceSourcesFound: false,
    aiRan: false,
    watchActive: true
  };
}
