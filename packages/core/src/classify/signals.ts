import path from "node:path";
import type { DiffLine, HunkCategory, ParsedHunk, RiskReason } from "../types.js";
import { extension, normalizeRepoRelative, safeEvidence } from "../path-utils.js";
import { SIGNAL_WEIGHTS } from "../score.js";
import { isTestPath, isManifestPath } from "./categories.js";
import { POPULAR_PACKAGE_NAMES } from "./signals/popular-packages.js";

export interface SignalContext {
  testScopes?: Set<string>;
  hasCoverageData?: boolean;
}

const SECURITY_PATH_RE =
  /(auth|security|crypt|password|token|secret|session|permission|acl|payment|billing|login|oauth)/i;
const SECRET_RE_LIST = [
  /(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{12,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY/,
  /ghp_[A-Za-z0-9]{36}/,
  /sk-[A-Za-z0-9]{20,}/
];
const TLS_RE =
  /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|curl .* -k( |$)/i;
const DANGEROUS_RE_LIST = [
  /\beval\(/,
  /new Function\(/,
  /child_process/,
  /execSync\(/,
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=/,
  /document\.write\(/,
  /\bexec\(/,
  /pickle\.load/,
  /subprocess\..*shell\s*=\s*True/,
  /os\.system\(/,
  /yaml\.load\((?!.*Loader)/,
  /rm -rf \//
];
const SQL_CONCAT_RE = /(["'`].*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b.*["'`]\s*\+)|(`.*\$\{.*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b)|(\bf".*\{.*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b)/i;
const ASSERT_RE = /assert|expect\(|should/i;
const SKIPPED_TEST_RE = /\.skip\(|\bxit\(|\bxdescribe\(|@pytest\.mark\.skip|\bt\.Skip\(/;
const PUBLIC_TS_RE =
  /^\s*export\s+(default\s+)?(async\s+)?(function|const|class|type|interface|enum)\b/;
const DEBUG_RE = /console\.log\(|\bprint\(|debugger;|binding\.pry/;
const TODO_RE = /\b(TODO|FIXME|HACK)\b/i;

export function computeRiskSignals(
  hunk: ParsedHunk,
  category: HunkCategory,
  context: SignalContext = {}
): RiskReason[] {
  const reasons: RiskReason[] = [...hunk.parserReasons];
  const file = normalizeRepoRelative(hunk.file);
  const added = hunk.lines.filter((line) => line.kind === "add");
  const removed = hunk.lines.filter((line) => line.kind === "del");
  const unchanged = hunk.lines.filter((line) => line.kind === "context");

  if (SECURITY_PATH_RE.test(file)) {
    reasons.push({ code: "SEC_PATH", label: "Security-sensitive path", weight: SIGNAL_WEIGHTS.SEC_PATH });
  }

  pushSecretSignals(reasons, added, category);
  pushFirstLineSignal(reasons, added, [TLS_RE], {
    code: "TLS_DISABLED",
    label: "Disables TLS verification",
    weight: SIGNAL_WEIGHTS.TLS_DISABLED
  });

  const dangerous = distinctLineMatches(added, DANGEROUS_RE_LIST);
  if (dangerous.length > 0) {
    const siteWeight =
      category === "tests" ? SIGNAL_WEIGHTS.DANGEROUS_API_TEST_SITE : SIGNAL_WEIGHTS.DANGEROUS_API_SITE;
    const cap = category === "tests" ? SIGNAL_WEIGHTS.DANGEROUS_API_TEST_CAP : SIGNAL_WEIGHTS.DANGEROUS_API_CAP;
    reasons.push({
      code: "DANGEROUS_API",
      label: "Dangerous API usage added",
      weight: Math.min(dangerous.length * siteWeight, cap),
      line: dangerous[0]?.line.newLine,
      evidence: safeEvidence(dangerous.map((match) => match.line.text).join(" | "))
    });
  }

  pushFirstLineSignal(reasons, added, [SQL_CONCAT_RE], {
    code: "SQL_CONCAT",
    label: "SQL string appears concatenated",
    weight: category === "tests" ? SIGNAL_WEIGHTS.SQL_CONCAT_TEST : SIGNAL_WEIGHTS.SQL_CONCAT
  });

  if (category === "tests") {
    const removedAssertions = removed.filter((line) => ASSERT_RE.test(line.text)).length;
    const addedAssertions = added.filter((line) => ASSERT_RE.test(line.text)).length;
    if (removedAssertions > addedAssertions) {
      reasons.push({
        code: "TEST_WEAKENED",
        label: "Test assertions were weakened",
        weight: SIGNAL_WEIGHTS.TEST_WEAKENED,
        evidence: `${removedAssertions} removed assertions, ${addedAssertions} added`
      });
    }
  }

  pushFirstLineSignal(reasons, added, [SKIPPED_TEST_RE], {
    code: "SKIPPED_TEST",
    label: "Test skip added",
    weight: SIGNAL_WEIGHTS.SKIPPED_TEST
  });

  const swallowed = findSwallowedError(added);
  if (swallowed) {
    reasons.push({
      code: "ERROR_SWALLOWED",
      label: "Error appears swallowed or broadly caught",
      weight: SIGNAL_WEIGHTS.ERROR_SWALLOWED,
      line: swallowed.newLine,
      evidence: safeEvidence(swallowed.text)
    });
  }

  if (isCiWorkflow(file)) {
    reasons.push({ code: "CI_WORKFLOW", label: "CI workflow changed", weight: SIGNAL_WEIGHTS.CI_WORKFLOW });
  }

  const migration = migrationWeight(file, added);
  if (migration > 0) {
    reasons.push({
      code: "MIGRATION",
      label: "Database migration changed",
      weight: migration,
      evidence: safeEvidence(added.map((line) => line.text).join(" "))
    });
  }

  if (path.posix.basename(file).startsWith(".env")) {
    reasons.push({ code: "ENV_FILE", label: "Environment file changed", weight: SIGNAL_WEIGHTS.ENV_FILE });
  }

  const newDeps = newDependencyNames(file, added, removed);
  if (newDeps.length > 0) {
    reasons.push({
      code: "NEW_DEPENDENCY",
      label: "New dependency added",
      weight: Math.min(
        newDeps.length * SIGNAL_WEIGHTS.NEW_DEPENDENCY_SITE,
        SIGNAL_WEIGHTS.NEW_DEPENDENCY_CAP
      ),
      line: added.find((line) => newDeps.some((dep) => line.text.includes(dep)))?.newLine,
      evidence: safeEvidence(newDeps.join(", "))
    });
  }
  const typoMatches = typosquatMatches(file, newDeps, [...removed, ...unchanged]);
  if (typoMatches.length > 0) {
    reasons.push({
      code: "TYPOSQUAT_SUSPECT",
      label: "New dependency resembles an existing or popular package",
      weight: SIGNAL_WEIGHTS.TYPOSQUAT_SUSPECT,
      line: added.find((line) => typoMatches.some((match) => line.text.includes(match.name)))?.newLine,
      evidence: safeEvidence(typoMatches.map((match) => `${match.name} ~ ${match.target}`).join(", "))
    });
  }

  if (isAgentGuidanceFile(file)) {
    reasons.push({
      code: "AGENT_GUIDANCE_EDIT",
      label: "Edits AI-agent guidance - verify the agent is not changing its own instructions",
      weight: SIGNAL_WEIGHTS.AGENT_GUIDANCE_EDIT
    });
  }

  const publicApiLine = [...added, ...removed].find((line) => isPublicApiLine(file, line));
  if (publicApiLine) {
    reasons.push({
      code: "PUBLIC_API",
      label: "Public API surface changed",
      weight: SIGNAL_WEIGHTS.PUBLIC_API,
      line: publicApiLine.newLine,
      evidence: safeEvidence(publicApiLine.text)
    });
  }

  const concurrency = concurrencyMatches(file, added, category);
  if (concurrency.length > 0) {
    reasons.push({
      code: "CONCURRENCY_HAZARD",
      label: "Concurrency primitive added",
      weight: Math.min(
        concurrency.length * SIGNAL_WEIGHTS.CONCURRENCY_HAZARD_SITE,
        SIGNAL_WEIGHTS.CONCURRENCY_HAZARD_CAP
      ),
      line: concurrency[0]?.line.newLine,
      evidence: safeEvidence(concurrency.map((match) => match.line.text).join(" | "))
    });
  }

  pushCoverageSignals(reasons, hunk, category, context);
  pushNovelUntestedSignal(reasons, hunk, category, context);

  if (hunk.isModeChange && hunk.newMode === "100755" && !reasons.some((reason) => reason.code === "MODE_EXEC")) {
    reasons.push({ code: "MODE_EXEC", label: "Mode changed to executable", weight: SIGNAL_WEIGHTS.MODE_EXEC });
  }

  if (category === "logic" && hunk.addedLines === 0 && hunk.removedLines > 50 && isLogicExtension(file)) {
    reasons.push({ code: "BIG_DELETION", label: "Large logic deletion", weight: SIGNAL_WEIGHTS.BIG_DELETION });
  }

  if (category === "logic" && !isTestPath(file)) {
    const debugLines = added.filter((line) => DEBUG_RE.test(line.text));
    if (debugLines.length > 0) {
      reasons.push({
        code: "DEBUG_LEFTOVER",
        label: "Debug statement left in logic",
        weight: Math.min(debugLines.length * SIGNAL_WEIGHTS.DEBUG_LEFTOVER_SITE, SIGNAL_WEIGHTS.DEBUG_LEFTOVER_CAP),
        tier: "nit",
        line: debugLines[0]?.newLine,
        evidence: safeEvidence(debugLines.map((line) => line.text).join(" | "))
      });
    }
  }

  const todoLine = added.find((line) => TODO_RE.test(line.text));
  if (todoLine) {
    reasons.push({
      code: "TODO_ADDED",
      label: "TODO-style marker added",
      weight: SIGNAL_WEIGHTS.TODO_ADDED,
      tier: "nit",
      line: todoLine.newLine,
      evidence: safeEvidence(todoLine.text)
    });
  }

  if (hunk.lines.some((line) => /Subproject commit/i.test(line.text))) {
    reasons.push({
      code: "SUBMODULE_BUMP",
      label: "Submodule pointer changed",
      weight: SIGNAL_WEIGHTS.SUBMODULE_BUMP
    });
  }

  return reasons;
}

function pushFirstLineSignal(
  reasons: RiskReason[],
  lines: DiffLine[],
  regexes: RegExp[],
  meta: Pick<RiskReason, "code" | "label" | "weight" | "tier">
): void {
  const match = lines.find((line) => regexes.some((regex) => regex.test(line.text)));
  if (!match) {
    return;
  }
  reasons.push({
    ...meta,
    line: match.newLine,
    evidence: safeEvidence(match.text)
  });
}

function pushSecretSignals(reasons: RiskReason[], added: DiffLine[], category: HunkCategory): void {
  const secretLikeLine = added.find((line) => lineMatchesAny(line.text, SECRET_RE_LIST));
  let secretWeight = 0;
  if (secretLikeLine) {
    reasons.push({
      code: "SECRET_LIKE",
      label: "Secret-like value added",
      weight: SIGNAL_WEIGHTS.SECRET_LIKE,
      line: secretLikeLine.newLine,
      evidence: safeEvidence(secretLikeLine.text)
    });
    secretWeight += SIGNAL_WEIGHTS.SECRET_LIKE;
  }
  if (category === "deps" || category === "generated") {
    return;
  }
  const entropy = findEntropySecret(added);
  if (!entropy) {
    return;
  }
  const remainingSecretWeight = SIGNAL_WEIGHTS.SECRET_COMBINED_CAP - secretWeight;
  const weight = Math.min(SIGNAL_WEIGHTS.SECRET_ENTROPY, Math.max(0, remainingSecretWeight));
  if (weight <= 0) {
    return;
  }
  reasons.push({
    code: "SECRET_ENTROPY",
    label: "High-entropy string literal added",
    weight,
    line: entropy.line.newLine,
    evidence: safeEvidence(`${entropy.value.slice(0, 80)} entropy ${entropy.entropy.toFixed(2)}`)
  });
}

function distinctLineMatches(lines: DiffLine[], regexes: RegExp[]): Array<{ line: DiffLine; key: string }> {
  const seen = new Set<string>();
  const matches: Array<{ line: DiffLine; key: string }> = [];
  for (const line of lines) {
    const regex = regexes.find((candidate) => candidate.test(line.text));
    if (!regex) {
      continue;
    }
    const key = `${regex.source}:${line.text.trim()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    matches.push({ line, key });
  }
  return matches;
}

function lineMatchesAny(text: string, regexes: RegExp[]): boolean {
  return regexes.some((regex) => regex.test(text));
}

function findEntropySecret(lines: DiffLine[]): { line: DiffLine; value: string; entropy: number } | undefined {
  for (const line of lines) {
    if (lineMatchesAny(line.text, SECRET_RE_LIST)) {
      continue;
    }
    for (const value of quotedStrings(line.text)) {
      if (/^https?:\/\//i.test(value) || !isEntropyCharset(value)) {
        continue;
      }
      const entropy = shannonEntropy(value);
      if (entropy >= 4.2) {
        return { line, value, entropy };
      }
    }
  }
  return undefined;
}

function quotedStrings(text: string): string[] {
  const strings: string[] = [];
  const quoted = /(["'`])((?:\\.|(?!\1).){20,})\1/g;
  let match = quoted.exec(text);
  while (match) {
    if (match[2]) {
      strings.push(match[2]);
    }
    match = quoted.exec(text);
  }
  return strings;
}

function isEntropyCharset(value: string): boolean {
  return /^[A-Za-z0-9+/_=.-]+$/.test(value);
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function findSwallowedError(added: DiffLine[]): DiffLine | undefined {
  for (let index = 0; index < added.length; index += 1) {
    const line = added[index];
    if (!line || !/\b(catch|except)\b/.test(line.text)) {
      continue;
    }
    if (isBroadExcept(line.text)) {
      return line;
    }
    const body = added
      .slice(index + 1, index + 4)
      .map((candidate) => candidate.text.trim())
      .filter((text) => text.length > 0 && text !== "}" && text !== "{");
    if (body.length === 0 || body.every((text) => text === "pass" || text.startsWith("//") || text.startsWith("#"))) {
      return line;
    }
  }
  return undefined;
}

function isBroadExcept(text: string): boolean {
  return /^\s*except\s*(?::|(?:Exception|BaseException)?(?:\s+as\s+\w+)?\s*:)/.test(text);
}

function isCiWorkflow(file: string): boolean {
  return file.startsWith(".github/workflows/") || file === ".gitlab-ci.yml" || file === "Jenkinsfile";
}

function migrationWeight(file: string, added: DiffLine[]): number {
  if (!/migrations?\//i.test(file) && extension(file) !== "sql") {
    return 0;
  }
  const text = added.map((line) => line.text).join("\n");
  let weight = SIGNAL_WEIGHTS.MIGRATION_BASE;
  if (/DROP\s+(TABLE|COLUMN)/i.test(text)) {
    weight += SIGNAL_WEIGHTS.MIGRATION_DROP;
  }
  if (/DELETE FROM/i.test(text) && !/DELETE FROM[^\n]+WHERE/i.test(text)) {
    weight += SIGNAL_WEIGHTS.MIGRATION_UNSCOPED_DELETE;
  }
  return Math.min(weight, SIGNAL_WEIGHTS.MIGRATION_CAP);
}

function newDependencyNames(file: string, added: DiffLine[], removed: DiffLine[]): string[] {
  if (!isManifestPath(file)) {
    return [];
  }
  const removedDeps = new Set(removed.flatMap((line) => extractDependencyNames(file, line.text)));
  const addedDeps = added.flatMap((line) => extractDependencyNames(file, line.text));
  return [...new Set(addedDeps.filter((dep) => !removedDeps.has(dep)))];
}

function typosquatMatches(
  file: string,
  newDeps: string[],
  comparisonLines: DiffLine[]
): Array<{ name: string; target: string }> {
  if (!isManifestPath(file)) {
    return [];
  }
  const localNames = comparisonLines.flatMap((line) => extractDependencyNames(file, line.text));
  const comparisonNames = uniqueNormalizedNames([...localNames, ...POPULAR_PACKAGE_NAMES]);
  const matches: Array<{ name: string; target: string; distance: number }> = [];
  for (const dep of newDeps) {
    const candidate = normalizePackageName(dep);
    if (candidate.length < 4) {
      continue;
    }
    let closest: { target: string; distance: number } | undefined;
    for (const target of comparisonNames) {
      if (candidate === target) {
        continue;
      }
      const distance = damerauLevenshtein(candidate, target);
      if (distance <= 2 && (!closest || distance < closest.distance)) {
        closest = { target, distance };
      }
    }
    if (closest) {
      matches.push({ name: dep, target: closest.target, distance: closest.distance });
    }
  }
  return matches.map(({ name, target }) => ({ name, target }));
}

function uniqueNormalizedNames(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => normalizePackageName(name)).filter(Boolean))];
}

function normalizePackageName(name: string): string {
  return name.trim().toLowerCase();
}

function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      );
      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        matrix[row]![col] = Math.min(matrix[row]![col]!, matrix[row - 2]![col - 2]! + 1);
      }
    }
  }
  return matrix[left.length]![right.length]!;
}

function extractDependencyNames(file: string, text: string): string[] {
  const trimmed = text.trim().replace(/,$/, "");
  const base = path.posix.basename(file);
  if (base === "package.json") {
    const match = trimmed.match(/^"([^"]+)":\s*"[^"]+"/);
    return match ? [match[1] ?? ""] .filter(Boolean) : [];
  }
  if (/requirements.*\.txt$/i.test(base)) {
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)/);
    return match ? [match[1] ?? ""] .filter(Boolean) : [];
  }
  if (base === "Cargo.toml") {
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
    return match ? [match[1] ?? ""] .filter(Boolean) : [];
  }
  if (base === "go.mod") {
    const match = trimmed.match(/^\s*([A-Za-z0-9_.\-/]+)\s+v?\d/);
    return match ? [match[1] ?? ""] .filter(Boolean) : [];
  }
  return [];
}

function isAgentGuidanceFile(file: string): boolean {
  const base = path.posix.basename(file);
  return (
    base === "CLAUDE.md" ||
    base === "AGENTS.md" ||
    file === ".cursorrules" ||
    file.startsWith(".cursor/rules/") ||
    file === ".github/copilot-instructions.md" ||
    /^\.claude\/settings.*\.json$/.test(file) ||
    (file.startsWith(".claude/") && file.endsWith(".md"))
  );
}

function concurrencyMatches(
  file: string,
  lines: DiffLine[],
  category: HunkCategory
): Array<{ line: DiffLine; key: string }> {
  if (category !== "logic") {
    return [];
  }
  const regexes = concurrencyRegexesFor(file);
  return distinctLineMatches(lines, regexes);
}

function concurrencyRegexesFor(file: string): RegExp[] {
  const ext = extension(file);
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    return [/new Worker\(/, /SharedArrayBuffer/, /Atomics\./, /worker_threads/];
  }
  if (ext === "py") {
    return [/threading\.Thread/, /\bmultiprocessing\b/, /\bLock\(\)/, /\bSemaphore\(/];
  }
  if (ext === "go") {
    return [/\bgo\s+func\(/, /sync\.Mutex/, /sync\.RWMutex/, /atomic\./];
  }
  if (ext === "rs") {
    return [/std::thread::spawn/, /tokio::spawn/, /\bMutex</, /\bRwLock</];
  }
  if (["java", "kt", "kts"].includes(ext)) {
    return [/\bsynchronized\b/, /\bReentrantLock\b/, /new Thread\(/];
  }
  return [];
}

function pushCoverageSignals(
  reasons: RiskReason[],
  hunk: ParsedHunk,
  category: HunkCategory,
  context: SignalContext
): void {
  if (category !== "logic" || !context.hasCoverageData || !hunk.coverage || hunk.coverage.total <= 0) {
    return;
  }
  const ratio = hunk.coverage.covered / hunk.coverage.total;
  if (hunk.addedLines >= 5 && hunk.coverage.covered === 0) {
    reasons.push({
      code: "UNTESTED_CHANGE",
      label: "Changed logic has no covered added lines",
      weight: SIGNAL_WEIGHTS.UNTESTED_CHANGE,
      evidence: coverageEvidence(hunk.coverage)
    });
  }
  if (!hunk.coverage.stale && ratio >= 0.8) {
    reasons.push({
      code: "COVERED_CHANGE",
      label: "Changed logic is covered by test evidence",
      weight: SIGNAL_WEIGHTS.COVERED_CHANGE,
      evidence: coverageEvidence(hunk.coverage)
    });
  }
}

function pushNovelUntestedSignal(
  reasons: RiskReason[],
  hunk: ParsedHunk,
  category: HunkCategory,
  context: SignalContext
): void {
  if (category !== "logic" || hunk.addedLines < 40) {
    return;
  }
  if (context.testScopes?.has(scopeKeyForPath(hunk.file))) {
    return;
  }
  const coverageRatio =
    context.hasCoverageData && hunk.coverage && hunk.coverage.total > 0
      ? hunk.coverage.covered / hunk.coverage.total
      : undefined;
  if (coverageRatio !== undefined && coverageRatio >= 0.3) {
    return;
  }
  reasons.push({
    code: "NOVEL_UNTESTED",
    label: "Large logic addition without nearby test evidence",
    weight:
      coverageRatio !== undefined
        ? SIGNAL_WEIGHTS.NOVEL_UNTESTED_COVERAGE_CONFIRMED
        : SIGNAL_WEIGHTS.NOVEL_UNTESTED,
    evidence:
      coverageRatio !== undefined
        ? coverageEvidence(hunk.coverage!)
        : `no test hunks under ${scopeKeyForPath(hunk.file)}`
  });
}

function coverageEvidence(coverage: { covered: number; total: number; stale: boolean }): string {
  return `${coverage.covered}/${coverage.total}${coverage.stale ? " stale" : ""}`;
}

export function scopeKeyForPath(file: string): string {
  const normalized = normalizeRepoRelative(file);
  return normalized.split("/").find((segment) => segment.length > 0) ?? ".";
}

function isPublicApiLine(file: string, line: DiffLine): boolean {
  const ext = extension(file);
  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    return PUBLIC_TS_RE.test(line.text);
  }
  if (ext === "py" && !isTestPath(file)) {
    return /^(def|class)\s+[A-Za-z][A-Za-z0-9_]*/.test(line.text.trim());
  }
  return false;
}

function isLogicExtension(file: string): boolean {
  return ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "c", "cpp", "h", "cs", "rb", "sh"].includes(
    extension(file)
  );
}
