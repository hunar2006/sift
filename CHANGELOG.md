# Changelog

All notable changes to Sift are documented here.

The format follows Keep a Changelog, and this project uses semantic versioning once published.

## [0.4.0] - Unreleased

### Added

- Live & Launch-Ready upgrade work started from a clean v0.3 baseline.
- Windows is now part of the CI matrix (Node 20), alongside Ubuntu 20/22 and macOS 20.
- `sift --watch` and `sift --staged --watch` now keep the review server live: Chokidar watches the worktree plus Git index/HEAD, debounces changes, serializes re-analysis, and publishes hunk deltas through `GET /api/events` Server-Sent Events.
- The web review queue now subscribes to live updates, preserves the nearest prior selection when a hunk disappears, toasts the add/remove count, marks new hunks with a verdict-teal dot and inspector chip, offers a `New (n)` filter, and shows a reduced-motion-safe live HUD indicator.
- `sift brief` now produces an agent-ready Markdown handoff for flagged hunks (or `--unreviewed-high`), including reviewer notes, plain-language primary reasons, and per-hunk patches capped at 120 lines.
- Hunk responses now carry persistent `firstSeenAt` values backed by an atomic, bounded `.sift/seen.json` sidecar. Freshness can therefore survive a page reload in the same browser session.

### Changed

- Git discovery of untracked and linguist-generated paths now uses NUL-delimited output, preserving Windows, Unicode, and whitespace-bearing paths.
- A running local server now owns a mutable review model, so manual refreshes and successful watch updates share the same response shape while failed watch ticks leave the last good model available.

## [0.3.0] - Unreleased

### Added

- Real WASM tree-sitter analysis for TypeScript, TSX, JavaScript, Python, and Go, including AST-derived definitions, removed definitions, references, enclosing symbols, format/import facts, rename sites, tokenizer fallback, parser guards, a 2.5-second per-file budget, and `astCoverage` metadata.
- Deterministic Change Digest engine: every hunk gains a factual `digest` with a `headline` and up to three detail bullets, plus optional `HunkGroup.digest` summaries, driven by a fixed 19-row headline template priority and a signal-code-to-phrase map (`digestPhrases.ts`). Digests describe and never judge, enforced by a forbidden-verdict guardrail scanned in tests and smoke.
- `sift print` and `sift report` now surface digest headlines for the top risky hunks, and the report gains a Top attention section.
- `GET /api/report?format=md` serves the reused Markdown report generator with no snapshot side-effects.
- Inspector now leads with a Digest block (headline + detail bullets, code refs rendered inline) and, for provenance-matched hunks, an Intent block promoting the Asked/Agent excerpts, a source chip, and line-match percentage out of the provenance card (which keeps session and transcript details). The Agent reasoning collapses to two lines with an expand toggle.
- `--ai` now also produces one whole-diff AI Review Brief (`{ story, readingHint }`) from the group digests and top attention-hunk digests with secrets excluded, cached at `.sift/ai-cache/<sha256>.json` and bypassable with `--no-ai-cache`. Served at `GET /api/brief` (404 when absent) and rendered as a dismissible, collapsible, per-diff Briefing bar under the header.
- AI annotations render as a labeled second headline line (`AI · <provider>`) beneath the deterministic digest without ever replacing it. The annotation system prompt now forbids stating or implying a change is safe, correct, or ready to approve.
- Client-side undo (`z`, depth 20) for approve/flag/unreview and group-approve (one compound entry), restoring prior status and note via the existing status endpoints. Every decision shows a consistent-verb toast (`Approved session.ts — Z to undo`); a stale entry after refresh drops itself with `Nothing to undo here`. Undo/flag-reason logic is a pure, tested reducer.
- Focus mode (`f` / palette "Enter focus mode"): a single-card flow over attention hunks with an `n of m` counter, digest + intent + reasons + diff + coverage, and an `[a]/[x]/[j]/[z]` action row; `Esc` returns to the workbench.
- Quick-flag picker (`x`): numbered canned reasons (from `.sift/config.json` `flagReasons`, cap 6, defaults otherwise) plus `i` for a free note; works in the workbench and focus mode.
- Group approval now opens a preview modal (group digest, per-hunk headlines and line counts, total, confirm/cancel) with the 409 hot-signal block rendered inline.
- Completion screen shown when every attention hunk is decided: headline, stat row, flagged list with digests, and Copy report (via `GET /api/report?format=md`) / Back to queue. `/api/meta` now reports `flagReasons` and `briefAvailable`.
- The demo now exercises every digest headline template: migration and CI-workflow files pre-exist so their edits render as `Migration:`/`Edits CI workflow` rather than new files, and a removed-function hunk fires the `Removes` template. Smoke asserts these rows plus added-symbol, rename-group, and lockfile headlines are present.
- Assay Office visual system: dark/light token sets as CSS variables (`--ink-*`, `--line`, `--text-hi/lo`, `--verdict`, and risk hues) with legacy aliases; locally-bundled Instrument Sans + JetBrains Mono via Fontsource (no network fonts); a sieve logomark used in the header and as the favicon; the `VERIFIED`/`FLAGGED` decision stamp with a 140ms settle and a reduced-motion fallback, plus static workbench mini-stamps; and a contrast test asserting AA for token pairs in both themes.

### Changed

- CLI analysis now loads bounded NEW-side sources from the worktree, index, or local range target before synchronous core analysis, while unavailable or invalid files degrade silently to the existing tokenizer.
- Pinned `web-tree-sitter` to the 0.20.8 ABI used by the allowed `tree-sitter-wasms` grammar package.
- README documents the change digest, summary stack ("describes, never judges"), updated keymap (`f`, `x→1–4`, `i`, `z`), `flagReasons` config, the Review Brief, `--no-ai-cache`, and screenshot placeholders. The queue is now two-line ledger rows with a band-colored risk spine.

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
