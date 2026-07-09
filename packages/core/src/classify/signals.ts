import path from "node:path";
import type { DiffLine, HunkCategory, ParsedHunk, RiskReason } from "../types.js";
import { extension, normalizeRepoRelative, safeEvidence } from "../path-utils.js";
import { SIGNAL_WEIGHTS } from "../score.js";
import { isTestPath, isManifestPath } from "./categories.js";

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

export function computeRiskSignals(hunk: ParsedHunk, category: HunkCategory): RiskReason[] {
  const reasons: RiskReason[] = [...hunk.parserReasons];
  const file = normalizeRepoRelative(hunk.file);
  const added = hunk.lines.filter((line) => line.kind === "add");
  const removed = hunk.lines.filter((line) => line.kind === "del");

  if (SECURITY_PATH_RE.test(file)) {
    reasons.push({ code: "SEC_PATH", label: "Security-sensitive path", weight: SIGNAL_WEIGHTS.SEC_PATH });
  }

  pushFirstLineSignal(reasons, added, SECRET_RE_LIST, {
    code: "SECRET_LIKE",
    label: "Secret-like value added",
    weight: SIGNAL_WEIGHTS.SECRET_LIKE
  });
  pushFirstLineSignal(reasons, added, [TLS_RE], {
    code: "TLS_DISABLED",
    label: "Disables TLS verification",
    weight: SIGNAL_WEIGHTS.TLS_DISABLED
  });

  const dangerous = distinctLineMatches(added, DANGEROUS_RE_LIST);
  if (dangerous.length > 0) {
    reasons.push({
      code: "DANGEROUS_API",
      label: "Dangerous API usage added",
      weight: Math.min(
        dangerous.length * SIGNAL_WEIGHTS.DANGEROUS_API_SITE,
        SIGNAL_WEIGHTS.DANGEROUS_API_CAP
      ),
      line: dangerous[0]?.line.newLine,
      evidence: safeEvidence(dangerous.map((match) => match.line.text).join(" | "))
    });
  }

  pushFirstLineSignal(reasons, added, [SQL_CONCAT_RE], {
    code: "SQL_CONCAT",
    label: "SQL string appears concatenated",
    weight: SIGNAL_WEIGHTS.SQL_CONCAT
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
      label: "Error appears swallowed",
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

  if (category === "logic") {
    const weight = Math.floor(
      Math.min(hunk.addedLines, SIGNAL_WEIGHTS.LARGE_NOVEL_CAP_LINES) /
        SIGNAL_WEIGHTS.LARGE_NOVEL_UNIT
    );
    if (weight > 0) {
      reasons.push({
        code: "LARGE_NOVEL",
        label: "Large novel logic addition",
        weight
      });
    }
  }

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
        weight: Math.min(debugLines.length * 5, SIGNAL_WEIGHTS.DEBUG_LEFTOVER_CAP),
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
  meta: Pick<RiskReason, "code" | "label" | "weight">
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

function findSwallowedError(added: DiffLine[]): DiffLine | undefined {
  for (let index = 0; index < added.length; index += 1) {
    const line = added[index];
    if (!line || !/\b(catch|except)\b/.test(line.text)) {
      continue;
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

function isCiWorkflow(file: string): boolean {
  return file.startsWith(".github/workflows/") || file === ".gitlab-ci.yml" || file === "Jenkinsfile";
}

function migrationWeight(file: string, added: DiffLine[]): number {
  if (!/migrations?\//i.test(file) && extension(file) !== "sql") {
    return 0;
  }
  const text = added.map((line) => line.text).join("\n");
  let weight = SIGNAL_WEIGHTS.MIGRATION_BASE;
  if (/DROP TABLE|DROP COLUMN|DELETE FROM/i.test(text)) {
    weight += SIGNAL_WEIGHTS.MIGRATION_DROP;
  }
  if (/DELETE FROM/i.test(text) && !/DELETE FROM[^\n]+WHERE/i.test(text)) {
    weight += SIGNAL_WEIGHTS.MIGRATION_UNSCOPED_DELETE;
  }
  return Math.min(weight, 40);
}

function newDependencyNames(file: string, added: DiffLine[], removed: DiffLine[]): string[] {
  if (!isManifestPath(file)) {
    return [];
  }
  const removedDeps = new Set(removed.flatMap((line) => extractDependencyNames(file, line.text)));
  const addedDeps = added.flatMap((line) => extractDependencyNames(file, line.text));
  return [...new Set(addedDeps.filter((dep) => !removedDeps.has(dep)))];
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
