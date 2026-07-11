#!/usr/bin/env node
import { Command } from "commander";
import open from "open";
import pc from "picocolors";
import { promises as fs } from "node:fs";
import {
  appendStats,
  computeStats,
  discoverRepoRoot,
  formatRuleFileProblem,
  GitError,
  lintRuleFiles,
  loadRules,
  mergeReviewState,
  readHistory,
  readReviewState,
  renderMarkdownReport,
  renderStats,
  createDemoRepo,
  type EffectiveRules,
  type RuleFileReport
} from "@sift-review/core";
import { hooksStatus, installHooks, runHookCapture, uninstallHooks } from "@sift-review/claude-adapter";
import { BINARY_NAME, PRODUCT_NAME, SIFT_VERSION } from "@sift-review/core";
import { runPipeline, type RunPipelineOptions } from "./pipeline-runner.js";
import { startServer } from "./server.js";
import { startLiveWatcher, type LiveWatcher } from "./watch.js";
import type { AiMode } from "./ai.js";
import { runMcpServer } from "./mcp.js";
import { printPayload, renderPrintReport } from "./print.js";
import { renderReviewBrief, type ReviewBriefMode } from "./review-brief.js";
import { runTui } from "./tui.js";

const program = new Command();

class WatchUsageError extends Error {}

program
  .name(BINARY_NAME)
  .description(`${PRODUCT_NAME}: local-first review cockpit for AI-generated diffs`)
  .version(SIFT_VERSION)
  .option("--json", "emit machine-readable output where supported")
  .option("--no-color", "disable colored output");

program
  .argument("[range]", "git ref/range to diff against HEAD")
  .option("--staged", "review staged changes")
  .option("--port <n>", "preferred localhost port", "4111")
  .option("--no-open", "do not open a browser")
  .option("--ai [provider]", "opt-in AI annotations: anthropic, openai, same, cross, or both")
  .option("--no-ai-cache", "bypass the cached AI Review Brief and regenerate it")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .option("--watch", "watch working-tree changes and stream review updates")
  .action(async (range: string | undefined, options: ReviewCommandOptions) => {
    assertWatchUsage(options.watch, range);
    const ai = parseAiOption(options.ai);
    const noAiCache = options.aiCache === false;
    const pipelineOptions = { cwd: process.cwd(), staged: options.staged, range, ai, noAiCache, coverage: options.coverage };
    let result = await runPipeline(pipelineOptions);
    if (result.model.hunks.length === 0 && !options.watch) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer(
      {
        ...result,
        watchActive: options.watch,
        refresh: async () => {
          result = await runPipeline(pipelineOptions);
          return result;
        }
      },
      Number.parseInt(options.port, 10)
    );
    printPortFallback(options.port, server.port);
    const summary = `${result.model.totals.changedLines} lines changed -> ${result.model.totals.attentionLines} need attention · ${result.model.groups.length} groups · sift v${SIFT_VERSION}`;
    console.log(`${server.url}\n${summary}`);
    if (options.open) {
      await open(server.url);
    }
    let watcher: LiveWatcher | undefined;
    if (options.watch) {
      watcher = await startLiveWatcher({
        repoRoot: result.model.meta.repoRoot,
        reanalyze: () => runPipeline(pipelineOptions),
        current: () => result,
        apply: (next, update) => {
          result = next;
          server.update(next, update);
        },
        onWarning: (message) => console.warn(message)
      });
      console.log(`watching ${result.model.meta.repoRoot} \u2014 Ctrl-C to stop`);
    }
    await waitForShutdown(async () => {
      await watcher?.close();
      await server.close();
    });
  });

program
  .command("pr")
  .argument("<numberOrUrl>")
  .option("--port <n>", "preferred localhost port", "4111")
  .option("--no-open", "do not open a browser")
  .option("--ai [provider]", "opt-in AI annotations: anthropic, openai, same, cross, or both")
  .option("--no-ai-cache", "bypass the cached AI Review Brief and regenerate it")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .option("--watch", "watch working-tree changes and stream review updates")
  .action(async (pr: string, options: ReviewCommandOptions) => {
    assertWatchUsage(options.watch, undefined, true);
    const ai = parseAiOption(options.ai);
    const noAiCache = options.aiCache === false;
    const result = await runPipeline({ cwd: process.cwd(), pr, ai, noAiCache, coverage: options.coverage });
    if (result.model.hunks.length === 0) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer(
      { ...result, refresh: () => runPipeline({ cwd: process.cwd(), pr, ai, noAiCache, coverage: options.coverage }) },
      Number.parseInt(options.port, 10)
    );
    printPortFallback(options.port, server.port);
    console.log(`${server.url}\n${result.model.totals.changedLines} lines changed -> ${result.model.totals.attentionLines} need attention · ${result.model.groups.length} groups · sift v${SIFT_VERSION}`);
    if (options.open) {
      await open(server.url);
    }
    await waitForShutdown(() => server.close());
  });

program
  .command("report")
  .option("--md", "emit markdown", true)
  .option("--json", "emit JSON")
  .option("-o, --output <file>", "write report to file")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (options: ReportOptions) => {
    const result = await runPipeline({ cwd: process.cwd(), coverage: options.coverage });
    const { state, warning } = await readReviewState(result.model.meta.repoRoot);
    if (warning) {
      console.error(warning);
    }
    const stats = computeStats(result.model, state);
    const wantsJson = options.json === true || process.argv.includes("--json");
    const output = wantsJson
      ? JSON.stringify({ model: mergeReviewState(result.model, state), stats }, null, 2)
      : renderMarkdownReport(result.model, state, stats);
    if (options.output) {
      await fs.writeFile(options.output, output, "utf8");
    } else {
      console.log(output);
    }
    await appendStats(result.model.meta.repoRoot, stats);
  });

program
  .command("brief")
  .option("--flagged", "include flagged hunks (the default)")
  .option("--unreviewed-high", "include unreviewed high-risk hunks instead")
  .option("-o, --output <file>", "write the brief to file")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (options: BriefCommandOptions) => {
    if (options.flagged && options.unreviewedHigh) {
      throw new Error("Choose either --flagged or --unreviewed-high.");
    }
    const result = await runPipeline({ cwd: process.cwd(), coverage: options.coverage });
    const { state, warning } = await readReviewState(result.model.meta.repoRoot);
    if (warning) {
      console.error(warning);
    }
    const mode: ReviewBriefMode = options.unreviewedHigh ? "unreviewed-high" : "flagged";
    const brief = renderReviewBrief(mergeReviewState(result.model, state), mode);
    if (!brief) {
      console.log("Nothing flagged.");
      return;
    }
    if (options.output) {
      await fs.writeFile(options.output, brief, "utf8");
      return;
    }
    console.log(brief);
  });

program
  .command("print")
  .argument("[range]", "git ref/range to diff against HEAD")
  .option("--staged", "review staged changes")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .option("--json", "emit JSON")
  .action(async (range: string | undefined, options: PrintCommandOptions) => {
    const result = await runPipeline({ cwd: process.cwd(), staged: options.staged, range, coverage: options.coverage });
    const { state, warning } = await readReviewState(result.model.meta.repoRoot);
    if (warning) {
      console.error(warning);
    }
    const stats = computeStats(result.model, state);
    const wantsJson = options.json === true || process.argv.includes("--json");
    console.log(
      wantsJson
        ? JSON.stringify(printPayload(result.model, state, stats), null, 2)
        : renderPrintReport(result.model, state, stats, { color: colorEnabled() })
    );
  });

program.command("stats").option("--json", "emit JSON").option("--coverage <path>", "parse coverage artifact instead of autodetecting").action(async (options: JsonOption & CoverageOption) => {
  const result = await runPipeline({ cwd: process.cwd(), coverage: options.coverage });
  const { state } = await readReviewState(result.model.meta.repoRoot);
  const stats = computeStats(result.model, state);
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(renderStats(stats, await readHistory(result.model.meta.repoRoot)));
});

program
  .command("check")
  .option("--max-debt <pct>", "maximum allowed debt percentage", "40")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (options: { maxDebt: string } & CoverageOption) => {
    const result = await runPipeline({ cwd: process.cwd(), coverage: options.coverage });
    const { state } = await readReviewState(result.model.meta.repoRoot);
    const stats = computeStats(result.model, state);
    const maxDebt = Number.parseFloat(options.maxDebt);
    if (stats.flaggedHunks > 0 || stats.debt * 100 > maxDebt) {
      console.error(
        `Check failed: debt ${(stats.debt * 100).toFixed(1)}% (max ${maxDebt}%), flagged hunks ${stats.flaggedHunks}.`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Check passed: debt ${(stats.debt * 100).toFixed(1)}%, no flagged hunks.`);
  });

const rules = program.command("rules");
rules.command("lint").action(async () => {
  const repoRoot = await discoverRepoRoot(process.cwd());
  const reports = await lintRuleFiles(repoRoot);
  console.log(renderRuleReports(reports));
  if (reports.some((report) => report.status === "error")) {
    process.exitCode = 1;
  }
});
rules.command("list").option("--json", "emit JSON").action(async (options: JsonOption) => {
  const repoRoot = await discoverRepoRoot(process.cwd());
  const loaded = await loadRules(repoRoot);
  const wantsJson = options.json === true || process.argv.includes("--json");
  if (wantsJson) {
    console.log(JSON.stringify(loaded, null, 2));
    return;
  }
  for (const report of loaded.reports) {
    if (report.status === "error") {
      console.error(`Ignoring invalid Sift rules file: ${formatRuleFileProblem(report)}`);
    }
  }
  console.log(renderRuleReports(loaded.reports));
  console.log(renderRulesList(loaded.rules));
});

const hooks = program.command("hooks");
hooks.command("install").option("--project", "use repo-local Claude settings").action(async (options: HookOptions) => {
  const file = await installHooks(process.cwd(), options.project);
  console.log(`Installed Sift hook in ${file}.`);
});
hooks.command("uninstall").option("--project", "use repo-local Claude settings").action(async (options: HookOptions) => {
  const file = await uninstallHooks(process.cwd(), options.project);
  console.log(`Removed Sift hook from ${file}.`);
});
hooks.command("status").option("--project", "use repo-local Claude settings").action(async (options: HookOptions) => {
  const installed = await hooksStatus(process.cwd(), options.project);
  console.log(installed ? "Sift hook installed." : "Sift hook not installed.");
  });

program
  .command("demo")
  .option("--dir <path>", "directory where the demo repo should be created")
  .option("--port <n>", "preferred localhost port", "4111")
  .option("--no-open", "do not open a browser")
  .action(async (options: DemoCommandOptions) => {
    let demo: Awaited<ReturnType<typeof createDemoRepo>>;
    try {
      demo = await createDemoRepo(options.dir ? { repoDir: options.dir } : undefined);
    } catch {
      throw new Error("Cannot create the demo in that directory. Choose a writable path and try again.");
    }
    process.env.SIFT_HOME = demo.siftHome;
    process.env.SIFT_CLAUDE_DIR = demo.claudeDir;
    console.log(demo.expectedSummary);
    console.log(`Demo repo: ${demo.repoRoot}`);
    const result = await runPipeline({ cwd: demo.repoRoot });
    const server = await startServer({ ...result, refresh: () => runPipeline({ cwd: demo.repoRoot }) }, Number.parseInt(options.port, 10));
    printPortFallback(options.port, server.port);
    console.log(`${server.url}\n${result.model.totals.changedLines} lines changed -> ${result.model.totals.attentionLines} need attention - sift v${SIFT_VERSION}`);
    if (options.open) {
      await open(server.url);
    }
    await waitForShutdown(() => server.close());
  });

program.command("hook-capture", { hidden: true }).action(async () => {
  await runHookCapture();
});

program
  .command("mcp")
  .argument("[range]", "git ref/range to diff against HEAD")
  .option("--staged", "review staged changes")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (range: string | undefined, options: { staged?: boolean; coverage?: string }) => {
    await runMcpServer(await runPipeline({ cwd: process.cwd(), staged: options.staged, range, coverage: options.coverage }));
  });

program
  .command("tui")
  .argument("[range]", "git ref/range to diff against HEAD")
  .option("--staged", "review staged changes")
  .option("--watch", "watch working-tree changes and refresh the TUI")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .option("--print-frame", "render one frame to stdout and exit (CI/smoke)", false)
  .action(async (range: string | undefined, options: { staged?: boolean; watch?: boolean; coverage?: string; printFrame?: boolean }) => {
    assertWatchUsage(options.watch, range);
    const pipelineOptions = {
      cwd: process.cwd(),
      staged: options.staged,
      range,
      coverage: options.coverage
    };
    let result = await runPipeline(pipelineOptions);
    if (result.model.hunks.length === 0 && !options.watch && !options.printFrame) {
      console.log("Nothing to review.");
      return;
    }
    await runTui({
      result,
      reanalyze: async () => {
        result = await runPipeline(pipelineOptions);
        return result;
      },
      watch: options.watch,
      printFrame: options.printFrame
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof GitError || error instanceof WatchUsageError) {
    console.error(error.message);
    process.exit(2);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(process.env.SIFT_DEBUG === "1" && error instanceof Error ? error.stack : pc.red(message));
  process.exit(1);
});

interface ReviewCommandOptions {
  staged?: boolean;
  port: string;
  open: boolean;
  ai?: true | string;
  aiCache?: boolean;
  coverage?: string;
  watch?: boolean;
}

interface ReportOptions {
  md?: boolean;
  json?: boolean;
  output?: string;
  coverage?: string;
}

interface BriefCommandOptions {
  flagged?: boolean;
  unreviewedHigh?: boolean;
  output?: string;
  coverage?: string;
}

interface PrintCommandOptions extends JsonOption, CoverageOption {
  staged?: boolean;
}

interface JsonOption {
  json?: boolean;
}

interface CoverageOption {
  coverage?: string;
}

interface HookOptions {
  project?: boolean;
}

interface DemoCommandOptions {
  dir?: string;
  port: string;
  open: boolean;
}

function assertWatchUsage(watch: boolean | undefined, range: string | undefined, isPr = false): void {
  if (watch && (range || isPr)) {
    throw new WatchUsageError("Watch follows the working tree. For ranges, re-run sift <range> after changes.");
  }
}

function parseAiOption(value: true | string | undefined): RunPipelineOptions["ai"] {
  if (!value) {
    return undefined;
  }
  if (value === true) {
    return true;
  }
  if (value === "anthropic" || value === "openai" || value === "same" || value === "cross" || value === "both") {
    return value satisfies AiMode;
  }
  throw new Error("--ai must be anthropic, openai, same, cross, both, or passed without a provider.");
}

function renderRuleReports(reports: RuleFileReport[]): string {
  return reports
    .map((report) => {
      if (report.status === "ok") {
        return `${pc.green("OK")} ${report.scope} ${report.path}`;
      }
      if (report.status === "missing") {
        return `${pc.dim("missing")} ${report.scope} ${report.path}`;
      }
      return `${pc.red("ERROR")} ${report.scope} ${formatRuleFileProblem(report)}`;
    })
    .join("\n");
}

function renderRulesList(rules: EffectiveRules): string {
  const lines = ["", "Effective rules:"];
  if (rules.rules.length === 0 && rules.adjust.length === 0) {
    lines.push("  none");
    return lines.join("\n");
  }
  if (rules.rules.length > 0) {
    lines.push("  custom signals");
    for (const rule of rules.rules) {
      const pattern = rule.pattern ? ` pattern=${rule.pattern}` : " path-only";
      lines.push(`  - USER_${rule.id} weight=${rule.weight} tier=${rule.tier} paths=${rule.paths.join(",")}${pattern}`);
    }
  }
  if (rules.adjust.length > 0) {
    lines.push("  adjustments");
    for (const adjustment of rules.adjust) {
      const paths = adjustment.paths ? adjustment.paths.join(",") : "**";
      lines.push(`  - ${adjustment.code} weight=${adjustment.weight} paths=${paths}`);
    }
  }
  return lines.join("\n");
}

function colorEnabled(): boolean {
  return program.opts<{ color?: boolean }>().color !== false && !process.argv.includes("--no-color");
}

function waitForShutdown(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = () => {
      close()
        .catch(() => undefined)
        .finally(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function printPortFallback(requested: string, actual: number): void {
  if (actual !== Number.parseInt(requested, 10)) {
    console.log(`Port ${requested} was in use; started on ${actual}.`);
  }
}
