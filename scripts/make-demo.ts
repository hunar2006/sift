import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDemoRepo } from "../packages/core/src/demo.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.join(root, ".demo");
const headless = process.argv.includes("--headless");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const demo = await createDemoRepo({ rootDir: demoRoot });

console.log(demo.expectedSummary);
console.log(`Demo repo: ${demo.repoRoot}`);

if (!headless) {
  await ensureBuilt();
  const cli = path.join(root, "packages", "cli", "dist", "index.js");
  const child = spawn(process.execPath, [cli, "--no-open"], {
    cwd: demo.repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...demo.env }
  });
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sift exited ${code ?? "null"}`))));
  });
}

async function ensureBuilt(): Promise<void> {
  const cli = path.join(root, "packages", "cli", "dist", "index.js");
  const exists = await fs.stat(cli).then(
    () => true,
    () => false
  );
  if (!exists) {
    await execFileAsync(pnpmBin, ["build"], {
      cwd: root,
      windowsHide: true,
      shell: process.platform === "win32"
    });
  }
}
