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

### Changed

- Package-local `pnpm --filter ... test` scripts now invoke Vitest from the workspace root so package-scoped tests include the root Vitest configuration.
- Rebalanced built-in signal weights: TLS disablement is stronger, broad/swallowed errors are quieter, dangerous APIs and SQL concatenation are reduced in tests, migrations cap at 50, and debug/TODO findings are nit-tier.
- Removed the v0.1 `LARGE_NOVEL` signal in favor of scoped `NOVEL_UNTESTED` logic.
- Invalid rules files are reported and skipped during analysis; `sift rules lint` exits non-zero for invalid existing files.

### Fixed

- Pending.

## [0.1.0] - 2026-07-09

### Added

- Initial local-first review cockpit with deterministic diff triage, risk scoring, persisted review state, Claude Code provenance, local web UI, reports, checks, and demo fixture.
