# Releasing Sift

Literal launch runbook for `siftdiff`. Engineering-only, no marketing copy.
Work top to bottom. `[AGENT DONE]` items are already committed on this branch;
`[HUMAN]` items require your hands (login, publish, push, repo settings).

The package is **`siftdiff`**; the installed command is **`sift`**. Only
`packages/cli` is ever published; `@sift-review/*` stay private and bundled.

Before anything: replace **`PLACEHOLDER_OWNER`** with the real GitHub owner/org
across `packages/cli/package.json`, `packages/cli/scripts/prepack.mjs`,
`site/index.html`, and `SECURITY.md`. This is the only placeholder in the tree.

---

## Prep — [AGENT DONE]

- [x] npm name set to `siftdiff`, `private` removed, `version` `0.5.0`, publish
      metadata (`description`, `license`, `repository`, `homepage`, `bugs`,
      `keywords`, `engines`, `bin`, `files`, `publishConfig`) filled in.
- [x] `prepack` builds the bundle and stages `LICENSE` + `README.md` (with
      absolute GitHub image/link URLs) into the package.
- [x] `pnpm pack-check` asserts the tarball name, required assets, `LICENSE`/
      `README`, and **no** `workspace:` / `@sift-review/*` leak in the manifest
      or bundle.
- [x] `.github/workflows/release.yml` added (inert; gated on `NPM_TOKEN`).
- [x] User-facing install strings swept to `npx siftdiff` / `npm i -g siftdiff`.
- [x] OSS hygiene: `SECURITY.md`, issue templates, PR template, `CONTRIBUTING.md`.

## Repo metadata to paste — [HUMAN]

In **Settings → General**, set the repository description and topics:

- **Description:** `Local-first review cockpit for AI-generated diffs — deterministic triage, provenance, and verification.`
- **Topics (8):** `code-review`, `diff`, `ai`, `claude-code`, `triage`, `cli`, `mcp`, `local-first`

## Ship it — [HUMAN]

The full CI gate (ubuntu + windows) runs on the tag before publish. Pick one path.

### Path A — publish locally (simplest)

```bash
npm login
cd packages/cli && npm publish   # prepack builds + stages docs; publishConfig makes it public with provenance
```

Then tag so the site deploys and the release is marked:

```bash
git tag v0.5.0 && git push origin v0.5.0
```

### Path B — publish from CI (hands-off)

1. Add an npm automation token as the repo secret **`NPM_TOKEN`**
   (Settings → Secrets and variables → Actions).
2. Push the tag; `release.yml` runs the gate then publishes, `pages.yml` deploys the site:

```bash
git tag v0.5.0 && git push origin v0.5.0
```

## Make it public & enable Pages — [HUMAN]

- Settings → General → **Change visibility → Public**.
- Settings → **Pages → Source: GitHub Actions** (arms `pages.yml`; the tag push above deploys `site/`).

## Verify the published package — [HUMAN]

In a fresh empty directory (no workspace checkout):

```bash
mkdir /tmp/sift-cold && cd /tmp/sift-cold
npx --yes siftdiff@latest --version      # expect 0.5.0
sift demo                                 # from the globally installed bin, if installed
```

Also exercise, enough to prove the published bin resolves its assets:

```bash
npx siftdiff@latest print --json          # web/grammar/triage path
npx siftdiff@latest tui --print-frame      # TUI path
```

## Post links — [HUMAN]

Once green, share the repo/site links in your chosen venues (e.g. Hacker News
Show HN, r/programming, relevant Discords/Slacks). No marketing copy required.

## Rollback — [HUMAN]

- A bad release is fixed by publishing a patch: bump `packages/cli/package.json`
  `version` (e.g. `0.5.1`), commit, and republish.
- `npm deprecate siftdiff@0.5.0 "use 0.5.1"` warns installers off a broken version.
- `npm unpublish` is only permitted within **72 hours** of publishing and only if
  nothing depends on it; do not rely on it. Prefer deprecate + patch.
