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
