import type { RiskReason, UndigestedHunk } from "./types.js";

export const BUILT_IN_PRIMARY_SIGNAL_CODES = [
  "SEC_PATH",
  "SECRET_LIKE",
  "SECRET_ENTROPY",
  "TLS_DISABLED",
  "DANGEROUS_API",
  "SQL_CONCAT",
  "TEST_WEAKENED",
  "SKIPPED_TEST",
  "ERROR_SWALLOWED",
  "CI_WORKFLOW",
  "MIGRATION",
  "ENV_FILE",
  "NEW_DEPENDENCY",
  "TYPOSQUAT_SUSPECT",
  "AGENT_GUIDANCE_EDIT",
  "PUBLIC_API",
  "CONCURRENCY_HAZARD",
  "UNTESTED_CHANGE",
  "COVERED_CHANGE",
  "NOVEL_UNTESTED",
  "MODE_EXEC",
  "BIG_DELETION",
  "SUBMODULE_BUMP",
  "TRUNCATED_LINE"
] as const;

export const BUILT_IN_NIT_SIGNAL_CODES = ["DEBUG_LEFTOVER", "TODO_ADDED"] as const;

export type BuiltInPrimarySignalCode = (typeof BUILT_IN_PRIMARY_SIGNAL_CODES)[number];

export interface DigestPhraseContext {
  reason: RiskReason;
  hunk: UndigestedHunk;
}

export type DigestPhraseFormatter = (context: DigestPhraseContext) => string;

export const DIGEST_PHRASES = {
  SEC_PATH: () => "Edits a security-sensitive path",
  SECRET_LIKE: () => "Adds a secret-like value",
  SECRET_ENTROPY: () => "Adds a high-entropy string literal",
  TLS_DISABLED: () => "Disables TLS certificate verification",
  DANGEROUS_API: ({ hunk }) =>
    primitivePhrase("Adds API or command usage", hunk, DANGEROUS_PRIMITIVES),
  SQL_CONCAT: () => "Builds a SQL statement with string concatenation",
  TEST_WEAKENED: () => "Removes more test assertions than it adds",
  SKIPPED_TEST: () => "Adds a test skip",
  ERROR_SWALLOWED: () => "Adds an empty or broad error handler",
  CI_WORKFLOW: () => "Edits a CI workflow",
  MIGRATION: () => "Edits a database migration",
  ENV_FILE: () => "Edits an environment file",
  NEW_DEPENDENCY: ({ reason }) => dependencyPhrase(reason.evidence),
  TYPOSQUAT_SUSPECT: ({ reason }) => typosquatPhrase(reason.evidence),
  AGENT_GUIDANCE_EDIT: () => "Edits AI-agent guidance file",
  PUBLIC_API: () => "Changes a public API declaration",
  CONCURRENCY_HAZARD: ({ hunk }) =>
    primitivePhrase("Adds concurrency primitive", hunk, CONCURRENCY_PRIMITIVES),
  UNTESTED_CHANGE: () => "Coverage marks no added lines covered",
  COVERED_CHANGE: () => "Coverage marks at least 80% of changed lines covered",
  NOVEL_UNTESTED: () => "Adds 40+ logic lines without nearby test changes",
  MODE_EXEC: () => "Changes file mode to executable",
  BIG_DELETION: ({ hunk }) => `Removes ${hunk.removedLines} lines of logic`,
  SUBMODULE_BUMP: () => "Changes a submodule pointer",
  TRUNCATED_LINE: () => "Truncates an oversized diff line for display"
} satisfies Record<BuiltInPrimarySignalCode, DigestPhraseFormatter>;

const DANGEROUS_PRIMITIVES = [
  "dangerouslySetInnerHTML",
  "document.write(",
  "new Function(",
  "pickle.load",
  "execSync(",
  "child_process",
  "innerHTML",
  "subprocess",
  "os.system(",
  "yaml.load(",
  "rm -rf /",
  "eval(",
  "exec("
] as const;

const CONCURRENCY_PRIMITIVES = [
  "SharedArrayBuffer",
  "threading.Thread",
  "std::thread::spawn",
  "worker_threads",
  "multiprocessing",
  "ReentrantLock",
  "new Worker(",
  "new Thread(",
  "sync.RWMutex",
  "sync.Mutex",
  "tokio::spawn",
  "Semaphore(",
  "Atomics.",
  "atomic.",
  "go func(",
  "Mutex<",
  "RwLock<",
  "Lock("
] as const;

export function phraseForReason(reason: RiskReason, hunk: UndigestedHunk): string | undefined {
  if (isBuiltInPrimarySignalCode(reason.code)) {
    return DIGEST_PHRASES[reason.code]({ reason, hunk });
  }
  if (reason.code.startsWith("USER_")) {
    return `Matches configured rule ${codeRef(reason.code)}`;
  }
  return undefined;
}

export function isBuiltInPrimarySignalCode(code: string): code is BuiltInPrimarySignalCode {
  return Object.prototype.hasOwnProperty.call(DIGEST_PHRASES, code);
}

function primitivePhrase(prefix: string, hunk: UndigestedHunk, primitives: readonly string[]): string {
  const added = hunk.lines.filter((line) => line.kind === "add").map((line) => line.text);
  const primitive = primitives.find((candidate) => added.some((line) => line.includes(candidate)));
  return primitive ? `${prefix}: ${codeRef(primitive)}` : prefix;
}

function dependencyPhrase(evidence?: string): string {
  const names = evidence
    ?.split(",")
    .map((name) => normalizeInline(name))
    .filter(Boolean);
  if (!names || names.length === 0) {
    return "Adds a dependency";
  }
  if (names.length === 1) {
    return `Adds dependency ${codeRef(names[0] ?? "dependency")}`;
  }
  return `Adds dependencies: ${names.slice(0, 3).map(codeRef).join(", ")}${names.length > 3 ? "…" : ""}`;
}

function typosquatPhrase(evidence?: string): string {
  const first = evidence?.split(",")[0] ?? "";
  const [name, target] = first.split("~").map((part) => normalizeInline(part));
  return name && target
    ? `New dependency ${codeRef(name)} resembles ${codeRef(target)}`
    : "Adds a dependency with a near-match package name";
}

function codeRef(value: string): string {
  return `\`${normalizeInline(value).replaceAll("`", "'")}\``;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
