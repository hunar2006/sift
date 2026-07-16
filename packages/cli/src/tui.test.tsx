import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import {
  ReviewSession,
  type SessionHunk
} from "@sift-review/core/session";
import { TuiApp } from "./tui.js";

function hunk(overrides: Partial<SessionHunk> = {}): SessionHunk {
  return {
    id: "h1",
    file: "src/a.ts",
    language: "typescript",
    header: "@@ -1,1 +1,1 @@",
    lines: [
      { kind: "del", text: "const a = 1;", oldLine: 1 },
      { kind: "add", text: "const a = 2;", newLine: 1 }
    ],
    addedLines: 1,
    removedLines: 1,
    category: "logic",
    categoryReason: "DEFAULT_LOGIC",
    risk: 45,
    band: "medium",
    reasons: [{ code: "PUBLIC_API", label: "Public API surface changed", weight: 15 }],
    groupId: "g1",
    newStart: 1,
    digest: { headline: "Updates a constant", details: ["changes a"], source: "auto" },
    status: "unreviewed",
    ...overrides
  };
}

describe("TUI", () => {
  it("renders queue and advances on approve", async () => {
    const session = new ReviewSession();
    const second = hunk({
      id: "h2",
      file: "src/b.ts",
      risk: 12,
      band: "low",
      digest: { headline: "Tweaks b", details: [], source: "auto" }
    });
    session.setModel({
      meta: {
        siftVersion: "0.5.0",
        repoRoot: "/repo",
        diffSpec: "WORKTREE",
        generatedAt: new Date().toISOString(),
        git: { headSha: "abc", branch: "main" },
        astCoverage: 0
      },
      files: [],
      hunks: [hunk(), second],
      groups: [
        {
          id: "g1",
          title: "Attention",
          kind: "attention",
          order: 0,
          hunkIds: ["h1", "h2"],
          totalAdded: 2,
          totalRemoved: 2
        }
      ],
      totals: { changedLines: 4, attentionLines: 2, reviewableLines: 4, files: 2 }
    });

    const persistStatus = vi.fn(async () => {
      await Promise.resolve();
    });
    const { lastFrame, stdin } = render(
      React.createElement(TuiApp, {
        session,
        flagReasons: ["Needs tests", "Security concern", "Doesn't match intent", "Unnecessary change"],
        getRepoRoot: () => "/repo",
        getModel: () => session.getState().model!,
        persistStatus,
        persistGroupApprove: async () => {
          await Promise.resolve();
        },
        performRevert: () => Promise.resolve({ id: "revert-1", path: "src/a.ts" }),
        undoFileRevert: async () => {
          await Promise.resolve();
        },
        onExit: () => undefined
      })
    );

    expect(lastFrame()).toContain("Updates a constant");
    expect(lastFrame()).toContain("src/a.ts");
    expect(lastFrame()).toContain("Shift+Z redo");
    expect(lastFrame()).toContain("o editor");
    expect(lastFrame()).not.toContain("o split");

    stdin.write("a");
    await vi.waitFor(() => {
      expect(persistStatus).toHaveBeenCalled();
    });
    expect(session.getState().model?.hunks.find((item) => item.id === "h1")?.status).toBe("approved");
  });

  it("flags with quick reason 2", async () => {
    const session = new ReviewSession();
    session.setModel({
      meta: {
        siftVersion: "0.5.0",
        repoRoot: "/repo",
        diffSpec: "WORKTREE",
        generatedAt: new Date().toISOString(),
        git: { headSha: "abc", branch: "main" },
        astCoverage: 0
      },
      files: [],
      hunks: [hunk()],
      groups: [
        {
          id: "g1",
          title: "Attention",
          kind: "attention",
          order: 0,
          hunkIds: ["h1"],
          totalAdded: 1,
          totalRemoved: 1
        }
      ],
      totals: { changedLines: 2, attentionLines: 2, reviewableLines: 2, files: 1 }
    });
    const persistStatus = vi.fn(async () => {
      await Promise.resolve();
    });
    const { stdin } = render(
      React.createElement(TuiApp, {
        session,
        flagReasons: ["Needs tests", "Security concern", "Doesn't match intent", "Unnecessary change"],
        getRepoRoot: () => "/repo",
        getModel: () => session.getState().model!,
        persistStatus,
        persistGroupApprove: async () => {
          await Promise.resolve();
        },
        performRevert: () => Promise.resolve({ id: "revert-1", path: "src/a.ts" }),
        undoFileRevert: async () => {
          await Promise.resolve();
        },
        onExit: () => undefined
      })
    );
    stdin.write("x");
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write("2");
    await vi.waitFor(() => {
      expect(persistStatus).toHaveBeenCalledWith("h1", "flagged", "Security concern");
    });
  });

  it("renders a two-thousand-line patch and confirms the [y/N] revert path", async () => {
    const session = new ReviewSession();
    const large = hunk({
      lines: Array.from({ length: 2_000 }, (_, index) => ({ kind: "add" as const, text: `export const line_${index} = ${index};`, newLine: index + 1 })),
      addedLines: 2_000,
      removedLines: 0
    });
    session.setModel({
      meta: {
        siftVersion: "1.0.0",
        repoRoot: "/repo",
        diffSpec: "WORKTREE",
        generatedAt: new Date().toISOString(),
        git: { headSha: "abc", branch: "main" },
        astCoverage: 0
      },
      files: [],
      hunks: [large],
      groups: [{ id: "g1", title: "Attention", kind: "attention", order: 0, hunkIds: ["h1"], totalAdded: 2_000, totalRemoved: 0 }],
      totals: { changedLines: 2_000, attentionLines: 2_000, reviewableLines: 2_000, files: 1 }
    });
    const performRevert = vi.fn(async () => {
      await Promise.resolve();
      return { id: "revert-1", path: "src/a.ts" };
    });
    const { lastFrame, stdin } = render(
      React.createElement(TuiApp, {
        session,
        flagReasons: ["Needs tests"],
        getRepoRoot: () => "/repo",
        getModel: () => session.getState().model!,
        persistStatus: async () => {
          await Promise.resolve();
        },
        persistGroupApprove: async () => {
          await Promise.resolve();
        },
        performRevert,
        undoFileRevert: async () => {
          await Promise.resolve();
        },
        onExit: () => undefined
      })
    );

    expect(lastFrame()).toContain("export const line_199 = 199;");
    stdin.write("R");
    await vi.waitFor(() => expect(lastFrame()).toContain("snapshot kept [y/N]"));
    stdin.write("y");
    await vi.waitFor(() => expect(performRevert).toHaveBeenCalledWith(large));
  });
});
