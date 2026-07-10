import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDemoRepo } from "../packages/core/src/demo.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(root, "packages", "cli");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pack-check-"));

try {
  await run(pnpm, ["build"], root);
  const packed = JSON.parse(
    await run(npm, ["pack", "--json", "--pack-destination", scratch], cliDir)
  ) as Array<{ filename?: string }>;
  const filename = packed[0]?.filename;
  if (!filename) {
    throw new Error("npm pack did not produce a CLI tarball.");
  }
  const tarball = path.join(scratch, filename);
  await fs.writeFile(path.join(scratch, "package.json"), JSON.stringify({ private: true, name: "sift-pack-check" }), "utf8");
  await run(npm, ["install", "--ignore-scripts", tarball], scratch);

  const installedRoot = path.join(scratch, "node_modules", "@sift-review", "cli");
  for (const asset of [
    "dist/index.js",
    "dist/web/index.html",
    "dist/grammars/tree-sitter-typescript.wasm",
    "dist/grammars/tree-sitter-tsx.wasm",
    "dist/grammars/tree-sitter-javascript.wasm",
    "dist/grammars/tree-sitter-python.wasm",
    "dist/grammars/tree-sitter-go.wasm"
  ]) {
    await fs.access(path.join(installedRoot, asset)).catch(() => {
      throw new Error(`Installed package is missing ${asset}.`);
    });
  }

  const demo = await createDemoRepo({ rootDir: path.join(scratch, "demo") });
  const bin = path.join(scratch, "node_modules", ".bin", process.platform === "win32" ? "sift.cmd" : "sift");
  await run(bin, ["--version"], scratch);
  const printed = JSON.parse(await run(bin, ["print", "--json"], demo.repoRoot, demo.env)) as { headline?: unknown };
  if (!printed.headline) {
    throw new Error("Installed sift print did not return a triage payload.");
  }
  console.log("pack-check ok: installed binary and package-local assets resolved.");
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env,
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout.toString();
}
