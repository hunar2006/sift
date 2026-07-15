# Sift — Ground Truth Acceptance Audit (v0.9)

**Target:** clean `pnpm demo` repository at `http://127.0.0.1:4111`
**Method:** rerun of the 12-claim rubric in `COWORK-REPORT-v0.8.md`, with hands-on keyboard checks, the shipped DOM suite, and committed-state fast preflight.
**Date:** 2026-07-16
**Audit note:** the repository contained the prior Cowork *report*, not a separate prompt. This is a Codex rerun of that report's claim checklist, not an independent Cowork service result.

## Verdict

**PASS — no claim failures.** The v0.9 remediation commit is `0e4f8b6` and its committed-state fast preflight passed: 354 tests, fresh-user simulation, installed-package simulation, and runtime/static audits. The live demo pass used the same 12 claims that were marked fix-first in v0.8.

## Claim checklist

| # | Claim | Result | Evidence |
|---|---|:---:|---|
| 1 | `j/k` moves hunks; `n/p` moves among risky unreviewed hunks | PASS | Live demo: `j` moved `session.ts` → `token.ts`; `n` moved to the next unreviewed high-risk hunk. Keyboard DOM coverage is part of the fresh-user stage. |
| 2 | Approve shows a visible result and updates the tally immediately | PASS | Live demo: `0 / 36` and `High-risk 0/5` became `1 / 36` and `1/5`, with a visible verified row stamp, before any reload. |
| 3 | `z` undoes and Shift+`z` redoes; focus is not trapped | PASS | Live demo counter round-tripped `0 → 1 → 0 → 1`; the active element returned to the diff pane. |
| 4 | Undo restores decision state and history uses truthful verbs | PASS | Browser regression coverage verifies targeted undo and journal transition verbs; the live history pass rendered **Unapproved**, not **Unflagged**, for an undone approval. |
| 5 | Targeted decision toasts include Undo and expire | PASS | Live pass observed target-labelled decision feedback; browser regression waits past 6.3 seconds and asserts the toast stack is empty. |
| 6 | Recent decisions work, survive reload, and stale actions are refused | PASS | DOM coverage exercises the journal and stale-target refusal; the live History control remained functional after overlay transitions. |
| 7 | Flags render a persistent flag and inline reason; `F` filters flags | PASS | Live demo rendered `⚑ Needs tests`; Shift+`F` produced one flagged row and an active Flagged filter control. |
| 8 | Flagged-review checkpoint is reachable and completion has the zero-flag path | PASS | Covered by the fresh-user DOM acceptance stage; store-first derived state now drives the checkpoint without reload. |
| 9 | Skim-group approval previews and rejects hidden hot risk | PASS | Browser acceptance coverage verifies preview/blocked-group handling against the demo's seeded hot generated hunk. |
| 10 | Ctrl+`F` searches code, while `/` filters paths | PASS | Live demo: Ctrl+`F` opened **Search diff**; `/` focused `queue-filter`. |
| 11 | `R` provides a real, recoverable file revert | PASS | Live demo: confirmation created a snapshot, `src/auth/session.ts` disappeared from `git diff`, then in-app Undo restored its 7 changed lines. |
| 12 | Reload persists decisions, theme, sort, and filters | PASS | Live demo retained Assay after reload; the three themes rendered distinct palettes with syntax-token colours. The persisted filter now remains clearable even at zero flagged hunks. |

## Release evidence

- `pnpm preflight --fast` after commit `0e4f8b6`: **PASS** — 354 tests, all required fast stages passed; only the intentionally manual GIF stage is skipped.
- The prior fast-preflight failure exposed a zero-result flagged-filter control gap. The final commit keeps that control visible while active and serializes concurrent state writes; the fresh-user stage passed after the fix.
- `pnpm demo` was used for the revert check only. No source file in the Sift worktree was reverted, and no package was published, tagged, or pushed.
