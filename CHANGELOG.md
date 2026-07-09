# Changelog

All notable changes to Sift are documented here.

The format follows Keep a Changelog, and this project uses semantic versioning once published.

## [0.2.0] - Unreleased

### Added

- Signal & Structure upgrade work started from a green v0.1 baseline.
- Lazy Shiki syntax highlighting for visible diff hunks, with cached highlighters and plain-text fallback.
- Standalone parser fixtures for the twelve v0.1 edge cases: renames, binary/mode-only changes, CRLF, unicode paths, oversized lines, file create/delete, lockfiles, and submodules.

### Changed

- Package-local `pnpm --filter ... test` scripts now invoke Vitest from the workspace root so package-scoped tests include the root Vitest configuration.

### Fixed

- Pending.

## [0.1.0] - 2026-07-09

### Added

- Initial local-first review cockpit with deterministic diff triage, risk scoring, persisted review state, Claude Code provenance, local web UI, reports, checks, and demo fixture.
