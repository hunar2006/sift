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
  ) as Array<{ filename?: string; name?: string; files?: Array<{ path: string }> }>;
  const meta = packed[0];
  const filename = meta?.filename;
  if (!filename) {
    throw new Error("npm pack did not produce a CLI tarball.");
  }
  if (meta?.name !== "siftdiff") {
    throw new Error(`Expected packed package name "siftdiff", got "${meta?.name ?? "unknown"}".`);
  }
  console.log(`pack-check: tarball ${filename} contains:`);
  for (const entry of meta.files ?? []) {
    console.log(`  ${entry.path}`);
  }
  const tarball = path.join(scratch, filename);
  await fs.writeFile(path.join(scratch, "package.json"), JSON.stringify({ private: true, name: "sift-pack-check" }), "utf8");
  await run(npm, ["install", "--ignore-scripts", tarball], scratch);

  const installedRoot = path.join(scratch, "node_modules", "siftdiff");
  for (const asset of [
    "dist/index.js",
    "dist/web/index.html",
    "dist/grammars/tree-sitter-typescript.wasm",
    "dist/grammars/tree-sitter-tsx.wasm",
    "dist/grammars/tree-sitter-javascript.wasm",
    "dist/grammars/tree-sitter-python.wasm",
    "dist/grammars/tree-sitter-go.wasm",
    "LICENSE",
    "NOTICE",
    "README.md"
  ]) {
    await fs.access(path.join(installedRoot, asset)).catch(() => {
      throw new Error(`Installed package is missing ${asset}.`);
    });
  }

  // Guard against workspace/internal leaks in the published manifest and bundle.
  const installedManifest = await fs.readFile(path.join(installedRoot, "package.json"), "utf8");
  const manifest = JSON.parse(installedManifest) as { dependencies?: Record<string, string>; private?: boolean };
  if (manifest.private) {
    throw new Error("Packed manifest is still marked private.");
  }
  if (/workspace:/u.test(installedManifest)) {
    throw new Error("Packed manifest still contains a workspace: protocol range.");
  }
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (dep.startsWith("@sift-review/")) {
      throw new Error(`Packed manifest leaks internal dependency ${dep}; it must be bundled.`);
    }
  }
  const bundle = await fs.readFile(path.join(installedRoot, "dist", "index.js"), "utf8");
  if (/require\(["']@sift-review\/|from ["']@sift-review\//u.test(bundle)) {
    throw new Error("Bundled dist/index.js still resolves @sift-review/* at runtime; check tsup noExternal.");
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
    env: { ...process.env, ...env },
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout.toString();
}
