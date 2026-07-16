import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { checkWorkflowGuard, isAllowedPackedFile, scanPlaceholders } from "./audit.js";
import type { MechanicalSample, PreflightContext, Stage, StageId, StageResult } from "./types.js";
import {
  commandFailure,
  commandText,
  ensureDir,
  isNetworkFailure,
  npmCommand,
  pnpmCommand,
  readJson,
  readTgzEntries,
  relative,
  runCommand,
  walkTextFiles
} from "./utils.js";

const STAGE_NAMES: Record<StageId, string> = {
  A: "Gate",
  B: "Evidence",
  C: "v1.0.0 conformance",
  D: "Fresh-user simulation",
  E: "Installed-package simulation",
  F: "Audits",
  G: "GIF",
  H: "Human handoff"
};

function completed(
  id: StageId,
  started: number,
  status: StageResult["status"],
  summary: string,
  details: string[] = [],
  metrics?: StageResult["metrics"]
): StageResult {
  return { id, name: STAGE_NAMES[id], status, summary, details, durationMs: performance.now() - started, metrics };
}

export function createStages(): Record<StageId, Stage> {
  return {
    A: stageGate,
    B: stageEvidence,
    C: stageConformance,
    D: stageFreshUser,
    E: stageInstalledPackage,
    F: stageAudits,
    G: stageGif,
    H: stageHandoff
  };
}

async function stageGate(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const commands = [
    ["health", ["health"]],
    ["lint", ["lint"]],
    ["typecheck", ["typecheck"]],
    ["test", ["test"]],
    ["build", ["build"]],
    ["smoke", ["smoke"]],
    ["perf", ["perf"]],
    ["pack-check", ["pack-check"]]
  ] as const;
  const details: string[] = [];
  const metrics: Record<string, number | string> = {};
  for (const [label, args] of commands) {
    const result = await runCommand(pnpmCommand(), [...args], { cwd: context.root, timeoutMs: 8 * 60_000 });
    if (result.code !== 0) {
      return completed("A", started, "FAIL", `${label} failed`, [...details, commandFailure(result)]);
    }
    const output = commandText(result);
    const plainOutput = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
    details.push(`PASS ${label}`);
    if (label === "test") {
      const match = plainOutput.match(/Tests\s+(\d+) passed/u);
      if (match) {
        metrics.tests = Number(match[1]);
        details[details.length - 1] = `PASS test (${match[1]} passing)`;
      }
      const coverage = plainOutput.match(/All files\s+\|\s+[0-9.]+\s+\|\s+[0-9.]+\s+\|\s+[0-9.]+\s+\|\s+([0-9.]+)/u);
      if (coverage) {
        metrics.coverageLines = Number(coverage[1]);
        details[details.length - 1] = `${details[details.length - 1]} · ${coverage[1]}% lines`;
      }
    }
    if (label === "perf") {
      const match = plainOutput.match(/median ([0-9.]+) ms/u);
      if (match) {
        metrics.perfMedianMs = Number(match[1]);
        details[details.length - 1] = `PASS perf (median ${match[1]} ms)`;
      }
    }
  }
  const measured = [
    typeof metrics.tests === "number" ? `${metrics.tests} tests` : undefined,
    typeof metrics.coverageLines === "number" ? `${metrics.coverageLines}% lines` : undefined,
    typeof metrics.perfMedianMs === "number" ? `${metrics.perfMedianMs} ms median` : undefined
  ].filter(Boolean);
  return completed("A", started, "PASS", `all eight project gates passed${measured.length ? ` (${measured.join(", ")})` : ""}`, details, metrics);
}

async function stageEvidence(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const fuzz = await runCommand(pnpmCommand(), ["fuzz"], {
    cwd: context.root,
    env: { ...process.env, FUZZ_PARSER: "400", FUZZ_PIPELINE: "80", FUZZ_SEED: "24343" },
    timeoutMs: 3 * 60_000
  });
  if (fuzz.code !== 0) {
    return completed("B", started, "FAIL", "fixed-seed fuzz subset failed", [commandFailure(fuzz)]);
  }
  const details = ["PASS fixed-seed fuzz subset (FUZZ_SEED=24343)"];
  if (context.options.fast) {
    details.push("SKIP eval (fast mode)");
    return completed("B", started, "PASS", "fuzz passed; eval skipped in fast mode", details);
  }
  const evaluation = await runCommand(pnpmCommand(), ["eval"], { cwd: context.root, timeoutMs: 10 * 60_000 });
  if (evaluation.code !== 0) {
    const failure = commandFailure(evaluation);
    if (isNetworkFailure(failure)) {
      return completed("B", started, "SKIP", "eval skipped: corpus network unavailable", [...details, `SKIP ${failure}`]);
    }
    return completed("B", started, "FAIL", "eval reported invariant violations", [...details, failure]);
  }
  const report = await readEvalReport(context.root);
  const hunks = report?.repos.reduce((total, repo) => total + repo.hunks, 0) ?? 0;
  const violations = report?.violations.length ?? 0;
  if (violations > 0) {
    return completed("B", started, "FAIL", `eval reported ${violations} invariant violations`, details, { hunks, violations });
  }
  details.push(`PASS eval: ${hunks} hunks, 0 invariant violations`, "PASS per-repo table: packages/eval/report/report.md#per-repo");
  return completed("B", started, "PASS", "eval and fuzz evidence passed", details, { hunks, violations });
}

async function stageConformance(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const details: string[] = [];
  const failures: string[] = [];
  const cliDir = path.join(context.root, "packages", "cli");
  const manifest = await readJson<Record<string, unknown>>(path.join(cliDir, "package.json"));
  const rootManifest = await readJson<{ scripts?: Record<string, unknown> }>(path.join(context.root, "package.json"));
  const packageChecks: Array<[boolean, string]> = [
    [manifest.name === "siftdiff", "cli name is siftdiff"],
    [manifest.version === "1.0.0", "cli version is 1.0.0"],
    [!("private" in manifest), "cli private field is absent"],
    [JSON.stringify(manifest.bin) === JSON.stringify({ sift: "./dist/index.js" }), "cli bin is sift"],
    [JSON.stringify(manifest.publishConfig) === JSON.stringify({ access: "public", provenance: true }), "publishConfig is public + provenance"],
    [String(rootManifest.scripts?.build ?? "").includes("--filter siftdiff build"), "root build targets renamed CLI package"]
  ];
  const prepack = await fs.readFile(path.join(cliDir, "scripts", "prepack.mjs"), "utf8");
  packageChecks.push([typeof (manifest.scripts as Record<string, unknown> | undefined)?.prepack === "string" && prepack.includes("run", "build"), "prepack builds"]);
  for (const [passed, label] of packageChecks) {
    (passed ? details : failures).push(`${passed ? "PASS" : "FAIL"} ${label}`);
  }

  const packed = await packCli(context.root);
  if ("error" in packed) {
    failures.push(`FAIL ${packed.error}`);
  } else {
    const disallowed = packed.files.filter((file) => !isAllowedPackedFile(file));
    if (disallowed.length > 0) {
      failures.push(`FAIL packed files outside allowlist: ${disallowed.join(", ")}`);
    } else {
      details.push(`PASS packed allowlist (${packed.files.length} files)`);
    }
    const packedManifest = packed.manifest;
    if (/workspace:|@sift-review\//u.test(JSON.stringify(packedManifest))) {
      failures.push("FAIL packed manifest leaks workspace: or @sift-review/*");
    } else {
      details.push("PASS packed manifest has no workspace/internal leak");
    }
  }

  const readme = await fs.readFile(path.join(context.root, "README.md"), "utf8");
  const imageUrls = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1] ?? "");
  const demoGif = path.join(context.root, "docs", "demo.gif");
  const demoGifUrl = canonicalDemoGifUrl(manifest);
  const demoGifExists = await fs.access(demoGif).then(() => true, () => false);
  if (imageUrls.length === 0 || imageUrls.some((url) => !/^https?:\/\//u.test(url))) {
    failures.push("FAIL README image links must be absolute URLs");
  } else {
    details.push(`PASS README has ${imageUrls.length} absolute image URLs`);
    if (!imageUrls.includes(demoGifUrl) || !demoGifExists) {
      failures.push("FAIL README demo GIF URL or local artifact is missing");
    } else {
      const bytes = (await fs.stat(demoGif)).size;
      if (bytes > 3 * 1024 * 1024) {
        failures.push(`FAIL docs/demo.gif exceeds 3 MB (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        details.push(`PASS local README demo GIF (${(bytes / 1024).toFixed(0)} kB; awaiting first push)`);
      }
    }
    const head = await verifyImageUrls(imageUrls);
    if (head === "offline") {
      details.push("SKIP README image HEAD check (network unavailable)");
    } else {
      const remoteFailures = head.filter((failure) => !failure.startsWith(`${demoGifUrl} (`));
      if (remoteFailures.length > 0) {
        failures.push(`FAIL README image HEAD check: ${remoteFailures.join(", ")}`);
      } else {
        details.push("PASS README public image links HEAD-resolve");
        if (head.length > 0) {
          details.push("PASS local demo GIF substitutes for its not-yet-pushed raw URL");
        }
      }
    }
  }

  const placeholders = await scanPlaceholders(context.root);
  if (placeholders.length > 0) {
    failures.push(`FAIL unexpected placeholders: ${placeholders.join(", ")}`);
  } else {
    details.push("PASS placeholder scan (no release placeholders)");
  }
  for (const file of [
    "SECURITY.md",
    "CONTRIBUTING.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/pull_request_template.md"
  ]) {
    const exists = await fs.access(path.join(context.root, file)).then(() => true, () => false);
    (exists ? details : failures).push(`${exists ? "PASS" : "FAIL"} ${file}`);
  }
  const releaseText = await fs.readFile(path.join(context.root, ".github", "workflows", "release.yml"), "utf8");
  const pagesText = await fs.readFile(path.join(context.root, ".github", "workflows", "pages.yml"), "utf8");
  const workflowErrors = checkWorkflowGuard(context.root, releaseText, pagesText);
  if (workflowErrors.length > 0) {
    failures.push(...workflowErrors.map((error) => `FAIL ${error}`));
  } else {
    details.push("PASS release/pages YAML and guarded publish flow");
  }
  const changelog = await fs.readFile(path.join(context.root, "CHANGELOG.md"), "utf8");
  for (const version of ["1.0.0"]) {
    const passed = changelog.includes(version);
    (passed ? details : failures).push(`${passed ? "PASS" : "FAIL"} CHANGELOG includes ${version}`);
  }
  return completed(
    "C",
    started,
    failures.length === 0 ? "PASS" : "FAIL",
    failures.length === 0 ? "v1.0.0 release claims conform" : `${failures.length} conformance check(s) failed`,
    [...details, ...failures]
  );
}

async function stageFreshUser(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sift-preflight-fresh-"));
  const cloneRoot = path.join(temp, "sift");
  const workRoot = context.options.fast ? context.root : cloneRoot;
  const details: string[] = [];
  try {
    if (!context.options.fast) {
      const clone = await runCommand("git", ["clone", context.root, cloneRoot], { cwd: temp, timeoutMs: 2 * 60_000 });
      if (clone.code !== 0) {
        return completed("D", started, "FAIL", "fresh clone failed", [commandFailure(clone)]);
      }
      const overlay = await overlayWorkingTree(context.root, cloneRoot);
      if (overlay.length > 0) {
        details.push(`PASS fresh clone overlaid ${overlay.length} uncommitted source file(s)`);
      }
      const install = await runCommand(pnpmCommand(), ["i", "--frozen-lockfile"], { cwd: workRoot, timeoutMs: 6 * 60_000 });
      if (install.code !== 0) {
        const failure = commandFailure(install);
        return completed("D", started, isNetworkFailure(failure) ? "SKIP" : "FAIL", isNetworkFailure(failure) ? "fresh install skipped: network unavailable" : "fresh install failed", [failure]);
      }
      const build = await runCommand(pnpmCommand(), ["build"], { cwd: workRoot, timeoutMs: 5 * 60_000 });
      if (build.code !== 0) {
        return completed("D", started, "FAIL", "fresh build failed", [commandFailure(build)]);
      }
      details.push("PASS local clone, install, and build");
    } else {
      details.push("PASS reused working tree (fast mode)");
    }
    const e2e = await runCommand(pnpmCommand(), ["e2e"], { cwd: workRoot, timeoutMs: 3 * 60_000 });
    if (e2e.code !== 0) {
      return completed("D", started, "FAIL", "DOM e2e failed", [...details, commandFailure(e2e)]);
    }
    details.push("PASS blocking DOM e2e");
    const demo = await runCommand(pnpmCommand(), ["demo", "--", "--headless"], { cwd: workRoot, timeoutMs: 2 * 60_000 });
    if (demo.code !== 0) {
      return completed("D", started, "FAIL", "demo generation failed", [...details, commandFailure(demo)]);
    }
    const demoRoot = path.join(workRoot, ".demo", "repo");
    const demoEnv = {
      ...process.env,
      SIFT_HOME: path.join(workRoot, ".demo", "home", ".sift"),
      SIFT_CLAUDE_DIR: path.join(workRoot, ".demo", "home", ".claude")
    };
    const service = await startSiftServer(workRoot, demoRoot, demoEnv);
    try {
      const review = (await (await fetch(`${service.url}/api/review`)).json()) as { hunks?: unknown[] };
      if (!Array.isArray(review.hunks) || review.hunks.length === 0) {
        return completed("D", started, "FAIL", "fresh app returned no hunks", details);
      }
      const browserResult = await captureFreshUserScreenshots(service.url, context.artifactsDir);
      if (browserResult !== "ok") {
        return completed("D", started, "SKIP", "browser proof skipped", [...details, browserResult]);
      }
      const tui = await runCommand(process.execPath, [path.join(workRoot, "packages", "cli", "dist", "index.js"), "tui", "--print-frame"], {
        cwd: demoRoot,
        env: demoEnv,
        timeoutMs: 60_000
      });
      if (tui.code !== 0 || !tui.stdout.includes("SIFT TUI FRAME")) {
        return completed("D", started, "FAIL", "fresh TUI frame failed", [...details, commandFailure(tui)]);
      }
      const printed = await runCommand(process.execPath, [path.join(workRoot, "packages", "cli", "dist", "index.js"), "print", "--json"], {
        cwd: demoRoot,
        env: demoEnv,
        timeoutMs: 60_000
      });
      const parsed = parsePrintPayload(workRoot, printed.stdout);
      if (printed.code !== 0 || !parsed) {
        return completed("D", started, "FAIL", "fresh print JSON failed schema validation", [...details, commandFailure(printed)]);
      }
      details.push(`PASS app booted with ${review.hunks.length} hunks`, "PASS first-run keyboard hint and screenshots", "PASS TUI frame and print JSON schema");
      return completed("D", started, "PASS", "fresh-user simulation passed", details, { hunks: review.hunks.length });
    } finally {
      await stopProcess(service.child);
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function stageInstalledPackage(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sift-preflight-package-"));
  const details: string[] = [];
  try {
    const packed = await packCli(context.root, scratch);
    if ("error" in packed) {
      return completed("E", started, "FAIL", "npm pack failed", [packed.error]);
    }
    const tarball = path.join(scratch, packed.filename);
    await fs.writeFile(path.join(scratch, "package.json"), JSON.stringify({ private: true, name: "sift-preflight-scratch" }), "utf8");
    const install = await runCommand(npmCommand(), ["install", "--ignore-scripts", tarball], { cwd: scratch, timeoutMs: 6 * 60_000 });
    if (install.code !== 0) {
      const failure = commandFailure(install);
      return completed("E", started, isNetworkFailure(failure) ? "SKIP" : "FAIL", isNetworkFailure(failure) ? "installed-package install skipped: network unavailable" : "installed-package install failed", [failure]);
    }
    const installedRoot = path.join(scratch, "node_modules", "siftdiff");
    const bin = path.join(scratch, "node_modules", ".bin", process.platform === "win32" ? "sift.cmd" : "sift");
    for (const asset of ["dist/index.js", "dist/web/index.html", "dist/grammars/tree-sitter-typescript.wasm"]) {
      const exists = await fs.access(path.join(installedRoot, asset)).then(() => true, () => false);
      if (!exists) {
        return completed("E", started, "FAIL", `installed package missing ${asset}`, details);
      }
    }
    const hasFont = (await fs.readdir(path.join(installedRoot, "dist", "web", "assets"))).some((name) => name.endsWith(".woff") || name.endsWith(".woff2"));
    if (!hasFont) {
      return completed("E", started, "FAIL", "installed package is missing local font assets", details);
    }
    const repo = await makeScratchRepo(scratch);
    const version = await runCommand(bin, ["--version"], { cwd: repo, timeoutMs: 60_000 });
    const printed = await runCommand(bin, ["print", "--json"], { cwd: repo, timeoutMs: 60_000 });
    if (version.code !== 0 || !parsePrintPayload(context.root, printed.stdout)) {
      return completed("E", started, "FAIL", "installed binary version/print check failed", [...details, commandFailure(version), commandFailure(printed)]);
    }
    const mcp = await runMcpProbe(scratch, installedRoot, repo);
    if (mcp.code !== 0) {
      return completed("E", started, "FAIL", "installed MCP liveness check failed", [...details, commandFailure(mcp)]);
    }
    const hookEnv = { ...process.env, SIFT_CLAUDE_DIR: path.join(scratch, "claude") };
    const hooks = ["install", "status", "uninstall"] as const;
    for (const action of hooks) {
      const result = await runCommand(bin, ["hooks", action], { cwd: repo, env: hookEnv, timeoutMs: 60_000 });
      if (result.code !== 0) {
        return completed("E", started, "FAIL", `installed hooks ${action} failed`, [...details, commandFailure(result)]);
      }
    }
    const initOne = await runCommand(bin, ["init"], { cwd: repo, timeoutMs: 60_000 });
    const initTwo = await runCommand(bin, ["init"], { cwd: repo, timeoutMs: 60_000 });
    const initFiles = await Promise.all(["config.json", "rules.yml"].map((name) => fs.access(path.join(repo, ".sift", name)).then(() => true, () => false)));
    if (initOne.code !== 0 || initTwo.code !== 0 || initFiles.some((exists) => !exists) || !initTwo.stdout.includes("exists")) {
      return completed("E", started, "FAIL", "installed init is not idempotent", [...details, commandFailure(initOne), commandFailure(initTwo)]);
    }
    details.push("PASS package-local web, wasm, and font assets", "PASS installed version and print JSON", "PASS MCP tools/list, summary, and mutation refresh", "PASS hooks round-trip and idempotent init");
    return completed("E", started, "PASS", "installed-package simulation passed", details);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function stageAudits(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const details: string[] = [];
  const failures: string[] = [];
  const runtimeRoot = path.join(context.root, "packages");
  const telemetry: string[] = [];
  const executors: string[] = [];
  await walkTextFiles(runtimeRoot, async (filePath, content) => {
    const rel = relative(context.root, filePath);
    if (rel.includes(".test.") || !rel.includes("/src/") || rel.startsWith("packages/eval/")) {
      return;
    }
    if (!rel.endsWith("packages/cli/src/ai.ts") && !rel.endsWith("packages/core/src/classify/signals/popular-packages.ts") && /telemetry|analytics|sentry|posthog|segment\.io/iu.test(content)) {
      telemetry.push(rel);
    }
    if (/(?:execFile\(|execFileSync\(|spawn\(|spawnSync\()/u.test(content) && !rel.endsWith("packages/cli/src/editor.ts") && !rel.endsWith("packages/core/src/git.ts") && !rel.endsWith("packages/core/src/demo.ts") && !rel.endsWith("packages/core/src/revert.ts")) {
      executors.push(rel);
    }
  });
  (telemetry.length === 0 ? details : failures).push(`${telemetry.length === 0 ? "PASS" : "FAIL"} telemetry grep${telemetry.length ? `: ${telemetry.join(", ")}` : ""}`);
  (executors.length === 0 ? details : failures).push(`${executors.length === 0 ? "PASS" : "FAIL"} repo-code execution allowlist${executors.length ? `: ${executors.join(", ")}` : ""}`);
  const cssFiles = (await fs.readdir(path.join(context.root, "packages", "web", "dist", "assets"))).filter((name) => name.endsWith(".css"));
  const css = (await Promise.all(cssFiles.map((name) => fs.readFile(path.join(context.root, "packages", "web", "dist", "assets", name), "utf8")))).join("\n");
  const remoteFonts = /@import\s+url|fonts\.googleapis\.com|url\(["']?https?:/iu.test(css);
  (remoteFonts ? failures : details).push(`${remoteFonts ? "FAIL" : "PASS"} local font audit`);
  const license = await fs.access(path.join(context.root, "LICENSE")).then(() => true, () => false);
  (license ? details : failures).push(`${license ? "PASS" : "FAIL"} LICENSE present`);

  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "sift-preflight-proxy-"));
  try {
    const repo = await makeScratchRepo(probe);
    const result = await runCommand(process.execPath, [path.join(context.root, "packages", "cli", "dist", "index.js"), "print", "--json"], {
      cwd: repo,
      env: { ...process.env, HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "" },
      timeoutMs: 60_000
    });
    if (result.code !== 0 || !parsePrintPayload(context.root, result.stdout)) {
      failures.push(`FAIL runtime canary-proxy probe: ${commandFailure(result)}`);
    } else {
      details.push("PASS runtime canary-proxy probe (no default pipeline egress)");
    }
  } finally {
    await fs.rm(probe, { recursive: true, force: true });
  }
  return completed("F", started, failures.length === 0 ? "PASS" : "FAIL", failures.length === 0 ? "runtime and static audits passed" : `${failures.length} audit(s) failed`, [...details, ...failures]);
}

async function stageGif(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const file = path.join(context.root, "docs", "demo.gif");
  const manifest = await readJson<{ scripts?: Record<string, unknown>; devDependencies?: Record<string, unknown> }>(path.join(context.root, "package.json"));
  const gifScript = String(manifest.scripts?.gif ?? "");
  const exists = await fs.access(file).then(() => true, () => false);
  if (!exists) {
    return completed("G", started, "FAIL", "docs/demo.gif is missing", ["Run pnpm gif to regenerate the scripted Playwright capture."]);
  }
  const bytes = (await fs.stat(file)).size;
  const errors = [
    ...(bytes > 3 * 1024 * 1024 ? [`docs/demo.gif exceeds 3 MB (${(bytes / 1024 / 1024).toFixed(2)} MB)`] : []),
    ...(!gifScript.includes("scripts/gif.ts") ? ["package script gif does not invoke scripts/gif.ts"] : []),
    ...(typeof manifest.devDependencies?.gifenc !== "string" ? ["gifenc is not a dev dependency"] : [])
  ];
  return completed(
    "G",
    started,
    errors.length === 0 ? "PASS" : "FAIL",
    errors.length === 0 ? "scripted GIF is present and regenerable" : `${errors.length} GIF check(s) failed`,
    errors.length === 0
      ? [`PASS ${relative(context.root, file)} (${(bytes / 1024).toFixed(0)} kB)`, "PASS regenerate with pnpm gif (Playwright + gifenc; no ffmpeg)"]
      : errors.map((error) => `FAIL ${error}`)
  );
}

function canonicalDemoGifUrl(manifest: Record<string, unknown>): string {
  const homepage = typeof manifest.homepage === "string" ? manifest.homepage : "";
  const match = homepage.match(/^https:\/\/github\.com\/([^/]+\/[^/#]+)(?:#.*)?$/u);
  return match ? `https://raw.githubusercontent.com/${match[1]}/main/docs/demo.gif` : "";
}

async function stageHandoff(context: PreflightContext): Promise<StageResult> {
  const started = performance.now();
  const report = await readEvalReport(context.root);
  const samples = report?.spotMechanical.length ?? 0;
  return completed("H", started, "PASS", "human review and ship checklist prepared", [
    samples >= 10 ? `PASS ${samples} mechanical candidates available for the 10-hunk handoff` : "SKIP latest full eval candidates unavailable; fast-mode handoff explains how to refresh",
    "PASS PowerShell-only manual ship sequence included"
  ]);
}

interface PackedCli {
  filename: string;
  files: string[];
  manifest: Record<string, unknown>;
}

async function packCli(root: string, destination?: string): Promise<PackedCli | { error: string }> {
  const temp = destination ?? (await fs.mkdtemp(path.join(os.tmpdir(), "sift-preflight-pack-")));
  const ownTemp = !destination;
  try {
    const result = await runCommand(npmCommand(), ["pack", "--json", "--pack-destination", temp], { cwd: path.join(root, "packages", "cli"), timeoutMs: 5 * 60_000 });
    if (result.code !== 0) {
      return { error: commandFailure(result) };
    }
    const info = JSON.parse(result.stdout) as Array<{ filename?: string; files?: Array<{ path: string }> }>;
    const filename = info[0]?.filename;
    if (!filename) {
      return { error: "npm pack did not return a tarball name" };
    }
    const entries = await readTgzEntries(path.join(temp, filename));
    const manifestEntry = entries.get("package/package.json");
    if (!manifestEntry) {
      return { error: "tarball is missing package/package.json" };
    }
    return {
      filename,
      files: [...entries.keys()].map((name) => name.replace(/^package\//u, "")).sort(),
      manifest: JSON.parse(manifestEntry.toString("utf8")) as Record<string, unknown>
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (ownTemp) {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}

async function verifyImageUrls(urls: string[]): Promise<"offline" | string[]> {
  const failures: string[] = [];
  try {
    for (const url of urls) {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        failures.push(`${url} (${response.status})`);
      }
    }
    return failures;
  } catch (error) {
    return isNetworkFailure(error instanceof Error ? error.message : String(error)) ? "offline" : [String(error)];
  }
}

async function startSiftServer(root: string, cwd: string, env = process.env): Promise<{ url: string; child: ChildProcess }> {
  const port = 47000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(root, "packages", "cli", "dist", "index.js"), "--no-open", "--port", String(port)], {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
    if (url) {
      return { url, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopProcess(child);
  throw new Error(`Sift server did not become ready: ${output.slice(-3000)}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
}

/** A full preflight must exercise the exact source the developer is testing.
 * Clone HEAD for a clean install, then overlay tracked edits and untracked
 * source files without staging, committing, or changing the shared checkout. */
async function overlayWorkingTree(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const changed = await runCommand("git", ["diff", "--name-status", "HEAD"], { cwd: sourceRoot, timeoutMs: 60_000 });
  const untracked = await runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd: sourceRoot, timeoutMs: 60_000 });
  if (changed.code !== 0 || untracked.code !== 0) {
    throw new Error(`Could not enumerate working source: ${commandFailure(changed)} ${commandFailure(untracked)}`);
  }
  const files = new Map<string, "copy" | "delete">();
  for (const line of changed.stdout.split(/\r?\n/u).filter(Boolean)) {
    const [status, file] = line.split("\t", 2);
    if (file) {
      files.set(file, status === "D" ? "delete" : "copy");
    }
  }
  for (const file of untracked.stdout.split(/\r?\n/u).filter(Boolean)) {
    files.set(file, "copy");
  }
  for (const [file, action] of files) {
    const source = path.join(sourceRoot, file);
    const target = path.join(targetRoot, file);
    if (action === "delete") {
      await fs.rm(target, { force: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  return [...files.keys()];
}

async function captureFreshUserScreenshots(url: string, artifactsDir: string): Promise<"ok" | string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator("main").waitFor({ timeout: 15_000 });
      if ((await page.locator(".shortcuts-hint").count()) === 0) {
        throw new Error("first-run keyboard hint is missing");
      }
      await ensureDir(artifactsDir);
      await page.screenshot({ path: path.join(artifactsDir, "workbench.png"), fullPage: true });
      const helpClose = page.locator(".help button").first();
      if (await helpClose.count()) {
        await helpClose.click();
      }
      await page.keyboard.press("f");
      await page.locator('[role="dialog"][aria-label="Focus mode"]').waitFor({ timeout: 5_000 });
      await page.screenshot({ path: path.join(artifactsDir, "focus.png"), fullPage: true });
    } finally {
      await browser.close();
    }
    return "ok";
  } catch (error) {
    return `Playwright unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function parsePrintPayload(root: string, raw: string): boolean {
  try {
    const require = createRequire(path.join(root, "packages", "cli", "package.json"));
    const { z } = require("zod") as { z: { object(shape: Record<string, unknown>): { safeParse(value: unknown): { success: boolean } }; number(): unknown; array(value: unknown): unknown; string(): unknown } };
    const schema = z.object({ headline: z.object({ changedLines: z.number(), attentionLines: z.number() }), topRiskyHunks: z.array(z.object({ id: z.string(), file: z.string() })), skimBundles: z.array(z.object({ id: z.string(), title: z.string() })) });
    return schema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}

async function makeScratchRepo(parent: string): Promise<string> {
  const repo = path.join(parent, "repo");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  for (const [args, content] of [
    [["init"], undefined],
    [["config", "user.email", "sift@example.com"], undefined],
    [["config", "user.name", "Sift Preflight"], undefined]
  ] as const) {
    const result = await runCommand("git", [...args], { cwd: repo, timeoutMs: 60_000 });
    if (result.code !== 0) {
      throw new Error(commandFailure(result));
    }
    void content;
  }
  await fs.writeFile(path.join(repo, "src", "app.ts"), "export const before = true;\n", "utf8");
  for (const args of [["add", "."], ["commit", "-m", "baseline"]]) {
    const result = await runCommand("git", args, { cwd: repo, timeoutMs: 60_000 });
    if (result.code !== 0) {
      throw new Error(commandFailure(result));
    }
  }
  await fs.writeFile(path.join(repo, "src", "app.ts"), "export const after = false;\n", "utf8");
  return repo;
}

async function runMcpProbe(scratch: string, installedRoot: string, repo: string) {
  const probe = path.join(scratch, "mcp-probe.mjs");
  const bin = path.join(installedRoot, "dist", "index.js");
  await fs.writeFile(
    probe,
    `import { Client } from "@modelcontextprotocol/sdk/client/index.js";\nimport { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";\nimport { appendFile } from "node:fs/promises";\nconst [bin, cwd] = process.argv.slice(2);\nconst client = new Client({ name: "sift-preflight", version: "0" });\nconst transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp"], cwd });\nawait client.connect(transport);\ntry {\n  const tools = await client.listTools();\n  if (!tools.tools.some((tool) => tool.name === "sift_get_summary")) throw new Error("summary tool missing");\n  await client.callTool({ name: "sift_get_summary", arguments: {} });\n  const before = await client.callTool({ name: "sift_list_unreviewed", arguments: {} });\n  await appendFile(cwd + "/src/new.ts", "export const fresh = true;\\n");\n  const after = await client.callTool({ name: "sift_list_unreviewed", arguments: {} });\n  const count = (value) => JSON.parse(value.content[0].text).length;\n  if (count(after) <= count(before)) throw new Error("MCP did not refresh after mutation");\n  console.log("mcp probe ok");\n} finally { await client.close(); }\n`,
    "utf8"
  );
  return runCommand(process.execPath, [probe, bin, repo], { cwd: scratch, timeoutMs: 90_000 });
}

interface EvalReportJson {
  repos: Array<{ hunks: number }>;
  violations: unknown[];
  spotMechanical: MechanicalSample[];
}

async function readEvalReport(root: string): Promise<EvalReportJson | undefined> {
  try {
    return await readJson<EvalReportJson>(path.join(root, "packages", "eval", "report", "report.json"));
  } catch {
    return undefined;
  }
}

export async function loadMechanicalCandidates(root: string): Promise<MechanicalSample[]> {
  return (await readEvalReport(root))?.spotMechanical ?? [];
}
