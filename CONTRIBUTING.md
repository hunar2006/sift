# Contributing

## Development

```bash
pnpm i
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm watch       # runs Sift live
pnpm tui         # runs terminal Sift
pnpm smoke
pnpm perf        # timing budget on a synthetic large diff
pnpm pack-check  # packs the CLI and verifies installed assets resolve
pnpm eval        # grades the engine against pinned open-source corpora
pnpm fuzz        # property-based parser/pipeline fuzzing
```

Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Tuning boundary — signal weights

Signal weights and thresholds are graded by `pnpm eval` and are easy to overfit. **Do not
silently change signal weights in a feature PR.** If you believe a weight is wrong, open an
issue with the eval evidence (a corpus/commit where the current weight misfires) and propose
the change there first. Weight changes land as their own reviewed PR with the eval delta.

## Fixture-first rule for parser bugs

For any parser or diff-handling bug, **add the failing fixture before the fix**. Put a minimal
reproducing diff under `fixtures/diffs` (or a fuzz regression under
`packages/eval/fuzz-regressions/`), watch it fail, then fix it. This keeps the parser's edge
cases pinned.

## Fixtures And Tests

- Parser fixtures belong under `fixtures/diffs` when promoted out of inline tests.
- Core tests should cover parser status, hunk ids, category rules, signal weights, grouping, ordering, state, stats, and report output.
- Adapter tests should use temporary directories and `SIFT_HOME` / `SIFT_CLAUDE_DIR` overrides.
- Web tests should exercise store transitions and keyboard behavior without depending on a browser.

## Demo

`pnpm demo` creates `.demo/repo`, commits a baseline, applies an uncommitted agent-style change, writes fake local provenance under `.demo/home`, and launches the built CLI. `pnpm smoke` runs the same fixture headlessly and checks `sift report --json`.

## Privacy Bar

Do not add telemetry, analytics, remote calls, or git write operations. Runtime network access is limited to loopback and explicit `--ai` provider requests.
