# Sift MCP

`sift mcp [range] [--staged] [--coverage <path>]` runs Sift once, then serves a stdio MCP server with read-only tools. It does not start HTTP, mutate review state, accept filesystem paths as tool input, or run repository code.

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

1. A human reviews locally in Sift and flags hunks with notes.
2. An agent is asked to fix everything flagged in Sift.
3. The agent reads flags and notes through MCP tools.
4. The agent edits the repository through its normal tools, not through Sift.

Security model: MCP inputs are only ids and enums. There are no path, glob, shell, write, approve, flag, or state-mutation tools.
