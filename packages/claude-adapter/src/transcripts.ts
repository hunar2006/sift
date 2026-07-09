import { promises as fs } from "node:fs";
import path from "node:path";
import { isParentOrChild } from "@sift-review/core";
import { claudeDir, hookLogPath } from "./paths.js";
import type { ProvenanceRecord } from "./types.js";

export async function loadHookLog(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<ProvenanceRecord[]> {
  const raw = await fs.readFile(hookLogPath(env), "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isRecord(parsed) || typeof parsed.file !== "string") {
          return [];
        }
        const cwd = stringValue(parsed.cwd);
        if (cwd && !isParentOrChild(cwd, repoRoot)) {
          return [];
        }
        const source = stringValue(parsed.source);
        if (source && source !== "claude-code") {
          return [];
        }
        return [
          {
            source: "claude-code",
            matchedVia: "hook-log" as const,
            sessionId: stringValue(parsed.sessionId) ?? "unknown",
            transcriptPath: stringValue(parsed.transcriptPath) ?? "",
            cwd,
            ts: stringValue(parsed.ts),
            toolName: stringValue(parsed.tool),
            filePath: parsed.file,
            addedHashes: Array.isArray(parsed.addedHashes)
              ? parsed.addedHashes.filter((item): item is string => typeof item === "string")
              : [],
            userPromptExcerpt: stringValue(parsed.userPromptExcerpt),
            reasoningExcerpt: stringValue(parsed.reasoningExcerpt)
          }
        ];
      } catch {
        return [];
      }
    });
}

export async function discoverTranscripts(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  baselineEpochSeconds = 0
): Promise<string[]> {
  const projectsDir = path.join(claudeDir(env), "projects");
  const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ file: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(projectsDir, entry.name);
    const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) {
        continue;
      }
      const fullPath = path.join(dir, file.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < (baselineEpochSeconds - 3600) * 1000) {
        continue;
      }
      if (await transcriptMentionsRepo(fullPath, repoRoot)) {
        candidates.push({ file: fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }
  return candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 25)
    .map((candidate) => candidate.file);
}

export async function parseTranscript(filePath: string, repoRoot: string): Promise<ProvenanceRecord[]> {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  const records: ProvenanceRecord[] = [];
  let lastUser = "";
  let lastAssistant = "";
  let lastModelFamily: ProvenanceRecord["modelFamily"];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as unknown;
      if (!isRecord(entry)) {
        continue;
      }
      const cwd = stringValue(entry.cwd);
      if (cwd && !isParentOrChild(cwd, repoRoot)) {
        continue;
      }
      const role = stringValue(entry.role) ?? stringValue(isRecord(entry.message) ? entry.message.role : undefined);
      const content = isRecord(entry.message) ? entry.message.content : entry.content;
      const text = extractText(content);
      if (role === "user" && text) {
        lastUser = excerpt(text, 200);
      }
      if (role === "assistant" && text) {
        lastAssistant = excerpt(text, 400);
      }
      if (role === "assistant") {
        lastModelFamily = modelFamilyFor(stringValue(entry.model) ?? stringValue(isRecord(entry.message) ? entry.message.model : undefined));
      }
      for (const tool of extractToolUses(content)) {
        records.push({
          source: "claude-code",
          matchedVia: "transcript-scan",
          sessionId: stringValue(entry.sessionId) ?? stringValue(entry.session_id) ?? path.basename(filePath, ".jsonl"),
          transcriptPath: filePath,
          cwd,
          ts: stringValue(entry.timestamp) ?? stringValue(entry.ts),
          toolName: tool.name,
          filePath: tool.filePath,
          newStrings: tool.newStrings,
          userPromptExcerpt: lastUser,
          reasoningExcerpt: lastAssistant,
          modelFamily: lastModelFamily
        });
      }
    } catch {
      continue;
    }
  }
  return records;
}

export async function loadTranscriptRecords(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<ProvenanceRecord[]> {
  const files = await discoverTranscripts(repoRoot, env);
  const nested = await Promise.all(files.map((file) => parseTranscript(file, repoRoot)));
  return nested.flat();
}

async function transcriptMentionsRepo(filePath: string, repoRoot: string): Promise<boolean> {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/).slice(0, 50)) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.cwd === "string" && isParentOrChild(parsed.cwd, repoRoot)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function extractToolUses(content: unknown): Array<{ name: string; filePath: string; newStrings: string[] }> {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.flatMap((block) => {
    if (!isRecord(block) || block.type !== "tool_use") {
      return [];
    }
    const name = stringValue(block.name);
    if (!name || !["Edit", "Write", "MultiEdit"].includes(name)) {
      return [];
    }
    const input = isRecord(block.input) ? block.input : {};
    const filePath = stringValue(input.file_path);
    if (!filePath) {
      return [];
    }
    const newStrings = [
      stringValue(input.new_string),
      stringValue(input.content),
      ...(Array.isArray(input.edits)
        ? input.edits.flatMap((edit) =>
            isRecord(edit) && typeof edit.new_string === "string" ? [edit.new_string] : []
          )
        : [])
    ].filter((value): value is string => Boolean(value));
    return newStrings.length > 0 ? [{ name, filePath, newStrings }] : [];
  });
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

function excerpt(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) : collapsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function modelFamilyFor(model: string | undefined): ProvenanceRecord["modelFamily"] {
  if (!model) {
    return undefined;
  }
  const normalized = model.toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "anthropic";
  }
  if (normalized.includes("gpt") || normalized.includes("openai") || normalized.includes("o3") || normalized.includes("o4")) {
    return "openai";
  }
  return "unknown";
}
