import type { MechanicalSample, StageResult } from "./types.js";
import { mechanicalSubtype, sampleMechanicalHunks } from "./audit.js";

export function renderScorecard(results: StageResult[]): string {
  const lines = ["## Scorecard", "", "| Stage | Result | Duration | Summary |", "| --- | --- | ---: | --- |"];
  for (const result of results) {
    lines.push(`| ${result.id} — ${result.name} | **${result.status}** | ${(result.durationMs / 1000).toFixed(1)}s | ${result.summary} |`);
  }
  return lines.join("\n");
}

export function renderHumanReview(candidates: MechanicalSample[]): string {
  const samples = sampleMechanicalHunks(candidates, 10);
  const lines = ["## READ THESE — ~8 minutes", ""];
  if (samples.length === 0) {
    lines.push("No mechanical samples were available. Run `pnpm preflight` without `--fast` to refresh the eval report.");
    return lines.join("\n");
  }
  for (const sample of samples) {
    lines.push(`### ${sample.repo} · ${sample.sha.slice(0, 8)} · ${sample.file}`);
    lines.push("");
    lines.push(`Sift verdict: mechanical / ${mechanicalSubtype(sample)} / ${sample.band} ${sample.risk}`);
    lines.push("```diff");
    lines.push(sample.patch.split("\n").slice(0, 40).join("\n"));
    lines.push("```");
    lines.push("[ ] looks right / [ ] wrong");
    lines.push(`Repro: \`pnpm eval --repo ${sample.repo} --sha ${sample.sha}\``);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderShipIt(): string {
  return `## SHIP IT — the only manual steps

\`\`\`powershell
# 1. In npmjs.com: Access Tokens -> Generate New Token -> Automation.
# 2. In GitHub: Settings -> Secrets and variables -> Actions -> New repository secret.
#    Name it NPM_TOKEN and paste that automation token.
# 3. In GitHub: Settings -> General -> Change visibility -> Public.
#    Description: Local-first review cockpit for AI-generated diffs — deterministic triage, provenance, and verification.
#    Topics: code-review, diff, ai, claude-code, triage, cli, mcp, local-first
# 4. Replace PLACEHOLDER_OWNER in the tracked release metadata, commit that change, then tag the verified commit:
git tag v0.5.0
git push origin v0.5.0
# 5. GitHub -> Actions -> release: watch the preflight-fast gate, then the guarded publish job.
# 6. Cold verify from a fresh temporary directory:
$cold = Join-Path $env:TEMP ("sift-cold-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $cold | Out-Null
Push-Location $cold
npx --yes siftdiff@latest --version
Pop-Location
Remove-Item -LiteralPath $cold -Recurse -Force
\`\`\`

Run \`pnpm sift -- --watch\` during one real agent session; if refreshes feel jittery rather than calm, file it before shipping.`;
}
