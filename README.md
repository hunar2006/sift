# Sift

**Stop reading slop. Verify what matters.**

Sift is a local-first review cockpit for large AI-generated diffs. Run it inside a git repository and it turns the diff into an ordered queue: critical logic first, skim-safe mechanical bundles at the end, visible evidence on every risky hunk, and review status preserved in `.sift/`.

## Why

AI agents can produce more code than a human can calmly review in one pass. Sift focuses on the human review bottleneck: deterministic triage, structural grouping, coverage evidence, provenance, and durable local state. Optional AI annotations can summarize, but they never change score, category, order, or review status.

## Quickstart

```bash
pnpm i
pnpm build
pnpm sift
```

Until packages are published, run the built binary directly:

```bash
node packages/cli/dist/index.js
```

Try the demo:

```bash
pnpm demo
# or, after build
node packages/cli/dist/index.js demo
```

## What It Does

- Triage: classifies hunks as logic, tests, config, deps, docs, mechanical, generated, or binary.
- Risk: scores hunks with deterministic, inspectable reasons and user-tunable rules.
- Structure: detects format-only changes, rename-pattern groups, definitions, references, and reading-order hints.
- Coverage: parses LCOV and Cobertura artifacts that you generated yourself.
- Provenance: reads Claude Code hook logs and open JSONL records from other agent tools.
- State: tracks approved, flagged, and unreviewed hunks locally.

## Commands

| Command | Purpose |
|---|---|
| `sift [range]` | Analyze the worktree or a ref/range, start the loopback UI, and print the URL. |
| `sift --staged` | Analyze staged changes. |
| `sift pr <number-or-url>` | Analyze a GitHub PR diff through the `gh` CLI. |
| `sift report [--md\|--json] [-o file]` | Emit a markdown or JSON review report and append a stats snapshot. |
| `sift print [--json]` | Print a compact terminal triage summary without starting the server. |
| `sift stats [--json]` | Print current review debt, reviewed percentage, flags, and line-match coverage. |
| `sift check [--max-debt pct]` | Personal pre-push aid. Do not use review debt as a team performance metric. |
| `sift demo [--dir path]` | Generate the demo repo and launch Sift against it. |
| `sift rules lint` | Validate global and repo rules files. |
| `sift rules list` | Print the effective merged ruleset. |
| `sift mcp` | Serve read-only review context over stdio MCP tools. |
| `sift hooks install [--project]` | Install the Claude Code PostToolUse capture hook. |
| `sift hooks status [--project]` | Show whether the hook is installed. |
| `sift hooks uninstall [--project]` | Remove only Sift's hook entry. |

## Cockpit Keys

| Key | Action |
|---|---|
| `Ctrl/Cmd+K` | Open the command palette. |
| `j` / `k` | Next / previous visible hunk. |
| `n` / `p` | Next / previous unreviewed attention hunk. |
| `J` / `K` | Next / previous file. |
| `a`, `x`, `u` | Approve, flag, or mark unreviewed. |
| `i` | Focus the note field. |
| `space` | Collapse or expand the current hunk body. |
| `s` | Cycle risk, reading, and path sort modes. |
| `t` | Open the provenance timeline. |
| `T` | Toggle light/dark theme. |
| `?` | Open help. |

## Rules

Rules let you tune Sift without forking it. Sift loads `~/.sift/rules.yml`, then `<repo>/.sift/rules.yml`, with repo rules winning. Custom rules create `USER_*` reasons, and adjustments can suppress or reweight built-in reasons.

See [docs/RULES.md](docs/RULES.md).

## Coverage Evidence

Sift never executes repository tests, scripts, or configs. It only parses artifacts you already produced, currently LCOV and Cobertura XML. Configure paths in `.sift/config.json`, use autodetected `coverage/lcov.info`, or pass `--coverage <path>` to `sift`, `report`, `check`, `print`, or `mcp`.

Fresh coverage can add a green risk reducer for well-covered changed logic. Stale artifacts still show badges, but do not reduce risk.

## Provenance

`sift hooks install` merges a Claude Code PostToolUse hook into settings. The hook appends compact hashes plus session metadata to `~/.sift/provenance.jsonl`.

Other agent tools can write the same open JSONL format. This is the sanctioned path for Cursor, Copilot, Codex, and other CLIs until first-party adapters exist. See [docs/PROVENANCE.md](docs/PROVENANCE.md).

## MCP

`sift mcp` runs the pipeline once and serves read-only stdio tools for agents. It exposes summaries, flagged hunks, unreviewed hunks, hunk details, and stats. It has no write tools and accepts only ids/enums as inputs.

See [docs/MCP.md](docs/MCP.md).

## Optional AI

`--ai`, `--ai=cross`, `--ai=same`, `--ai=both`, `--ai=anthropic`, or `--ai=openai` adds annotation-only summaries for high and medium risk hunks. Secret-like hunks, including high-entropy secrets, are excluded from provider payloads. AI output never changes score, category, order, grouping, or status.

## Security And Privacy

- Runtime is offline-first by default.
- No telemetry or analytics.
- Sift never runs reviewed repository code.
- Git access is read-only except the `pr` command's explicit use of `gh`.
- The web server binds `127.0.0.1` only.
- Grammar wasm files and the web UI are bundled from disk; nothing is fetched at runtime.
- State lives under `.sift/`, which self-ignores with `.sift/.gitignore`.
- Network is used only for localhost UI/MCP operation and explicit `--ai` provider calls.

## License

MIT.
