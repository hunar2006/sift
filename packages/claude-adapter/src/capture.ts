import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { captureErrorPath, hookLogPath, siftHome } from "./paths.js";

const MAX_HASHES = 400;
const MAX_LOG_BYTES = 20 * 1024 * 1024;

export async function captureHookInput(raw: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const payload = parsePayload(raw);
    if (!payload) {
      return;
    }
    const logPath = hookLogPath(env);
    await fs.mkdir(siftHome(env), { recursive: true });
    await rotateIfLarge(logPath);
    const addedHashes = payload.newStrings
      .flatMap((value) => value.split(/\r?\n/))
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, MAX_HASHES)
      .map((line) => createHash("sha256").update(line).digest("hex"));
    const line = {
      source: "claude-code",
      matchedVia: "hook-log",
      ts: new Date().toISOString(),
      sessionId: payload.sessionId,
      transcriptPath: payload.transcriptPath,
      cwd: payload.cwd,
      tool: payload.toolName,
      file: payload.filePath,
      addedHashes,
      lineCount: payload.newStrings.reduce((sum, value) => sum + value.split(/\r?\n/).length, 0)
    };
    await fs.appendFile(logPath, `${JSON.stringify(line)}\n`, { encoding: "utf8", flag: "a" });
  } catch (error) {
    await writeCaptureError(error, env).catch(() => undefined);
  }
}

export async function runHookCapture(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  await captureHookInput(Buffer.concat(chunks).toString("utf8"));
}

function parsePayload(raw: string):
  | {
      sessionId: string;
      transcriptPath: string;
      cwd: string;
      toolName: string;
      filePath: string;
      newStrings: string[];
    }
  | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    return null;
  }
  const toolInput = isRecord(parsed.tool_input) ? parsed.tool_input : {};
  const newStrings = extractNewStrings(toolInput);
  const filePath = stringValue(toolInput.file_path) ?? stringValue(toolInput.path);
  if (!filePath || newStrings.length === 0) {
    return null;
  }
  return {
    sessionId: stringValue(parsed.session_id) ?? "unknown",
    transcriptPath: stringValue(parsed.transcript_path) ?? "",
    cwd: stringValue(parsed.cwd) ?? process.cwd(),
    toolName: stringValue(parsed.tool_name) ?? "",
    filePath,
    newStrings
  };
}

function extractNewStrings(toolInput: Record<string, unknown>): string[] {
  const direct = [stringValue(toolInput.new_string), stringValue(toolInput.content)].filter(
    (value): value is string => Boolean(value)
  );
  const edits = Array.isArray(toolInput.edits)
    ? toolInput.edits.flatMap((edit) =>
        isRecord(edit) && typeof edit.new_string === "string" ? [edit.new_string] : []
      )
    : [];
  return [...direct, ...edits];
}

async function rotateIfLarge(logPath: string): Promise<void> {
  const stat = await fs.stat(logPath).catch(() => null);
  if (stat && stat.size > MAX_LOG_BYTES) {
    await fs.rename(logPath, `${logPath}.1`).catch(() => undefined);
  }
}

async function writeCaptureError(error: unknown, env: NodeJS.ProcessEnv): Promise<void> {
  await fs.mkdir(siftHome(env), { recursive: true });
  const message = error instanceof Error ? error.message : "unknown capture error";
  await fs.appendFile(captureErrorPath(env), `${new Date().toISOString()} ${message}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
