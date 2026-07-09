# Contributing

## Development

```bash
pnpm i
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Fixtures And Tests

- Parser fixtures belong under `fixtures/diffs` when promoted out of inline tests.
- Core tests should cover parser status, hunk ids, category rules, signal weights, grouping, ordering, state, stats, and report output.
- Adapter tests should use temporary directories and `SIFT_HOME` / `SIFT_CLAUDE_DIR` overrides.
- Web tests should exercise store transitions and keyboard behavior without depending on a browser.

## Demo

`pnpm demo` creates `.demo/repo`, commits a baseline, applies an uncommitted agent-style change, writes fake local provenance under `.demo/home`, and launches the built CLI. `pnpm smoke` runs the same fixture headlessly and checks `sift report --json`.

## Privacy Bar

Do not add telemetry, analytics, remote calls, or git write operations. Runtime network access is limited to loopback and explicit `--ai` provider requests.
