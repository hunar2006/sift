import type { FileChange, ParsedDiff, ParsedHunk, RiskReason } from "./types.js";
import { languageNameForPath } from "./classify/languages.js";
import { normalizeRepoRelative, safeEvidence, stripDiffPrefix } from "./path-utils.js";

const MAX_STORED_LINE = 4000;

interface MutableFile {
  path: string;
  oldPath?: string;
  status: FileChange["status"];
  hunkIds: string[];
  hunks: ParsedHunk[];
  similarity?: number;
  newMode?: string;
  sawModeOnly?: boolean;
}

interface MutableHunk extends ParsedHunk {
  oldCursor: number;
  newCursor: number;
  truncated: boolean;
}

export function parseUnifiedDiff(patch: string): ParsedDiff {
  const files: MutableFile[] = [];
  let current: MutableFile | undefined;
  let hunk: MutableHunk | undefined;

  function finishHunk(): void {
    if (!current || !hunk) {
      return;
    }
    current.hunks.push(hunk);
    hunk = undefined;
  }

  function finishFile(): void {
    finishHunk();
    if (!current) {
      return;
    }
    if (current.status === "renamed" && current.similarity === 100 && current.hunks.length === 0) {
      current.hunks.push(makePseudoHunk(current, "RENAME_ONLY", true, false));
    }
    if (current.status === "mode" && current.hunks.length === 0) {
      current.hunks.push(makePseudoHunk(current, "MODE_CHANGE", false, true));
    }
    files.push(current);
    current = undefined;
  }

  const lines = patch.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      finishFile();
      const [oldPath, newPath] = parseDiffGitLine(line);
      current = {
        path: normalizeRepoRelative(newPath),
        oldPath: normalizeRepoRelative(oldPath),
        status: "modified",
        hunkIds: [],
        hunks: []
      };
      if (current.oldPath === current.path) {
        delete current.oldPath;
      }
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("similarity index ")) {
      const similarity = Number.parseInt(line.replace(/\D+/g, ""), 10);
      if (Number.isFinite(similarity)) {
        current.similarity = similarity;
      }
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.oldPath = normalizeRepoRelative(unquoteGitPath(line.slice("rename from ".length)));
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.path = normalizeRepoRelative(unquoteGitPath(line.slice("rename to ".length)));
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("new file mode ")) {
      current.status = "added";
      current.newMode = line.slice("new file mode ".length).trim();
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("old mode ") || line.startsWith("new mode ")) {
      current.sawModeOnly = true;
      if (line.startsWith("new mode ")) {
        current.newMode = line.slice("new mode ".length).trim();
      }
      if (current.status === "modified") {
        current.status = "mode";
      }
      continue;
    }
    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      current.status = "binary";
      finishHunk();
      continue;
    }
    if (line.startsWith("--- ")) {
      const oldPath = pathFromHeader(line.slice(4));
      if (oldPath !== "/dev/null") {
        current.oldPath = normalizeRepoRelative(oldPath);
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = pathFromHeader(line.slice(4));
      if (newPath === "/dev/null") {
        current.status = "deleted";
      } else {
        current.path = normalizeRepoRelative(newPath);
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      finishHunk();
      hunk = makeHunk(current, line);
      continue;
    }
    if (!hunk) {
      continue;
    }
    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    appendDiffLine(hunk, line);
  }
  finishFile();

  const resultFiles = files.map<FileChange>((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    hunkIds: []
  }));
  const resultHunks = files.flatMap((file) => file.hunks);
  return { files: resultFiles, hunks: resultHunks };
}

function parseDiffGitLine(line: string): [string, string] {
  const rest = line.slice("diff --git ".length);
  const tokens = tokenizeGitHeader(rest);
  const oldPath = tokens[0] ?? "a/unknown";
  const newPath = tokens[1] ?? oldPath.replace(/^a\//, "b/");
  return [stripDiffPrefix(unquoteGitPath(oldPath)), stripDiffPrefix(unquoteGitPath(newPath))];
}

function tokenizeGitHeader(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      current += char;
      inQuote = !inQuote;
      continue;
    }
    if (char === " " && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) {
    current += "\\";
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function pathFromHeader(value: string): string {
  const trimmed = value.trim();
  const withoutTimestamp = trimmed.startsWith('"')
    ? trimmed
    : (trimmed.split(/\t| {2,}/)[0] ?? trimmed);
  const unquoted = unquoteGitPath(withoutTimestamp);
  return unquoted === "/dev/null" ? unquoted : stripDiffPrefix(unquoted);
}

export function unquoteGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }
  const body = trimmed.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char === "\\" && /^[0-7]{3}$/.test(body.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    if (char === "\\" && index + 1 < body.length) {
      const next = body[index + 1] ?? "";
      const mapped = next === "t" ? "\t" : next === "n" ? "\n" : next;
      bytes.push(...Buffer.from(mapped, "utf8"));
      index += 1;
      continue;
    }
    bytes.push(...Buffer.from(char, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

function makeHunk(file: MutableFile, header: string): MutableHunk {
  const parsed = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  const oldStart = parsed ? Number.parseInt(parsed[1] ?? "1", 10) : 1;
  const newStart = parsed ? Number.parseInt(parsed[3] ?? "1", 10) : 1;
  return {
    file: file.path,
    oldPath: file.oldPath,
    language: languageNameForPath(file.path),
    header,
    oldStart,
    newStart,
    oldCursor: oldStart,
    newCursor: newStart,
    lines: [],
    addedLines: 0,
    removedLines: 0,
    parserReasons: [],
    truncated: false
  };
}

function makePseudoHunk(
  file: MutableFile,
  code: "RENAME_ONLY" | "MODE_CHANGE",
  isRenameOnly: boolean,
  isModeChange: boolean
): ParsedHunk {
  return {
    file: file.path,
    oldPath: file.oldPath,
    language: languageNameForPath(file.path),
    header: code,
    lines: [],
    addedLines: 0,
    removedLines: 0,
    parserReasons: isModeChange && file.newMode === "100755"
      ? [{ code: "MODE_EXEC", label: "Mode changed to executable", weight: 10 }]
      : [],
    isRenameOnly,
    isModeChange,
    newMode: file.newMode
  };
}

function appendDiffLine(hunk: MutableHunk, rawLine: string): void {
  const marker = rawLine[0];
  if (marker !== "+" && marker !== "-" && marker !== " ") {
    return;
  }
  const rawText = rawLine.slice(1);
  const { text, reason } = capLine(rawText, hunk.newCursor);
  if (reason && !hunk.truncated) {
    hunk.parserReasons.push(reason);
    hunk.truncated = true;
  }
  if (marker === "+") {
    hunk.lines.push({ kind: "add", text, newLine: hunk.newCursor });
    hunk.newCursor += 1;
    hunk.addedLines += 1;
    return;
  }
  if (marker === "-") {
    hunk.lines.push({ kind: "del", text, oldLine: hunk.oldCursor });
    hunk.oldCursor += 1;
    hunk.removedLines += 1;
    return;
  }
  hunk.lines.push({ kind: "context", text, oldLine: hunk.oldCursor, newLine: hunk.newCursor });
  hunk.oldCursor += 1;
  hunk.newCursor += 1;
}

function capLine(text: string, newLine: number): { text: string; reason?: RiskReason } {
  if (text.length <= MAX_STORED_LINE) {
    return { text };
  }
  const capped = `${text.slice(0, MAX_STORED_LINE)}...[truncated]`;
  return {
    text: capped,
    reason: {
      code: "TRUNCATED_LINE",
      label: "Oversized diff line truncated",
      weight: 10,
      line: newLine,
      evidence: safeEvidence(capped)
    }
  };
}
