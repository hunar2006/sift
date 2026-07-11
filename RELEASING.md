# Releasing Sift

Engineering-only runbook for the first public launch. No marketing copy.

## 1. Choose the final npm name

The bare `sift` name is taken on npm. Pick an available scoped or unscoped name (examples to check: `@assay/sift`, `sift-review`, `sift-diff`).

Rename procedure (after the name is chosen):

1. Set the brand/binary constants in `packages/core/src/brand.ts` (`BINARY_NAME`, `PRODUCT_NAME` if needed).
2. Update `packages/cli/package.json` `name` and `bin` keys to match.
3. Update workspace package names only if publishing more than the CLI (usually keep `@sift-review/*` private).
4. Replace user-facing strings in `README.md`, `site/index.html`, `docs/*`, and `CHANGELOG.md`.
5. Grep for leftovers:

```bash
rg -n "sift-review|BINARY_NAME|npx sift|pnpm sift" --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.evalcache/**'
```

Files that usually need a pass: `packages/core/src/brand.ts`, `packages/cli/package.json`, `package.json` (workspace scripts), `README.md`, `site/index.html`, `docs/MCP.md`, `docs/TROUBLESHOOTING.md`, `RELEASING.md`.

## 2. Pack dry-run

```bash
pnpm i
pnpm build
pnpm pack-check
cd packages/cli
npm publish --dry-run
```

Confirm the tarball includes `dist/index.js`, `dist/web/**`, `dist/grammars/**`, and that `ink`/`react` are runtime dependencies.

## 3. Publish

1. Flip `"private": false` on the publishable CLI package only.
2. `npm publish --access public` (or the org equivalent) from `packages/cli` after a clean `pnpm build`.
3. Tag `@latest`.
4. On a clean machine/VM (no workspace checkout):

```bash
npx <final-name> --version
npx <final-name> print --json
```

## 4. Tag and Pages

```bash
git tag v0.5.0
git push origin v0.5.0
```

- Activate GitHub Pages for the `pages.yml` workflow (Settings → Pages → GitHub Actions). The workflow is present but inert until the repo is public and Pages is enabled.
- Confirm `docs/screenshots/*` and any `docs/demo.*` assets are fresh (`pnpm shots`; regenerate GIF/mp4 if present).

## 5. Post-publish smoke

1. Install from the registry into an empty directory.
2. Run against a throwaway git repo with a small diff.
3. Exercise web (`npx <name>`), TUI (`npx <name> tui --print-frame`), and MCP (`npx <name> mcp` with a one-shot tool client) enough to prove the published bin resolves assets.

Do not announce until steps 3–5 are green.
