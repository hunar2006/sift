import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeDir } from "./paths.js";

const SIFT_HOOK = {
  matcher: "Edit|Write|MultiEdit",
  hooks: [{ type: "command", command: "sift hook-capture" }]
};

export type HookScope = "user" | "project";

export async function hooksStatus(repoRoot: string, project = false, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const settings = await readSettings(settingsPath(repoRoot, project ? "project" : "user", env));
  return settings ? hasSiftHook(settings) : false;
}

export async function installHooks(repoRoot: string, project = false, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const file = settingsPath(repoRoot, project ? "project" : "user", env);
  const settings = (await readSettings(file)) ?? {};
  if (hasSiftHook(settings)) {
    return file;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await backupIfExists(file);
  const next = mergeHook(settings);
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return file;
}

export async function uninstallHooks(repoRoot: string, project = false, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const file = settingsPath(repoRoot, project ? "project" : "user", env);
  const settings = await readSettings(file);
  if (!settings) {
    return file;
  }
  await backupIfExists(file);
  const next = removeHook(settings);
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return file;
}

export function settingsPath(repoRoot: string, scope: HookScope, env: NodeJS.ProcessEnv = process.env): string {
  return scope === "project"
    ? path.join(repoRoot, ".claude", "settings.json")
    : path.join(claudeDir(env), "settings.json");
}

function mergeHook(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const postToolUse = unknownArray(hooks.PostToolUse);
  hooks.PostToolUse = [...postToolUse, SIFT_HOOK];
  return { ...settings, hooks };
}

function removeHook(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const postToolUse = unknownArray(hooks.PostToolUse).filter((entry) => !isSiftHook(entry));
  if (postToolUse.length > 0) {
    hooks.PostToolUse = postToolUse;
  } else {
    delete hooks.PostToolUse;
  }
  const next: Record<string, unknown> = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return next;
}

function hasSiftHook(settings: Record<string, unknown>): boolean {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const postToolUse = unknownArray(hooks.PostToolUse);
  return postToolUse.some(isSiftHook);
}

function isSiftHook(entry: unknown): boolean {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return false;
  }
  return entry.hooks.some(
    (hook) => isRecord(hook) && hook.type === "command" && hook.command === "sift hook-capture"
  );
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((entry) => entry as unknown) : [];
}

async function readSettings(file: string): Promise<Record<string, unknown> | null> {
  const raw = await fs.readFile(file, "utf8").catch((error: unknown) => {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Claude settings at ${file} must contain a JSON object.`);
  }
  return parsed;
}

async function backupIfExists(file: string): Promise<void> {
  const exists = await fs.stat(file).then(
    () => true,
    () => false
  );
  if (exists) {
    await fs.copyFile(file, `${file}.bak-sift-${Math.floor(Date.now() / 1000)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
