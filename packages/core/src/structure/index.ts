import type { Hunk, ParsedHunk } from "../types.js";
import { extension, normalizeRepoRelative } from "../path-utils.js";

const IDENTIFIER_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|=>|==|===|!=|!==|<=|>=|&&|\|\||[{}()[\].,;:+\-*/%=<>]/g;
const COMMENT_RE = /^\s*(\/\/|#|\/\*|\*|\*\/)/;
const MAX_REFERENCES = 200;
const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "def",
  "else",
  "export",
  "false",
  "for",
  "from",
  "func",
  "function",
  "go",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "return",
  "struct",
  "synchronized",
  "true",
  "try",
  "type",
  "var",
  "void",
  "while"
]);

interface RenameSite {
  hunkId: string;
  file: string;
  from: string;
  to: string;
}

export function enrichParsedHunksWithStructure(hunks: ParsedHunk[]): ParsedHunk[] {
  return hunks.map((hunk) => {
    const added = hunk.lines.filter((line) => line.kind === "add").map((line) => line.text);
    return {
      ...hunk,
      defines: definedSymbols(hunk.file, added),
      references: referencedSymbols(added)
    };
  });
}

export function isTokenFormatOnly(hunk: ParsedHunk): boolean {
  const added = changedTokenStream(hunk, "add");
  const removed = changedTokenStream(hunk, "del");
  return added.length > 0 && removed.length > 0 && added.join(" ") === removed.join(" ");
}

export function applyRenamePatternGroups(hunks: Hunk[]): Hunk[] {
  const sites = hunks.flatMap(renameSitesForHunk);
  const byMapping = new Map<string, RenameSite[]>();
  for (const site of sites) {
    const key = `${site.from}\0${site.to}`;
    byMapping.set(key, [...(byMapping.get(key) ?? []), site]);
  }
  const eligibleHunkIds = new Map<string, { from: string; to: string }>();
  for (const [key, mappingSites] of byMapping) {
    const files = new Set(mappingSites.map((site) => site.file));
    if (files.size < 3 || mappingSites.length < 5) {
      continue;
    }
    const [from = "", to = ""] = key.split("\0");
    for (const site of mappingSites) {
      eligibleHunkIds.set(site.hunkId, { from, to });
    }
  }
  if (eligibleHunkIds.size === 0) {
    return hunks;
  }
  return hunks.map((hunk) => {
    const mapping = eligibleHunkIds.get(hunk.id);
    if (!mapping || hunk.reasons.some((reason) => reason.weight >= 15)) {
      return hunk;
    }
    return {
      ...hunk,
      category: "mechanical",
      categoryReason: `RENAME_PATTERN:${mapping.from}->${mapping.to}`,
      risk: 0,
      band: "skim"
    };
  });
}

function renameSitesForHunk(hunk: Hunk): RenameSite[] {
  if (hunk.reasons.some((reason) => reason.weight >= 15)) {
    return [];
  }
  const removed = hunk.lines.filter((line) => line.kind === "del");
  const added = hunk.lines.filter((line) => line.kind === "add");
  const sites: RenameSite[] = [];
  const count = Math.min(removed.length, added.length);
  for (let index = 0; index < count; index += 1) {
    const candidate = singleIdentifierRename(removed[index]?.text ?? "", added[index]?.text ?? "");
    if (candidate) {
      sites.push({ hunkId: hunk.id, file: normalizeRepoRelative(hunk.file), ...candidate });
    }
  }
  return sites;
}

function singleIdentifierRename(removed: string, added: string): { from: string; to: string } | null {
  const oldTokens = codeTokens(removed);
  const newTokens = codeTokens(added);
  if (oldTokens.length !== newTokens.length || oldTokens.length === 0) {
    return null;
  }
  let mapping: { from: string; to: string } | null = null;
  for (let index = 0; index < oldTokens.length; index += 1) {
    if (oldTokens[index] === newTokens[index]) {
      continue;
    }
    if (!isIdentifier(oldTokens[index] ?? "") || !isIdentifier(newTokens[index] ?? "")) {
      return null;
    }
    if (mapping && (mapping.from !== oldTokens[index] || mapping.to !== newTokens[index])) {
      return null;
    }
    mapping = { from: oldTokens[index] ?? "", to: newTokens[index] ?? "" };
  }
  return mapping && mapping.from !== mapping.to ? mapping : null;
}

function changedTokenStream(hunk: ParsedHunk, kind: "add" | "del"): string[] {
  return hunk.lines
    .filter((line) => line.kind === kind && !COMMENT_RE.test(line.text))
    .flatMap((line) => codeTokens(line.text));
}

function codeTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function definedSymbols(file: string, lines: string[]): string[] {
  const ext = extension(file);
  const symbols = new Set<string>();
  for (const text of lines) {
    const trimmed = text.trim();
    const patterns = definitionPatterns(ext);
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        symbols.add(match[1]);
      }
    }
  }
  return [...symbols].sort();
}

function definitionPatterns(ext: string): RegExp[] {
  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    return [
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
      /^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/
    ];
  }
  if (ext === "py") {
    return [/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\b/, /^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/];
  }
  if (ext === "go") {
    return [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\b/, /^type\s+([A-Za-z_][A-Za-z0-9_]*)\b/];
  }
  if (ext === "rs") {
    return [/^(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/, /^(?:pub\s+)?(?:struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/];
  }
  if (["java", "kt"].includes(ext)) {
    return [/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/, /\b(?:fun|void|int|String|boolean)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/];
  }
  return [];
}

function referencedSymbols(lines: string[]): string[] {
  const symbols = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(IDENTIFIER_RE)) {
      const symbol = match[0];
      if (!KEYWORDS.has(symbol) && !/^[A-Z0-9_]+$/.test(symbol)) {
        symbols.add(symbol);
      }
      if (symbols.size >= MAX_REFERENCES) {
        return [...symbols];
      }
    }
  }
  return [...symbols].sort();
}

function isIdentifier(token: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) && !KEYWORDS.has(token);
}
