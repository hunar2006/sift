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
    digest: { headline: "Updates a constant", details: ["changes a"] },
    status: "unreviewed",
    ...overrides
  };
}

describe("TUI", () => {
  it("renders queue and advances on approve", async () => {
    const session = new ReviewSession();
    const second = hunk({ id: "h2", file: "src/b.ts", risk: 12, band: "low", digest: { headline: "Tweaks b", details: [] } });
    session.setModel({
      meta: {
        siftVersion: "0.5.0",
        repoRoot: "/repo",
        diffSpec: "WORKTREE",
        generatedAt: new Date().toISOString(),
        git: { headSha: "abc", branch: "main" }
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
      totals: { changedLines: 4, attentionLines: 2, reviewableLines: 4, filesChanged: 2 }
    });

    const persistStatus = vi.fn(async () => undefined);
    const { lastFrame, stdin } = render(
      React.createElement(TuiApp, {
        session,
        flagReasons: ["Needs tests", "Security concern", "Doesn't match intent", "Unnecessary change"],
        getRepoRoot: () => "/repo",
        getModel: () => session.getState().model!,
        persistStatus,
        persistGroupApprove: async () => undefined,
        onExit: () => undefined
      })
    );

    expect(lastFrame()).toContain("Updates a constant");
    expect(lastFrame()).toContain("src/a.ts");

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
        git: { headSha: "abc", branch: "main" }
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
      totals: { changedLines: 2, attentionLines: 2, reviewableLines: 2, filesChanged: 1 }
    });
    const persistStatus = vi.fn(async () => undefined);
    const { stdin } = render(
      React.createElement(TuiApp, {
        session,
        flagReasons: ["Needs tests", "Security concern", "Doesn't match intent", "Unnecessary change"],
        getRepoRoot: () => "/repo",
        getModel: () => session.getState().model!,
        persistStatus,
        persistGroupApprove: async () => undefined,
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
});
