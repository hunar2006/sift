# Issues to file

These are deliberately deferred ideas, not release blockers. Copy one into GitHub when it becomes useful.

## Optional regex search

**Label:** `enhancement`

Add an explicit opt-in regular-expression mode to diff search. Keep literal search as the safe default, surface invalid-pattern errors in the UI, and preserve current keyboard behavior.

## Diff-wide TUI search

**Label:** `enhancement`

Add an opt-in search mode that scans the complete diff in the terminal cockpit. It must remain responsive on large reviews and must not replace the current hunk-focused navigation.
