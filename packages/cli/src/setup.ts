import { createInterface } from "node:readline/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import { discoverRepoRoot, runGit, siftDir } from "@sift-review/core";
import { hooksStatus, installHooks, uninstallHooks } from "@sift-review/claude-adapter";
import { detectCoverageArtifact, MCP_SETUP_COMMAND } from "./doctor.js";
import { detectEditor } from "./editor.js";
import { runInit } from "./init.js";
import { isInteractiveTerminal } from "./onboarding.js";

export const PRE_PUSH_START = "# >>> sift setup >>>";
export const PRE_PUSH_END = "# <<< sift setup <<<";
const PRE_PUSH_BLOCK_PATTERN = /(^|\r?\n)# >>> sift setup >>>\r?\n[\s\S]*?\r?\n# <<< sift setup <<<(?:\r?\n|$)/u;

export interface SetupIo {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream & { isTTY?: boolean };
}

export interface SetupOptions {
  remove?: boolean;
  io?: SetupIo;
}

export interface SetupDeps {
  env?: NodeJS.ProcessEnv;
  discoverRepo?(cwd: string): Promise<string>;
  installHooks?(repoRoot: string, project: boolean, env: NodeJS.ProcessEnv): Promise<string>;
  uninstallHooks?(repoRoot: string, project: boolean, env: NodeJS.ProcessEnv): Promise<string>;
  hooksStatus?(repoRoot: string, project: boolean, env: NodeJS.ProcessEnv): Promise<boolean>;
  detectEditor?(): Promise<string | null>;
  detectCoverage?(repoRoot: string): Promise<string | undefined>;
  prompt?(question: string, io: SetupIo): Promise<string>;
  now?(): number;
}

interface SetupState {
  version: 1;
  config: Record<string, ConfigChange>;
  created: Record<string, string>;
  hooks: Record<SetupHookScope, boolean>;
}

interface ConfigChange {
  had: boolean;
  before: unknown;
  after: unknown;
}

type PrePushChange = "installed" | "exists" | "removed" | "absent";
type SetupHookScope = "user" | "project";

/** Run the reversible local setup flow. It never invokes the Claude CLI. */
export async function runSetup(cwd = process.cwd(), options: SetupOptions = {}, deps: SetupDeps = {}): Promise<string[]> {
  const repoRoot = await (deps.discoverRepo ?? discoverRepoRoot)(cwd);
  const io = options.io ?? { input: process.stdin, output: process.stdout };
  if (options.remove) {
    return removeSetup(repoRoot, deps);
  }
  if (!isInteractiveTerminal(io)) {
    return setupManualLines();
  }

  const initNotes = await runInit(repoRoot);
  await recordSetupStarters(repoRoot, initNotes);
  const lines = ["Sift setup", ...initNotes];
  const prompt = deps.prompt ?? promptLine;
  const env = deps.env ?? process.env;
  const changes: Record<string, unknown> = {};
  const config = await readConfig(repoRoot);

  if (isYes(await prompt("Install Claude Code hooks? [Y/n] ", io), true)) {
    const project = isYes(await prompt("Install in project scope instead of user scope? [y/N] ", io), false);
    const scope: SetupHookScope = project ? "project" : "user";
    const existing = await (deps.hooksStatus ?? hooksStatus)(repoRoot, project, env);
    await (deps.installHooks ?? installHooks)(repoRoot, project, env);
    if (!existing) {
      await recordSetupHook(repoRoot, scope);
    }
    lines.push(`hooks: ${scope} scope ${existing ? "already ready" : "ready"}`);
  } else {
    lines.push("hooks: skipped");
  }

  if (isYes(await prompt("Install a reversible pre-push review gate? [Y/n] ", io), true)) {
    const debt = parseDebt(await prompt("Maximum review debt [40]: ", io));
    const gate = await installPrePushGate(repoRoot, debt, deps.now);
    lines.push(`pre-push gate: ${gate}`);
  } else {
    lines.push("pre-push gate: skipped");
  }

  const editor = await (deps.detectEditor ?? detectEditor)();
  if (editor && isYes(await prompt(`Use ${editor} as the editor? [Y/n] `, io), true)) {
    changes.editor = editor;
    lines.push(`editor: ${editor}`);
  } else if (!editor) {
    lines.push("editor: not detected (run sift setup after installing code or cursor)");
  }

  const currentReasons = Array.isArray(config.flagReasons) ? config.flagReasons.filter((item): item is string => typeof item === "string") : [];
  const reasonAnswer = await prompt(`Flag reasons, comma-separated [${currentReasons.join(", ")}]: `, io);
  const reasons = reasonAnswer.split(",").map((item) => item.trim()).filter(Boolean);
  if (reasons.length > 0) {
    changes.flagReasons = reasons;
    lines.push(`flag reasons: ${reasons.length} saved`);
  } else {
    lines.push("flag reasons: kept");
  }

  const coverage = await (deps.detectCoverage ?? detectCoverageArtifact)(repoRoot).catch(() => undefined);
  if (coverage) {
    const relativeCoverage = configPathValue(repoRoot, coverage);
    if (isYes(await prompt(`Use detected coverage ${relativeCoverage}? [Y/n] `, io), true)) {
      changes.coverage = [relativeCoverage];
      lines.push(`coverage: ${relativeCoverage}`);
    }
  } else {
    lines.push("coverage: not detected (add an LCOV or Cobertura artifact later)");
  }

  lines.push(...(await updateSetupConfig(repoRoot, changes)));
  lines.push(`MCP: run ${MCP_SETUP_COMMAND}`);
  return [...lines, ...dailyLoopCard()];
}

export function setupManualLines(): string[] {
  return [
    "Sift setup needs a TTY; no files were changed.",
    "Manual setup:",
    "  1. sift hooks install",
    "  2. sift setup                 # choose editor, reasons, and coverage",
    `  3. ${MCP_SETUP_COMMAND}`,
    "  4. sift check --max-debt 40",
    ...dailyLoopCard()
  ];
}

export function dailyLoopCard(): string[] {
  return [
    "Daily loop:",
    "  1. Agent works",
    "  2. sift --watch or sift last",
    "  3. a approve / x flag / R revert",
    "  4. sift brief for fixes",
    "  5. sift check --max-debt 40",
    "  6. ? for keys"
  ];
}

/** Append a marked gate without replacing foreign hook content. */
export async function installPrePushGate(repoRoot: string, maxDebt = 40, now: () => number = Date.now): Promise<PrePushChange> {
  // Confirmed reversible v0.7 amendment: only this marker block is written or later removed.
  const debt = validateDebt(maxDebt);
  const file = await prePushPath(repoRoot);
  const current = await fs.readFile(file, "utf8").catch((error: unknown) => {
    if (isMissingFile(error)) {
      return "";
    }
    throw error;
  });
  if (hasPrePushBlock(current)) {
    return "exists";
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (current) {
    await backupHook(file, now);
  }
  const prefix = current ? `${current.endsWith("\n") ? current : `${current}\n`}` : "#!/bin/sh\n";
  await fs.writeFile(file, `${prefix}${prePushBlock(debt)}\n`, "utf8");
  await fs.chmod(file, 0o755).catch(() => undefined);
  return "installed";
}

/** Remove only the setup-owned marker block; foreign hook content stays untouched. */
export async function removePrePushGate(repoRoot: string, now: () => number = Date.now): Promise<PrePushChange> {
  const file = await prePushPath(repoRoot);
  const current = await fs.readFile(file, "utf8").catch((error: unknown) => {
    if (isMissingFile(error)) {
      return "";
    }
    throw error;
  });
  if (!hasPrePushBlock(current)) {
    return "absent";
  }
  await backupHook(file, now);
  await fs.writeFile(file, stripPrePushBlock(current), "utf8");
  return "removed";
}

export function prePushBlock(maxDebt = 40): string {
  return [PRE_PUSH_START, `sift check --max-debt ${validateDebt(maxDebt)}`, PRE_PUSH_END].join("\n");
}

export function stripPrePushBlock(content: string): string {
  return content.replace(PRE_PUSH_BLOCK_PATTERN, "$1");
}

export async function updateSetupConfig(repoRoot: string, updates: Record<string, unknown>): Promise<string[]> {
  if (Object.keys(updates).length === 0) {
    return [];
  }
  const config = await readConfig(repoRoot);
  const state = await readSetupState(repoRoot);
  const changed: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (sameValue(config[key], value)) {
      continue;
    }
    const prior = state.config[key];
    state.config[key] = prior ?? { had: Object.hasOwn(config, key), before: config[key], after: value };
    state.config[key].after = value;
    config[key] = value;
    changed.push(key);
  }
  if (changed.length === 0) {
    return [];
  }
  await fs.writeFile(configFile(repoRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.writeFile(setupStateFile(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return [`config: ${changed.join(", ")} saved`];
}

async function removeSetup(repoRoot: string, deps: SetupDeps): Promise<string[]> {
  const env = deps.env ?? process.env;
  const uninstall = deps.uninstallHooks ?? uninstallHooks;
  const state = await readSetupState(repoRoot);
  const scopes = (Object.keys(state.hooks) as SetupHookScope[]).filter((scope) => state.hooks[scope]);
  await Promise.all(scopes.map((scope) => uninstall(repoRoot, scope === "project", env)));
  for (const scope of scopes) {
    state.hooks[scope] = false;
  }
  if (scopes.length > 0) {
    await fs.writeFile(setupStateFile(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  const gate = await removePrePushGate(repoRoot, deps.now);
  const restored = await restoreSetupConfig(repoRoot);
  return [
    "Sift setup removal",
    `hooks: ${scopes.length > 0 ? `removed from ${scopes.join(" and ")} scope${scopes.length === 1 ? "" : "s"}` : "no setup-owned hooks to remove"}`,
    `pre-push gate: ${gate}`,
    ...restored
  ];
}

async function restoreSetupConfig(repoRoot: string): Promise<string[]> {
  const state = await readSetupState(repoRoot);
  if (Object.keys(state.config).length === 0 && Object.keys(state.created).length === 0) {
    return ["config: no setup-owned values to remove"];
  }
  let config: Record<string, unknown>;
  try {
    config = await readConfig(repoRoot);
  } catch {
    return ["config: retained because it is not valid JSON"];
  }
  let restored = 0;
  let retained = 0;
  for (const [key, change] of Object.entries(state.config)) {
    if (!sameValue(config[key], change.after)) {
      retained += 1;
      continue;
    }
    if (change.had) {
      config[key] = change.before;
    } else {
      delete config[key];
    }
    delete state.config[key];
    restored += 1;
  }
  if (restored > 0) {
    await fs.writeFile(configFile(repoRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  let removedStarters = 0;
  for (const [relative, initial] of Object.entries(state.created)) {
    const file = path.join(repoRoot, ...relative.split("/"));
    const current = await fs.readFile(file, "utf8").catch(() => undefined);
    if (current !== initial) {
      retained += 1;
      continue;
    }
    await fs.unlink(file);
    delete state.created[relative];
    removedStarters += 1;
  }
  if (Object.keys(state.config).length === 0 && Object.keys(state.created).length === 0) {
    await fs.unlink(setupStateFile(repoRoot)).catch(() => undefined);
    await fs.rmdir(siftDir(repoRoot)).catch(() => undefined);
  } else {
    await fs.writeFile(setupStateFile(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  return [
    `config: ${restored} restored${removedStarters ? `; ${removedStarters} starter${removedStarters === 1 ? "" : "s"} removed` : ""}${retained ? `; ${retained} retained after user edits` : ""}`
  ];
}

async function readConfig(repoRoot: string): Promise<Record<string, unknown>> {
  const source = await fs.readFile(configFile(repoRoot), "utf8");
  try {
    const config = JSON.parse(source) as unknown;
    if (isRecord(config)) {
      return config;
    }
  } catch {
    // Keep the public error message concise and actionable.
  }
  throw new Error(".sift/config.json must contain a JSON object; fix it before running sift setup.");
}

async function readSetupState(repoRoot: string): Promise<SetupState> {
  const source = await fs.readFile(setupStateFile(repoRoot), "utf8").catch(() => "");
  if (!source) {
    return { version: 1, config: {}, created: {}, hooks: { user: false, project: false } };
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (isRecord(parsed) && parsed.version === 1 && isRecord(parsed.config)) {
      return {
        version: 1,
        config: parsed.config as Record<string, ConfigChange>,
        created: isRecord(parsed.created) ? (parsed.created as Record<string, string>) : {},
        hooks: {
          user: isRecord(parsed.hooks) && parsed.hooks.user === true,
          project: isRecord(parsed.hooks) && parsed.hooks.project === true
        }
      };
    }
  } catch {
    // Preserve an unreadable state file by treating it as user-owned configuration.
  }
  return { version: 1, config: {}, created: {}, hooks: { user: false, project: false } };
}

async function recordSetupStarters(repoRoot: string, notes: string[]): Promise<void> {
  const starters = new Set([".sift/config.json", ".sift/rules.yml"]);
  const created = notes
    .filter((note) => note.startsWith("wrote"))
    .map((note) => note.slice("wrote".length).trim().replaceAll("\\", "/"))
    .filter((file) => starters.has(file));
  if (created.length === 0) {
    return;
  }
  const state = await readSetupState(repoRoot);
  for (const relative of created) {
    state.created[relative] = await fs.readFile(path.join(repoRoot, ...relative.split("/")), "utf8");
  }
  await fs.writeFile(setupStateFile(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function recordSetupHook(repoRoot: string, scope: SetupHookScope): Promise<void> {
  const state = await readSetupState(repoRoot);
  state.hooks[scope] = true;
  await fs.writeFile(setupStateFile(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function prePushPath(repoRoot: string): Promise<string> {
  const gitPath = (await runGit(["rev-parse", "--git-path", "hooks/pre-push"], repoRoot, true)).trim();
  return path.resolve(repoRoot, gitPath || path.join(".git", "hooks", "pre-push"));
}

async function backupHook(file: string, now: () => number): Promise<void> {
  const base = `${file}.bak-sift-${Math.floor(now() / 1000)}`;
  let backup = base;
  let suffix = 2;
  while (await exists(backup)) {
    backup = `${base}-${suffix}`;
    suffix += 1;
  }
  await fs.copyFile(file, backup);
}

function configFile(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "config.json");
}

function setupStateFile(repoRoot: string): string {
  return path.join(siftDir(repoRoot), "setup.json");
}

function configPathValue(repoRoot: string, artifact: string): string {
  const relative = path.relative(repoRoot, artifact).replaceAll("\\", "/");
  return relative && !relative.startsWith("../") && !path.isAbsolute(relative) ? relative : artifact;
}

function parseDebt(value: string): number {
  return value.trim() ? validateDebt(Number(value)) : 40;
}

function validateDebt(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Maximum review debt must be a number from 0 to 100.");
  }
  return value;
}

function hasPrePushBlock(content: string): boolean {
  return content.includes(PRE_PUSH_START) && content.includes(PRE_PUSH_END);
}

function isYes(answer: string, fallback: boolean): boolean {
  const value = answer.trim().toLowerCase();
  return value ? value === "y" || value === "yes" : fallback;
}

async function promptLine(question: string, io: SetupIo): Promise<string> {
  const prompt = createInterface({ input: io.input, output: io.output });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
