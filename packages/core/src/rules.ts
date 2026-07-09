import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ParsedHunk, RiskReason } from "./types.js";
import { normalizeRepoRelative, safeEvidence } from "./path-utils.js";

export type RuleScope = "global" | "repo";

export interface UserRule {
  id: string;
  message: string;
  paths: string[];
  exclude: string[];
  pattern?: string;
  weight: number;
  tier: "primary" | "nit";
  source: string;
}

export interface RuleAdjustment {
  code: string;
  paths?: string[];
  exclude: string[];
  weight: number;
  source: string;
}

export interface EffectiveRules {
  rules: UserRule[];
  adjust: RuleAdjustment[];
}

export interface RuleFileReport {
  scope: RuleScope;
  path: string;
  status: "ok" | "missing" | "error";
  error?: string;
}

export interface LoadedRules {
  rules: EffectiveRules;
  reports: RuleFileReport[];
}

interface RuleFileSpec {
  scope: RuleScope;
  path: string;
}

const EMPTY_RULES: EffectiveRules = { rules: [], adjust: [] };

const userRuleSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be UPPER_SNAKE"),
  message: z.string().min(1),
  paths: z.array(z.string().min(1)).nonempty().default(["**"]),
  exclude: z.array(z.string().min(1)).default([]),
  pattern: z.string().optional(),
  weight: z.number().min(-50).max(50),
  tier: z.union([z.literal("primary"), z.literal("nit")]).default("primary")
});

const adjustmentSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be UPPER_SNAKE"),
  paths: z.array(z.string().min(1)).nonempty().optional(),
  exclude: z.array(z.string().min(1)).default([]),
  weight: z.number().min(-50).max(50)
});

const rulesFileSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(userRuleSchema).default([]),
    adjust: z.array(adjustmentSchema).default([])
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, rule] of value.rules.entries()) {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "id"],
          message: `duplicate rule id ${rule.id}`
        });
      }
      seen.add(rule.id);
      if (rule.pattern) {
        validateRegex(rule.pattern, ctx, ["rules", index, "pattern"]);
      }
    }
  });

type ParsedRulesFile = z.infer<typeof rulesFileSchema>;

export async function loadRules(
  repoRoot: string,
  options: { homeDir?: string } = {}
): Promise<LoadedRules> {
  const loaded: Array<{ spec: RuleFileSpec; file: ParsedRulesFile }> = [];
  const reports: RuleFileReport[] = [];
  for (const spec of ruleFileSpecs(repoRoot, options.homeDir)) {
    const result = await loadRuleFile(spec);
    reports.push(result.report);
    if (result.file) {
      loaded.push({ spec, file: result.file });
    }
  }
  return { rules: mergeRules(loaded), reports };
}

export async function lintRuleFiles(
  repoRoot: string,
  options: { homeDir?: string } = {}
): Promise<RuleFileReport[]> {
  const reports: RuleFileReport[] = [];
  for (const spec of ruleFileSpecs(repoRoot, options.homeDir)) {
    reports.push((await loadRuleFile(spec)).report);
  }
  return reports;
}

export function applyRulesToReasons(
  hunk: ParsedHunk,
  reasons: RiskReason[],
  rules: EffectiveRules = EMPTY_RULES
): RiskReason[] {
  if (rules.rules.length === 0 && rules.adjust.length === 0) {
    return reasons;
  }
  const adjusted = reasons.flatMap((reason) => {
    const weight = adjustedWeightFor(hunk, reason, rules.adjust);
    return weight === 0 ? [] : [{ ...reason, weight }];
  });
  const added = hunk.lines.filter((line) => line.kind === "add");
  for (const rule of rules.rules) {
    if (!matchesRuleScope(hunk.file, rule.paths, rule.exclude)) {
      continue;
    }
    let match = added[0];
    if (rule.pattern) {
      const regex = new RegExp(rule.pattern);
      match = added.find((line) => regex.test(line.text));
      if (!match) {
        continue;
      }
    }
    adjusted.push({
      code: `USER_${rule.id}`,
      label: rule.message,
      weight: rule.weight,
      tier: rule.tier,
      line: match?.newLine,
      evidence: match ? safeEvidence(match.text) : safeEvidence(normalizeRepoRelative(hunk.file))
    });
  }
  return adjusted;
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizeGlobPath(pattern);
  const normalizedFile = normalizeRepoRelative(filePath);
  if (!normalizedPattern.includes("*")) {
    return normalizedPattern === normalizedFile;
  }
  return globToRegExp(normalizedPattern).test(normalizedFile);
}

export function formatRuleFileProblem(report: RuleFileReport): string {
  return report.error ? `${report.path}: ${report.error}` : report.path;
}

function ruleFileSpecs(repoRoot: string, homeDir: string = os.homedir()): RuleFileSpec[] {
  return [
    { scope: "global", path: path.join(homeDir, ".sift", "rules.yml") },
    { scope: "repo", path: path.join(repoRoot, ".sift", "rules.yml") }
  ];
}

async function loadRuleFile(
  spec: RuleFileSpec
): Promise<{ report: RuleFileReport; file?: ParsedRulesFile }> {
  let text: string;
  try {
    text = await fs.readFile(spec.path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { report: { ...spec, status: "missing" } };
    }
    return { report: { ...spec, status: "error", error: errorMessage(error) } };
  }
  try {
    const parsed = rulesFileSchema.parse(parseYaml(text));
    return { report: { ...spec, status: "ok" }, file: parsed };
  } catch (error) {
    return { report: { ...spec, status: "error", error: zodOrErrorMessage(error) } };
  }
}

function mergeRules(loaded: Array<{ spec: RuleFileSpec; file: ParsedRulesFile }>): EffectiveRules {
  const customRules = new Map<string, UserRule>();
  const adjust: RuleAdjustment[] = [];
  for (const { spec, file } of loaded) {
    for (const rule of file.rules) {
      customRules.set(rule.id, { ...rule, source: spec.path });
    }
    for (const item of file.adjust) {
      adjust.push({ ...item, exclude: item.exclude ?? [], source: spec.path });
    }
  }
  return { rules: [...customRules.values()], adjust };
}

function adjustedWeightFor(hunk: ParsedHunk, reason: RiskReason, adjustments: RuleAdjustment[]): number {
  let weight = reason.weight;
  for (const adjustment of adjustments) {
    if (adjustment.code === reason.code && matchesRuleScope(hunk.file, adjustment.paths ?? ["**"], adjustment.exclude)) {
      weight = adjustment.weight;
    }
  }
  return weight;
}

function matchesRuleScope(filePath: string, paths: string[], exclude: string[]): boolean {
  return paths.some((pattern) => matchesGlob(pattern, filePath)) && !exclude.some((pattern) => matchesGlob(pattern, filePath));
}

function normalizeGlobPath(pattern: string): string {
  return pattern.replace(/\\/g, "/").replace(/^\.\//, "");
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += escapeRegexChar(char ?? "");
  }
  return new RegExp(`^${source}$`);
}

function escapeRegexChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function validateRegex(pattern: string, ctx: z.RefinementCtx, issuePath: Array<string | number>): void {
  try {
    new RegExp(pattern);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: issuePath,
      message: `invalid regex: ${errorMessage(error)}`
    });
  }
}

function zodOrErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) {
      return "invalid rules file";
    }
    const pathText = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${pathText}${issue.message}`;
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
