#!/usr/bin/env node
import { Command } from "commander";
import open from "open";
import pc from "picocolors";
import { promises as fs } from "node:fs";
import {
  appendStats,
  computeStats,
  GitError,
  mergeReviewState,
  readHistory,
  readReviewState,
  renderMarkdownReport,
  renderStats
} from "@sift-review/core";
import { hooksStatus, installHooks, runHookCapture, uninstallHooks } from "@sift-review/claude-adapter";
import { BINARY_NAME, PRODUCT_NAME, SIFT_VERSION } from "@sift-review/core";
import { runPipeline, type RunPipelineOptions } from "./pipeline-runner.js";
import { startServer } from "./server.js";
import type { AiProvider } from "./ai.js";

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
  .option("--ai [provider]", "opt-in AI annotations: anthropic or openai")
  .action(async (range: string | undefined, options: ReviewCommandOptions) => {
    const ai = parseAiOption(options.ai);
    const result = await runPipeline({ cwd: process.cwd(), staged: options.staged, range, ai });
    if (result.model.hunks.length === 0) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer(
      {
        ...result,
        refresh: () => runPipeline({ cwd: process.cwd(), staged: options.staged, range, ai })
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
  .option("--ai [provider]", "opt-in AI annotations: anthropic or openai")
  .action(async (pr: string, options: ReviewCommandOptions) => {
    const ai = parseAiOption(options.ai);
    const result = await runPipeline({ cwd: process.cwd(), pr, ai });
    if (result.model.hunks.length === 0) {
      console.log("Nothing to review.");
      return;
    }
    const server = await startServer({ ...result, refresh: () => runPipeline({ cwd: process.cwd(), pr, ai }) }, Number.parseInt(options.port, 10));
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
  .action(async (options: ReportOptions) => {
    const result = await runPipeline({ cwd: process.cwd() });
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

program.command("stats").option("--json", "emit JSON").action(async (options: JsonOption) => {
  const result = await runPipeline({ cwd: process.cwd() });
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
  .action(async (options: { maxDebt: string }) => {
    const result = await runPipeline({ cwd: process.cwd() });
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
}

interface ReportOptions {
  md?: boolean;
  json?: boolean;
  output?: string;
}

interface JsonOption {
  json?: boolean;
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
  if (value === "anthropic" || value === "openai") {
    return value satisfies AiProvider;
  }
  throw new Error("--ai must be anthropic, openai, or passed without a provider.");
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
