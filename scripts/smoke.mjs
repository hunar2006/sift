import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(root, ".demo", "repo");
const home = path.join(root, ".demo", "home");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const cliPath = path.join(root, "packages", "cli", "dist", "index.js");
const demoEnv = { ...process.env, SIFT_HOME: path.join(home, ".sift"), SIFT_CLAUDE_DIR: path.join(home, ".claude") };

await execFileAsync(pnpmBin, ["demo", "--", "--headless"], {
  cwd: root,
  windowsHide: true,
  shell: process.platform === "win32"
});
const { stdout } = await execFileAsync(process.execPath, [cliPath, "report", "--json"], {
  cwd: repo,
  windowsHide: true,
  env: demoEnv,
  maxBuffer: 32 * 1024 * 1024
});
const parsed = JSON.parse(stdout);
if (!parsed.model || parsed.model.hunks.length <= 0 || parsed.model.groups.length <= 3) {
  throw new Error("Smoke failed: expected report JSON with hunks and more than three groups.");
}

assertDemoSignals(parsed.model);
await assertPrint();
await assertTuiFrame();
await assertRulesLint();
await assertMcpSummary();
await assertCliPack();
console.log(`smoke ok: ${parsed.model.hunks.length} hunks, ${parsed.model.groups.length} groups`);

function assertDemoSignals(model) {
  if (typeof model.meta?.astCoverage !== "number" || model.meta.astCoverage <= 0) {
    throw new Error("Smoke failed: expected real tree-sitter coverage on the demo.");
  }
  const codes = new Set(model.hunks.flatMap((hunk) => hunk.reasons.map((reason) => reason.code)));
  for (const code of [
    "CONCURRENCY_HAZARD",
    "SECRET_ENTROPY",
    "TYPOSQUAT_SUSPECT",
    "AGENT_GUIDANCE_EDIT",
    "COVERED_CHANGE",
    "UNTESTED_CHANGE",
    "USER_BAN_LEGACY_AUTH"
  ]) {
    if (!codes.has(code)) {
      throw new Error(`Smoke failed: demo missing signal ${code}.`);
    }
  }
  if (codes.has("ERROR_SWALLOWED")) {
    throw new Error("Smoke failed: demo rules did not suppress ERROR_SWALLOWED.");
  }
  if (!model.groups.some((group) => group.title === "Rename: formatDate -> renderDate")) {
    throw new Error("Smoke failed: demo missing rename-pattern skim group.");
  }
  if (model.hunks.filter((hunk) => hunk.coverage).length < 2) {
    throw new Error("Smoke failed: expected coverage on at least two demo hunks.");
  }
  if (!model.hunks.some((hunk) => hunk.readingRank !== undefined)) {
    throw new Error("Smoke failed: expected reading-order ranks in demo model.");
  }
  const undigested = model.hunks.filter(
    (hunk) => typeof hunk.digest?.headline !== "string" || hunk.digest.headline.trim().length === 0
  );
  if (undigested.length > 0) {
    throw new Error(`Smoke failed: ${undigested.length} demo hunks missing a digest headline.`);
  }
  const forbidden = /\blooks good\b|\bsafe to approve\b|\blgtm\b/iu;
  for (const hunk of model.hunks) {
    const text = [hunk.digest?.headline, ...(hunk.digest?.details ?? [])].filter(Boolean).join(" ");
    if (forbidden.test(text)) {
      throw new Error(`Smoke failed: digest for ${hunk.file} contains a verdict word.`);
    }
  }
  const headlines = model.hunks.map((hunk) => hunk.digest.headline);
  const requiredHeadlines = [
    [/^Migration:/u, "migration"],
    [/^Edits CI workflow/u, "CI workflow"],
    [/^Removes `/u, "removed symbol"],
    [/^Adds `/u, "added symbol"],
    [/^Renames `.+` → `.+`/u, "rename group"],
    [/^Lockfile churn/u, "lockfile"]
  ];
  for (const [pattern, label] of requiredHeadlines) {
    if (!headlines.some((headline) => pattern.test(headline))) {
      throw new Error(`Smoke failed: demo digests missing the ${label} template row.`);
    }
  }
}

async function assertPrint() {
  const { stdout: printStdout } = await execFileAsync(process.execPath, [cliPath, "print", "--json"], {
    cwd: repo,
    windowsHide: true,
    env: demoEnv,
    maxBuffer: 32 * 1024 * 1024
  });
  const printed = JSON.parse(printStdout);
  for (const field of ["changedLines", "attentionLines", "reviewableLines", "debt", "provenanceCoverage"]) {
    if (typeof printed.headline?.[field] !== "number") {
      throw new Error(`Smoke failed: print JSON missing headline.${field}.`);
    }
  }
  if (typeof printed.headline.coverageOnChangedLines !== "number") {
    throw new Error("Smoke failed: print JSON missing coverage headline.");
  }
}

async function assertTuiFrame() {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "tui", "--print-frame"], {
    cwd: repo,
    windowsHide: true,
    env: demoEnv,
    maxBuffer: 32 * 1024 * 1024
  });
  if (!stdout.includes("SIFT TUI FRAME") || !stdout.includes("groups")) {
    throw new Error("Smoke failed: tui --print-frame missing expected frame markers.");
  }
  if (!stdout.includes("footer:")) {
    throw new Error("Smoke failed: tui --print-frame missing footer keymap line.");
  }
}

async function assertRulesLint() {
  await execFileAsync(process.execPath, [cliPath, "rules", "lint"], {
    cwd: repo,
    windowsHide: true,
    env: demoEnv,
    maxBuffer: 32 * 1024 * 1024
  });
}

async function assertMcpSummary() {
  const cliRequire = createRequire(path.join(root, "packages", "cli", "package.json"));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(cliRequire.resolve("@modelcontextprotocol/sdk/client/index.js")).href),
    import(pathToFileURL(cliRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href)
  ]);
  const client = new Client({ name: "sift-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    cwd: repo,
    env: demoEnv
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "sift_get_summary")) {
      throw new Error("Smoke failed: MCP summary tool missing.");
    }
    const summary = readJson(await client.callTool({ name: "sift_get_summary", arguments: {} }));
    if (typeof summary.debt !== "number" || !summary.totals || typeof summary.flaggedHunks !== "number") {
      throw new Error("Smoke failed: MCP summary shape invalid.");
    }
  } finally {
    await client.close();
  }
}

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
  for (const expected of [
    "dist/index.js",
    "dist/web/index.html",
    "dist/grammars/tree-sitter-typescript.wasm",
    "dist/grammars/tree-sitter-tsx.wasm",
    "dist/grammars/tree-sitter-javascript.wasm",
    "dist/grammars/tree-sitter-python.wasm",
    "dist/grammars/tree-sitter-go.wasm"
  ]) {
    if (!files.has(expected)) {
      throw new Error(`Smoke failed: npm pack missing ${expected}.`);
    }
  }
}

function readJson(result) {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Smoke failed: expected MCP text result.");
  }
  return JSON.parse(first.text);
}
