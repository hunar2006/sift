import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hunk, ReviewModel } from "@sift-review/core";
import { createSiftMcpServer } from "./mcp.js";
import type { PipelineResult } from "./pipeline-runner.js";

const hunk = (id: string, risk: number, band: Hunk["band"]): Hunk => ({
  id,
  file: `src/${id}.ts`,
  language: "typescript",
  header: "@@",
  lines: [{ kind: "add", text: `const ${id} = true;`, newLine: 1 }],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  risk,
  band,
  reasons: [{ code: "TLS_DISABLED", label: "TLS validation disabled", weight: 45, evidence: "rejectUnauthorized" }],
  groupId: band === "high" ? "high-risk-logic" : "medium-risk",
  newStart: 1,
  digest: { headline: `Modifies \`src/${id}.ts\``, details: [], source: "auto" }
});

describe("Sift MCP server", () => {
  it("lists read-only tools and returns compact JSON shapes", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-mcp-"));
    await fs.mkdir(path.join(repoRoot, ".sift"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".sift", "state.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        hunks: { h1: { status: "flagged", note: "fix this" } }
      }),
      "utf8"
    );
    const model = modelFor(repoRoot);
    const server = createSiftMcpServer({ model, provenanceRecords: 0, aiRan: false, brief: null } satisfies PipelineResult);
    const client = new Client({ name: "sift-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "sift_get_hunk",
        "sift_get_stats",
        "sift_get_summary",
        "sift_list_flagged",
        "sift_list_unreviewed"
      ]);

      expect(readJson(await client.callTool({ name: "sift_get_summary", arguments: {} }))).toMatchObject({
        flaggedHunks: 1
      });
      const flagged = readJson(await client.callTool({ name: "sift_list_flagged", arguments: {} })) as Array<
        Record<string, unknown>
      >;
      expect(flagged[0]).toMatchObject({
        id: "h1",
        note: "fix this"
      });
      const unreviewed = readJson(await client.callTool({ name: "sift_list_unreviewed", arguments: { minBand: "medium" } })) as Array<
        Record<string, unknown>
      >;
      expect(unreviewed[0]).toMatchObject({
        id: "h2"
      });
      expect(readJson(await client.callTool({ name: "sift_get_hunk", arguments: { id: "h1" } }))).toMatchObject({
        id: "h1",
        patch: "+const h1 = true;"
      });
      expect(readJson(await client.callTool({ name: "sift_get_stats", arguments: {} }))).toMatchObject({
        flaggedHunks: 1
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refreshes mid-session when the worktree fingerprint changes and re-reads flags", async () => {
    const repoRoot = await initTempGitRepo();
    await fs.mkdir(path.join(repoRoot, ".sift"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".sift", "state.json"),
      JSON.stringify({ version: 1, updatedAt: "2026-01-01T00:00:00.000Z", hunks: {} }),
      "utf8"
    );

    let generation = 0;
    const refresh = async (): Promise<PipelineResult> => {
      await Promise.resolve();
      generation += 1;
      const model = modelFor(repoRoot);
      model.hunks = [
        hunk("h1", 80, "high"),
        hunk(generation === 1 ? "h2" : "h3", 55, "medium")
      ];
      model.meta.generatedAt = `2026-01-01T00:00:0${generation}.000Z`;
      model.totals = { changedLines: 2, attentionLines: 2, reviewableLines: 2, files: 2 };
      return { model, provenanceRecords: 0, aiRan: false, brief: null };
    };

    const initial = await refresh();
    const server = createSiftMcpServer({ initial, refresh });
    const client = new Client({ name: "sift-live", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const first = readJson(await client.callTool({ name: "sift_get_summary", arguments: {} })) as {
        groupCounts: Array<{ hunks: number }>;
      };
      expect(first.groupCounts.length).toBeGreaterThan(0);

      await fs.writeFile(path.join(repoRoot, "src", "new.ts"), "export const x = 1;\n", "utf8");
      await fs.writeFile(
        path.join(repoRoot, ".sift", "state.json"),
        JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          hunks: { h1: { status: "flagged", note: "mid-session" } }
        }),
        "utf8"
      );

      const flagged = readJson(await client.callTool({ name: "sift_list_flagged", arguments: {} })) as Array<
        Record<string, unknown>
      >;
      expect(flagged.some((item) => item.id === "h1" && item.note === "mid-session")).toBe(true);
      expect(generation).toBeGreaterThanOrEqual(2);

      // Concurrent calls during a mutation coalesce onto one in-flight refresh.
      generation = 10;
      let refreshes = 0;
      const slowRefresh = async (): Promise<PipelineResult> => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        const model = modelFor(repoRoot);
        model.hunks = [hunk("h1", 80, "high"), hunk(`h${refreshes}`, 40, "medium")];
        return { model, provenanceRecords: 0, aiRan: false, brief: null };
      };
      const coalesced = createSiftMcpServer({
        initial: await slowRefresh(),
        refresh: slowRefresh
      });
      const client2 = new Client({ name: "sift-coalesce", version: "0.0.0" });
      const [c2, s2] = InMemoryTransport.createLinkedPair();
      await Promise.all([coalesced.connect(s2), client2.connect(c2)]);
      // Baseline the fingerprint after the server is live.
      await client2.callTool({ name: "sift_get_summary", arguments: {} });
      await fs.writeFile(path.join(repoRoot, "src", "burst.ts"), "export const y = 2;\n", "utf8");
      const before = refreshes;
      const [a, b] = await Promise.all([
        client2.callTool({ name: "sift_get_summary", arguments: {} }),
        client2.callTool({ name: "sift_get_summary", arguments: {} })
      ]);
      expect(readJson(a)).toBeTruthy();
      expect(readJson(b)).toBeTruthy();
      expect(refreshes - before).toBe(1);
      await client2.close();
      await coalesced.close();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function initTempGitRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-mcp-live-"));
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync("git", ["init"], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "sift@example.com"], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "Sift"], { cwd: repoRoot, windowsHide: true });
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot, windowsHide: true });
  return repoRoot;
}

function modelFor(repoRoot: string): ReviewModel {
  const hunks = [hunk("h1", 80, "high"), hunk("h2", 55, "medium")];
  return {
    meta: {
      siftVersion: "0.2.0",
      repoRoot,
      diffSpec: "WORKTREE",
      generatedAt: "2026-01-01T00:00:00.000Z",
      git: { headSha: "abc", branch: "main" },
      astCoverage: 0
    },
    files: [],
    hunks,
    groups: [
      {
        id: "high-risk-logic",
        title: "High-risk logic",
        kind: "attention",
        order: 10,
        hunkIds: ["h1"],
        totalAdded: 1,
        totalRemoved: 0
      },
      {
        id: "medium-risk",
        title: "Medium risk",
        kind: "attention",
        order: 20,
        hunkIds: ["h2"],
        totalAdded: 1,
        totalRemoved: 0
      }
    ],
    totals: { changedLines: 2, attentionLines: 2, reviewableLines: 2, files: 2 }
  };
}

function readJson(result: unknown): unknown {
  const content = (result as { content?: unknown }).content;
  const first = Array.isArray(content) ? (content as unknown[])[0] : undefined;
  if (!isTextContent(first)) {
    throw new Error("Expected text result.");
  }
  return JSON.parse(first.text);
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}
