import { describe, expect, it } from "vitest";
import { deriveDecisionProgress, deriveLiveStats, sortReviewHunks, useReviewStore } from "./store.js";
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
  totals: {
    changedLines: hunks.reduce((total, item) => total + item.addedLines + item.removedLines, 0),
    attentionLines: hunks.reduce((total, item) => total + item.addedLines + item.removedLines, 0),
    reviewableLines: hunks.reduce((total, item) => total + item.addedLines + item.removedLines, 0),
    files: hunks.length
  }
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
      theme: "graphite",
      codeSize: 12
    });

    useReviewStore.getState().setPaletteOpen(true);
    useReviewStore.getState().setTimelineOpen(true);
    useReviewStore.getState().setStatsOpen(true);
    useReviewStore.getState().cycleSortMode();
    useReviewStore.getState().toggleHunkCollapsed("h1");
    useReviewStore.getState().toggleNits();
    useReviewStore.getState().toggleTheme();
    useReviewStore.getState().cycleCodeSize();

    expect(useReviewStore.getState().paletteOpen).toBe(true);
    expect(useReviewStore.getState().timelineOpen).toBe(true);
    expect(useReviewStore.getState().statsOpen).toBe(true);
    expect(useReviewStore.getState().sortMode).toBe("reading");
    expect(useReviewStore.getState().hunkCollapsed.h1).toBe(true);
    expect(useReviewStore.getState().nitsOpen).toBe(true);
    expect(useReviewStore.getState().theme).toBe("assay");
    expect(useReviewStore.getState().codeSize).toBe(13);
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

  it("BUG-05-counter-invariant-after-mixed-decisions", () => {
    const model = modelFor([
      hunk({ id: "approved", file: "src/a.ts", risk: 60, status: "approved", addedLines: 2, removedLines: 1 }),
      hunk({ id: "flagged", file: "src/b.ts", risk: 40, status: "flagged", addedLines: 3, removedLines: 0 }),
      hunk({ id: "open", file: "src/c.ts", risk: 20, status: "unreviewed", addedLines: 5, removedLines: 0 })
    ]);
    const live = deriveLiveStats(model, {
      at: "now",
      diffSpec: "WORKTREE",
      changedLines: 999,
      reviewableLines: 999,
      reviewedReviewableLines: 0,
      flaggedHunks: 0,
      debt: 1,
      provenanceCoverage: 0
    });
    expect(live?.reviewedReviewableLines).toBe(6);
    expect(live?.flaggedHunks).toBe(1);
    expect(deriveDecisionProgress(model)).toEqual({ reviewed: 2, total: 3 });
    expect(live?.reviewableLines).toBe(11);
  });

  it("BUG-03-unsaved-decisions-remain-in-the-shared-store", () => {
    useReviewStore.setState({ unsaved: {} });
    useReviewStore.getState().markUnsaved(["a", "b"]);
    expect(useReviewStore.getState().unsaved).toEqual({ a: true, b: true });
    useReviewStore.getState().markSaved(["a"]);
    expect(useReviewStore.getState().unsaved).toEqual({ b: true });
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
