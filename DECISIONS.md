# Decisions

## 2026-07-09

- Chose a hand-rolled unified diff parser instead of `parse-diff` so Sift can meet the exact parser edge cases in the v0.1 spec without adapting a third-party model.
- Kept `@tailwindcss/vite` out of the dependency graph and used Tailwind v4 through CSS-compatible utility classes plus hand-authored CSS. This keeps the build dependency list closer to the allowlist while preserving the intended UI style.
- Used OpenAI `gpt-4.1-mini` as the optional OpenAI annotation default. It is only reached when `--ai=openai` or `--ai` resolves to OpenAI and `OPENAI_API_KEY` is present.
- Treat lockfile-only hunks with no hot signals as the `Lockfiles` skim group even though the `deps` base score is 15. The grouping spec expects bulk-approvable lockfiles, while the base-score table would otherwise make every dependency hunk at least `low`.

## 2026-07-10

- v0.2 baseline was green before upgrade work: `pnpm i`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all passed. Core coverage was 80.8% lines.
- Upgrade plan follows the v0.2 phase order: carry-over highlighting/fixtures, signal engine v2, rules, coverage, structural layer, ordering, AI/provenance, MCP/print/demo publish-readiness, cockpit overhaul, demo v2/docs/smoke.
- Cut-line protocol is active. If needed, cuts will happen only in the specified order: ink TUI stretch, reading-order sort mode, cross-file rename-pattern groups, minimap, Cobertura support.
- Shiki highlighting is lazy-loaded from the web client and allowed to fall back to escaped plain text per hunk. The build currently emits grammar/theme chunks through Vite; this keeps first paint non-blocking and can be tightened during publish-readiness if package size becomes a problem.
- `SECRET_ENTROPY` uses observed Shannon entropy with the specified 4.2 bits/char threshold. Pure hex SHA-like strings are covered by near-miss tests and do not fire because their maximum observed entropy is 4 bits/char.
- The built-in typosquat comparison set is a hardcoded plausible npm/PyPI list in core; no package registry or network lookup is performed.
- The rules engine uses the allowed `yaml` dependency in core and Sift's own small glob matcher (`*`, `**`, exact) rather than adding a glob package.
- Rules are loaded inside the CLI pipeline and applied before the second classification pass, so user suppressions and custom hot signals can affect mechanical demotion deterministically.
- Coverage ingest uses hand-rolled LCOV parsing and the allowed `fast-xml-parser` dependency for Cobertura. It only reads artifact text and changed-file mtimes; it never invokes tests or repo scripts.
- Coverage discovery honors `--coverage`, then `.sift/config.json`, then the specified autodetect paths. Invalid `.sift/config.json` is reported as a warning and ignored so analysis remains fail-open.
- Added the allowed `web-tree-sitter` and `tree-sitter-wasms` dependencies for the structural layer. The current core pass uses deterministic token-stream fallback when parser/grammar assets are unavailable; CLI package wasm asset copying remains part of publish-readiness.
- Cross-file rename-pattern groups are synthesized only when one identifier mapping appears in at least three files and five sites, and only for hunks without signals weighted 15 or higher.
- Reading-order ranks are annotations only; the persisted review model still defaults to v0.1 risk ordering, while the web client applies the user's persisted sort mode locally.
- Reading-order ties, cycles, and hunks without definition/reference edges fall back to risk ordering so ambiguous structural data never hides higher-risk work.
- AI provider resolution treats bare `--ai` as `cross`: use the opposite provider when provenance reveals a dominant generator family and that key exists, otherwise use configured keys with an informational line.
- AI v2 keeps `aiSummary` and `aiConcern` as compatibility accessors, but new annotations are stored per provider in `aiAnnotations[]` with optional drift text.
- Provenance matching now lives in core behind a `ProvenanceProvider` interface. Claude Code is the first provider; generic JSONL records from other tools are matched after Claude so canonical hook/transcript matches win ties.
- The open provenance file remains `~/.sift/provenance.jsonl`; generic ingestion skips `source=claude-code` records so the legacy Claude hook path and third-party records can share one file without duplicate matches.
- The MCP server is stdio-only and read-only. It uses a separate no-write state reader instead of the normal state helper because the normal helper may back up corrupt files.
- MCP tool inputs are restricted to ids and enums; no path, glob, shell, HTTP, or review-state mutation tools are exposed.
- `sift print` is implemented as a CLI-local renderer over the same pipeline/state/stats path as reports. JSON output exposes compact triage data rather than the full review model so terminal automation has a stable small shape.
- The demo repository generator now lives in core and only invokes `git`; both `pnpm demo` and `sift demo` reuse it, with demo provenance isolated through demo-specific `SIFT_HOME` and `SIFT_CLAUDE_DIR` values.
- CLI publish-readiness uses `tsup` for the CLI bundle with `@sift-review/*` packages bundled into `dist/index.js`. The CLI build copies the web dist into `dist/web` and selected `tree-sitter-wasms` grammars into `dist/grammars`; runtime resolution prefers those package-local assets and falls back to the monorepo web dist for development.
- Internal workspace packages are dev-only semver dependencies in the CLI package, and `pnpm-workspace.yaml` links matching workspace versions. This keeps the packed manifest free of `workspace:` ranges while preserving local development resolution.
- The cockpit command palette is implemented in-house in the React shell with token/fuzzy matching and no new dependency; actions call the same store/API paths as keyboard shortcuts.
- Theme and split preferences persist in localStorage, while the first-run help overlay is a one-time localStorage flag. If storage is unavailable, Sift falls back to dark theme, unified diff on narrow viewports, and no persisted preference.
- The web minimap is a hunk-level rail over the visible queue. It selects hunks directly and hides below 1000px width; the deeper virtualized multi-hunk scroll map remains unnecessary for the current one-hunk viewer architecture.
- Demo v2 intentionally includes deterministic trigger snippets for every new signal family, a repo rules file that both fires and suppresses a built-in reason, fresh LCOV evidence for covered and untested hunks, a rename-pattern fixture, and definition/reference hunks with reading ranks.
- The final smoke script now asserts the demo model, `sift print --json`, `sift rules lint`, `sift mcp` via the SDK stdio client, and CLI package assets. This keeps publish-readiness checks on the installed-user path without publishing.

## 2026-07-10 — v0.3 Clarity & Craft

- The v0.3 baseline is green before implementation: `pnpm i`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke` all passed. The suite has 72 tests across 15 files, core line coverage is 88.65%, and smoke reports 34 hunks in 11 groups.
- The implementation follows the specification's phase order: real tree-sitter, deterministic digests, intent surfacing, labeled AI summaries and Review Brief, decision UX, Assay Office visual system, craft pass, demo/smoke, then documentation and final audit.
- The v0.3 cut-line protocol is active in this order: Review Brief, completion-screen flourishes while retaining basic stats, then tree-sitter only after three materially different documented integration attempts. No cut has been made.
