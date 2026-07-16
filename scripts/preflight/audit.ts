import { promises as fs } from "node:fs";
import path from "node:path";
import type { MechanicalSample } from "./types.js";
import { loadYaml, relative, walkTextFiles } from "./utils.js";

export function isAllowedPackedFile(filePath: string): boolean {
  return (
    filePath === "package.json" ||
    filePath === "LICENSE" ||
    filePath === "NOTICE" ||
    filePath === "README.md" ||
    filePath === "dist/index.js" ||
    /^dist\/[A-Za-z0-9-]+\.d\.ts(?:\.map)?$/u.test(filePath) ||
    /^dist\/grammars\/tree-sitter-[a-z]+\.wasm$/u.test(filePath) ||
    filePath === "dist/web/index.html" ||
    filePath.startsWith("dist/web/assets/")
  );
}

export async function scanPlaceholders(root: string, allowed = new Set<string>()): Promise<string[]> {
  const unexpected: string[] = [];
  await walkTextFiles(root, async (filePath, content) => {
    const file = relative(root, filePath);
    if (file.startsWith("scripts/preflight/") || file === "PREFLIGHT.md" || file === "PREFLIGHT.json") {
      return;
    }
    for (const match of content.matchAll(/\b(?:TBD|PLACEHOLDER(?:_[A-Z0-9_]+)?)\b/gu)) {
      const token = match[0];
      if (!allowed.has(token)) {
        unexpected.push(`${relative(root, filePath)}: ${token}`);
      }
    }
  });
  return unexpected.sort();
}

export function checkWorkflowGuard(root: string, releaseText: string, pagesText: string): string[] {
  const yaml = loadYaml(root);
  const errors: string[] = [];
  let release: Record<string, unknown>;
  let pages: Record<string, unknown>;
  try {
    release = yaml.parse(releaseText) as Record<string, unknown>;
    pages = yaml.parse(pagesText) as Record<string, unknown>;
  } catch (error) {
    return [`workflow YAML does not parse: ${error instanceof Error ? error.message : String(error)}`];
  }
  const releaseTriggers = release.on as Record<string, unknown> | undefined;
  const pagesTriggers = pages.on as Record<string, unknown> | undefined;
  if (!hasTagTrigger(releaseTriggers) || !("workflow_dispatch" in (releaseTriggers ?? {}))) {
    errors.push("release.yml must trigger on v* tags and workflow_dispatch");
  }
  if (!hasTagTrigger(pagesTriggers)) {
    errors.push("pages.yml must trigger on v* tags");
  }
  const jobs = asRecord(release.jobs);
  const gate = asRecord(jobs.gate);
  const publish = asRecord(jobs.publish);
  const gateSteps = Array.isArray(gate.steps) ? gate.steps : [];
  if (!gateSteps.some((step) => typeof step === "object" && step !== null && String((step as Record<string, unknown>).run ?? "").includes("pnpm preflight --fast"))) {
    errors.push("release gate must run pnpm preflight --fast");
  }
  const needs = publish.needs;
  if (!(needs === "gate" || (Array.isArray(needs) && needs.includes("gate")))) {
    errors.push("publish must depend on gate");
  }
  const publishSteps = Array.isArray(publish.steps) ? publish.steps : [];
  for (const step of publishSteps) {
    if (typeof step === "object" && step !== null && String((step as Record<string, unknown>).run ?? "").includes("npm publish")) {
      if (!String((step as Record<string, unknown>).if ?? "").includes("env.NPM_TOKEN != ''")) {
        errors.push("npm publish is not guarded by NPM_TOKEN presence");
      }
    }
  }
  return errors;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function hasTagTrigger(value: Record<string, unknown> | undefined): boolean {
  const push = asRecord(value?.push);
  const tags = push.tags;
  return Array.isArray(tags) && tags.includes("v*");
}

export function mechanicalSubtype(sample: MechanicalSample): "format-only" | "import-reorder" | "comment-only" | "rename" {
  const reason = sample.categoryReason.toLowerCase();
  const patch = sample.patch.toLowerCase();
  if (reason.includes("rename")) {
    return "rename";
  }
  if (reason.includes("format") || reason.includes("whitespace")) {
    return "format-only";
  }
  if (/^[+-]\s*import\b/mu.test(patch)) {
    return "import-reorder";
  }
  return "comment-only";
}

export function sampleMechanicalHunks(candidates: MechanicalSample[], count = 10): MechanicalSample[] {
  const ordered = [...candidates].sort((a, b) =>
    `${a.repo}\0${mechanicalSubtype(a)}\0${a.file}\0${a.hunkId}`.localeCompare(
      `${b.repo}\0${mechanicalSubtype(b)}\0${b.file}\0${b.hunkId}`
    )
  );
  const selected: MechanicalSample[] = [];
  const used = new Set<string>();
  const subtypes: Array<ReturnType<typeof mechanicalSubtype>> = ["format-only", "import-reorder", "comment-only", "rename"];
  const repos = [...new Set(ordered.map((item) => item.repo))];
  const take = (predicate: (item: MechanicalSample) => boolean): void => {
    const next = ordered.find((item) => !used.has(item.hunkId) && predicate(item));
    if (next && selected.length < count) {
      selected.push(next);
      used.add(next.hunkId);
    }
  };
  for (const subtype of subtypes) {
    take((item) => mechanicalSubtype(item) === subtype);
  }
  for (const repo of repos) {
    take((item) => item.repo === repo);
  }
  for (const item of ordered) {
    if (selected.length >= count) {
      break;
    }
    if (!used.has(item.hunkId)) {
      selected.push(item);
      used.add(item.hunkId);
    }
  }
  return selected;
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(path.resolve(filePath), "utf8");
}
