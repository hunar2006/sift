import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHumanReview, renderScorecard, renderShipIt } from "./human.js";
import { createStages, loadMechanicalCandidates } from "./stages.js";
import type { PreflightContext, PreflightOptions, Stage, StageId, StageResult } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORDER: StageId[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function parseOptions(argv: string[]): PreflightOptions {
  const options: PreflightOptions = { fast: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fast") {
      options.fast = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--only") {
      const stage = argv[++index]?.toUpperCase() as StageId | undefined;
      if (!stage || !ORDER.includes(stage)) {
        throw new Error("--only expects one stage letter: A, B, C, D, E, F, G, or H.");
      }
      options.only = stage;
    } else {
      throw new Error(`Unknown preflight option: ${arg}`);
    }
  }
  return options;
}

export async function runStages(stages: Record<StageId, Stage>, context: PreflightContext): Promise<StageResult[]> {
  const results: StageResult[] = [];
  for (const id of context.options.only ? [context.options.only] : ORDER) {
    try {
      const result = await stages[id](context);
      results.push(result);
    } catch (error) {
      results.push({
        id,
        name: id,
        status: "FAIL",
        summary: "stage threw before completing",
        details: [error instanceof Error ? error.stack ?? error.message : String(error)],
        durationMs: 0
      });
    }
  }
  return results;
}

export function renderPreflightMarkdown(results: StageResult[], samples: Awaited<ReturnType<typeof loadMechanicalCandidates>>): string {
  const verdict = results.some((result) => result.status === "FAIL") ? "FAIL" : "PASS";
  const lines = ["# Sift preflight", "", `**Verdict: ${verdict}**`, "", renderScorecard(results), ""];
  for (const result of results) {
    lines.push(`## ${result.id} — ${result.name}`, "");
    for (const detail of result.details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");
  }
  lines.push(renderHumanReview(samples), "", renderShipIt(), "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  let options: PreflightOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  const artifactsDir = path.join(ROOT, "preflight-artifacts");
  await fs.rm(artifactsDir, { recursive: true, force: true });
  const context: PreflightContext = { root: ROOT, options, artifactsDir };
  console.log(`Sift preflight${options.fast ? " (fast)" : ""}`);
  const results = await runStages(createStages(), context);
  for (const result of results) {
    console.log(`${result.id} ${result.status} ${(result.durationMs / 1000).toFixed(1)}s — ${result.summary}`);
  }
  const samples = await loadMechanicalCandidates(ROOT);
  const markdown = renderPreflightMarkdown(results, samples);
  await fs.writeFile(path.join(ROOT, "PREFLIGHT.md"), markdown, "utf8");
  if (options.json) {
    await fs.writeFile(path.join(ROOT, "PREFLIGHT.json"), `${JSON.stringify({ verdict: results.some((result) => result.status === "FAIL") ? "FAIL" : "PASS", results }, null, 2)}\n`, "utf8");
  }
  const failures = results.filter((result) => result.status === "FAIL");
  console.log(`\nPREFLIGHT ${failures.length === 0 ? "PASS" : "FAIL"}`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain || process.argv[1]?.endsWith("preflight/index.ts")) {
  await main();
}
