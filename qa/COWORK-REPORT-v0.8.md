# Sift — Live QA & UX Audit (v0.8)

**Target:** http://127.0.0.1:4111 · **Method:** ~20 min hands-on, keyboard-first, skeptical-developer pass via a live browser session · **Date:** 2026-07-16

---

## 1. Verdict

**Fix-first.** The review *concepts* are all here and the happy paths (approve, flag, search, group-approve, checkpoint, completion) genuinely work — but a pervasive live state-sync bug means the queue's decision feedback (✓/⚑ stamps, group tallies, the flagged-review checkpoint, filter results) frequently does **not** update until you reload the page, redo is broken, decision persistence silently fails ("Retry update"), and the reviewed-line counter is not trustworthy. Those undermine the one thing a review cockpit must get right: telling you what you've decided.

---

## 2. Claim checklist (Part 2)

| # | Claim | Result | Notes |
|---|-------|:------:|-------|
| 1 | `j/k` moves hunks; `n/p` jumps unreviewed risky hunks | ✅ | Both work. `j/k` step hunks, `J/K` step files, `n` jumps to the next unreviewed attention hunk. |
| 2 | `a` approves w/ **visible stamp** + auto-advance; `x` numbered reason picker (1–4); `i` free note | ❌ | Auto-advance ✓, reason picker (1 Needs tests / 2 Security concern / 3 Doesn't match intent / 4 Unnecessary change / `i` Write a note) ✓, note ✓. **But the "visible stamp" does not render live** — the ✓ in the queue and the group tally (e.g. `HIGH-RISK LOGIC · 0/5`) stay stale after approving; the mark only appears after a page reload. The toast is the only immediate confirmation. |
| 3 | Focus contract: `z` undoes after `x`+reason (focus not stuck); `Ctrl+Z` undo; `Shift+Z` redo; new decision clears redo | ❌ | `z` immediately after `x`+reason **does** undo and focus is **not** trapped in the note field ✓. **But `Shift+Z` performs another UNDO, not redo** — redo is entirely broken (the header redo arrow ↻ also does nothing). Could not reach "new decision clears redo" because redo never works. |
| 4 | Undo restores status+note, moves selection to affected hunk w/ pulse; group-approvals undo atomically | ⚠️ | Undo moves selection back to the affected hunk ✓ and restores status ✓. Pulse not clearly observable. The model is **append-only**: every undo appends an inverse entry, and undoing an *approval* is mislabeled **"Unflagged X"** in the log. |
| 5 | Toasts name target, linger ~6 s, working inline Undo | ❌ | Toasts name the target ✓ and carry an Undo button ✓. **They do not auto-dismiss** — they pile up and stay on screen indefinitely (observed 3+ stuck toasts across many minutes), cleared only by reload. "~6 s linger" is wrong. |
| 6 | Recent-decisions log exists, survives reload, "Undo this" on older entry works, refuses stale entries | ⚠️ | Log **exists** (history ↶ icon by the progress bar) with timestamps, reasons, and per-row "Undo this" ✓. "Undo this" on an older entry works ✓. Persists across reload ✓. **"Refuses stale entries" not observed** — it always appends an inverse action; and undone approvals are mislabeled "Unflagged". |
| 7 | Flagged rows show persistent ⚑ + reason inline; `F` toggles flagged-only filter (+ combines w/ path); unflag from view works | ❌ | ⚑ + inline reason **do** exist but **only render after a reload** (live, a flagged row shows a ✓ like an approval, or nothing). **`F` does not toggle a flagged filter — `F`/`f` opens focus mode.** The flagged filter lives on the header **"Flagged (N)"** chip / palette "Show flagged only". Combines with the path filter ✓. Unflag-from-view: the action registers but the view doesn't update live (stale). |
| 8 | Checkpoint: decide all attention while ≥1 flagged → "Flagged review" before completion; 0 flags → skip to completion | ⚠️ | The **Flagged review** screen exists and is correct — lists flagged items with inline Keep/Unflag + "Continue to summary" ✓. **But it did not trigger live** when all attention hunks were decided; it only appeared **after a page reload** (same state-sync bug). Zero-flag skip path not tested. |
| 9 | Bulk "Approve group" shows preview modal; refuses on any group hiding a risky signal (inline explanation) | ⚠️ | Preview modal **works** — tested Lockfiles, Skim, Rename, Generated, Snapshots; each shows a per-hunk preview + Approve/Cancel ✓. **The "refuses on risky group" behavior could not be reproduced** — no skim group in the demo hides a risky signal, and every group previewed & approved normally. Unverified. |
| 10 | `Ctrl+F` searches code content w/ match cycling; `/` filters paths; different features | ✅ | `Ctrl+F` opens a "Search changes" bar with an `N/M` match counter and ‹ › cycling (e.g. "legacy" → 9 matches, cycles + highlights). `/` (and the path box) filters file paths. Confirmed as two distinct features (the search bar even says "use / to filter files"). |
| 11 | `R` on a hunk — believe revert is MISSING | ✅ | **Confirmed absent.** There is no revert anywhere (palette or keymap). `r`/`R` = **refresh**: it silently reconciles the stale UI (e.g. it cleared a stale flag display and re-synced the `Flagged (N)` and group counts). It never touched the hunk's code. |
| 12 | Reload persists statuses, theme, sort, filters | ⚠️ | Reviewed count, decisions, flags, theme (Graphite) and sort all persisted across reload ✓. **Caveat:** a reload is effectively *required* to reconcile state, and some approvals silently failed to persist ("Retry update" — see BUG-03). Flagged-filter persistence not explicitly confirmed. |

---

## 3. Bugs (numbered, with severity, repro, expected vs actual)

### BUG-01 · P1 · Redo is broken (`Shift+Z` undoes instead of redoing)
- **Repro:** On any hunk: `a` (approve) → `z` (undo, counter drops correctly) → `Shift+Z`.
- **Expected:** Redo re-applies the approval; counter returns to the pre-undo value.
- **Actual:** `Shift+Z` fires *another* undo ("Undid last decision"; counter drops further, e.g. 12 → 7). The header redo arrow (↻) also does nothing. Redo is entirely non-functional.

### BUG-02 · P1 · Decision feedback doesn't update live — reload required to reconcile
- **Repro:** Approve or flag several hunks and watch the queue + right rail.
- **Expected:** The affected row shows a ✓ (approved) or ⚑+reason (flagged), and the group tally (`… · X/5`) increments, immediately.
- **Actual:** Rows keep their old appearance (a flagged row even shows a ✓ identical to approved), group tallies stay stale (observed `HIGH-RISK LOGIC · 0/5` after 3 high-risk approvals), and the flagged-review checkpoint / completion don't fire — **until a page reload**, which reconciles everything correctly. This is the audit's central defect and it cascades into claims 2, 4, 7, 8.

### BUG-03 · P1 · Decision persistence silently fails ("Retry update"); reviewed counter over-counts
- **Repro:** Rapidly approve many hunks (`n`+`a`) through the whole queue.
- **Expected:** Every decision persists; the top counter and group tallies agree.
- **Actual:** The top counter raced to `1,321 / 1,321` (100%) while group tallies still read `TESTS · 0/1`, `CONFIG & CI · 0/1`, `LOW-RISK LOGIC · 0/4`, and **"Retry update." buttons** appeared in the inspector — indicating decisions failed to persist. No console error is logged (fails silently). Only after reload did the tallies reconcile.

### BUG-04 · P1/P2 · "Show flagged only" can render a completely empty screen
- **Repro:** Palette → "Show flagged only" when the live flag state is out of sync.
- **Expected:** The flagged hunks, or a clear "No flagged hunks" empty state.
- **Actual:** Entire app went blank — empty queue, "No hunk selected" in both panes, no explanatory empty state. (The header **"Flagged (N)"** chip is the reliable path and does filter correctly.)

### BUG-05 · P2 · Reviewed-line counter is non-monotonic / unreliable
- **Repro:** Approve a sequence of hunks and watch the `N / 1,321 reviewed` figure.
- **Expected:** Monotonic increase per approval; stable denominator.
- **Actual:** Observed the counter read **18, then 15 after a subsequent approval** (no undo between). The denominator/"lines changed" also drifted during the session (`1,332 → 1,321`, `2,210 → 2,199`). The number can't be trusted.

### BUG-06 · P2 · Modal stacking: `Esc` doesn't reliably close focus mode; palette stacks on top and goes dead
- **Repro:** `F` (focus mode) → `Esc` → `Ctrl+K`.
- **Expected:** `Esc` closes focus mode; palette opens cleanly.
- **Actual:** Focus mode stayed open behind the palette; the palette then ignored clicks *and* Down+Enter (couldn't select "Show flagged only") until extra `Esc` presses cleared the underlying focus-mode card.

### BUG-07 · P2 · Theme dropdown (header) doesn't apply a selection
- **Repro:** Header theme dropdown → click "Assay" (or "Paper").
- **Expected:** Theme switches.
- **Actual:** Nothing changes; label stays "Graphite". Only the palette commands ("Use Assay theme" / "Use Paper theme") actually switch themes.

### BUG-08 · P2 · Toasts never auto-dismiss
- **Repro:** Perform several decisions/undos.
- **Expected:** Toasts fade after a few seconds (claim says ~6 s).
- **Actual:** Toasts persist and stack indefinitely (many minutes), cluttering the lower-right until a reload clears them.

### BUG-09 · P2 · Undoing an approval is mislabeled "Unflagged X" in Recent decisions
- **Repro:** Approve a hunk, then "Undo this" (or `z`), open Recent decisions.
- **Expected:** "Unapproved X" (or similar).
- **Actual:** Logged as "Unflagged X" regardless of whether the original action was an approve or a flag — misleading history.

### BUG-10 · P2 · No syntax highlighting — code is monochrome in every theme
- **Detail:** In Graphite, Assay, and Paper the diff renders all tokens in one colour (no keyword/string/identifier differentiation). For a tool whose entire job is reading code, this is a real readability cost.

### BUG-11 · P3 · Keys-help modal category buttons are non-functional
- **Detail:** The `?` modal shows four buttons (Move / Decide / Skim groups / Palette). They look like tabs but do nothing when clicked.

### BUG-12 · P3 · Documented keymap is incomplete and partly wrong
- **Detail:** The `?` map omits `f`/`F` (focus mode), `Ctrl+F` (search diff text), `e` (open in editor), and the flagged-only filter. It also lists `r refresh` (correct) but the shipped docs elsewhere imply `R`=revert (there is none) and `F`=flagged filter (it's focus mode). Many palette actions have no documented key at all (Next flagged hunk, Show flagged only, Recent decisions, Open timeline, Open stats, Expand nits, Cycle sort/size, Toggle theme).

### BUG-13 · P3 · Action buttons fall below the inspector fold on info-heavy hunks
- **Detail:** On a hunk with many reasons (e.g. `src/auth/session.ts`), the REVIEW row (Approve / Flag / Undo) is pushed below the visible inspector; mouse users must scroll to reach it (keyboard is unaffected).

### BUG-14 · P3 · Coverage figure inconsistent
- **Detail:** Header reads `coverage 1%`; the completion summary reads `50% COVERAGE`. One is wrong.

### BUG-15 · P3 · Minor polish
- `r` (refresh) gives no visible feedback. · "Copy report" confirmation ("Copied report.") is delayed and easy to miss. · Timeline session shows a zero-duration timestamp (start = end). · Assay and Graphite are near-visually-identical dark themes.

---

## 4. Theme report (Part 3)

Reference hunk for all three: `src/auth/session.ts` ("Adds rotateSessionRefresh()"), captured in each theme during the session. Common to all three: **no syntax highlighting** (monochrome code) and **no live-updating decision marks** (BUG-02, BUG-10) — both theme-independent.

### Graphite (dark, default) — **fix-first**
Dark charcoal. Risk indicators are unmistakable (white-on-red `CRIT` chips, red scores, red left spine, green ✓). Code is comfortable at 13px but monochrome.
- Top 3 tweaks: (1) add real syntax highlighting; (2) strengthen the added/removed line backgrounds (currently faint); (3) raise contrast on secondary metadata (rule tags like `SEC_PATH`, "line match %").

### Assay (dark) — **fix-first**
**Nearly indistinguishable from Graphite** — same charcoal, only a marginally different accent hue on scores. Same monochrome code.
- Top 3 tweaks: (1) make it meaningfully different from Graphite or drop it — two near-duplicate dark themes is confusing; (2) syntax highlighting; (3) if it's meant to be the "higher-signal" theme, push risk accents (spines/chips) noticeably warmer/brighter.

### Paper (light) — **fix-first**
Dark-slate text on white — good primary contrast and readable. Monochrome again. Risk indicators (red chips/scores/spine, green ✓) stay clear.
- Weak spots: added vs. context line backgrounds are both a faint blue-grey — hard to tell apart; secondary metadata ("line match 77%", `SEC_PATH`, "Copy rule" outline) is low-contrast light-grey on white.
- Top 3 tweaks: (1) syntax highlighting; (2) give added lines a clearly distinct (green) tint vs. context; (3) darken secondary/metadata text and the "Copy rule" outline to meet contrast.

### Responsive (< ~1200 px)
The app ships breakpoints at **1199 / 999 / 767 px**. At ≤1199 px it tightens the 3-column grid and wraps the diff header (`flex-wrap`) to avoid overlap; at ≤999 px it hides the minimap + inspector and drops to a 2-column layout. **There is no width-based rule that switches the diff to unified** — the app already defaults to unified, so the "defaults to unified below 1200 px" expectation is moot rather than implemented. *Caveat:* I could not visually confirm the reflow — the browser viewport in this environment would not shrink below ~1700 px (verified via `window.innerWidth`); findings here are from the shipped CSS.

---

## 5. Friction log (in the order encountered)

1. Approved a hunk — got a toast but the queue row showed no stamp and `HIGH-RISK LOGIC · 0/5` didn't move. Wasn't sure the approval "took".
2. Approve buttons were below the inspector fold on the first (rich) hunk — had to hunt for them.
3. Reviewed counter went *down* (18→15) after an approve — lost trust in the number immediately.
4. `Shift+Z` to redo kept undoing more; stacked "Undid last decision" toasts and I lost track of state.
5. Header ↶/↻ arrows aren't undo/redo — ↶ opened "Recent decisions". Unlabeled icons, surprising.
6. "Undo this" in the history logged undone approvals as "Unflagged" — read as if I'd touched a flag I hadn't.
7. Flagged a hunk; the queue row showed a ✓ (like approved), not a ⚑ — couldn't tell approved from flagged.
8. `F` (expecting flagged filter) opened focus mode instead; then `Esc` didn't close it and the palette stacked on top and went unresponsive.
9. "Show flagged only" (palette) blanked the whole screen with no empty-state message.
10. Toasts never went away — the lower-right slowly filled with stale toasts.
11. Header theme dropdown did nothing; had to use the palette to change themes.
12. Finished the entire queue but no completion/checkpoint appeared; "Retry update" buttons showed up. Only a reload surfaced the Flagged-review screen and the summary.
13. "Copy report" gave no obvious confirmation at first (it arrives late).

---

## 6. Top 10 fixes (priority-ordered)

1. **Fix live state-sync** so ✓/⚑ stamps, group tallies, filters, checkpoint and completion update without a reload. (L) — root cause of most friction.
2. **Fix redo** (`Shift+Z` + header ↻) and make the undo/redo stack behave like a stack, not append-only inverses. (M)
3. **Fix silent persistence failures** ("Retry update") and surface errors instead of swallowing them; reconcile the reviewed counter so it's monotonic and matches group tallies. (M)
4. **Distinguish flagged from approved in the queue** — persistent ⚑ + inline reason, rendered live, visually distinct from ✓. (S)
5. **Add syntax highlighting** to the diff (all themes). (M)
6. **Auto-dismiss toasts** (~5–6 s) and cap/stack them sanely. (S)
7. **Repair the header theme dropdown** so selections apply (or remove it and keep the palette). (S)
8. **Reconcile the keymap & docs**: document `f`/`F` (focus), `Ctrl+F` (search), `e` (open in editor), the flagged filter; drop the phantom `R`=revert and `F`=flagged-filter claims; make the `?` modal category buttons work or remove them. (S)
9. **Fix modal stacking**: `Esc` closes the topmost overlay reliably; don't let the palette open on top of a still-open focus mode. (M)
10. **Add empty/loading states & a real "Copied" confirmation**: "No flagged hunks" for the flagged filter, and immediate Copy-report feedback; fix the 1% vs 50% coverage mismatch. (S)

---

*Note: `Copy report` output could not be verified (clipboard read blocked/timed out in this environment). Group "refuses on risky signal" (claim 9) and the < 1200 px visual reflow could not be exercised in this environment and are marked unverified above.*
