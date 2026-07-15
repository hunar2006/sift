# Troubleshooting

## Undoing a confirmed file revert

Press `Z` immediately after a confirmed revert to restore the snapshot. Sift refuses restoration with `file changed since` when another edit has changed the reverted-to bytes; resolve that edit first rather than overwriting it. Snapshots are Git objects and may be pruned by normal object-store garbage collection after roughly two weeks, so restore important work promptly.

Start with the shortest fix below. Sift stays local; retry after the change.

## “Not a git repository”

Run Sift from a checkout, or change into one first:

```powershell
Set-Location C:\path\to\repo
sift
```

## There is nothing to review

Create, edit, or stage a change, then run `sift` again. Use `sift --staged` when the change is in Git's index.

## `sift pr` says that `gh` is required

Install GitHub CLI, authenticate it, and retry:

```powershell
gh auth login
sift pr 123
```

## The requested port is busy

Sift automatically uses the next available loopback port and prints it. To choose a new starting point yourself, run `sift --port 4200`.

## Review state was corrupt

Sift backs up a corrupt `.sift/state.json` and starts with an empty review state. Inspect the timestamped backup in `.sift/`, then restore only the decisions you trust.

`seen.json` is disposable freshness metadata: delete `.sift/seen.json` if it is malformed; Sift silently recreates it.

## A rules or config file is invalid

Run this to see the file and field that need attention:

```powershell
sift rules lint
```

For `.sift/config.json`, fix the JSON or remove the file; Sift continues using safe defaults.

## Coverage is missing or unreadable

Point Sift at a valid LCOV or Cobertura artifact:

```powershell
sift --coverage coverage/lcov.info
```

Regenerate the artifact if Sift reports that it could not parse it.

## Watch mode rejects a range or PR

Watch follows the working tree only. Run `sift --watch` (or `sift --staged --watch`) and re-run a range review after changes when you need a fixed baseline.

## No editor was found

Install `code` or `cursor`, or add an explicit editor to `.sift/config.json`:

```json
{ "editor": "code" }
```

Templates use whole arguments only, for example `{ "editor": "subl %f:%l" }`; Sift never uses a shell to launch an editor.

## `--ai` reports a missing key

Set one provider key in the current shell, then re-run with `--ai`:

```powershell
$env:ANTHROPIC_API_KEY = "..."
# or
$env:OPENAI_API_KEY = "..."
```

## Windows hooks or PATH issues

`sift hooks install` edits `%USERPROFILE%\.claude\settings.json` unless you pass `--project`. If `sift`, `code`, or `cursor` is not found, restart PowerShell after updating PATH and run `Get-Command sift`, `Get-Command code`, or `Get-Command cursor` to confirm it is visible.

## TUI looks cramped or garbled

`sift tui` targets ≥100×28 columns/rows and degrades to 80×24 with truncation. Enlarge the window, or in Windows Terminal enable UTF-8 (`chcp 65001`) and a monospace font. If Ink fails to start, rebuild (`pnpm build`) so `ink`/`react` resolve from the CLI package.

## Web or grammar assets cannot be found

Rebuild the local package assets, then run Sift again:

```powershell
pnpm build
node packages/cli/dist/index.js
```

For an installed tarball, use `pnpm pack-check` to verify that the packaged web and grammar assets resolve without the workspace.
