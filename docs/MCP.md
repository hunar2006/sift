# Sift MCP

`sift mcp [range] [--staged] [--coverage <path>]` starts a stdio MCP server with read-only tools. It does not start HTTP, mutate review state, accept filesystem paths as tool input, or run repository code.

**Live freshness:** every tool call re-reads `.sift/state.json`. Before answering from the cached model it checks a cheap fingerprint (`git rev-parse HEAD` + `git status --porcelain -z` + `state.json`/`seen.json` mtimes). If the fingerprint moved, it re-runs the analysis pipeline (serialized; concurrent calls coalesce onto the in-flight run), then answers. Mid-session edits and new flags therefore show up on the next tool call without restarting MCP.

Register it with Claude Desktop or Claude Code:

```bash
claude mcp add sift -- sift mcp
```

Tools:

- `sift_get_summary()` returns totals, group counts, debt, coverage percent, and flagged count.
- `sift_list_flagged()` returns flagged hunks with id, file, line span, risk, top reasons, and user note.
- `sift_list_unreviewed({ minBand?: "high" | "medium" | "low" })` returns unreviewed hunks at or above the requested band.
- `sift_get_hunk({ id })` returns one hunk with patch text capped at 6,000 characters, reasons, status, note, and provenance excerpt.
- `sift_get_stats()` returns the current `StatsSnapshot`.

Intended loop:

1. A human reviews locally in Sift (web or TUI) and flags hunks with notes.
2. The agent calls `sift_list_flagged` (or uses `sift brief`) and edits the repository through its normal tools, not through Sift.
3. After the edit, the next MCP tool call refreshes the model; `sift_get_summary` reflects new hunks while untouched approvals remain in state.

Security model: MCP inputs are only ids and enums. There are no path, glob, shell, write, approve, flag, or state-mutation tools.
