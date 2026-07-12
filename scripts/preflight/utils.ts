import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export interface CommandResult {
  command: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } 
): Promise<CommandResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      // Windows only needs a command shell for .cmd launchers (pnpm/npm/the
      // installed bin). Passing node.exe through cmd.exe loses its quoted path.
      shell: process.platform === "win32" && /\.cmd$/iu.test(command),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += error.message;
    });
    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (timedOut) {
        stderr = `${stderr}\nTimed out after ${options.timeoutMs} ms.`;
      }
      resolve({
        command,
        args,
        code: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        durationMs: performance.now() - started
      });
    });
  });
}

export function commandText(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

export function commandFailure(result: CommandResult): string {
  const text = commandText(result).replace(/\s+/gu, " ").trim();
  return `${result.command} ${result.args.join(" ")} exited ${result.code}${text ? `: ${text.slice(0, 500)}` : ""}`;
}

export function isNetworkFailure(value: string): boolean {
  return /ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|unable to access|could not resolve|proxy/i.test(value);
}

export function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export function loadYaml(root: string): { parse(text: string): unknown } {
  const require = createRequire(path.join(root, "packages", "cli", "package.json"));
  return require("yaml") as { parse(text: string): unknown };
}

/** Reads npm's small ustar archive without relying on a POSIX tar binary. */
export async function readTgzEntries(filePath: string): Promise<Map<string, Buffer>> {
  const bytes = gunzipSync(await fs.readFile(filePath));
  const entries = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    if (!name) {
      break;
    }
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const bodyStart = offset + 512;
    entries.set(entryPath, bytes.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function walkTextFiles(root: string, callback: (filePath: string, content: string) => Promise<void>): Promise<void> {
  const ignored = new Set([".git", "node_modules", "dist", "coverage", ".evalcache", "preflight-artifacts"]);
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          await visit(path.join(dir, entry.name));
        }
      } else if (/\.(?:ts|tsx|mjs|cjs|js|json|md|yml|yaml|html|css)$/u.test(entry.name)) {
        const filePath = path.join(dir, entry.name);
        await callback(filePath, await fs.readFile(filePath, "utf8"));
      }
    }
  };
  await visit(root);
}

export function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}
