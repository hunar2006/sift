import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(root, ".demo", "repo");
const home = path.join(root, ".demo", "home");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

await execFileAsync(pnpmBin, ["demo", "--", "--headless"], {
  cwd: root,
  windowsHide: true,
  shell: process.platform === "win32"
});
const { stdout } = await execFileAsync(process.execPath, [path.join(root, "packages", "cli", "dist", "index.js"), "report", "--json"], {
  cwd: repo,
  windowsHide: true,
  env: { ...process.env, SIFT_HOME: path.join(home, ".sift"), SIFT_CLAUDE_DIR: path.join(home, ".claude") },
  maxBuffer: 32 * 1024 * 1024
});
const parsed = JSON.parse(stdout);
if (!parsed.model || parsed.model.hunks.length <= 0 || parsed.model.groups.length <= 3) {
  throw new Error("Smoke failed: expected report JSON with hunks and more than three groups.");
}

await assertCliPack();
console.log(`smoke ok: ${parsed.model.hunks.length} hunks, ${parsed.model.groups.length} groups`);

async function assertCliPack() {
  const cliDir = path.join(root, "packages", "cli");
  const manifest = await fs.readFile(path.join(cliDir, "package.json"), "utf8");
  if (manifest.includes("workspace:")) {
    throw new Error("Smoke failed: cli package manifest still contains workspace: ranges.");
  }
  const { stdout: packStdout } = await execFileAsync(npmBin, ["pack", "--dry-run", "--json"], {
    cwd: cliDir,
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024
  });
  const packed = JSON.parse(packStdout);
  const files = new Set(packed[0]?.files?.map((file) => file.path) ?? []);
  for (const expected of ["dist/index.js", "dist/web/index.html", "dist/grammars/tree-sitter-typescript.wasm"]) {
    if (!files.has(expected)) {
      throw new Error(`Smoke failed: npm pack missing ${expected}.`);
    }
  }
}
