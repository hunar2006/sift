import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hunk, ReviewModel } from "./types.js";
import { buildProvenanceTimeline, GenericJsonlProvider, matchProvenanceRecords } from "./provenance.js";

const hunk = (id: string): Hunk => ({
  id,
  file: "src/a.ts",
  language: "typescript",
  header: "@@",
  lines: [{ kind: "add", text: "const a = 1;", newLine: 1 }],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  risk: 35,
  band: "low",
  reasons: [],
  groupId: "low-risk-logic"
});

describe("generic provenance", () => {
  it("loads open JSONL records and builds a timeline", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-prov-"));
    const siftHome = path.join(repoRoot, ".sift-home");
    await fs.mkdir(siftHome, { recursive: true });
    await fs.writeFile(
      path.join(siftHome, "provenance.jsonl"),
      `${JSON.stringify({
        source: "codex",
        sessionId: "s1",
        transcriptPath: "/tmp/s1.jsonl",
        cwd: repoRoot,
        ts: "2026-01-01T00:00:00.000Z",
        tool: "edit",
        file: path.join(repoRoot, "src/a.ts"),
        newStrings: ["const a = 1;"],
        userPromptExcerpt: "add a"
      })}\n`,
      "utf8"
    );
    const provider = new GenericJsonlProvider({ SIFT_HOME: siftHome });
    const records = await provider.listRecords(repoRoot);
    const match = matchProvenanceRecords([hunk("h1")], records, (item) => provider.enrich(item)).get("h1");

    expect(match).toMatchObject({ source: "codex", matchedVia: "generic-jsonl", sessionId: "s1" });

    const model = {
      meta: {
        siftVersion: "0.2.0",
        repoRoot,
        diffSpec: "WORKTREE",
        generatedAt: "2026-01-01T00:00:00.000Z",
        git: { headSha: "abc", branch: "main" },
        astCoverage: 0
      },
      files: [],
      hunks: [{ ...hunk("h1"), provenance: match }],
      groups: [],
      totals: { changedLines: 1, attentionLines: 0, reviewableLines: 0, files: 1 }
    } satisfies ReviewModel;

    expect(buildProvenanceTimeline(model)).toEqual([
      {
        sessionId: "s1",
        source: "codex",
        firstTs: "2026-01-01T00:00:00.000Z",
        lastTs: "2026-01-01T00:00:00.000Z",
        promptExcerpts: ["add a"],
        hunkIds: ["h1"]
      }
    ]);
  });
});
