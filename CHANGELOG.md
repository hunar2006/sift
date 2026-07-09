# Changelog

All notable changes to Sift are documented here.

The format follows Keep a Changelog, and this project uses semantic versioning once published.

## [0.2.0] - Unreleased

### Added

- Signal & Structure upgrade work started from a green v0.1 baseline.
- Lazy Shiki syntax highlighting for visible diff hunks, with cached highlighters and plain-text fallback.
- Standalone parser fixtures for the twelve v0.1 edge cases: renames, binary/mode-only changes, CRLF, unicode paths, oversized lines, file create/delete, lockfiles, and submodules.
- Signal engine v2 detectors for high-entropy secrets, concurrency hazards, typosquat-suspect dependencies, agent-guidance edits, large untested logic additions, and coverage-driven risk reducers/untested-change findings.
- YAML user rules with global/repo precedence, custom `USER_*` signals, built-in signal adjustments, `sift rules lint`, `sift rules list`, and `docs/RULES.md`.
- Parse-only coverage ingest for LCOV and Cobertura artifacts, `.sift/config.json` coverage discovery, `--coverage <path>` CLI overrides, per-hunk coverage summaries, stats/report coverage lines, and stale-artifact handling.
- Structural token-stream layer for format-only mechanical detection, definition/reference extraction, and cross-file rename-pattern skim groups.
- Queue sort modes for risk, reading order, and path order; reading mode uses core-computed `readingRank` from changed-hunk definition/reference edges, and the web UI persists the selected mode.
- AI annotation v2 provider selection with `cross`, `same`, and `both` modes, provider-tagged `aiAnnotations`, optional drift text, and transcript-derived generator model family detection.
- Open provenance JSONL ingest via `~/.sift/provenance.jsonl`, a core provenance provider interface, generic provider support, `docs/PROVENANCE.md`, and `/api/timeline`.
- Read-only stdio MCP server via `sift mcp`, exposing summary, flagged/unreviewed lists, hunk detail, and stats tools with `docs/MCP.md`.
- Terminal-first `sift print` output with compact text and JSON modes.
- `sift demo`, backed by the same reusable demo-repo generator as `pnpm demo`.
- Web cockpit command palette, provenance timeline panel, stats panel, minimap rail, first-run help strip, light theme, coverage badges, and inline reason chips.
- Demo v2 fixture covering new signals, repo rules, coverage reducers/untested changes, rename-pattern groups, reading-order ranks, timeline provenance, print output, rules lint, and MCP smoke coverage.

### Changed

- Package-local `pnpm --filter ... test` scripts now invoke Vitest from the workspace root so package-scoped tests include the root Vitest configuration.
- Rebalanced built-in signal weights: TLS disablement is stronger, broad/swallowed errors are quieter, dangerous APIs and SQL concatenation are reduced in tests, migrations cap at 50, and debug/TODO findings are nit-tier.
- Removed the v0.1 `LARGE_NOVEL` signal in favor of scoped `NOVEL_UNTESTED` logic.
- Invalid rules files are reported and skipped during analysis; `sift rules lint` exits non-zero for invalid existing files.
- Coverage artifacts are read from disk only; Sift still does not run repository tests, scripts, or configs.
- Comment-only and token-format-only mechanical hunks now stay in skim formatting groups.
- Risk remains the default queue ordering to preserve v0.1 behavior.
- Bare `--ai` now resolves as cross-model review; when provenance does not identify a generator family, Sift falls back to configured keys and prints the selected provider.
- User-facing provenance match wording now says `line match` instead of exposing the internal confidence field.
- CLI builds now bundle workspace packages with tsup and copy package-local web and grammar assets for dry-run packaging checks.
- Web keymap remapped note focus from `n` to `i`; `n`/`p` now move between unreviewed attention hunks, `space` collapses the current hunk, `Ctrl/Cmd+K` opens the palette, and `t` opens the timeline.
- Risk color language now reserves a distinct filled critical tier for hunks scoring 80 or higher; ordinary high-risk hunks use outlined red-orange treatment.
- README now leads with developer-facing review language and documents rules, coverage, MCP, open provenance, print/demo, privacy, and the personal-only framing for `sift check`.

### Fixed

- Pending.

## [0.1.0] - 2026-07-09

### Added

- Initial local-first review cockpit with deterministic diff triage, risk scoring, persisted review state, Claude Code provenance, local web UI, reports, checks, and demo fixture.
