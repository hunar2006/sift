import { basename, extension, normalizeRepoRelative } from "./path-utils.js";
import { isLockfilePath } from "./classify/categories.js";
import { phraseForReason } from "./digestPhrases.js";
import type {
  FileChange,
  Hunk,
  HunkDigest,
  HunkGroup,
  RiskReason,
  UndigestedHunk
} from "./types.js";

const MAX_HEADLINE = 90;
const MAX_DETAIL = 100;
const MAX_DETAILS = 3;
const RENAME_PREFIX = "RENAME_PATTERN:";

export const FORBIDDEN_VERDICT_PATTERNS = [
  /\blooks good\b/iu,
  /\bsafe to approve\b/iu,
  /\blgtm\b/iu
] as const;

interface RenamePosition {
  from: string;
  to: string;
  ordinal: number;
  files: number;
}

export interface HunkDigestContext {
  fileStatus?: FileChange["status"];
  rename?: RenamePosition;
}

export function attachDigests(
  hunks: UndigestedHunk[],
  groups: HunkGroup[],
  files: FileChange[]
): { hunks: Hunk[]; groups: HunkGroup[] } {
  const statusByFile = new Map(files.map((file) => [normalizeRepoRelative(file.path), file.status]));
  const hunkById = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const renameByHunkId = renamePositions(groups, hunkById);
  const digestedHunks = hunks.map<Hunk>((hunk) => ({
    ...hunk,
    digest: computeHunkDigest(hunk, {
      fileStatus: statusByFile.get(normalizeRepoRelative(hunk.file)),
      rename: renameByHunkId.get(hunk.id)
    })
  }));
  const digestedById = new Map(digestedHunks.map((hunk) => [hunk.id, hunk]));
  const digestedGroups = groups.map((group) => ({
    ...group,
    digest: computeGroupDigest(
      group,
      group.hunkIds.flatMap((id) => {
        const hunk = digestedById.get(id);
        return hunk ? [hunk] : [];
      })
    )
  }));
  return { hunks: digestedHunks, groups: digestedGroups };
}

export function computeHunkDigest(
  hunk: UndigestedHunk,
  context: HunkDigestContext = {}
): HunkDigest {
  return {
    headline: limitText(headlineForHunk(hunk, context), MAX_HEADLINE),
    details: detailsForHunk(hunk).map((detail) => limitText(detail, MAX_DETAIL)).slice(0, MAX_DETAILS),
    source: "auto"
  };
}

export function computeGroupDigest(group: HunkGroup, members: readonly UndigestedHunk[]): string {
  const lines = group.totalAdded + group.totalRemoved;
  const count = group.hunkIds.length;
  const noun = count === 1 ? "hunk" : "hunks";
  const rename = members.find((hunk) => hunk.categoryReason.startsWith(RENAME_PREFIX));
  if (group.id.startsWith("rename-pattern-") && rename) {
    const mapping = renameMapping(rename.categoryReason);
    const files = new Set(members.map((hunk) => normalizeRepoRelative(hunk.file))).size;
    if (mapping) {
      return `Rename: ${mapping.from} → ${mapping.to} across ${files} ${files === 1 ? "file" : "files"}`;
    }
  }
  if (
    group.id === "formatting-whitespace" &&
    members.every((hunk) => ["ast-format-only", "WHITESPACE_ONLY"].includes(hunk.categoryReason))
  ) {
    return `${count} ${noun} — formatting only (${lines} lines)`;
  }
  if (group.id === "formatting-whitespace") {
    return `${count} ${noun} — formatting and comments (${lines} lines)`;
  }
  if (group.id === "renames") {
    return `${count} file ${count === 1 ? "rename" : "renames"}`;
  }
  return `${count} ${noun} — ${group.title.toLowerCase()} (${lines} lines)`;
}

export function containsForbiddenVerdict(value: string): boolean {
  return FORBIDDEN_VERDICT_PATTERNS.some((pattern) => pattern.test(value));
}

function headlineForHunk(hunk: UndigestedHunk, context: HunkDigestContext): string {
  const rename = context.rename ?? fallbackRenamePosition(hunk);
  if (rename) {
    return `Renames ${codeRef(rename.from)} → ${codeRef(rename.to)} (${rename.ordinal} of ${rename.files} files)`;
  }
  if (
    hunk.category === "mechanical" &&
    ["ast-format-only", "WHITESPACE_ONLY"].includes(hunk.categoryReason)
  ) {
    return "Reformats code — no token changes";
  }
  if (hunk.category === "mechanical" && hunk.categoryReason === "COMMENT_ONLY") {
    return "Comment-only edit";
  }
  if (hunk.category === "mechanical" && hunk.categoryReason === "IMPORT_REORDER_ONLY") {
    return "Reorders imports — same modules";
  }
  if (hunk.isRenameOnly || hunk.categoryReason === "RENAME_ONLY") {
    return `Renames file ${codeRef(hunk.oldPath ?? hunk.file)} → ${codeRef(hunk.file)}`;
  }
  if (hunk.category === "deps" && !isLockfilePath(hunk.file)) {
    return dependencyHeadline(hunk);
  }
  if (isLockfilePath(hunk.file) || hunk.categoryReason === "LOCKFILE") {
    return `Lockfile churn (+${hunk.addedLines}/−${hunk.removedLines} lines)`;
  }
  if (context.fileStatus === "added" && (hunk.defines?.length ?? 0) > 0) {
    return newFileWithSymbolsHeadline(hunk);
  }
  if (context.fileStatus === "added") {
    return `New file (+${hunk.addedLines} lines)`;
  }
  if (context.fileStatus === "deleted") {
    return `Deletes ${codeRef(hunk.file)} (−${hunk.removedLines} lines)`;
  }
  if (hunk.category === "tests") {
    return testHeadline(hunk);
  }
  if (hasReason(hunk, "MIGRATION")) {
    return `Migration: ${firstDdlStatement(hunk) ?? "edits database migration"}`;
  }
  if (isCiWorkflowPath(hunk.file)) {
    return `Edits CI workflow ${codeRef(basename(hunk.file))}`;
  }
  if (hunk.category === "config") {
    const keys = configKeys(hunk);
    return keys.length > 0
      ? `Changes config keys: ${cappedPlainList(keys, 3)}`
      : `Edits ${codeRef(hunk.file)}`;
  }
  const addedSymbols = symbolDifference(hunk.defines, hunk.removedDefines);
  if (hunk.category === "logic" && addedSymbols.length > 0) {
    return symbolHeadline("Adds", addedSymbols, hunk.addedLines);
  }
  const removedSymbols = symbolDifference(hunk.removedDefines, hunk.defines);
  if (hunk.category === "logic" && removedSymbols.length > 0) {
    return symbolHeadline("Removes", removedSymbols, hunk.removedLines);
  }
  if (hunk.category === "logic" && hunk.enclosingSymbol) {
    return `Modifies ${callableRef(hunk.enclosingSymbol)} (+${hunk.addedLines}/−${hunk.removedLines})`;
  }
  if (hunk.isBinary || hunk.category === "binary") {
    return "Binary file changed";
  }
  if (hunk.isModeChange) {
    return modeHeadline(hunk.newMode);
  }
  if (hunk.categoryReason === "SUBMODULE_BUMP" || hasReason(hunk, "SUBMODULE_BUMP")) {
    return `Bumps submodule ${codeRef(hunk.file)}`;
  }
  return `Modifies ${codeRef(hunk.file)} (+${hunk.addedLines}/−${hunk.removedLines})`;
}

function detailsForHunk(hunk: UndigestedHunk): string[] {
  const signalDetails = hunk.reasons
    .map((reason, index) => ({ reason, index }))
    .filter(({ reason }) => (reason.tier ?? "primary") === "primary")
    .sort((left, right) =>
      right.reason.weight - left.reason.weight ||
      compareAscii(left.reason.code, right.reason.code) ||
      left.index - right.index
    )
    .flatMap(({ reason }) => {
      const phrase = phraseForReason(reason, hunk);
      return phrase ? [phrase] : [];
    });
  const details = uniqueStable(signalDetails);
  if (hunk.coverage) {
    details.push(`${hunk.coverage.covered} of ${hunk.coverage.total} changed lines covered`);
  }
  const imports = newImports(hunk);
  if (imports.length > 0) {
    details.push(`Uses: ${imports.slice(0, 3).join(", ")}${imports.length > 3 ? "…" : ""}`);
  }
  return details.slice(0, MAX_DETAILS);
}

function renamePositions(
  groups: readonly HunkGroup[],
  hunkById: ReadonlyMap<string, UndigestedHunk>
): Map<string, RenamePosition> {
  const positions = new Map<string, RenamePosition>();
  for (const group of groups) {
    if (!group.id.startsWith("rename-pattern-")) {
      continue;
    }
    const members = group.hunkIds.flatMap((id) => {
      const hunk = hunkById.get(id);
      return hunk ? [hunk] : [];
    });
    const mapping = members.map((hunk) => renameMapping(hunk.categoryReason)).find(Boolean);
    if (!mapping) {
      continue;
    }
    const files = uniqueStable(members.map((hunk) => normalizeRepoRelative(hunk.file)));
    for (const member of members) {
      positions.set(member.id, {
        ...mapping,
        ordinal: Math.max(1, files.indexOf(normalizeRepoRelative(member.file)) + 1),
        files: files.length
      });
    }
  }
  return positions;
}

function fallbackRenamePosition(hunk: UndigestedHunk): RenamePosition | undefined {
  const mapping = renameMapping(hunk.categoryReason);
  return mapping ? { ...mapping, ordinal: 1, files: 1 } : undefined;
}

function renameMapping(reason: string): { from: string; to: string } | undefined {
  if (!reason.startsWith(RENAME_PREFIX)) {
    return undefined;
  }
  const [from, to] = reason.slice(RENAME_PREFIX.length).split("->");
  return from && to ? { from, to } : undefined;
}

function dependencyHeadline(hunk: UndigestedHunk): string {
  const added = dependencyEntries(hunk, "add");
  const removed = dependencyEntries(hunk, "del");
  const addedByName = new Map(added.map((entry) => [entry.name, entry]));
  const removedByName = new Map(removed.map((entry) => [entry.name, entry]));
  const bumped = [...addedByName.values()]
    .filter((entry) => {
      const previous = removedByName.get(entry.name);
      return previous?.version !== undefined && entry.version !== undefined && previous.version !== entry.version;
    })
    .sort((left, right) => compareAscii(left.name, right.name));
  const additions = [...addedByName.values()]
    .filter((entry) => !removedByName.has(entry.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  const removals = [...removedByName.values()]
    .filter((entry) => !addedByName.has(entry.name))
    .sort((left, right) => compareAscii(left.name, right.name));

  if (bumped.length === 1 && additions.length === 0 && removals.length === 0) {
    const current = bumped[0]!;
    const previous = removedByName.get(current.name)!;
    return `Bumps ${codeRef(current.name)} ${previous.version} → ${current.version}`;
  }
  if (additions.length > 0 && removals.length === 0 && bumped.length === 0) {
    return dependencyCollectionHeadline("Adds", additions.map((entry) => entry.name));
  }
  if (removals.length > 0 && additions.length === 0 && bumped.length === 0) {
    return dependencyCollectionHeadline("Removes", removals.map((entry) => entry.name));
  }
  if (bumped.length > 1 && additions.length === 0 && removals.length === 0) {
    return dependencyCollectionHeadline("Bumps", bumped.map((entry) => entry.name));
  }
  const changed = uniqueSorted([
    ...additions.map((entry) => entry.name),
    ...removals.map((entry) => entry.name),
    ...bumped.map((entry) => entry.name)
  ]);
  return changed.length > 0
    ? `Changes ${changed.length} dependencies: ${cappedPlainList(changed, 3)}`
    : `Edits dependencies in ${codeRef(hunk.file)}`;
}

interface DependencyEntry {
  name: string;
  version?: string;
}

function dependencyEntries(hunk: UndigestedHunk, kind: "add" | "del"): DependencyEntry[] {
  return hunk.lines
    .filter((line) => line.kind === kind)
    .flatMap((line) => dependencyEntryForLine(hunk.file, line.text));
}

function dependencyEntryForLine(file: string, text: string): DependencyEntry[] {
  const base = basename(file);
  const trimmed = text.trim().replace(/,$/u, "");
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return [];
  }
  if (base === "package.json") {
    const match = trimmed.match(/^"([^"]+)"\s*:\s*"([^"]+)"/u);
    return match?.[1] && match[2] ? [{ name: match[1], version: match[2] }] : [];
  }
  if (/^requirements.*\.txt$/iu.test(base)) {
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*([<>=!~].+)?$/u);
    return match?.[1] ? [{ name: match[1], version: normalizeOptional(match[2]) }] : [];
  }
  if (base === "pyproject.toml" || base === "Cargo.toml") {
    const assignment = trimmed.match(
      /^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*\bversion\s*=\s*"([^"]+)"[^}]*\})/u
    );
    if (assignment?.[1]) {
      return [{ name: assignment[1], version: normalizeOptional(assignment[2] ?? assignment[3]) }];
    }
    const arrayItem = trimmed.match(/^"([A-Za-z0-9_.-]+)([<>=!~].*)"$/u);
    return arrayItem?.[1] ? [{ name: arrayItem[1], version: normalizeOptional(arrayItem[2]) }] : [];
  }
  if (base === "go.mod") {
    const match = trimmed.match(/^([A-Za-z0-9_.\-/]+)\s+(v[^\s]+)(?:\s|$)/u);
    return match?.[1] && match[2] ? [{ name: match[1], version: match[2] }] : [];
  }
  return [];
}

function dependencyCollectionHeadline(verb: "Adds" | "Removes" | "Bumps", names: string[]): string {
  if (names.length === 1) {
    const singular = verb === "Bumps" ? "dependency" : "dependency";
    return `${verb} ${singular} ${codeRef(names[0] ?? "dependency")}`;
  }
  return `${verb} ${names.length} dependencies: ${cappedPlainList(names, 3)}`;
}

function newFileWithSymbolsHeadline(hunk: UndigestedHunk): string {
  const symbols = uniqueSorted(hunk.defines ?? []);
  const displayed = symbols.slice(0, 2).map(codeRef).join(", ");
  const more = symbols.length > 2 ? ` +${symbols.length - 2} more` : "";
  return `New file — defines ${displayed}${more} (+${hunk.addedLines} lines)`;
}

function testHeadline(hunk: UndigestedHunk): string {
  const titles = changedTestTitles(hunk);
  const title = titles.find((item) => item.kind === "add") ?? titles[0];
  if (hasReason(hunk, "SKIPPED_TEST") && title) {
    return `Skips test: '${quotedText(title.title)}'`;
  }
  if (hasReason(hunk, "TEST_WEAKENED") && title) {
    return `Weakens assertions in '${quotedText(title.title)}'`;
  }
  const added = titles.find((item) => item.kind === "add");
  if (added) {
    return `Adds test: '${quotedText(added.title)}'`;
  }
  const removed = titles.find((item) => item.kind === "del");
  if (removed) {
    return `Removes test: '${quotedText(removed.title)}'`;
  }
  return `Edits tests in ${codeRef(hunk.file)}`;
}

interface ChangedTestTitle {
  title: string;
  kind: "add" | "del";
}

function changedTestTitles(hunk: UndigestedHunk): ChangedTestTitle[] {
  return hunk.lines.flatMap((line) => {
    if (line.kind === "context") {
      return [];
    }
    const title = testTitle(line.text);
    return title ? [{ title, kind: line.kind }] : [];
  });
}

function testTitle(text: string): string | undefined {
  const javascript = text.match(/\b(?:it|test|describe)(?:\.(?:skip|only|todo))?\s*\(\s*(["'`])(.+?)\1/u);
  if (javascript?.[2]) {
    return normalizeInline(javascript[2]);
  }
  const python = text.match(/^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)/u)?.[1];
  if (python) {
    return humanizeTestName(python.replace(/^test_/u, ""));
  }
  const go = text.match(/^\s*func\s+(Test[A-Za-z0-9_]+)/u)?.[1];
  return go ? humanizeTestName(go.replace(/^Test/u, "")) : undefined;
}

function humanizeTestName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return words.length > 0 ? `${words[0]?.toLowerCase() ?? ""}${words.slice(1)}` : value;
}

function firstDdlStatement(hunk: UndigestedHunk): string | undefined {
  const added = hunk.lines
    .filter((line) => line.kind === "add")
    .map((line) => line.text.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .join(" ")
    .replace(/\s+/gu, " ");
  const statement = added.match(/\b(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b.*?(?:;|$)/iu)?.[0];
  return statement ? truncatePlain(statement.replace(/;$/u, ""), 60) : undefined;
}

function isCiWorkflowPath(file: string): boolean {
  const normalized = normalizeRepoRelative(file);
  return (
    normalized.startsWith(".github/workflows/") ||
    normalized === ".gitlab-ci.yml" ||
    basename(normalized) === "Jenkinsfile"
  );
}

function configKeys(hunk: UndigestedHunk): string[] {
  const matches = hunk.lines
    .filter((line) => line.kind === "add")
    .flatMap((line) => {
      const match =
        line.text.match(/^(\s*)"([^"]+)"\s*:/u) ??
        line.text.match(/^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)\s*:/u) ??
        line.text.match(/^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)\s*=/u);
      return match?.[2] ? [{ key: match[2], indent: match[1]?.length ?? 0 }] : [];
    });
  if (matches.length === 0) {
    return [];
  }
  const minimumIndent = Math.min(...matches.map((match) => match.indent));
  return uniqueStable(matches.filter((match) => match.indent === minimumIndent).map((match) => match.key));
}

function symbolDifference(left: readonly string[] | undefined, right: readonly string[] | undefined): string[] {
  const excluded = new Set(right ?? []);
  return uniqueSorted((left ?? []).filter((symbol) => !excluded.has(symbol)));
}

function symbolHeadline(verb: "Adds" | "Removes", symbols: string[], lines: number): string {
  if (symbols.length === 1) {
    return `${verb} ${callableRef(symbols[0] ?? "symbol")} (${verb === "Adds" ? "+" : "−"}${lines} lines)`;
  }
  const displayed = symbols.slice(0, 2).map(callableRef).join(", ");
  return `${verb} ${displayed}${symbols.length > 2 ? ` +${symbols.length - 2} more` : ""}`;
}

function modeHeadline(newMode?: string): string {
  if (newMode === "100755") {
    return "Mode change → executable";
  }
  if (newMode === "100644") {
    return "Mode change → non-executable";
  }
  return `Mode change${newMode ? ` → ${normalizeInline(newMode)}` : ""}`;
}

function newImports(hunk: UndigestedHunk): string[] {
  const removed = new Set(
    hunk.lines.filter((line) => line.kind === "del").flatMap((line) => importNames(hunk.file, line.text))
  );
  return uniqueSorted(
    hunk.lines
      .filter((line) => line.kind === "add")
      .flatMap((line) => importNames(hunk.file, line.text))
      .filter((name) => !removed.has(name))
  );
}

function importNames(file: string, text: string): string[] {
  const ext = extension(file);
  const trimmed = text.trim();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const match =
      trimmed.match(/\bfrom\s+["']([^"']+)["']/u) ??
      trimmed.match(/^import\s+["']([^"']+)["']/u) ??
      trimmed.match(/\brequire\(\s*["']([^"']+)["']\s*\)/u);
    return match?.[1] ? [match[1]] : [];
  }
  if (["py", "pyi"].includes(ext)) {
    const from = trimmed.match(/^from\s+([^\s]+)\s+import\s+/u)?.[1];
    if (from) {
      return [from];
    }
    const direct = trimmed.match(/^import\s+(.+)$/u)?.[1];
    return direct
      ? direct.split(",").map((part) => part.trim().split(/\s+as\s+/u)[0] ?? "").filter(Boolean)
      : [];
  }
  if (ext === "go") {
    const match = trimmed.match(/["']([^"']+)["']/u)?.[1];
    return match ? [match] : [];
  }
  if (ext === "rs") {
    const match = trimmed.match(/^use\s+([A-Za-z0-9_]+)/u)?.[1];
    return match ? [match] : [];
  }
  if (["java", "kt", "kts"].includes(ext)) {
    const match = trimmed.match(/^import\s+([^;\s]+)/u)?.[1];
    return match ? [match] : [];
  }
  if (["c", "h", "cpp"].includes(ext)) {
    const match = trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/u)?.[1];
    return match ? [match] : [];
  }
  if (ext === "rb") {
    const match = trimmed.match(/^(?:require|load)\s+["']([^"']+)["']/u)?.[1];
    return match ? [match] : [];
  }
  return [];
}

function hasReason(hunk: UndigestedHunk, code: string): boolean {
  return hunk.reasons.some((reason: RiskReason) => reason.code === code);
}

function dependencyVersion(value: string): string {
  return truncatePlain(normalizeInline(value), 24);
}

function normalizeOptional(value?: string): string | undefined {
  return value ? dependencyVersion(value) : undefined;
}

function cappedPlainList(values: readonly string[], cap: number): string {
  const shown = values.slice(0, cap).map((value) => truncatePlain(normalizeInline(value), 24));
  return `${shown.join(", ")}${values.length > cap ? "…" : ""}`;
}

function callableRef(value: string): string {
  const normalized = normalizeInline(value).replace(/\(\)$/u, "");
  return codeRef(`${normalized}()`);
}

function codeRef(value: string): string {
  return `\`${normalizeInline(value).replaceAll("`", "'")}\``;
}

function quotedText(value: string): string {
  return truncatePlain(normalizeInline(value).replaceAll("'", "’"), 64);
}

function limitText(value: string, maximum: number): string {
  const normalized = normalizeInline(value);
  if (normalized.length <= maximum) {
    return normalized;
  }
  const sliced = normalized.slice(0, maximum - 1).trimEnd();
  if ((sliced.match(/`/gu)?.length ?? 0) % 2 === 1) {
    return `${sliced.slice(0, maximum - 2).trimEnd()}\`…`;
  }
  return `${sliced}…`;
}

function truncatePlain(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeInline).filter(Boolean))].sort(compareAscii);
}

function uniqueStable(values: readonly string[]): string[] {
  return [...new Set(values)];
}
