import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeDiff,
  baseHunkId,
  groupingMismatches,
  mergeReviewState,
  readReviewState,
  updateHunkStatus,
  type Hunk,
  type ReviewModel
} from "@sift-review/core";
import { verifyMechanicalHonesty, verifyRenameGroups } from "./mechanical.js";
import { fingerprintModel, type Violation } from "./types.js";

const CATEGORIES = new Set([
  "logic",
  "tests",
  "config",
  "deps",
  "docs",
  "mechanical",
  "generated",
  "binary"
]);
const BANDS = new Set(["high", "medium", "low", "skim"]);

function repro(repo: string, sha: string): string {
  return `pnpm eval --repo ${repo} --sha ${sha}`;
}

function lineNumbersInHunk(hunk: Hunk): Set<number> {
  const lines = new Set<number>();
  for (const line of hunk.lines) {
    if (line.newLine !== undefined) {
      lines.add(line.newLine);
    }
    if (line.oldLine !== undefined) {
      lines.add(line.oldLine);
    }
  }
  return lines;
}

export function checkCompleteness(repo: string, sha: string, model: ReviewModel): Violation[] {
  const violations: Violation[] = [];
  for (const hunk of model.hunks) {
    if (!CATEGORIES.has(hunk.category)) {
      violations.push({
        repo,
        sha,
        invariant: "completeness",
        detail: `Invalid category ${hunk.category} on ${hunk.id}`,
        repro: repro(repo, sha)
      });
    }
    if (!BANDS.has(hunk.band)) {
      violations.push({
        repo,
        sha,
        invariant: "completeness",
        detail: `Invalid band ${hunk.band} on ${hunk.id}`,
        repro: repro(repo, sha)
      });
    }
    const headline = hunk.digest?.headline ?? "";
    if (!headline || headline.length > 90) {
      violations.push({
        repo,
        sha,
        invariant: "completeness",
        detail: `Bad digest.headline on ${hunk.id}: ${JSON.stringify(headline)}`,
        repro: repro(repo, sha)
      });
    }
    for (const reason of hunk.reasons) {
      if (!reason.label || reason.label.trim().length === 0) {
        violations.push({
          repo,
          sha,
          invariant: "completeness",
          detail: `Reason without label on ${hunk.id} (${reason.code})`,
          repro: repro(repo, sha)
        });
      }
    }
  }
  return violations;
}

export function checkMechanical(repo: string, sha: string, model: ReviewModel): Violation[] {
  const violations: Violation[] = [];
  for (const hunk of model.hunks) {
    if (hunk.category !== "mechanical") {
      continue;
    }
    const fail = verifyMechanicalHonesty(hunk);
    if (fail) {
      violations.push({
        repo,
        sha,
        invariant: "mechanical-honesty",
        detail: fail,
        repro: repro(repo, sha)
      });
    }
  }
  for (const fail of verifyRenameGroups(model)) {
    violations.push({
      repo,
      sha,
      invariant: "mechanical-honesty",
      detail: fail,
      repro: repro(repo, sha)
    });
  }
  return violations;
}

export function checkDeterminism(
  repo: string,
  sha: string,
  first: ReviewModel,
  second: ReviewModel
): Violation[] {
  const a = fingerprintModel(first);
  const b = fingerprintModel(second);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    return [
      {
        repo,
        sha,
        invariant: "determinism",
        detail: "Double-run models differ on ids/categories/scores/digests",
        repro: repro(repo, sha)
      }
    ];
  }
  return [];
}

export function checkBounds(repo: string, sha: string, model: ReviewModel): Violation[] {
  const violations: Violation[] = [];
  for (const hunk of model.hunks) {
    if (hunk.risk < 0 || hunk.risk > 100 || !Number.isFinite(hunk.risk)) {
      violations.push({
        repo,
        sha,
        invariant: "bounds",
        detail: `Score ${hunk.risk} out of [0,100] on ${hunk.id}`,
        repro: repro(repo, sha)
      });
    }
    const lines = lineNumbersInHunk(hunk);
    for (const reason of hunk.reasons) {
      if (reason.line !== undefined && lines.size > 0 && !lines.has(reason.line)) {
        violations.push({
          repo,
          sha,
          invariant: "bounds",
          detail: `Reason ${reason.code} line ${reason.line} outside hunk ${hunk.id}`,
          repro: repro(repo, sha)
        });
      }
    }
  }
  return violations;
}

/** Invariant #8: no final-band/category hunk may be rendered in a conflicting queue group. */
export function checkGrouping(repo: string, sha: string, model: ReviewModel): Violation[] {
  return groupingMismatches(model.hunks).map((detail) => ({
    repo,
    sha,
    invariant: "grouping",
    detail,
    repro: repro(repo, sha)
  }));
}

export function checkPerf(
  repo: string,
  sha: string,
  durationMs: number,
  changedLines: number,
  perfMult: number
): Violation[] {
  // A one-second floor was below normal Windows scheduling variance (a clean
  // 909-line corpus sample measured 1034ms). Keep the line-scaled budget but
  // make the fixed floor stable enough to remain a deterministic gate.
  const budgetMs = Math.max(1250, 5000 * (changedLines / 20_000)) * perfMult;
  if (durationMs > budgetMs) {
    return [
      {
        repo,
        sha,
        invariant: "perf",
        detail: `Wall ${durationMs.toFixed(0)}ms exceeded budget ${budgetMs.toFixed(0)}ms (${changedLines} changed lines, PERF_MULT=${perfMult})`,
        repro: repro(repo, sha)
      }
    ];
  }
  return [];
}

/** Approve sample → re-read state preserved; mutate one changed line → id changes → unreviewed. */
export async function checkStateSafety(
  repo: string,
  sha: string,
  model: ReviewModel,
  sampleSize = 25
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const sample = model.hunks.slice(0, sampleSize);
  if (sample.length === 0) {
    return violations;
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sift-eval-state-"));
  try {
    for (const hunk of sample) {
      await updateHunkStatus(scratch, hunk.id, "approved", "eval");
    }
    const { state } = await readReviewState(scratch);
    const merged = mergeReviewState(model, state);
    for (const hunk of sample) {
      const stored = merged.hunks.find((h) => h.id === hunk.id)?.status;
      if (stored !== "approved") {
        violations.push({
          repo,
          sha,
          invariant: "state-safety",
          detail: `Approved status not preserved for ${hunk.id}`,
          repro: repro(repo, sha)
        });
      }
    }

    const target = sample[0];
    if (target) {
      const mutatedLines = target.lines.map((line, index) =>
        index === target.lines.findIndex((l) => l.kind === "add" || l.kind === "del")
          ? { ...line, text: `${line.text} /*eval-mutate*/` }
          : line
      );
      const mutated = { ...target, lines: mutatedLines };
      const newId = baseHunkId(mutated);
      if (newId === target.id.replace(/~\d+$/u, "") || newId === target.id) {
        // base id might collide only if mutation didn't affect changed lines
        const hasChange = mutatedLines.some((l, i) => l.text !== target.lines[i]?.text);
        if (hasChange) {
          // id should differ from original base
          const originalBase = target.id.replace(/~\d+$/u, "");
          if (newId === originalBase) {
            violations.push({
              repo,
              sha,
              invariant: "state-safety",
              detail: `Mutating changed line did not change id for ${target.id}`,
              repro: repro(repo, sha)
            });
          }
        }
      }
      const remodeled = analyzeDiff({
        repoRoot: scratch,
        diffSpec: "EVAL_MUTATE",
        git: model.meta.git,
        patch: syntheticPatch(mutated)
      });
      const remapped = remodeled.hunks[0];
      if (remapped && remapped.id === target.id) {
        violations.push({
          repo,
          sha,
          invariant: "state-safety",
          detail: `Re-analyzed mutated hunk kept id ${target.id}`,
          repro: repro(repo, sha)
        });
      }
      if (remapped) {
        const after = mergeReviewState(remodeled, state);
        const status = after.hunks.find((h) => h.id === remapped.id)?.status ?? "unreviewed";
        if (status !== "unreviewed") {
          violations.push({
            repo,
            sha,
            invariant: "state-safety",
            detail: `Mutated hunk ${remapped.id} should be unreviewed, got ${status}`,
            repro: repro(repo, sha)
          });
        }
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
  return violations;
}

function syntheticPatch(hunk: Hunk): string {
  const oldCount = hunk.lines.filter((l) => l.kind !== "add").length || 1;
  const newCount = hunk.lines.filter((l) => l.kind !== "del").length || 1;
  const body = hunk.lines
    .map((line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      return `${prefix}${line.text}`;
    })
    .join("\n");
  return [
    `diff --git a/${hunk.file} b/${hunk.file}`,
    `--- a/${hunk.file}`,
    `+++ b/${hunk.file}`,
    `@@ -${hunk.oldStart ?? 1},${oldCount} +${hunk.newStart ?? 1},${newCount} @@`,
    body,
    ""
  ].join("\n");
}
