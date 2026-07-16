# Releasing Sift

`pnpm preflight` is the release path. It performs the repeatable checks; the human spends the final minutes judging the sampled mechanical changes before tagging a release.

## GitHub-first launch

Sift launches from GitHub first. Keep `NPM_TOKEN` unset: the `release` workflow still runs its cross-platform gate and deploys GitHub Pages for a version tag, while its npm publish step is skipped. After the workflow passes, create the GitHub Release for that tag. npm publication is deliberately a later decision.

1. Run `pnpm preflight` locally. Read the generated `PREFLIGHT.md`, especially the `READ THESE` section. File any sampled mechanical change that looks wrong before shipping.
2. Make the repository public, set GitHub Pages to deploy from GitHub Actions, and confirm `main` is the default branch.
3. Push a version tag. The release workflow runs `pnpm preflight --fast` on Ubuntu and Windows; the same tag triggers the Pages deployment.
4. When both workflows pass, create the GitHub Release and verify a clean-clone source install.

```powershell
git status --short
git tag -a v0.9.0 -m "Sift v0.9.0"
git push origin v0.9.0

$cold = Join-Path $env:TEMP ("sift-cold-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $cold | Out-Null
Push-Location $cold
git clone https://github.com/hunar2006/sift.git
Set-Location sift
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm sift --help
Pop-Location
Remove-Item -LiteralPath $cold -Recurse -Force
```

The optional **preflight** workflow runs the full scorecard on Ubuntu and uploads `PREFLIGHT.md` plus browser evidence.

## Later: publish to npm

The npm package is **`siftdiff`** and its installed command is **`sift`**. Only `packages/cli` is published.

1. In npmjs.com, create a granular token with package read/write permission.
2. In GitHub, add it as the repository Actions secret `NPM_TOKEN`.
3. Bump the package version, commit it, and push a fresh `v*` tag. Never reuse a published npm version.
4. Watch the guarded publish job, then cold-verify with `npx --yes siftdiff@<version> --version`.

Do not publish locally: the guarded release workflow builds, gates, and publishes with provenance.

## Rollback

Publish a patch, then deprecate the broken version. Prefer `npm deprecate`; npm unpublish is time-limited and should not be the planned recovery path.
