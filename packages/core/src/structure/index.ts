import Parser from "web-tree-sitter";
import type { Hunk, ParsedHunk, RenameCandidate } from "../types.js";
import { extension, normalizeRepoRelative } from "../path-utils.js";

export const TREE_SITTER_MAX_BYTES = 512 * 1024;
export const TREE_SITTER_MAX_LINES = 20_000;
export const TREE_SITTER_BUDGET_MS = 2_500;

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

type SupportedLanguage = "typescript" | "tsx" | "javascript" | "python" | "go";

interface LanguageConfig {
  grammar: string;
  definitionTypes: string[];
  referenceTypes: string[];
  identifierTypes: Set<string>;
  importTypes: Set<string>;
}

const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    grammar: "tree-sitter-typescript.wasm",
    definitionTypes: [
      "function_declaration",
      "generator_function_declaration",
      "class_declaration",
      "method_definition",
      "method_signature",
      "abstract_method_signature"
    ],
    referenceTypes: ["identifier", "property_identifier", "type_identifier", "shorthand_property_identifier"],
    identifierTypes: new Set(["identifier", "property_identifier", "type_identifier", "shorthand_property_identifier"]),
    importTypes: new Set(["import_statement"])
  },
  tsx: {
    grammar: "tree-sitter-tsx.wasm",
    definitionTypes: [
      "function_declaration",
      "generator_function_declaration",
      "class_declaration",
      "method_definition",
      "method_signature",
      "abstract_method_signature"
    ],
    referenceTypes: ["identifier", "property_identifier", "type_identifier", "shorthand_property_identifier"],
    identifierTypes: new Set(["identifier", "property_identifier", "type_identifier", "shorthand_property_identifier"]),
    importTypes: new Set(["import_statement"])
  },
  javascript: {
    grammar: "tree-sitter-javascript.wasm",
    definitionTypes: ["function_declaration", "generator_function_declaration", "class_declaration", "method_definition"],
    referenceTypes: ["identifier", "property_identifier", "shorthand_property_identifier"],
    identifierTypes: new Set(["identifier", "property_identifier", "shorthand_property_identifier"]),
    importTypes: new Set(["import_statement"])
  },
  python: {
    grammar: "tree-sitter-python.wasm",
    definitionTypes: ["function_definition", "class_definition"],
    referenceTypes: ["identifier"],
    identifierTypes: new Set(["identifier"]),
    importTypes: new Set(["import_statement", "import_from_statement"])
  },
  go: {
    grammar: "tree-sitter-go.wasm",
    definitionTypes: ["function_declaration", "method_declaration", "type_spec"],
    referenceTypes: ["identifier", "field_identifier", "type_identifier", "package_identifier"],
    identifierTypes: new Set(["identifier", "field_identifier", "type_identifier", "package_identifier"]),
    importTypes: new Set(["import_declaration"])
  }
};

export interface TreeSitterInitOptions {
  grammarDirectory: string;
}

export interface StructureEnrichmentOptions {
  newFileSources?: ReadonlyMap<string, string>;
  skipAstFiles?: ReadonlySet<string>;
}

export interface StructureEnrichmentResult {
  hunks: ParsedHunk[];
  astCoverage: number;
}

interface RenameSite extends RenameCandidate {
  hunkId: string;
  file: string;
}

interface AstSnippetFacts {
  formatOnly: boolean;
  importReorderOnly: boolean;
  renameCandidates: RenameCandidate[];
  removedDefines: string[];
}

let parserInitialization: Promise<boolean> | undefined;
let loadedLanguages = new Map<SupportedLanguage, Parser.Language>();

export async function initializeTreeSitter(options: TreeSitterInitOptions): Promise<void> {
  parserInitialization ??= Parser.init().then(
    () => true,
    () => false
  );
  if (!(await parserInitialization)) {
    loadedLanguages = new Map();
    return;
  }

  const attempts = await Promise.all(
    (Object.entries(LANGUAGE_CONFIGS) as Array<[SupportedLanguage, LanguageConfig]>).map(async ([name, config]) => {
      try {
        const grammarPath = `${options.grammarDirectory.replace(/[\\/]$/, "")}/${config.grammar}`;
        return [name, await Parser.Language.load(grammarPath)] as const;
      } catch {
        return null;
      }
    })
  );
  loadedLanguages = new Map(attempts.filter((attempt): attempt is readonly [SupportedLanguage, Parser.Language] => Boolean(attempt)));
}

export function enrichParsedHunksWithStructure(
  hunks: ParsedHunk[],
  options: StructureEnrichmentOptions = {}
): ParsedHunk[] {
  return analyzeParsedHunksStructure(hunks, options).hunks;
}

export function analyzeParsedHunksStructure(
  hunks: ParsedHunk[],
  options: StructureEnrichmentOptions = {}
): StructureEnrichmentResult {
  const fallback = hunks.map((hunk) => tokenizerEnrichment(hunk, sourceForHunk(hunk, options.newFileSources)));
  const indicesByFile = new Map<string, number[]>();
  for (const [index, hunk] of hunks.entries()) {
    const file = normalizeRepoRelative(hunk.file);
    indicesByFile.set(file, [...(indicesByFile.get(file) ?? []), index]);
  }

  let eligibleFiles = 0;
  let parsedFiles = 0;
  for (const [file, indices] of indicesByFile) {
    const languageName = supportedLanguageForPath(file);
    if (!languageName || options.skipAstFiles?.has(file)) {
      continue;
    }
    const source = sourceForFile(file, hunks[indices[0] ?? -1], options.newFileSources);
    if (source !== undefined && exceedsAstGuards(source)) {
      continue;
    }
    eligibleFiles += 1;
    const language = loadedLanguages.get(languageName);
    if (source === undefined || !language) {
      continue;
    }

    const sourceHunks = indices.map((index) => hunks[index]).filter((hunk): hunk is ParsedHunk => Boolean(hunk));
    const enriched = analyzeFileWithTreeSitter(sourceHunks, source, languageName, language);
    if (!enriched) {
      continue;
    }
    parsedFiles += 1;
    for (const [offset, index] of indices.entries()) {
      const astHunk = enriched[offset];
      if (astHunk) {
        fallback[index] = astHunk;
      }
    }
  }

  return {
    hunks: fallback,
    astCoverage: eligibleFiles === 0 ? 0 : parsedFiles / eligibleFiles
  };
}

export function isTokenFormatOnly(hunk: ParsedHunk): boolean {
  if (hunk.astFormatOnly !== undefined) {
    return hunk.astFormatOnly;
  }
  const added = changedTokenStream(hunk, "add");
  const removed = changedTokenStream(hunk, "del");
  return added.length > 0 && removed.length > 0 && added.join(" ") === removed.join(" ");
}

export function applyRenamePatternGroups(
  hunks: Hunk[],
  astCandidatesByHunkId: ReadonlyMap<string, readonly RenameCandidate[]> = new Map()
): Hunk[] {
  const sites = hunks.flatMap((hunk) => renameSitesForHunk(hunk, astCandidatesByHunkId.get(hunk.id)));
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

function analyzeFileWithTreeSitter(
  hunks: ParsedHunk[],
  source: string,
  languageName: SupportedLanguage,
  language: Parser.Language
): ParsedHunk[] | null {
  const parser = new Parser();
  const startedAt = performance.now();
  let tree: Parser.Tree | undefined;
  try {
    parser.setLanguage(language);
    setRemainingBudget(parser, startedAt);
    tree = parser.parse(source);
    if (tree.rootNode.hasError()) {
      return null;
    }

    const config = LANGUAGE_CONFIGS[languageName];
    const declarations = tree.rootNode.descendantsOfType(config.definitionTypes);
    const references = tree.rootNode.descendantsOfType(config.referenceTypes);
    return hunks.map((hunk) => {
      const addedRows = new Set(
        hunk.lines.flatMap((line) => (line.kind === "add" && line.newLine ? [line.newLine - 1] : []))
      );
      const changedRows = changedNewRows(hunk);
      const snippetFacts = analyzeChangedSyntax(parser, hunk, config, startedAt);
      return {
        ...hunk,
        defines: definitionNamesOnRows(declarations, addedRows),
        removedDefines: snippetFacts?.removedDefines ?? definedSymbols(hunk.file, changedText(hunk, "del")),
        references: referenceNamesOnRows(references, addedRows),
        enclosingSymbol: enclosingDefinition(declarations, changedRows),
        astFormatOnly: snippetFacts?.formatOnly,
        astImportReorderOnly: snippetFacts?.importReorderOnly,
        renameCandidates: snippetFacts?.renameCandidates
      };
    });
  } catch {
    return null;
  } finally {
    tree?.delete();
    parser.delete();
  }
}

function analyzeChangedSyntax(
  parser: Parser,
  hunk: ParsedHunk,
  config: LanguageConfig,
  startedAt: number
): AstSnippetFacts | undefined {
  const added = changedText(hunk, "add").join("\n");
  const removed = changedText(hunk, "del").join("\n");
  if (!added || !removed) {
    return undefined;
  }

  let addedTree: Parser.Tree | undefined;
  let removedTree: Parser.Tree | undefined;
  try {
    parser.reset();
    setRemainingBudget(parser, startedAt);
    addedTree = parser.parse(added);
    parser.reset();
    setRemainingBudget(parser, startedAt);
    removedTree = parser.parse(removed);
    if (addedTree.rootNode.hasError() || removedTree.rootNode.hasError()) {
      return undefined;
    }

    const addedImports = importSignature(addedTree.rootNode, config.importTypes);
    const removedImports = importSignature(removedTree.rootNode, config.importTypes);
    return {
      formatOnly: syntaxSignature(addedTree.rootNode) === syntaxSignature(removedTree.rootNode),
      importReorderOnly:
        addedImports !== null &&
        removedImports !== null &&
        addedImports.length > 0 &&
        arraysEqual(addedImports, removedImports),
      renameCandidates: renameCandidatesFromTrees(removedTree.rootNode, addedTree.rootNode, config.identifierTypes),
      removedDefines: definitionNames(removedTree.rootNode.descendantsOfType(config.definitionTypes))
    };
  } catch {
    parser.reset();
    return undefined;
  } finally {
    addedTree?.delete();
    removedTree?.delete();
  }
}

function setRemainingBudget(parser: Parser, startedAt: number): void {
  const remainingMs = TREE_SITTER_BUDGET_MS - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    throw new Error("tree-sitter budget exhausted");
  }
  parser.setTimeoutMicros(Math.max(1, Math.floor(remainingMs * 1_000)));
}

function definitionNamesOnRows(nodes: Parser.SyntaxNode[], rows: ReadonlySet<number>): string[] {
  return uniqueSorted(
    nodes.flatMap((node) => {
      const name = node.childForFieldName("name");
      return name && rows.has(name.startPosition.row) ? [name.text] : [];
    })
  );
}

function definitionNames(nodes: Parser.SyntaxNode[]): string[] {
  return uniqueSorted(nodes.flatMap((node) => (node.childForFieldName("name")?.text ? [node.childForFieldName("name")!.text] : [])));
}

function referenceNamesOnRows(nodes: Parser.SyntaxNode[], rows: ReadonlySet<number>): string[] {
  const names = uniqueSorted(
    nodes.flatMap((node) => {
      const symbol = node.text;
      return rows.has(node.startPosition.row) && isIdentifier(symbol) && !/^[A-Z0-9_]+$/.test(symbol) ? [symbol] : [];
    })
  );
  return names.slice(0, MAX_REFERENCES);
}

function enclosingDefinition(nodes: Parser.SyntaxNode[], rows: { first: number; last: number }): string | undefined {
  const candidates = nodes
    .filter((node) => node.startPosition.row <= rows.first && node.endPosition.row >= rows.last)
    .sort((a, b) => {
      const aSpan = a.endIndex - a.startIndex;
      const bSpan = b.endIndex - b.startIndex;
      return aSpan - bSpan || b.startIndex - a.startIndex;
    });
  return candidates[0]?.childForFieldName("name")?.text;
}

function changedNewRows(hunk: ParsedHunk): { first: number; last: number } {
  const rows = hunk.lines.flatMap((line) =>
    line.kind === "add" && line.newLine ? [Math.max(0, line.newLine - 1)] : []
  );
  const fallback = Math.max(0, (hunk.newStart ?? 1) - 1);
  return {
    first: rows.length > 0 ? Math.min(...rows) : fallback,
    last: rows.length > 0 ? Math.max(...rows) : fallback
  };
}

function importSignature(root: Parser.SyntaxNode, importTypes: ReadonlySet<string>): string[] | null {
  if (root.namedChildren.length === 0 || !root.namedChildren.every((node) => importTypes.has(node.type))) {
    return null;
  }
  return root.namedChildren.map((node) => `${node.type}:${node.text.replace(/\s+/gu, " ").trim()}`).sort();
}

function syntaxSignature(node: Parser.SyntaxNode): string {
  if (node.childCount === 0) {
    return `${node.type}:${node.text}`;
  }
  return `${node.type}(${node.children.map(syntaxSignature).join(",")})`;
}

function renameCandidatesFromTrees(
  removedRoot: Parser.SyntaxNode,
  addedRoot: Parser.SyntaxNode,
  identifierTypes: ReadonlySet<string>
): RenameCandidate[] {
  const removed = leafTokens(removedRoot);
  const added = leafTokens(addedRoot);
  if (removed.length !== added.length || removed.length === 0) {
    return [];
  }

  const candidates: RenameCandidate[] = [];
  let mapping: RenameCandidate | undefined;
  for (let index = 0; index < removed.length; index += 1) {
    const before = removed[index];
    const after = added[index];
    if (!before || !after || (before.type === after.type && before.text === after.text)) {
      continue;
    }
    if (!identifierTypes.has(before.type) || !identifierTypes.has(after.type)) {
      return [];
    }
    if (mapping && (mapping.from !== before.text || mapping.to !== after.text)) {
      return [];
    }
    mapping = { from: before.text, to: after.text };
    candidates.push(mapping);
  }
  return mapping && mapping.from !== mapping.to ? candidates : [];
}

function leafTokens(node: Parser.SyntaxNode): Array<{ type: string; text: string }> {
  if (node.childCount === 0) {
    return [{ type: node.type, text: node.text }];
  }
  return node.children.flatMap(leafTokens);
}

function tokenizerEnrichment(hunk: ParsedHunk, source?: string): ParsedHunk {
  const added = changedText(hunk, "add");
  const removed = changedText(hunk, "del");
  return {
    ...hunk,
    defines: definedSymbols(hunk.file, added),
    removedDefines: definedSymbols(hunk.file, removed),
    references: referencedSymbols(added),
    enclosingSymbol: fallbackEnclosingSymbol(hunk, source)
  };
}

function fallbackEnclosingSymbol(hunk: ParsedHunk, source?: string): string | undefined {
  if (!source) {
    return undefined;
  }
  const sourceLines = source.split(/\r?\n/u);
  const target = Math.min(sourceLines.length - 1, Math.max(0, changedNewRows(hunk).first));
  for (let row = target; row >= 0; row -= 1) {
    const symbol = enclosingSymbolFromLine(hunk.file, sourceLines[row] ?? "");
    if (symbol) {
      return symbol;
    }
  }
  return undefined;
}

function enclosingSymbolFromLine(file: string, text: string): string | undefined {
  const ext = extension(file);
  const trimmed = text.trim();
  const patterns = definitionPatterns(ext).filter((pattern) => !pattern.source.includes("const|let|var"));
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    patterns.push(/^(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/);
  }
  for (const pattern of patterns) {
    const symbol = trimmed.match(pattern)?.[1];
    if (symbol && isIdentifier(symbol)) {
      return symbol;
    }
  }
  return undefined;
}

function renameSitesForHunk(hunk: Hunk, astCandidates?: readonly RenameCandidate[]): RenameSite[] {
  if (hunk.reasons.some((reason) => reason.weight >= 15)) {
    return [];
  }
  if (astCandidates !== undefined) {
    return astCandidates.map((candidate) => ({
      hunkId: hunk.id,
      file: normalizeRepoRelative(hunk.file),
      ...candidate
    }));
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

function singleIdentifierRename(removed: string, added: string): RenameCandidate | null {
  const oldTokens = codeTokens(removed);
  const newTokens = codeTokens(added);
  if (oldTokens.length !== newTokens.length || oldTokens.length === 0) {
    return null;
  }
  let mapping: RenameCandidate | null = null;
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

function changedText(hunk: ParsedHunk, kind: "add" | "del"): string[] {
  return hunk.lines.filter((line) => line.kind === kind).map((line) => line.text);
}

function codeTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function definedSymbols(file: string, lines: string[]): string[] {
  const ext = extension(file);
  const symbols = new Set<string>();
  for (const text of lines) {
    const trimmed = text.trim();
    for (const pattern of definitionPatterns(ext)) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        symbols.add(match[1]);
      }
    }
  }
  return [...symbols].sort();
}

function definitionPatterns(ext: string): RegExp[] {
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    return [
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
      /^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/
    ];
  }
  if (["py", "pyi"].includes(ext)) {
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

function supportedLanguageForPath(file: string): SupportedLanguage | undefined {
  const ext = extension(file);
  if (["ts", "mts", "cts"].includes(ext)) {
    return "typescript";
  }
  if (ext === "tsx") {
    return "tsx";
  }
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) {
    return "javascript";
  }
  if (["py", "pyi"].includes(ext)) {
    return "python";
  }
  return ext === "go" ? "go" : undefined;
}

function sourceForHunk(hunk: ParsedHunk, sources?: ReadonlyMap<string, string>): string | undefined {
  return sourceForFile(normalizeRepoRelative(hunk.file), hunk, sources);
}

function sourceForFile(file: string, hunk: ParsedHunk | undefined, sources?: ReadonlyMap<string, string>): string | undefined {
  if (!sources) {
    return undefined;
  }
  return sources.get(file) ?? (hunk ? sources.get(hunk.file) : undefined);
}

function exceedsAstGuards(source: string): boolean {
  if (Buffer.byteLength(source, "utf8") > TREE_SITTER_MAX_BYTES) {
    return true;
  }
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10 && ++lines > TREE_SITTER_MAX_LINES) {
      return true;
    }
  }
  return false;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isIdentifier(token: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) && !KEYWORDS.has(token);
}
