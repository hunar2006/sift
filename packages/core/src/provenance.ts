import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isParentOrChild } from "./path-utils.js";
import type { Hunk, ProvenanceRef, ReviewModel } from "./types.js";

export interface ProvenanceRecord {
  source: string;
  matchedVia?: ProvenanceRef["matchedVia"];
  sessionId: string;
  transcriptPath?: string;
  cwd?: string;
  ts?: string;
  toolName?: string;
  filePath: string;
  newStrings?: string[];
  addedHashes?: string[];
  userPromptExcerpt?: string;
  reasoningExcerpt?: string;
  modelFamily?: ProvenanceRef["modelFamily"];
}

export interface ProvenanceMatch {
  record: ProvenanceRecord;
  score: number;
  confidence: number;
}

export interface ProvenanceProvider {
  listRecords(repoRoot: string, since?: Date): Promise<ProvenanceRecord[]>;
  enrich(match: ProvenanceMatch): ProvenanceRef;
}

export interface TimelineSession {
  sessionId: string;
  source: string;
  firstTs?: string;
  lastTs?: string;
  promptExcerpts: string[];
  hunkIds: string[];
}

export class GenericJsonlProvider implements ProvenanceProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async listRecords(repoRoot: string, since?: Date): Promise<ProvenanceRecord[]> {
    return loadGenericJsonlRecords(repoRoot, this.env, since);
  }

  enrich(match: ProvenanceMatch): ProvenanceRef {
    return defaultProvenanceRef(match);
  }
}

export function provenanceJsonlPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.SIFT_HOME ? path.resolve(env.SIFT_HOME) : path.join(os.homedir(), ".sift");
  return path.join(home, "provenance.jsonl");
}

export async function loadGenericJsonlRecords(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  since?: Date
): Promise<ProvenanceRecord[]> {
  const raw = await fs.readFile(provenanceJsonlPath(env), "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return parseGenericRecord(JSON.parse(line) as unknown, repoRoot, since);
      } catch {
        return [];
      }
    });
}

export function matchProvenanceRecords(
  hunks: Hunk[],
  records: ProvenanceRecord[],
  enrich: (match: ProvenanceMatch) => ProvenanceRef = defaultProvenanceRef
): Map<string, ProvenanceRef> {
  const result = new Map<string, ProvenanceRef>();
  for (const hunk of hunks) {
    const addedHashes = new Set(
      hunk.lines
        .filter((line) => line.kind === "add" && line.text.trim().length > 0)
        .map((line) => hashProvenanceLine(line.text))
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
    result.set(hunk.id, enrich(best));
  }
  return result;
}

export function attachProvenanceRecords(
  hunks: Hunk[],
  records: ProvenanceRecord[],
  enrich: (match: ProvenanceMatch) => ProvenanceRef = defaultProvenanceRef
): Hunk[] {
  const matches = matchProvenanceRecords(hunks, records, enrich);
  return hunks.map((hunk) => {
    const provenance = matches.get(hunk.id);
    return provenance ? { ...hunk, provenance } : hunk;
  });
}

export function defaultProvenanceRef(match: ProvenanceMatch): ProvenanceRef {
  return {
    source: match.record.source,
    sessionId: match.record.sessionId,
    transcriptPath: match.record.transcriptPath ?? "",
    matchedVia: match.record.matchedVia ?? "generic-jsonl",
    confidence: match.confidence,
    modelFamily: match.record.modelFamily,
    userPromptExcerpt: match.record.userPromptExcerpt,
    reasoningExcerpt: match.record.reasoningExcerpt,
    toolName: match.record.toolName,
    timestamp: match.record.ts
  };
}

export function buildProvenanceTimeline(model: ReviewModel): TimelineSession[] {
  const sessions = new Map<string, TimelineSession>();
  for (const hunk of model.hunks) {
    const provenance = hunk.provenance;
    if (!provenance) {
      continue;
    }
    const key = `${provenance.source}\0${provenance.sessionId}`;
    const existing =
      sessions.get(key) ??
      ({
        sessionId: provenance.sessionId,
        source: provenance.source,
        promptExcerpts: [],
        hunkIds: []
      } satisfies TimelineSession);
    if (provenance.timestamp) {
      existing.firstTs = earlierTimestamp(existing.firstTs, provenance.timestamp);
      existing.lastTs = laterTimestamp(existing.lastTs, provenance.timestamp);
    }
    if (provenance.userPromptExcerpt && !existing.promptExcerpts.includes(provenance.userPromptExcerpt)) {
      existing.promptExcerpts.push(provenance.userPromptExcerpt);
    }
    if (!existing.hunkIds.includes(hunk.id)) {
      existing.hunkIds.push(hunk.id);
    }
    sessions.set(key, existing);
  }
  return [...sessions.values()].sort((a, b) => timestampMs(a.firstTs) - timestampMs(b.firstTs));
}

export function provenanceSourceLabel(source: string): string {
  return source === "claude-code" ? "Claude Code" : source;
}

export function hashProvenanceLine(line: string): string {
  return createHash("sha256").update(line.trimEnd()).digest("hex");
}

function parseGenericRecord(value: unknown, repoRoot: string, since?: Date): ProvenanceRecord[] {
  if (!isRecord(value)) {
    return [];
  }
  const source = stringValue(value.source);
  if (!source || source === "claude-code") {
    return [];
  }
  const cwd = stringValue(value.cwd);
  if (cwd && !isParentOrChild(cwd, repoRoot)) {
    return [];
  }
  const ts = stringValue(value.ts) ?? stringValue(value.timestamp);
  if (since && ts && timestampMs(ts) < since.getTime()) {
    return [];
  }
  const filePath = stringValue(value.file) ?? stringValue(value.filePath);
  if (!filePath) {
    return [];
  }
  const addedHashes = stringArray(value.addedHashes);
  const newStrings = stringArray(value.newStrings);
  if (addedHashes.length === 0 && newStrings.length === 0) {
    return [];
  }
  return [
    {
      source,
      matchedVia: "generic-jsonl",
      sessionId: stringValue(value.sessionId) ?? stringValue(value.session_id) ?? "unknown",
      transcriptPath: stringValue(value.transcriptPath) ?? stringValue(value.transcript_path) ?? "",
      cwd,
      ts,
      toolName: stringValue(value.tool) ?? stringValue(value.toolName) ?? stringValue(value.tool_name),
      filePath,
      addedHashes,
      newStrings,
      userPromptExcerpt: stringValue(value.userPromptExcerpt),
      reasoningExcerpt: stringValue(value.reasoningExcerpt),
      modelFamily: modelFamilyValue(value.modelFamily)
    }
  ];
}

function scoreRecord(hunkFile: string, addedHashes: Set<string>, record: ProvenanceRecord): ProvenanceMatch {
  const sourceHashes =
    record.addedHashes && record.addedHashes.length > 0
      ? record.addedHashes
      : record.newStrings?.flatMap((value) =>
        value
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter(Boolean)
          .map(hashProvenanceLine)
      ) ?? [];
  const recordHashes = new Set(sourceHashes);
  const intersect = [...addedHashes].filter((hash) => recordHashes.has(hash)).length;
  const score = intersect / Math.max(addedHashes.size, 1);
  const normalizedRecordPath = record.filePath.replace(/\\/g, "/");
  const normalizedHunkPath = hunkFile.replace(/\\/g, "/");
  const fullPathBonus =
    normalizedRecordPath.endsWith(normalizedHunkPath) || normalizedRecordPath === normalizedHunkPath ? 0.1 : 0;
  return { record, score, confidence: Math.min(1, score + fullPathBonus) };
}

function earlierTimestamp(current: string | undefined, candidate: string): string {
  return !current || timestampMs(candidate) < timestampMs(current) ? candidate : current;
}

function laterTimestamp(current: string | undefined, candidate: string): string {
  return !current || timestampMs(candidate) > timestampMs(current) ? candidate : current;
}

function timestampMs(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modelFamilyValue(value: unknown): ProvenanceRef["modelFamily"] {
  return value === "anthropic" || value === "openai" || value === "unknown" ? value : undefined;
}
