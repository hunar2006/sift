import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs } from "node:fs";
import { z } from "zod";
import {
  BINARY_NAME,
  SIFT_VERSION,
  computeStats,
  emptyState,
  mergeReviewState,
  reviewStateFileSchema,
  statePath,
  type HunkWithState,
  type ReviewModel,
  type ReviewStateFile
} from "@sift-review/core";
import type { PipelineResult } from "./pipeline-runner.js";

const bandRank = { skim: 0, low: 1, medium: 2, high: 3 } as const;

export async function runMcpServer(result: PipelineResult): Promise<void> {
  const server = createSiftMcpServer(result);
  await server.connect(new StdioServerTransport());
}

export function createSiftMcpServer(result: PipelineResult): McpServer {
  const server = new McpServer({ name: BINARY_NAME, version: SIFT_VERSION });

  server.registerTool(
    "sift_get_summary",
    {
      title: "Get Sift summary",
      description: "Read review totals, group counts, debt, coverage, and flagged count.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => jsonResult(await summaryFor(result.model))
  );

  server.registerTool(
    "sift_list_flagged",
    {
      title: "List flagged hunks",
      description: "Read flagged hunks with file, line span, risk, top reasons, and user note.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => jsonResult((await modelWithState(result.model)).hunks.filter((hunk) => hunk.status === "flagged").map(hunkListItem))
  );

  server.registerTool(
    "sift_list_unreviewed",
    {
      title: "List unreviewed hunks",
      description: "Read unreviewed hunks, optionally filtered by minimum band.",
      inputSchema: { minBand: z.enum(["high", "medium", "low"]).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ minBand }) => {
      const minRank = minBand ? bandRank[minBand] : bandRank.low;
      const hunks = (await modelWithState(result.model)).hunks.filter(
        (hunk) => hunk.status === "unreviewed" && bandRank[hunk.band] >= minRank
      );
      return jsonResult(hunks.map(hunkListItem));
    }
  );

  server.registerTool(
    "sift_get_hunk",
    {
      title: "Get hunk detail",
      description: "Read full hunk detail by id, including capped patch text, reasons, state, and provenance excerpt.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      const hunk = (await modelWithState(result.model)).hunks.find((candidate) => candidate.id === id);
      if (!hunk) {
        return jsonResult({ error: "Unknown hunk id." });
      }
      return jsonResult(hunkDetail(hunk));
    }
  );

  server.registerTool(
    "sift_get_stats",
    {
      title: "Get Sift stats",
      description: "Read the current StatsSnapshot.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => jsonResult(computeStats(result.model, await readStateReadonly(result.model.meta.repoRoot)))
  );

  return server;
}

async function summaryFor(model: ReviewModel): Promise<Record<string, unknown>> {
  const state = await readStateReadonly(model.meta.repoRoot);
  const stats = computeStats(model, state);
  return {
    totals: model.totals,
    groupCounts: model.groups.map((group) => ({
      id: group.id,
      title: group.title,
      kind: group.kind,
      hunks: group.hunkIds.length,
      lines: group.totalAdded + group.totalRemoved
    })),
    debt: stats.debt,
    coverageOnChangedLines: stats.coverageOnChangedLines,
    flaggedHunks: stats.flaggedHunks
  };
}

async function modelWithState(model: ReviewModel): Promise<ReturnType<typeof mergeReviewState>> {
  return mergeReviewState(model, await readStateReadonly(model.meta.repoRoot));
}

async function readStateReadonly(repoRoot: string): Promise<ReviewStateFile> {
  const raw = await fs.readFile(statePath(repoRoot), "utf8").catch(() => "");
  if (!raw) {
    return emptyState();
  }
  try {
    const parsed = reviewStateFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyState();
  } catch {
    return emptyState();
  }
}

function hunkListItem(hunk: HunkWithState): Record<string, unknown> {
  return {
    id: hunk.id,
    file: hunk.file,
    lineSpan: lineSpan(hunk),
    risk: hunk.risk,
    band: hunk.band,
    topReasons: hunk.reasons.slice(0, 3).map((reason) => ({
      code: reason.code,
      weight: reason.weight,
      label: reason.label,
      evidence: reason.evidence
    })),
    note: hunk.note
  };
}

function hunkDetail(hunk: HunkWithState): Record<string, unknown> {
  return {
    ...hunkListItem(hunk),
    category: hunk.category,
    categoryReason: hunk.categoryReason,
    status: hunk.status,
    patch: patchText(hunk).slice(0, 6000),
    reasons: hunk.reasons,
    provenance: hunk.provenance
      ? {
          source: hunk.provenance.source,
          sessionId: hunk.provenance.sessionId,
          lineMatch: hunk.provenance.confidence,
          userPromptExcerpt: hunk.provenance.userPromptExcerpt,
          reasoningExcerpt: hunk.provenance.reasoningExcerpt,
          toolName: hunk.provenance.toolName,
          timestamp: hunk.provenance.timestamp
        }
      : undefined
  };
}

function lineSpan(hunk: HunkWithState): Record<string, number | undefined> {
  return {
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    addedLines: hunk.addedLines,
    removedLines: hunk.removedLines
  };
}

function patchText(hunk: HunkWithState): string {
  return hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`).join("\n");
}

function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
