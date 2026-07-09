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
  type EffectiveRules,
  type RuleFileReport
} from "@sift-review/core";
import { hooksStatus, installHooks, runHookCapture, uninstallHooks } from "@sift-review/claude-adapter";
import { BINARY_NAME, PRODUCT_NAME, SIFT_VERSION } from "@sift-review/core";
import { runPipeline, type RunPipelineOptions } from "./pipeline-runner.js";
import { startServer } from "./server.js";
import type { AiMode } from "./ai.js";

const program = new Command();

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
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (range: string | undefined, options: ReviewCommandOptions) => {
    const ai = parseAiOption(options.ai);
    const result = await runPipeline({ cwd: process.cwd(), staged: options.staged, range, ai, coverage: options.coverage });
    if (result.model.hunks.length === 0) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer(
      {
        ...result,
        refresh: () => runPipeline({ cwd: process.cwd(), staged: options.staged, range, ai, coverage: options.coverage })
      },
      Number.parseInt(options.port, 10)
    );
    const summary = `${result.model.totals.changedLines} lines changed -> ${result.model.totals.attentionLines} need attention · ${result.model.groups.length} groups · sift v${SIFT_VERSION}`;
    console.log(`${server.url}\n${summary}`);
    if (options.open) {
      await open(server.url);
    }
    await waitForShutdown(() => server.close());
  });

program
  .command("pr")
  .argument("<numberOrUrl>")
  .option("--port <n>", "preferred localhost port", "4111")
  .option("--no-open", "do not open a browser")
  .option("--ai [provider]", "opt-in AI annotations: anthropic, openai, same, cross, or both")
  .option("--coverage <path>", "parse coverage artifact instead of autodetecting")
  .action(async (pr: string, options: ReviewCommandOptions) => {
    const ai = parseAiOption(options.ai);
    const result = await runPipeline({ cwd: process.cwd(), pr, ai, coverage: options.coverage });
    if (result.model.hunks.length === 0) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer(
      { ...result, refresh: () => runPipeline({ cwd: process.cwd(), pr, ai, coverage: options.coverage }) },
      Number.parseInt(options.port, 10)
    );
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

program.command("hook-capture", { hidden: true }).action(async () => {
  await runHookCapture();
});

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof GitError) {
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
  coverage?: string;
}

interface ReportOptions {
  md?: boolean;
  json?: boolean;
  output?: string;
  coverage?: string;
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
