import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { runPipeline } from "../packages/cli/src/pipeline-runner.js";

const execFileAsync = promisify(execFile);
const FILES = 400;
const TARGET_CHANGED_LINES = 25_000;
const MAX_PIPELINE_MS = 5_000 * Number(process.env.PERF_MULT ?? "1");
const MAX_SERIALIZE_MS = 1_500;
const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-perf-"));

try {
  await createFixture(repoRoot);
  const timings: number[] = [];
  let serialization = { ms: 0, bytes: 0 };
  for (let run = 1; run <= 3; run += 1) {
    const started = performance.now();
    const result = await runPipeline({ cwd: repoRoot });
    const elapsed = performance.now() - started;
    timings.push(elapsed);
    const serializedAt = performance.now();
    const json = JSON.stringify(result.model);
    serialization = { ms: performance.now() - serializedAt, bytes: Buffer.byteLength(json) };
    console.log(`run ${run}: ${elapsed.toFixed(1)} ms; review JSON ${serialization.ms.toFixed(1)} ms / ${serialization.bytes.toLocaleString()} bytes`);
  }
  const sorted = [...timings].sort((left, right) => left - right);
  const minimum = sorted[0] ?? 0;
  const median = sorted[1] ?? 0;
  console.log(`perf: ${FILES} files, ~${TARGET_CHANGED_LINES.toLocaleString()} changed lines; min ${minimum.toFixed(1)} ms, median ${median.toFixed(1)} ms`);
  if (median > MAX_PIPELINE_MS) {
    throw new Error(`Performance budget exceeded: median ${median.toFixed(1)} ms > ${MAX_PIPELINE_MS.toFixed(1)} ms.`);
  }
  if (serialization.ms > MAX_SERIALIZE_MS) {
    throw new Error(`Review JSON serialization exceeded: ${serialization.ms.toFixed(1)} ms > ${MAX_SERIALIZE_MS} ms.`);
  }
} finally {
  await fs.rm(repoRoot, { recursive: true, force: true });
}

async function createFixture(root: string): Promise<void> {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "perf@sift.local"]);
  await git(root, ["config", "user.name", "Sift Perf"]);
  for (let index = 0; index < FILES; index += 1) {
    const file = fixturePath(index);
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), baselineSource(index), "utf8");
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  await git(root, ["mv", fixturePath(0), "src/logic/renamed-module.ts"]);

  for (let index = 0; index < FILES; index += 1) {
    const file = changedFixturePath(index);
    await fs.writeFile(path.join(root, file), changedSource(index), "utf8");
  }
}

function changedFixturePath(index: number): string {
  return index === 0 ? "src/logic/renamed-module.ts" : fixturePath(index);
}

function fixturePath(index: number): string {
  if (index < 240) {
    const extension = ["ts", "py", "go"][index % 3] ?? "ts";
    return `src/logic/module-${index}.${extension}`;
  }
  if (index < 320) {
    return `tests/module-${index}.test.ts`;
  }
  if (index < 340) {
    return `migrations/${String(index).padStart(3, "0")}_schema.sql`;
  }
  if (index < 350) {
    return `build/generated-${index}.txt`;
  }
  if (index < 360) {
    return `src/format/rename-${index}.ts`;
  }
  if (index === 360) {
    return "pnpm-lock.yaml";
  }
  return `docs-and-config/file-${index}.md`;
}

function baselineSource(index: number): string {
  if (index >= 350 && index < 360) {
    return `export function formatDate(value: string): string { return value; }\n`;
  }
  return `// baseline ${index}\nexport const value${index} = ${index};\n`;
}

function changedSource(index: number): string {
  if (index >= 350 && index < 360) {
    return `export function renderDate(value: string): string { return value; }\n${Array.from({ length: 61 }, (_, line) => `export const format_${index}_${line} = ${line};`).join("\n")}\n`;
  }
  const prefix = index % 3 === 0 ? "export const" : index % 3 === 1 ? "const" : "let";
  const lines = Array.from({ length: 62 }, (_, line) => `${prefix} value${index}_${line} = ${index + line};`);
  return `${lines.join("\n")}\n`;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}
