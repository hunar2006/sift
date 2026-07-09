import { createHash } from "node:crypto";
import path from "node:path";
import type { Hunk, ProvenanceRef } from "@sift-review/core";
import type { ProvenanceRecord } from "./types.js";

export function hashLine(line: string): string {
  return createHash("sha256").update(line.trimEnd()).digest("hex");
}

export function matchProvenance(hunks: Hunk[], records: ProvenanceRecord[]): Map<string, ProvenanceRef> {
  const result = new Map<string, ProvenanceRef>();
  for (const hunk of hunks) {
    const addedHashes = new Set(
      hunk.lines
        .filter((line) => line.kind === "add" && line.text.trim().length > 0)
        .map((line) => hashLine(line.text))
    );
    if (addedHashes.size === 0) {
      continue;
    }
    const matches = records
      .filter((record) => path.basename(record.filePath) === path.basename(hunk.file))
      .map((record) => scoreRecord(hunk.file, addedHashes, record))
      .filter((match) => match.score >= 0.6)
      .sort((a, b) => b.score - a.score || timestampMs(b.record.ts) - timestampMs(a.record.ts));
    const best = matches[0];
    if (!best) {
      continue;
    }
    result.set(hunk.id, {
      source: "claude-code",
      sessionId: best.record.sessionId,
      transcriptPath: best.record.transcriptPath,
      matchedVia: best.record.source,
      confidence: best.confidence,
      modelFamily: best.record.modelFamily,
      userPromptExcerpt: best.record.userPromptExcerpt,
      reasoningExcerpt: best.record.reasoningExcerpt,
      toolName: best.record.toolName,
      timestamp: best.record.ts
    });
  }
  return result;
}

export function attachProvenance(hunks: Hunk[], records: ProvenanceRecord[]): Hunk[] {
  const matches = matchProvenance(hunks, records);
  return hunks.map((hunk) => {
    const provenance = matches.get(hunk.id);
    return provenance ? { ...hunk, provenance } : hunk;
  });
}

function scoreRecord(
  hunkFile: string,
  addedHashes: Set<string>,
  record: ProvenanceRecord
): { record: ProvenanceRecord; score: number; confidence: number } {
  const recordHashes = new Set(
    record.addedHashes ??
      record.newStrings?.flatMap((value) =>
        value
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter(Boolean)
          .map(hashLine)
      ) ??
      []
  );
  const intersect = [...addedHashes].filter((hash) => recordHashes.has(hash)).length;
  const score = intersect / Math.max(addedHashes.size, 1);
  const normalizedRecordPath = record.filePath.replace(/\\/g, "/");
  const normalizedHunkPath = hunkFile.replace(/\\/g, "/");
  const fullPathBonus =
    normalizedRecordPath.endsWith(normalizedHunkPath) || normalizedRecordPath === normalizedHunkPath ? 0.1 : 0;
  return { record, score, confidence: Math.min(1, score + fullPathBonus) };
}

function timestampMs(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}
