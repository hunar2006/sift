import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(root, ".demo", "repo");
const home = path.join(root, ".demo", "home");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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
console.log(`smoke ok: ${parsed.model.hunks.length} hunks, ${parsed.model.groups.length} groups`);
