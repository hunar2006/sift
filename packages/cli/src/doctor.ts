import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { discoverRepoRoot, loadCoverage, SIFT_VERSION } from "@sift-review/core";
import { claudeDir, hookLogPath, hooksStatus } from "@sift-review/claude-adapter";
import { detectEditor } from "./editor.js";

const execFileAsync = promisify(execFile);
const NODE_ENGINE = ">=22.13";
export const MCP_SETUP_COMMAND = "claude mcp add sift -- sift mcp";

export type DoctorState = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  state: DoctorState;
  label: string;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  version: string;
  checks: DoctorCheck[];
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface McpRegistrationStatus {
  readable: boolean;
  registered: boolean;
  path?: string;
}

export interface DoctorDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  version?: string;
  run?(bin: string, args: string[], cwd?: string): Promise<CommandResult>;
  discoverRepo?(cwd: string): Promise<string>;
  hooks?(repoRoot: string, project: boolean, env: NodeJS.ProcessEnv): Promise<boolean>;
  coverage?(repoRoot: string): Promise<string | undefined>;
  editor?(): Promise<string | undefined>;
  mcp?(repoRoot: string | undefined, env: NodeJS.ProcessEnv): Promise<McpRegistrationStatus>;
  readFile?(file: string): Promise<string>;
  provenancePath?(env: NodeJS.ProcessEnv): string;
}

/** Inspect the local machine without changing configuration or invoking third-party CLIs. */
export async function inspectDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const cwd = deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? runCommand;
  const findRepo = deps.discoverRepo ?? discoverRepoRoot;
  const checks: DoctorCheck[] = [];
  const nodeVersion = deps.nodeVersion ?? process.versions.node;

  checks.push(
    nodeAtLeast(nodeVersion, 22, 13)
      ? ok("node", `Node ${NODE_ENGINE}`, nodeVersion)
      : fail("node", `Node ${NODE_ENGINE}`, `${nodeVersion} found`, `nvm install 22.13`)
  );

  const git = await run("git", ["--version"], cwd);
  const gitReady = git.code === 0 && git.stdout.trim().length > 0;
  checks.push(
    gitReady
      ? ok("git", "Git", git.stdout.trim())
      : fail("git", "Git", "not found", installCommand("git", platform))
  );

  let repoRoot: string | undefined;
  if (gitReady) {
    try {
      repoRoot = await findRepo(cwd);
      checks.push(ok("repo", "Repository", "inside a Git repository"));
    } catch {
      checks.push(fail("repo", "Repository", "not inside a Git repository", "git init"));
    }
  } else {
    checks.push(fail("repo", "Repository", "Git is unavailable", installCommand("git", platform)));
  }

  const gh = await run("gh", ["--version"], cwd);
  const ghReady = gh.code === 0 && gh.stdout.trim().length > 0;
  checks.push(
    ghReady
      ? ok("gh", "GitHub CLI", gh.stdout.split(/\r?\n/u)[0]?.trim() || "installed")
      : warn("gh", "GitHub CLI", "not installed", installCommand("gh", platform))
  );
  if (!ghReady) {
    checks.push(warn("gh-auth", "GitHub authentication", "not checked (gh is unavailable)", installCommand("gh", platform)));
  } else {
    const auth = await run("gh", ["auth", "status"], cwd);
    checks.push(
      auth.code === 0
        ? ok("gh-auth", "GitHub authentication", "authenticated")
        : warn("gh-auth", "GitHub authentication", "not authenticated", "gh auth login")
    );
  }

  if (repoRoot) {
    const hookState = deps.hooks ?? hooksStatus;
    const [userHooks, projectHooks] = await Promise.all([
      hookState(repoRoot, false, env).catch(() => false),
      hookState(repoRoot, true, env).catch(() => false)
    ]);
    const hookDetail = `user ${userHooks ? "installed" : "missing"}; project ${projectHooks ? "installed" : "missing"}`;
    checks.push(userHooks || projectHooks ? ok("hooks", "Claude Code hooks", hookDetail) : warn("hooks", "Claude Code hooks", hookDetail, "sift setup"));
  } else {
    checks.push(warn("hooks", "Claude Code hooks", "not checked outside a repository", "cd <repo> && sift setup"));
  }

  const readFile = deps.readFile ?? ((file: string) => fs.readFile(file, "utf8"));
  const provenancePath = (deps.provenancePath ?? hookLogPath)(env);
  const provenance = await countLines(provenancePath, readFile);
  checks.push(
    provenance === undefined
      ? warn("provenance", "Provenance log", "not found", "sift hooks install")
      : ok("provenance", "Provenance log", `${provenance} entr${provenance === 1 ? "y" : "ies"}`)
  );

  if (repoRoot) {
    const coveragePath = await (deps.coverage ?? detectCoverageArtifact)(repoRoot).catch(() => undefined);
    checks.push(
      coveragePath
        ? ok("coverage", "Coverage artifact", path.relative(repoRoot, coveragePath).replaceAll("\\", "/") || path.basename(coveragePath))
        : warn("coverage", "Coverage artifact", "not found", "pnpm test -- --coverage")
    );
  } else {
    checks.push(warn("coverage", "Coverage artifact", "not checked outside a repository", "cd <repo> && pnpm test -- --coverage"));
  }

  const editor = await (deps.editor ?? detectedEditor)().catch(() => undefined);
  checks.push(editor ? ok("editor", "Editor", editor) : warn("editor", "Editor", "not found", "sift setup"));

  const mcp = await (deps.mcp ?? inspectMcpRegistration)(repoRoot, env);
  const mcpDetail = mcp.registered
    ? "registered"
    : mcp.readable
      ? "not registered"
      : "not verified";
  checks.push(
    mcp.registered
      ? ok("mcp", "MCP registration", mcpDetail)
      : warn("mcp", "MCP registration", mcpDetail, MCP_SETUP_COMMAND)
  );

  checks.push(
    hasTruecolor(env)
      ? ok("truecolor", "Terminal truecolor", "available")
      : warn("truecolor", "Terminal truecolor", "not detected", truecolorFix(platform))
  );
  checks.push(ok("sift", "Sift", `v${deps.version ?? SIFT_VERSION}; update hint: check npm when published`));

  return { version: deps.version ?? SIFT_VERSION, checks };
}

export function renderDoctor(report: DoctorReport): string {
  return [
    `Sift doctor (v${report.version})`,
    ...report.checks.flatMap((check) => [
      `${check.state === "ok" ? "✓" : "✗"} ${check.label}: ${check.detail}`,
      ...(check.fix ? [`  Fix: ${check.fix}`] : [])
    ])
  ].join("\n");
}

export function doctorJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}

export async function detectCoverageArtifact(repoRoot: string): Promise<string | undefined> {
  return (await loadCoverage(repoRoot, [])).coverage?.artifactPath;
}

export async function inspectMcpRegistration(repoRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<McpRegistrationStatus> {
  const configDir = claudeDir(env);
  const candidates = [
    path.join(path.dirname(configDir), ".claude.json"),
    path.join(configDir, "settings.json"),
    ...(repoRoot ? [path.join(repoRoot, ".mcp.json")] : [])
  ];
  let readable = false;
  for (const file of candidates) {
    const source = await fs.readFile(file, "utf8").catch(() => undefined);
    if (source === undefined) {
      continue;
    }
    readable = true;
    try {
      if (hasSiftMcp(JSON.parse(source) as unknown)) {
        return { readable: true, registered: true, path: file };
      }
    } catch {
      // A readable invalid config is still a useful distinction from an unavailable one.
    }
  }
  return { readable, registered: false };
}

function hasSiftMcp(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const servers = value.mcpServers;
  if (isRecord(servers) && isRecord(servers.sift)) {
    return true;
  }
  const mcp = value.mcp;
  return isRecord(mcp) && isRecord(mcp.sift);
}

async function detectedEditor(): Promise<string | undefined> {
  return (await detectEditor()) ?? undefined;
}

async function countLines(file: string, readFile: (file: string) => Promise<string>): Promise<number | undefined> {
  try {
    return (await readFile(file)).split(/\r?\n/u).filter(Boolean).length;
  } catch {
    return undefined;
  }
}

async function runCommand(bin: string, args: string[], cwd?: string): Promise<CommandResult> {
  try {
    const result = await execFileAsync(bin, args, { cwd, windowsHide: true });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof result.code === "number" ? result.code : 127,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : ""
    };
  }
}

function nodeAtLeast(version: string, major: number, minor: number): boolean {
  const match = version.match(/^(?:v)?(\d+)\.(\d+)/u);
  if (!match) {
    return false;
  }
  const actualMajor = Number.parseInt(match[1] ?? "", 10);
  const actualMinor = Number.parseInt(match[2] ?? "", 10);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

function hasTruecolor(env: NodeJS.ProcessEnv): boolean {
  return /truecolor|24bit/iu.test(env.COLORTERM ?? "") || /direct/iu.test(env.TERM ?? "") || Boolean(env.WT_SESSION);
}

function installCommand(tool: "git" | "gh", platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return tool === "git" ? "winget install --id Git.Git" : "winget install --id GitHub.cli";
  }
  if (platform === "darwin") {
    return `brew install ${tool}`;
  }
  return `sudo apt-get install ${tool}`;
}

function truecolorFix(platform: NodeJS.Platform): string {
  return platform === "win32" ? "$env:COLORTERM='truecolor'" : "export COLORTERM=truecolor";
}

function ok(id: string, label: string, detail: string): DoctorCheck {
  return { id, state: "ok", label, detail };
}

function warn(id: string, label: string, detail: string, fix?: string): DoctorCheck {
  return { id, state: "warn", label, detail, fix };
}

function fail(id: string, label: string, detail: string, fix: string): DoctorCheck {
  return { id, state: "fail", label, detail, fix };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
