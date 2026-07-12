import { analyzeCommitRange, countChangedLines } from "./analyze.js";
import { ensureCorpusClone, filterCorpus, listReplayCommits, loadCorpusLock, parentOf } from "./corpus.js";
import {
  checkBounds,
  checkCompleteness,
  checkDeterminism,
  checkMechanical,
  checkPerf,
  checkStateSafety
} from "./invariants.js";
import { emptyRepoStats, writeReport } from "./report.js";
import {
  patchForHunk,
  type EvalReport,
  type SpotSample,
  type Violation
} from "./types.js";

export interface EvalOptions {
  repoFilter?: string;
  shaFilter?: string;
  commitLimit?: number;
  perfMult?: number;
  skipStateSafety?: boolean;
}

function parseArgs(argv: string[]): EvalOptions {
  const options: EvalOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      options.repoFilter = argv[++i];
    } else if (arg === "--sha") {
      options.shaFilter = argv[++i];
    } else if (arg === "--commits") {
      options.commitLimit = Number.parseInt(argv[++i] ?? "40", 10);
    } else if (arg === "--skip-state-safety") {
      options.skipStateSafety = true;
    }
  }
  if (process.env.EVAL_REPOS) {
    options.repoFilter = process.env.EVAL_REPOS;
  }
  if (process.env.EVAL_COMMITS) {
    options.commitLimit = Number.parseInt(process.env.EVAL_COMMITS, 10);
  }
  options.perfMult = Number.parseFloat(process.env.PERF_MULT ?? "1") || 1;
  options.commitLimit ??= 40;
  return options;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export async function runEval(argv = process.argv.slice(2)): Promise<EvalReport> {
  const options = parseArgs(argv);
  const startedAt = new Date().toISOString();
  const corpus = filterCorpus(await loadCorpusLock(), options.repoFilter);
  const violations: Violation[] = [];
  const spotMechanical: SpotSample[] = [];
  const spotHigh: SpotSample[] = [];
  const repos = [];

  console.error(
    `eval: ${corpus.length} repo(s), up to ${options.commitLimit} commits each, PERF_MULT=${options.perfMult}`
  );

  for (const entry of corpus) {
    const stats = emptyRepoStats(entry.id);
    const repoPath = await ensureCorpusClone(entry, options.commitLimit ?? 40);
    let commits = await listReplayCommits(repoPath, entry.sha, options.commitLimit ?? 40);
    if (options.shaFilter) {
      commits = commits.filter((sha) => sha.startsWith(options.shaFilter!));
    }
    console.error(`eval: ${entry.id} — ${commits.length} commits at ${repoPath}`);
    let stateSafetySample: { sha: string; model: Awaited<ReturnType<typeof analyzeCommitRange>> } | undefined;

    for (const sha of commits) {
      const parent = await parentOf(repoPath, sha);
      if (!parent) {
        console.error(`eval: skip ${entry.id}@${sha.slice(0, 8)} (no parent)`);
        continue;
      }
      const range = `${parent}..${sha}`;
      let model;
      let modelSecond;
      let durationMs = 0;
      try {
        const t0 = performance.now();
        model = await analyzeCommitRange(repoPath, range);
        durationMs = performance.now() - t0;
        modelSecond = await analyzeCommitRange(repoPath, range);
      } catch (error) {
        violations.push({
          repo: entry.id,
          sha,
          invariant: "no-crash",
          detail: error instanceof Error ? error.message : String(error),
          repro: `pnpm eval --repo ${entry.id} --sha ${sha}`
        });
        console.error(`eval: CRASH ${entry.id}@${sha.slice(0, 8)}: ${String(error)}`);
        continue;
      }

      const changedLines = countChangedLines(model);
      stats.commits += 1;
      stats.hunks += model.hunks.length;
      stats.timingsMs.push(durationMs);
      stats.mechanical += model.hunks.filter((h) => h.category === "mechanical").length;
      stats.renameGroups += model.groups.filter(
        (g) => g.title.startsWith("Rename:") || g.hunkIds.some((id) => {
          const h = model.hunks.find((x) => x.id === id);
          return Boolean(h?.categoryReason.startsWith("RENAME_PATTERN:"));
        })
      ).length;

      for (const hunk of model.hunks) {
        bump(stats.categories, hunk.category);
        bump(stats.bands, hunk.band);
        for (const reason of hunk.reasons) {
          stats.signalCounts.set(reason.code, (stats.signalCounts.get(reason.code) ?? 0) + 1);
          const list = stats.signalFires.get(reason.code) ?? [];
          if (list.length < 5) {
            list.push({
              code: reason.code,
              label: reason.label,
              repo: entry.id,
              sha,
              hunkId: hunk.id,
              file: hunk.file,
              evidence: reason.evidence
            });
            stats.signalFires.set(reason.code, list);
          }
        }
        if (hunk.category === "mechanical" && spotMechanical.length < 200) {
          spotMechanical.push({
            repo: entry.id,
            sha,
            hunkId: hunk.id,
            file: hunk.file,
            category: hunk.category,
            categoryReason: hunk.categoryReason,
            band: hunk.band,
            risk: hunk.risk,
            headline: hunk.digest.headline,
            patch: patchForHunk(hunk)
          });
        }
        if (hunk.band === "high" && spotHigh.length < 20) {
          spotHigh.push({
            repo: entry.id,
            sha,
            hunkId: hunk.id,
            file: hunk.file,
            category: hunk.category,
            categoryReason: hunk.categoryReason,
            band: hunk.band,
            risk: hunk.risk,
            headline: hunk.digest.headline,
            patch: patchForHunk(hunk)
          });
        }
      }

      violations.push(
        ...checkCompleteness(entry.id, sha, model),
        ...checkMechanical(entry.id, sha, model),
        ...checkDeterminism(entry.id, sha, model, modelSecond),
        ...checkBounds(entry.id, sha, model),
        ...checkPerf(entry.id, sha, durationMs, changedLines, options.perfMult ?? 1)
      );

      if (!stateSafetySample && model.hunks.length > 0) {
        stateSafetySample = { sha, model };
      }
    }

    if (!options.skipStateSafety && stateSafetySample) {
      violations.push(
        ...(await checkStateSafety(entry.id, stateSafetySample.sha, stateSafetySample.model))
      );
    }

    repos.push(stats);
  }

  const finishedAt = new Date().toISOString();
  const report: EvalReport = {
    startedAt,
    finishedAt,
    repos,
    violations,
    spotMechanical,
    spotHigh
  };
  const reportPath = await writeReport(report);
  console.error(`eval: wrote ${reportPath}`);
  console.error(`eval: ${violations.length} violation(s)`);
  return report;
}

export async function main(): Promise<void> {
  const report = await runEval();
  if (report.violations.length > 0) {
    for (const v of report.violations.slice(0, 50)) {
      console.error(`FAIL [${v.invariant}] ${v.repo}@${v.sha.slice(0, 8)}: ${v.detail}`);
    }
    if (report.violations.length > 50) {
      console.error(`…and ${report.violations.length - 50} more`);
    }
    process.exitCode = 1;
  }
}
