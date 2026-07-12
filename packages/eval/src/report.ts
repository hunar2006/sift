import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalReport, RepoStats, SignalFire, SpotSample } from "./types.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_DIR = path.join(PACKAGE_ROOT, "report");

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function countMapToSorted(map: Record<string, number>): string {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function aggregateSignalCounts(repos: RepoStats[]): Map<string, number> {
  const all = new Map<string, number>();
  for (const repo of repos) {
    for (const [code, count] of repo.signalCounts) {
      all.set(code, (all.get(code) ?? 0) + count);
    }
  }
  return all;
}

function aggregateSignalExamples(repos: RepoStats[]): Map<string, SignalFire[]> {
  const all = new Map<string, SignalFire[]>();
  for (const repo of repos) {
    for (const [code, fires] of repo.signalFires) {
      const merged = [...(all.get(code) ?? []), ...fires].slice(0, 5);
      all.set(code, merged);
    }
  }
  return all;
}

export async function writeReport(report: EvalReport): Promise<string> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, "report.md");
  const totalHunks = report.repos.reduce((sum, r) => sum + r.hunks, 0);
  const signalCounts = aggregateSignalCounts(report.repos);
  const signalExamples = aggregateSignalExamples(report.repos);
  const rankedSignals = [...signalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top8 = rankedSignals.slice(0, 8);

  const lines: string[] = [];
  lines.push("# Sift eval report");
  lines.push("");
  lines.push(`Generated: ${report.finishedAt}`);
  lines.push(`Started: ${report.startedAt}`);
  lines.push(`Repos: ${report.repos.length} · Hunks: ${totalHunks} · Violations: ${report.violations.length}`);
  lines.push("");

  lines.push("## Per-repo");
  lines.push("");
  lines.push("| Repo | Commits | Hunks | Mechanical | Rename groups | p50 ms | p95 ms |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const repo of report.repos) {
    const sorted = [...repo.timingsMs].sort((a, b) => a - b);
    lines.push(
      `| ${repo.id} | ${repo.commits} | ${repo.hunks} | ${repo.mechanical} | ${repo.renameGroups} | ${percentile(sorted, 50).toFixed(0)} | ${percentile(sorted, 95).toFixed(0)} |`
    );
  }
  lines.push("");

  lines.push("## Category distribution (overall)");
  lines.push("");
  const categories: Record<string, number> = {};
  const bands: Record<string, number> = {};
  for (const repo of report.repos) {
    for (const [k, v] of Object.entries(repo.categories)) {
      categories[k] = (categories[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(repo.bands)) {
      bands[k] = (bands[k] ?? 0) + v;
    }
  }
  lines.push(countMapToSorted(categories) || "(none)");
  lines.push("");
  lines.push("## Band distribution (overall)");
  lines.push("");
  lines.push(countMapToSorted(bands) || "(none)");
  lines.push("");

  lines.push("## Signal fire rates (per 1,000 hunks)");
  lines.push("");
  lines.push("| Signal | Fires | Rate /1k |");
  lines.push("| --- | ---: | ---: |");
  for (const [code, count] of rankedSignals) {
    const rate = totalHunks === 0 ? 0 : (count / totalHunks) * 1000;
    lines.push(`| ${code} | ${count} | ${rate.toFixed(2)} |`);
  }
  lines.push("");

  lines.push("## Top-firing signals — example excerpts");
  lines.push("");
  for (const [code] of top8) {
    const fires = signalExamples.get(code) ?? [];
    lines.push(`### ${code}`);
    lines.push("");
    for (const fire of fires.slice(0, 5)) {
      lines.push(
        `- \`${fire.repo}@${fire.sha.slice(0, 8)}\` ${fire.file} · ${fire.label}${fire.evidence ? ` — ${fire.evidence}` : ""}`
      );
    }
    lines.push("");
  }

  lines.push("## Recommendations");
  lines.push("");
  if (rankedSignals.length === 0) {
    lines.push("- No signal fires observed in this run.");
  } else {
    const high = rankedSignals.filter(([, count]) => totalHunks > 0 && count / totalHunks > 0.05);
    const low = rankedSignals.filter(([, count]) => count <= 2);
    if (high.length > 0) {
      lines.push("- Suspected over-firing (>%5 of hunks): " + high.map(([c]) => c).join(", "));
    }
    if (low.length > 0) {
      lines.push("- Rare signals (≤2 fires; may be under-tested): " + low.map(([c]) => c).join(", "));
    }
    if (high.length === 0 && low.length === 0) {
      lines.push("- No strong over/under-firing pattern; review top-8 excerpts manually.");
    }
  }
  lines.push("- Recommendations only — scoring weights remain frozen unless an invariant/spec bug is proven.");
  lines.push("");

  lines.push("## Violations");
  lines.push("");
  if (report.violations.length === 0) {
    lines.push("_None._");
  } else {
    for (const v of report.violations) {
      lines.push(`- **${v.invariant}** \`${v.repo}@${v.sha.slice(0, 8)}\`: ${v.detail} — \`${v.repro}\``);
    }
  }
  lines.push("");

  lines.push("## Spot-check samples (mechanical)");
  lines.push("");
  appendSpot(lines, report.spotMechanical);
  lines.push("## Spot-check samples (high band)");
  lines.push("");
  appendSpot(lines, report.spotHigh);

  await fs.writeFile(out, `${lines.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "report.json"), `${JSON.stringify(serializableReport(report), null, 2)}\n`, "utf8");
  return out;
}

function serializableReport(report: EvalReport): Record<string, unknown> {
  return {
    ...report,
    repos: report.repos.map((repo) => ({
      ...repo,
      signalCounts: Object.fromEntries(repo.signalCounts),
      signalFires: Object.fromEntries(repo.signalFires)
    }))
  };
}

function appendSpot(lines: string[], samples: SpotSample[]): void {
  if (samples.length === 0) {
    lines.push("_None._");
    lines.push("");
    return;
  }
  for (const sample of samples) {
    lines.push(`### ${sample.repo}@${sample.sha.slice(0, 8)} · ${sample.file}`);
    lines.push("");
    lines.push(
      `- id: \`${sample.hunkId}\` · ${sample.category}/${sample.categoryReason} · ${sample.band} ${sample.risk}`
    );
    lines.push(`- headline: ${sample.headline}`);
    lines.push("```diff");
    lines.push(sample.patch.slice(0, 4000));
    lines.push("```");
    lines.push("");
  }
}

export function emptyRepoStats(id: string): RepoStats {
  return {
    id,
    commits: 0,
    hunks: 0,
    categories: {},
    bands: {},
    mechanical: 0,
    renameGroups: 0,
    timingsMs: [],
    signalCounts: new Map(),
    signalFires: new Map()
  };
}
