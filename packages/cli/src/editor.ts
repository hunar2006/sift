import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewModel } from "@sift-review/core";

const execFileAsync = promisify(execFile);
const KNOWN_EDITORS = new Set(["code", "cursor"]);
const SHELL_META = /[|&;<>()$`\\"'%!^]/u;

export interface EditorCommand {
  bin: string;
  args: string[];
}

export interface EditorDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  comspec?: string;
  exists?(filePath: string): Promise<boolean>;
  execute?(bin: string, args: string[]): Promise<void>;
}

export class EditorNotFoundError extends Error {
  constructor() {
    super('No editor found — set "editor" in .sift/config.json');
    this.name = "EditorNotFoundError";
  }
}

/**
 * This is the narrow editor exception to Sift's no-process-spawning rule:
 * only a configured/allowlisted editor is invoked with execFile and argv.
 * User strings are never evaluated by a shell.
 */
export async function openHunkInEditor(repoRoot: string, model: ReviewModel, hunkId: string, deps: EditorDeps = {}): Promise<void> {
  const hunk = model.hunks.find((candidate) => candidate.id === hunkId);
  if (!hunk) {
    throw new Error("Unknown hunk.");
  }
  const filePath = resolveRepoFile(repoRoot, hunk.file);
  const changedLine = hunk.lines.find((candidate) => candidate.kind !== "context");
  const line = changedLine?.newLine ?? changedLine?.oldLine ?? hunk.newStart ?? hunk.oldStart ?? 1;
  const command = await resolveEditor(repoRoot, filePath, line, deps);
  if (!command) {
    throw new EditorNotFoundError();
  }
  const launch = editorLaunchCommand(command, deps.platform ?? process.platform, deps.comspec ?? process.env.ComSpec ?? "cmd.exe");
  const execute = deps.execute ?? ((bin: string, args: string[]) => execFileAsync(bin, args, { windowsHide: true }).then(() => undefined));
  await execute(launch.bin, launch.args);
}

/** Windows exposes the supported editor CLIs as .cmd shims, which execFile cannot launch directly. */
export function editorLaunchCommand(command: EditorCommand, platform = process.platform, comspec = process.env.ComSpec ?? "cmd.exe"): EditorCommand {
  if (platform === "win32" && KNOWN_EDITORS.has(command.bin)) {
    return { bin: comspec, args: ["/d", "/s", "/c", command.bin, ...command.args] };
  }
  return command;
}

export async function resolveEditor(repoRoot: string, filePath: string, line: number, deps: EditorDeps = {}): Promise<EditorCommand | null> {
  const configured = await readConfiguredEditor(repoRoot);
  if (configured) {
    return commandForSetting(configured, filePath, line);
  }
  const detected = await detectEditor(deps);
  return detected ? knownCommand(detected, filePath, line) : null;
}

/** Return a PATH-resolvable supported editor without reading user configuration. */
export async function detectEditor(deps: EditorDeps = {}): Promise<string | null> {
  const exists = deps.exists ?? executableExists;
  for (const bin of KNOWN_EDITORS) {
    if (await existsOnPath(bin, deps.env ?? process.env, exists)) {
      return bin;
    }
  }
  return null;
}

export function commandForSetting(setting: string, filePath: string, line: number): EditorCommand {
  const trimmed = setting.trim();
  if (KNOWN_EDITORS.has(trimmed)) {
    return knownCommand(trimmed, filePath, line);
  }
  const parts = trimmed.split(/\s+/u).filter(Boolean);
  const [bin, ...templateArgs] = parts;
  if (!bin || SHELL_META.test(bin)) {
    throw new Error("Editor template has an unsafe binary.");
  }
  if (!templateArgs.some((arg) => arg.includes("%f")) || !templateArgs.some((arg) => arg.includes("%l"))) {
    throw new Error("Editor template must include %f and %l.");
  }
  return {
    bin,
    args: templateArgs.map((arg) => arg.replaceAll("%f", filePath).replaceAll("%l", String(line)))
  };
}

function knownCommand(bin: string, filePath: string, line: number): EditorCommand {
  return { bin, args: ["-g", `${filePath}:${line}`] };
}

async function readConfiguredEditor(repoRoot: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(repoRoot, ".sift", "config.json"), "utf8"));
    const editor = parsed && typeof parsed === "object" && "editor" in parsed ? (parsed as { editor?: unknown }).editor : undefined;
    return typeof editor === "string" && editor.trim() ? editor : undefined;
  } catch {
    return undefined;
  }
}

function resolveRepoFile(repoRoot: string, repoRelativeFile: string): string {
  const resolved = path.resolve(repoRoot, ...repoRelativeFile.replaceAll("\\", "/").split("/"));
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Hunk path is outside the repository.");
  }
  return resolved;
}

async function existsOnPath(bin: string, env: NodeJS.ProcessEnv, exists: (filePath: string) => Promise<boolean>): Promise<boolean> {
  const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      if (await exists(path.join(directory, `${bin}${extension.toLowerCase()}`))) {
        return true;
      }
      if (extension && await exists(path.join(directory, `${bin}${extension.toUpperCase()}`))) {
        return true;
      }
    }
  }
  return false;
}

async function executableExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
