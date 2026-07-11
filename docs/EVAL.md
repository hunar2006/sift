# How we test Sift

Sift grades AI-written diffs. The engine itself is graded by a private eval harness (`packages/eval`, not shipped in the published CLI).

## Corpus

Six permissively licensed repos, pinned by exact SHA in `packages/eval/corpus.lock.json`:

| id | language | license |
| --- | --- | --- |
| zod | TypeScript | MIT |
| express | JavaScript | MIT |
| flask | Python | BSD-3-Clause |
| httpx | Python | BSD-3-Clause |
| chi | Go | MIT |
| fastify | TypeScript | MIT |

Clones live under `.evalcache/` (gitignored). For each repo, the harness replays the most recent **40 non-merge** commits as `C^..C` with provenance off, `--ai` off, and coverage off. Corpus trees are **never** built, installed, or executed — only `git` + parse/analyze.

## Invariants (`pnpm eval`)

Hard fails on any of:

1. Crash / non-zero path through the pipeline
2. Completeness (category, band, digest headline ≤ 90 chars, reason labels)
3. Mechanical honesty (independent re-check of whitespace / format / import-reorder / rename groups)
4. Determinism (double-run deep-equal on ids, categories, scores, digests)
5. Bounds (scores ∈ [0,100]; reason lines inside hunk)
6. State safety (approve preserved; mutate changed line → new id → unreviewed)
7. Perf budget: `max(1s, 5s × changedLines/20_000) × PERF_MULT`

## Latest full run

- **Date:** 2026-07-11
- **Shape:** 6 repos × 40 commits
- **Hunks:** 1442
- **Violations:** 0
- **Wall:** ~4 minutes with warm `.evalcache` (`PERF_MULT=2`)

### Per-repo

| Repo | Commits | Hunks | Mechanical | p50 ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| zod | 40 | 396 | 3 | 282 | 1136 |
| express | 40 | 119 | 5 | 260 | 1058 |
| flask | 40 | 354 | 0 | 299 | 1183 |
| httpx | 40 | 194 | 0 | 273 | 1103 |
| chi | 40 | 129 | 11 | 284 | 1105 |
| fastify | 40 | 250 | 21 | 432 | 1113 |

### Distributions

- **Categories:** deps 426 · logic 385 · docs 222 · config 187 · tests 179 · mechanical 40 · generated 2 · binary 1
- **Bands:** low 1009 · skim 247 · medium 183 · high 3

### Highest-firing signals (per 1k hunks)

| Signal | Fires | /1k |
| --- | ---: | ---: |
| CI_WORKFLOW | 131 | 90.85 |
| PUBLIC_API | 23 | 15.95 |
| TEST_WEAKENED | 16 | 11.10 |
| SEC_PATH | 14 | 9.71 |
| TLS_DISABLED | 5 | 3.47 |

### Recommendations (not applied)

- `CI_WORKFLOW` fires on >5% of hunks — likely over-noisy for library repos with frequent Actions churn; left frozen per the tuning boundary.
- `SEC_PATH` on documentation paths (e.g. zod MDX) looks over-broad; recommendation only.
- `TLS_DISABLED` correctly lights on `verify=False` mentions, including changelog/docs — expected but noisy.
- Rare signals (≤2 fires) remain under-exercised by this corpus window.

Full machine report (gitignored): `packages/eval/report/report.md` after `pnpm eval`.

## Fuzzer (`pnpm fuzz`)

Property-based (fast-check) over parser mutations and synthetic pipeline diffs. Local: 10 000 parser + 1 000 pipeline. CI: 1 500 / 200 with fixed seed. First green run produced **zero** failures; named regressions land in `packages/eval/fuzz-regressions/` when found.

## Spot-check

Human verdicts for sampled mechanical and high-band hunks are recorded in `DECISIONS.md` (Phase 4). One mechanical misclassification (Go `//go:build` treated as COMMENT_ONLY) was fixed with a permanent fixture.
