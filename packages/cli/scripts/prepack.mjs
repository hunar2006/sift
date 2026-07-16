// Runs during `prepack` (npm pack / npm publish) so a publish from this package
// directory is self-sufficient: it builds the bundle and stages LICENSE, NOTICE,
// and README into the package. All build output is routed to stderr so callers that
// parse `npm pack --json` stdout (e.g. scripts/pack-check.ts) see clean JSON.
// Relative doc/image links in the README are rewritten to absolute GitHub URLs
// because npm renders the README outside the repo tree.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER_BASE = "https://github.com/hunar2006/sift";
const RAW_BASE = "https://raw.githubusercontent.com/hunar2006/sift/main";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..", "..");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build"], {
  cwd: cliDir,
  stdio: ["ignore", 2, 2], // route child stdout to our stderr
  shell: process.platform === "win32"
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

await fs.copyFile(path.join(repoRoot, "LICENSE"), path.join(cliDir, "LICENSE"));
await fs.copyFile(path.join(repoRoot, "NOTICE"), path.join(cliDir, "NOTICE"));

let readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
readme = readme.replace(
  /!\[([^\]]*)\]\((?:\.\/)?((?:docs|site)\/[^)]+)\)/gu,
  (_match, alt, rel) => `![${alt}](${RAW_BASE}/${rel})`
);
readme = readme.replace(
  /(^|[^!])\[([^\]]+)\]\((?:\.\/)?((?:docs|site)\/[^)]+)\)/gu,
  (_match, lead, text, rel) => `${lead}[${text}](${OWNER_BASE}/blob/main/${rel})`
);
await fs.writeFile(path.join(cliDir, "README.md"), readme, "utf8");

console.error("prepack: built bundle and staged LICENSE, NOTICE, and README with absolute links.");
