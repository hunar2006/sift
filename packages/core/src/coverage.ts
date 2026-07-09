import { promises as fs } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { FileChange, ParsedHunk } from "./types.js";
import { normalizeRepoRelative } from "./path-utils.js";

export interface CoverageData {
  artifactPath: string;
  format: "lcov" | "cobertura";
  stale: boolean;
  files: Map<string, Map<number, number>>;
}

export interface CoverageLoadResult {
  coverage?: CoverageData;
  warnings: string[];
}

interface SiftConfig {
  coverage?: string[];
}

const AUTODETECT_COVERAGE = [
  "coverage/lcov.info",
  "lcov.info",
  "coverage/cobertura-coverage.xml",
  "coverage/cobertura.xml"
];

export async function loadCoverage(
  repoRoot: string,
  files: FileChange[],
  overridePath?: string
): Promise<CoverageLoadResult> {
  const warnings: string[] = [];
  const candidates = await coverageCandidates(repoRoot, overridePath, warnings);
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat) {
      if (overridePath) {
        warnings.push(`Coverage artifact not found: ${candidate}`);
      }
      continue;
    }
    try {
      const format = candidate.toLowerCase().endsWith(".xml") ? "cobertura" : "lcov";
      const text = await fs.readFile(candidate, "utf8");
      const coverage =
        format === "cobertura" ? parseCobertura(text, repoRoot) : parseLcov(text, repoRoot);
      return {
        coverage: {
          artifactPath: candidate,
          format,
          stale: stat.mtimeMs < (await newestChangedFileMtime(repoRoot, files)),
          files: coverage
        },
        warnings
      };
    } catch (error) {
      warnings.push(`Coverage artifact could not be parsed: ${candidate}: ${errorMessage(error)}`);
      if (overridePath) {
        break;
      }
    }
  }
  return { warnings };
}

export function attachCoverageToHunks(hunks: ParsedHunk[], coverage?: CoverageData): ParsedHunk[] {
  if (!coverage) {
    return hunks;
  }
  return hunks.map((hunk) => {
    const fileCoverage = coverage.files.get(normalizeRepoRelative(hunk.file));
    if (!fileCoverage) {
      return hunk;
    }
    let covered = 0;
    let total = 0;
    for (const line of hunk.lines) {
      if (line.kind !== "add" || line.newLine === undefined) {
        continue;
      }
      const hits = fileCoverage.get(line.newLine);
      if (hits === undefined) {
        continue;
      }
      total += 1;
      if (hits > 0) {
        covered += 1;
      }
    }
    return total > 0 ? { ...hunk, coverage: { covered, total, stale: coverage.stale } } : hunk;
  });
}

export function coverageRatioForHunks(hunks: Array<{ coverage?: { covered: number; total: number } }>): number | undefined {
  const totals = hunks.reduce(
    (acc, hunk) => {
      if (hunk.coverage) {
        acc.covered += hunk.coverage.covered;
        acc.total += hunk.coverage.total;
      }
      return acc;
    },
    { covered: 0, total: 0 }
  );
  return totals.total > 0 ? totals.covered / totals.total : undefined;
}

export function parseLcov(text: string, repoRoot: string): Map<string, Map<number, number>> {
  const coverage = new Map<string, Map<number, number>>();
  let currentFile: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      currentFile = normalizeCoveragePath(repoRoot, line.slice(3));
      if (!coverage.has(currentFile)) {
        coverage.set(currentFile, new Map());
      }
      continue;
    }
    if (line === "end_of_record") {
      currentFile = undefined;
      continue;
    }
    if (!currentFile || !line.startsWith("DA:")) {
      continue;
    }
    const [lineText, hitsText] = line.slice(3).split(",");
    const lineNumber = Number.parseInt(lineText ?? "", 10);
    const hits = Number.parseInt(hitsText ?? "", 10);
    if (Number.isFinite(lineNumber) && Number.isFinite(hits)) {
      coverage.get(currentFile)?.set(lineNumber, hits);
    }
  }
  return coverage;
}

export function parseCobertura(text: string, repoRoot: string): Map<string, Map<number, number>> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const parsed = parser.parse(text) as unknown;
  const coverage = new Map<string, Map<number, number>>();
  for (const item of collectCoberturaClasses(parsed)) {
    const file = normalizeCoveragePath(repoRoot, item.filename);
    const lines = new Map<number, number>();
    for (const line of asArray(item.lines?.line).filter(isCoberturaLine)) {
      const number = Number.parseInt(String(line.number ?? ""), 10);
      const hits = Number.parseInt(String(line.hits ?? ""), 10);
      if (Number.isFinite(number) && Number.isFinite(hits)) {
        lines.set(number, hits);
      }
    }
    if (lines.size > 0) {
      coverage.set(file, lines);
    }
  }
  return coverage;
}

async function coverageCandidates(repoRoot: string, overridePath: string | undefined, warnings: string[]): Promise<string[]> {
  if (overridePath) {
    return [resolveRepoPath(repoRoot, overridePath)];
  }
  const config = await readSiftConfig(repoRoot, warnings);
  if (config.coverage && config.coverage.length > 0) {
    return config.coverage.map((item) => resolveRepoPath(repoRoot, item));
  }
  return AUTODETECT_COVERAGE.map((item) => resolveRepoPath(repoRoot, item));
}

async function readSiftConfig(repoRoot: string, warnings: string[]): Promise<SiftConfig> {
  const file = path.join(repoRoot, ".sift", "config.json");
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as SiftConfig;
    return Array.isArray(parsed.coverage) ? parsed : {};
  } catch (error) {
    warnings.push(`Ignoring invalid Sift config: ${file}: ${errorMessage(error)}`);
    return {};
  }
}

async function newestChangedFileMtime(repoRoot: string, files: FileChange[]): Promise<number> {
  let newest = 0;
  for (const file of files) {
    const stat = await fs.stat(path.join(repoRoot, file.path)).catch(() => null);
    if (stat) {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

function normalizeCoveragePath(repoRoot: string, filePath: string): string {
  const raw = filePath.trim();
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
  return normalizeRepoRelative(path.relative(repoRoot, absolute));
}

function resolveRepoPath(repoRoot: string, item: string): string {
  return path.isAbsolute(item) ? path.resolve(item) : path.resolve(repoRoot, item);
}

function collectCoberturaClasses(node: unknown): CoberturaClass[] {
  if (!node || typeof node !== "object") {
    return [];
  }
  const record = node as Record<string, unknown>;
  const own = asArray(record.class).filter(isCoberturaClass);
  return [
    ...own,
    ...Object.values(record).flatMap((value) =>
      Array.isArray(value)
        ? value.flatMap((item) => collectCoberturaClasses(item))
        : collectCoberturaClasses(value)
    )
  ];
}

interface CoberturaClass {
  filename: string;
  lines?: { line?: unknown };
}

interface CoberturaLine {
  number?: string | number;
  hits?: string | number;
}

function isCoberturaClass(value: unknown): value is CoberturaClass {
  return Boolean(
    value &&
      typeof value === "object" &&
      "filename" in value &&
      typeof (value as { filename?: unknown }).filename === "string"
  );
}

function isCoberturaLine(value: unknown): value is CoberturaLine {
  if (!value || typeof value !== "object") {
    return false;
  }
  const line = value as CoberturaLine;
  return (
    (typeof line.number === "string" || typeof line.number === "number") &&
    (typeof line.hits === "string" || typeof line.hits === "number")
  );
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
