# Releasing Sift

`pnpm preflight` is the release path. It does the repeatable operating work; the human spends the final minutes judging the sampled mechanical changes and arming the one guarded publish action.

The npm package is **`siftdiff`** and its installed command is **`sift`**. Only `packages/cli` is published.

## Automated path

1. Run `pnpm preflight` locally. Read the generated `PREFLIGHT.md`, especially **READ THESE — ~8 minutes**. For every sample that looks wrong, file the displayed repro before shipping.
2. The release workflow runs `pnpm preflight --fast` on Ubuntu and Windows before the publish job. The publish job remains inert until `NPM_TOKEN` exists.
3. The optional **preflight** workflow runs the full scorecard on Ubuntu and uploads `PREFLIGHT.md` plus its browser evidence.

## SHIP IT — the only manual steps

```powershell
# In npmjs.com: Access Tokens -> Generate New Token -> Automation.
# In GitHub: Settings -> Secrets and variables -> Actions -> New repository secret.
# Add the token with the exact name NPM_TOKEN.

# In GitHub: Settings -> General -> Change visibility -> Public.
# Set description: Local-first review cockpit for AI-generated diffs — deterministic triage, provenance, and verification.
# Set topics: code-review, diff, ai, claude-code, triage, cli, mcp, local-first

# Replace PLACEHOLDER_OWNER in the tracked release metadata and commit that change.
git tag v0.6.0
git push origin v0.6.0

# GitHub -> Actions -> release: watch preflight-fast pass, then the guarded publish job.

$cold = Join-Path $env:TEMP ("sift-cold-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $cold | Out-Null
Push-Location $cold
npx --yes siftdiff@latest --version
Pop-Location
Remove-Item -LiteralPath $cold -Recurse -Force
```

Run `pnpm sift -- --watch` during one real agent session; if refreshes feel jittery rather than calm, file it before shipping.

## Superseded manual path

The previous local `npm login` / `npm publish` path is deliberately superseded. Do not publish locally: arm the guarded workflow once with the automation token, tag the verified commit, and let preflight gate the publish.

## Rollback

Publish a patch, then deprecate the broken version. Prefer `npm deprecate`; npm unpublish is time-limited and should not be the planned recovery path.
