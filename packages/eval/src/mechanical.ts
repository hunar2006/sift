/**
 * Independent mechanical-honesty checkers.
 * Intentionally does NOT import classifier helpers from categories.ts / isTokenFormatOnly.
 */
import type { Hunk, ReviewModel } from "@sift-review/core";

const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|=>|==|===|!=|!==|<=|>=|&&|\|\||[{}()[\].,;:+\-*/%=<>!]|\?/g;
const COMMENT_RE = /^\s*(\/\/|#|\/\*|\*|\*\/)/;
const TS_JS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/i;
const DECLARATION_FILE_RE = /\.(?:d\.ts|pyi)$/i;

function changedText(hunk: Hunk, kind: "add" | "del"): string[] {
  return hunk.lines.filter((line) => line.kind === kind).map((line) => line.text);
}

function normalizeWs(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function tokenStream(hunk: Hunk, kind: "add" | "del"): string[] {
  return hunk.lines
    .filter((line) => line.kind === kind && !COMMENT_RE.test(line.text))
    .flatMap((line) => line.text.match(TOKEN_RE) ?? []);
}

function independentWhitespaceOnly(hunk: Hunk): boolean {
  const added = changedText(hunk, "add");
  const removed = changedText(hunk, "del");
  if (added.length === 0 || removed.length === 0) {
    const changed = [...added, ...removed];
    return changed.length > 0 && changed.every((line) => line.trim().length === 0);
  }
  return normalizeWs(added.join("\n")) === normalizeWs(removed.join("\n"));
}

function independentAstFormatOnly(hunk: Hunk): boolean {
  const added = tokenStream(hunk, "add");
  const removed = tokenStream(hunk, "del");
  return added.length > 0 && removed.length > 0 && added.join(" ") === removed.join(" ");
}

function jsModule(line: string): string | null {
  const from = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
  if (from?.[1]) {
    return from[1];
  }
  const req = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (req?.[1]) {
    return req[1];
  }
  const side = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
  return side?.[1] ?? null;
}

function pyModule(line: string): string | null {
  const from = line.match(/^\s*from\s+(\S+)\s+import\s+/);
  if (from?.[1]) {
    return from[1];
  }
  const imp = line.match(/^\s*import\s+(\S+)/);
  return imp?.[1] ?? null;
}

function goModule(line: string): string | null {
  const quoted = line.match(/^\s*"([^"]+)"\s*$/);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const imp = line.match(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/);
  return imp?.[1] ?? (line.trim() || null);
}

function importModules(hunk: Hunk): { added: Map<string, number>; removed: Map<string, number> } | null {
  const changed = hunk.lines.filter((line) => line.kind !== "context");
  if (changed.length === 0) {
    return null;
  }
  const ext = hunk.file.toLowerCase();
  const extractor =
    ext.endsWith(".py") ? pyModule : ext.endsWith(".go") ? goModule : jsModule;
  const importish = (text: string): boolean => {
    const t = text.trim();
    if (ext.endsWith(".py")) {
      return /^\s*(import|from)\b/.test(t);
    }
    if (ext.endsWith(".go")) {
      return /^\s*import\b/.test(t) || /^\s*"[^"]+"\s*$/.test(t);
    }
    return /^\s*import\b/.test(t) || /\brequire\s*\(/.test(t);
  };
  if (!changed.every((line) => importish(line.text))) {
    return null;
  }
  const bag = (kind: "add" | "del"): Map<string, number> => {
    const map = new Map<string, number>();
    for (const text of changedText(hunk, kind)) {
      const mod = extractor(text);
      if (!mod) {
        continue;
      }
      map.set(mod, (map.get(mod) ?? 0) + 1);
    }
    return map;
  };
  return { added: bag("add"), removed: bag("del") };
}

function sameMultiset(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, count] of a) {
    if (b.get(key) !== count) {
      return false;
    }
  }
  return true;
}

function independentImportReorder(hunk: Hunk): boolean {
  const bags = importModules(hunk);
  if (!bags) {
    return false;
  }
  return sameMultiset(bags.added, bags.removed) && bags.added.size > 0;
}

/** A separate lexical check so eval can catch directives accidentally made mechanical. */
function independentDirectiveComment(file: string, line: string): boolean {
  const content = commentContent(line);
  if (content === null) {
    return false;
  }
  const tsOrJs = TS_JS_FILE_RE.test(file);
  const python = file.endsWith(".py") || file.endsWith(".pyi");
  const go = file.endsWith(".go");
  const rust = file.endsWith(".rs");
  const jvm = file.endsWith(".java") || file.endsWith(".kt");
  return (
    (tsOrJs &&
      /@ts-(?:ignore|expect-error|nocheck)\b|\beslint-disable(?:-[a-z]+)*\b|\b(?:prettier|biome)-ignore\b|\b(?:istanbul|c8) ignore\b|\bwebpackIgnore\s*:\s*true\b|@jsx(?:ImportSource)?\b/.test(
        content
      )) ||
    (python && /\bnoqa\b|\btype:\s*ignore\b|\bpragma:\s*no cover\b|\bmypy:|\bruff:\s*noqa\b|\bfmt:\s*(?:off|on)\b/.test(content)) ||
    (go && (/^\s*\/\/\s*Deprecated:/.test(line) || /\bnolint\b|\bgo:[A-Za-z0-9_-]+\b|\+build\b/.test(content))) ||
    (rust && /\brustfmt::skip\b/.test(content)) ||
    (jvm && /\bnoinspection\b|\bNOSONAR\b/.test(content)) ||
    /\bcoverage:ignore\b|\bcodecov ignore\b/.test(content) ||
    (DECLARATION_FILE_RE.test(file) && /@(?:deprecated|internal)\b/.test(content)) ||
    (tsOrJs && /^\s*\/\*\*|^\s*\*/.test(line) && /@(?:deprecated|internal)\b/.test(content))
  );
}

function commentContent(line: string): string | null {
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (line.startsWith("//", index) || line.startsWith("/*", index)) {
      return line.slice(index + 2);
    }
    if (character === "#") {
      return line.slice(index + 1);
    }
  }
  return line.trimStart().startsWith("*") ? line.trimStart().slice(1) : null;
}

function parseRenameReason(reason: string): { from: string; to: string } | null {
  const match = reason.match(/^RENAME_PATTERN:(.+)->(.+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { from: match[1], to: match[2] };
}

/** Returns null when honest; otherwise a failure detail. */
export function verifyMechanicalHonesty(hunk: Hunk): string | null {
  if (hunk.lines.some((line) => line.kind !== "context" && independentDirectiveComment(hunk.file, line.text))) {
    return `Directive comment must not be mechanical for ${hunk.id}`;
  }
  const reason = hunk.categoryReason;
  if (reason === "WHITESPACE_ONLY" || reason === "whitespace-only") {
    if (!independentWhitespaceOnly(hunk)) {
      return `WHITESPACE_ONLY not independently verified for ${hunk.id}`;
    }
    return null;
  }
  if (reason === "ast-format-only") {
    // Prefer token-stream equality; also accept whitespace-only as a stricter subset.
    if (!independentAstFormatOnly(hunk) && !independentWhitespaceOnly(hunk)) {
      // AST path may have set astFormatOnly with richer tokenization; require either
      // independent tokens equal OR the AST flag was the sole source — still fail if
      // neither token nor whitespace honesty holds.
      return `ast-format-only not independently verified for ${hunk.id}`;
    }
    return null;
  }
  if (reason === "IMPORT_REORDER_ONLY" || reason === "import-reorder") {
    if (!independentImportReorder(hunk)) {
      return `IMPORT_REORDER_ONLY not independently verified for ${hunk.id}`;
    }
    return null;
  }
  const rename = parseRenameReason(reason);
  if (rename) {
    if (!rename.from || !rename.to || rename.from === rename.to || /\s/.test(rename.from) || /\s/.test(rename.to)) {
      return `Rename mapping invalid for ${hunk.id}: ${reason}`;
    }
    return null;
  }
  return null;
}

export function verifyRenameGroups(model: ReviewModel): string[] {
  const failures: string[] = [];
  for (const group of model.groups) {
    const isRename =
      group.title.startsWith("Rename:") ||
      group.hunkIds.some((id) => {
        const hunk = model.hunks.find((h) => h.id === id);
        return Boolean(hunk && parseRenameReason(hunk.categoryReason));
      });
    if (!isRename) {
      continue;
    }
    const mappings = new Set<string>();
    for (const id of group.hunkIds) {
      const hunk = model.hunks.find((h) => h.id === id);
      if (!hunk) {
        failures.push(`Rename group ${group.id} missing hunk ${id}`);
        continue;
      }
      const parsed = parseRenameReason(hunk.categoryReason);
      if (!parsed) {
        // Group may include non-pattern members; skip
        continue;
      }
      mappings.add(`${parsed.from}->${parsed.to}`);
    }
    if (mappings.size > 1) {
      failures.push(`Rename group ${group.id} has inconsistent mappings: ${[...mappings].join(", ")}`);
    }
  }
  return failures;
}
