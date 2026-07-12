# Decisions

## 2026-07-09

- Chose a hand-rolled unified diff parser instead of `parse-diff` so Sift can meet the exact parser edge cases in the v0.1 spec without adapting a third-party model.
- Kept `@tailwindcss/vite` out of the dependency graph and used Tailwind v4 through CSS-compatible utility classes plus hand-authored CSS. This keeps the build dependency list closer to the allowlist while preserving the intended UI style.
- Used OpenAI `gpt-4.1-mini` as the optional OpenAI annotation default. It is only reached when `--ai=openai` or `--ai` resolves to OpenAI and `OPENAI_API_KEY` is present.
- Treat lockfile-only hunks with no hot signals as the `Lockfiles` skim group even though the `deps` base score is 15. The grouping spec expects bulk-approvable lockfiles, while the base-score table would otherwise make every dependency hunk at least `low`.

## 2026-07-10

- Pinned `web-tree-sitter` to 0.20.8 for the real structural parser. The existing 0.26.10 runtime failed while loading `tree-sitter-wasms` 0.1.13 grammars in `getDylinkMetadata`/`loadWebAssemblyModule`; those grammars were built with tree-sitter CLI 0.20.8. The matching 0.20.8 runtime successfully loaded and parsed TypeScript, TSX, JavaScript, Python, and Go fixtures. This is a compatibility fix, not a tree-sitter cut attempt.
- Kept the public `analyzeDiff` path synchronous. The async CLI pipeline initializes tree-sitter and loads bounded NEW-side file sources first, then passes an optional source map into core; direct core callers continue to receive deterministic tokenizer fallback unless they explicitly initialize the runtime and provide sources.
- `astCoverage` is the fraction of supported, non-guarded changed files that parsed successfully with tree-sitter. Generated, binary, dependency, over-512-KB, and over-20k-line files are excluded from the denominator; supported files with unavailable sources or parse failures remain in the denominator and silently use the tokenizer.
- NEW-side sources come from the worktree for `WORKTREE`, the index for `STAGED`, and the right-hand revision for local ranges. PR patch analysis cannot reliably access full NEW-side files from the existing ingest contract, so it degrades per file to the tokenizer without adding another network call.

- v0.2 baseline was green before upgrade work: `pnpm i`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all passed. Core coverage was 80.8% lines.
- Upgrade plan follows the v0.2 phase order: carry-over highlighting/fixtures, signal engine v2, rules, coverage, structural layer, ordering, AI/provenance, MCP/print/demo publish-readiness, cockpit overhaul, demo v2/docs/smoke.
- Cut-line protocol is active. If needed, cuts will happen only in the specified order: ink TUI stretch, reading-order sort mode, cross-file rename-pattern groups, minimap, Cobertura support.
- Shiki highlighting is lazy-loaded from the web client and allowed to fall back to escaped plain text per hunk. The build currently emits grammar/theme chunks through Vite; this keeps first paint non-blocking and can be tightened during publish-readiness if package size becomes a problem.
- `SECRET_ENTROPY` uses observed Shannon entropy with the specified 4.2 bits/char threshold. Pure hex SHA-like strings are covered by near-miss tests and do not fire because their maximum observed entropy is 4 bits/char.
- The built-in typosquat comparison set is a hardcoded plausible npm/PyPI list in core; no package registry or network lookup is performed.
- The rules engine uses the allowed `yaml` dependency in core and Sift's own small glob matcher (`*`, `**`, exact) rather than adding a glob package.
- Rules are loaded inside the CLI pipeline and applied before the second classification pass, so user suppressions and custom hot signals can affect mechanical demotion deterministically.
- Coverage ingest uses hand-rolled LCOV parsing and the allowed `fast-xml-parser` dependency for Cobertura. It only reads artifact text and changed-file mtimes; it never invokes tests or repo scripts.
- Coverage discovery honors `--coverage`, then `.sift/config.json`, then the specified autodetect paths. Invalid `.sift/config.json` is reported as a warning and ignored so analysis remains fail-open.
- Added the allowed `web-tree-sitter` and `tree-sitter-wasms` dependencies for the structural layer. The current core pass uses deterministic token-stream fallback when parser/grammar assets are unavailable; CLI package wasm asset copying remains part of publish-readiness.
- Cross-file rename-pattern groups are synthesized only when one identifier mapping appears in at least three files and five sites, and only for hunks without signals weighted 15 or higher.
- Reading-order ranks are annotations only; the persisted review model still defaults to v0.1 risk ordering, while the web client applies the user's persisted sort mode locally.
- Reading-order ties, cycles, and hunks without definition/reference edges fall back to risk ordering so ambiguous structural data never hides higher-risk work.
- AI provider resolution treats bare `--ai` as `cross`: use the opposite provider when provenance reveals a dominant generator family and that key exists, otherwise use configured keys with an informational line.
- AI v2 keeps `aiSummary` and `aiConcern` as compatibility accessors, but new annotations are stored per provider in `aiAnnotations[]` with optional drift text.
- Provenance matching now lives in core behind a `ProvenanceProvider` interface. Claude Code is the first provider; generic JSONL records from other tools are matched after Claude so canonical hook/transcript matches win ties.
- The open provenance file remains `~/.sift/provenance.jsonl`; generic ingestion skips `source=claude-code` records so the legacy Claude hook path and third-party records can share one file without duplicate matches.
- The MCP server is stdio-only and read-only. It uses a separate no-write state reader instead of the normal state helper because the normal helper may back up corrupt files.
- MCP tool inputs are restricted to ids and enums; no path, glob, shell, HTTP, or review-state mutation tools are exposed.
- `sift print` is implemented as a CLI-local renderer over the same pipeline/state/stats path as reports. JSON output exposes compact triage data rather than the full review model so terminal automation has a stable small shape.
- The demo repository generator now lives in core and only invokes `git`; both `pnpm demo` and `sift demo` reuse it, with demo provenance isolated through demo-specific `SIFT_HOME` and `SIFT_CLAUDE_DIR` values.
- CLI publish-readiness uses `tsup` for the CLI bundle with `@sift-review/*` packages bundled into `dist/index.js`. The CLI build copies the web dist into `dist/web` and selected `tree-sitter-wasms` grammars into `dist/grammars`; runtime resolution prefers those package-local assets and falls back to the monorepo web dist for development.
- Internal workspace packages are dev-only semver dependencies in the CLI package, and `pnpm-workspace.yaml` links matching workspace versions. This keeps the packed manifest free of `workspace:` ranges while preserving local development resolution.
- The cockpit command palette is implemented in-house in the React shell with token/fuzzy matching and no new dependency; actions call the same store/API paths as keyboard shortcuts.
- Theme and split preferences persist in localStorage, while the first-run help overlay is a one-time localStorage flag. If storage is unavailable, Sift falls back to dark theme, unified diff on narrow viewports, and no persisted preference.
- The web minimap is a hunk-level rail over the visible queue. It selects hunks directly and hides below 1000px width; the deeper virtualized multi-hunk scroll map remains unnecessary for the current one-hunk viewer architecture.
- Demo v2 intentionally includes deterministic trigger snippets for every new signal family, a repo rules file that both fires and suppresses a built-in reason, fresh LCOV evidence for covered and untested hunks, a rename-pattern fixture, and definition/reference hunks with reading ranks.
- The final smoke script now asserts the demo model, `sift print --json`, `sift rules lint`, `sift mcp` via the SDK stdio client, and CLI package assets. This keeps publish-readiness checks on the installed-user path without publishing.

## 2026-07-10 — v0.3 Clarity & Craft

- The v0.3 baseline is green before implementation: `pnpm i`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke` all passed. The suite has 72 tests across 15 files, core line coverage is 88.65%, and smoke reports 34 hunks in 11 groups.
- The implementation follows the specification's phase order: real tree-sitter, deterministic digests, intent surfacing, labeled AI summaries and Review Brief, decision UX, Assay Office visual system, craft pass, demo/smoke, then documentation and final audit.
- The v0.3 cut-line protocol is active in this order: Review Brief, completion-screen flourishes while retaining basic stats, then tree-sitter only after three materially different documented integration attempts. No cut has been made.
- The digest engine runs in core after grouping and before ordering, so it can read group membership (rename-pattern ordinals, group digests) while ordering still operates on the fully-formed `Hunk`. The classify/group/structure pipeline now flows `UndigestedHunk` (`Omit<Hunk, "digest">`) and `attachDigests` produces the final `Hunk`; `digest` is a required field so every persisted and served hunk carries one.
- Digest determinism: symbol lists in headlines and detail phrases are ASCII-sorted and de-duplicated rather than kept in source order, so the same model always yields the same digest regardless of diff line ordering. New-file symbol headlines therefore read in sorted order (e.g. `refresh`, `signIn`) rather than declaration order.
- The forbidden-verdict guardrail lives in `digest.ts` (`FORBIDDEN_VERDICT_PATTERNS`) and is enforced three ways: a unit test scans every headline template and every signal phrase, and the smoke script scans the live demo model's digests. The forbidden strings are exactly the three from the spec — `looks good`, `safe to approve`, and `lgtm`. We deliberately did NOT add `ready to approve` to the scanned set, because §4.1 mandates the annotation prompt text "Never state or imply that a change is safe, correct, or ready to approve"; scanning for `ready to approve` would flag Sift's own guardrail instruction. The mandated prompt contains no forbidden substring (`safe to approve` never appears — the words are separated by `, correct, or`), so the prompt-contract scan passes cleanly.
- AI Review Brief (§4.2): the primary provider from `resolveAiProviders` produces one whole-diff brief; provider callers were refactored into a shared `callProvider(provider, system, user)` so `annotateWithAi` and `generateBrief` share transport. The brief cache key is `sha256(diffSpec + " " + headSha + " " + provider + " " + model)` stored at `.sift/ai-cache/<key>.json`; cache read/write are best-effort and never fail analysis. `--no-ai-cache` sets `useCache: false` to bypass the read while still writing a fresh entry. The brief is served at `GET /api/brief` (404 when absent) and never persists review state.

## 2026-07-10 — v0.3 craft-pass self-critique (Phase 7)

This craft pass was performed **without a browser** this session (the app was not rendered live), so it is a code-and-CSS read against the §6.5 checklist rather than a visual pass. Findings and actions:

- **Designed-for-Sift vs generic dark dashboard.** The Assay Office palette (graphite `--ink-*`, warm risk hues reserved for risk, a single cool `--verdict` teal for approval) and the sieve logomark move it away from the rejected near-black + acid-green default. The queue was still a generic one-line risk list, which read as dashboard-y — **fixed**: rebuilt it as two-line "ledger" rows (mono file path + band/risk on line one, digest headline in `--text-lo` on line two) with a 2px band-colored risk spine, per the §6.4 redline.
- **Is the stamp the single memorable moment?** Yes — it is the only element with an entrance animation (140ms settle, −6° tilt); every other transition is opacity/transform only. Kept it as the one orchestrated moment.
- **Is risk color ever decorative?** Audited: risk hues appear only on band chips, the risk spine, the `--high` Flag affordances, and the `FLAGGED` stamp — all risk-carrying. `--verdict` teal is reserved for approval/progress/the logomark. No risk color is used as ornament.
- **Do both themes hold AA?** Enforced by `contrast.test.ts` (28 checks): body text ≥ 4.5:1 and large/accent text ≥ 3:1 for token pairs in both themes. Light accent hues were darkened (`--verdict #12897a`, `--critical #c0353a`, etc.) to clear the bar.
- **Anything decorative to cut?** Cut nothing further; the interface is already lean. 
- **Known remaining redline gaps (documented, not yet applied blind):** the header is not yet the full segmented-progress "HUD" (still a text progress figure + buttons); the inspector keeps a `Category` section not in the §6.4 order and renders coverage in the scoreline rather than as its own ordered block; the first-load staggered pane fade is not implemented. These are visual-polish items best finished with a live render and are logged here so they are not lost.

## 2026-07-10 - v0.4 Live & Launch-Ready

- The v0.4 baseline is green before implementation: `pnpm i`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke` all passed. The suite has 176 tests across 23 files, core line coverage is 88.63%, and smoke reports 35 hunks in 11 groups.
- The v0.4 work follows the specified order: Windows audit and CI, watch/SSE, live UI, brief and seen-sidecar state, editor jump, the three deferred visual items, render evidence, performance, resilience, packaging, then final docs/audit.
- The v0.4 cut-line protocol is active in this order: demo GIF/video, New filter, editor jump, and perf CI gate. No cut has been made.
- The Windows audit uses Git's NUL-delimited `ls-files` and `check-attr` output with `core.quotepath=false`, rather than newline/colon parsing. This preserves spaces, Unicode, and Windows-normalized paths without relying on command-line quoting conventions.
- Watch mode is intentionally limited to the default working-tree and `--staged` review. Ref/range and PR reviews remain finite snapshots; rejecting those combinations avoids silently changing the meaning of a user-selected baseline. Chokidar ignores `node_modules`, `.git`, `.sift`, and simple top-level `.gitignore` entries, but explicitly watches `.git/index` and `.git/HEAD`.
- The local server state is mutable only inside the running process. A successful watch pass replaces it atomically and broadcasts one SSE `model-updated` payload with sorted added/removed hunk IDs, totals, and `generatedAt`; a failed pass emits one warning and preserves the last successful model.
- Freshness is client-side interaction state: SSE-added IDs remain fresh until the reviewer explicitly opens the hunk or decides it. When the active hunk disappears in a live update, the queue selects the next surviving hunk in the prior order, then the prior surviving hunk, before falling back to the first item. The live HUD dot is controlled by explicit server metadata, not merely an open SSE connection, because the endpoint deliberately exists in snapshot mode too.
- `.sift/seen.json` is deliberately disposable, unlike review state. It is a direct `hunk id -> ISO timestamp` map, atomically replaced after fsync, and retains its newest 5,000 entries. Corrupt content is treated as an empty map and is silently recreated by the next non-empty model.
- `sift brief` defaults to flagged hunks; `--unreviewed-high` selects unreviewed hunks at risk 70 or above (the model's visual critical band is represented by that same threshold). It uses deterministic hunk lines rather than running any command, caps every patch independently at 120 lines, and filters generated digest/reason text against the existing verdict guardrail. Reviewer notes remain verbatim by design.
- Editor jump accepts known `code`/`cursor` IDs or an explicit whitespace-tokenized template in `.sift/config.json`; template binaries with shell metacharacters are rejected and templates must supply both `%f` and `%l`. Sift resolves the target from the server-side model and calls `execFile(bin, args)` only—never a shell and never a command from the reviewed repository.
- The HUD uses ten fixed segments rather than a continuously animated meter so its verdict-teal fill reads as review progress without becoming an attention-grabbing dashboard element. The one-time pane fade is guarded by `sessionStorage` and an in-memory ref, so a live model replacement cannot retrigger it. Inspector category detail was removed from the reading flow to satisfy the specified evidence order.

## 2026-07-10 - v0.4 craft-pass v2 (rendered pixels)

- **Evidence:** `pnpm shots` built a fresh demo and captured the required 1440×900 dark workbench, light workbench, focus, completion, and timeline states. Each capture is committed under `docs/screenshots/`; the `shots` CI job is intentionally non-blocking and uploads regenerated evidence.
- **HUD balance:** the segmented strip stays quiet at 0% and the mono reviewed/changed/attention counts remain readable without overpowering the file queue. The light capture confirms the thin segment borders and verdict-teal accent retain clear contrast. No change required.
- **Risk spines and chips:** the 2px left spine remains scannable through the dense queue; critical/medium chips retain their semantic contrast in both themes. No risk color is used decoratively.
- **Stamp legibility:** a live focus-mode approval was rendered over code. The `VERIFIED` stamp remains high-contrast and readable over the dark diff while preserving its single-moment emphasis. No change required.
- **Inspector and focus:** digest, intent, reasons, coverage, provenance, AI, and note now follow the prescribed reading order in the inspector; the focus card remains readable over the dimmed workbench. The timeline capture is intentionally sparse when the demo's matching timeline has no extra sessions.
- **Cut:** the optional 15-second GIF/video stretch is cut for this release. The required still captures and reproducible `pnpm shots` path remain; no other v0.4 cut-line item has been cut.

## 2026-07-10 - v0.4 performance harness

- The fixture intentionally uses 400 files and a roughly 25,000-line working-tree diff: 60% TypeScript/Python/Go logic paths, tests, migrations, generated output, lockfile-like data, docs/config, one file rename, and a ten-file `formatDate -> renderDate` cross-file rename pattern. It runs the real ingest-to-model pipeline three times with AI disabled.
- The performance gate is a 5,000 ms median locally, scaled only through `PERF_MULT` (Ubuntu CI uses `2`). JSON serialization is separately capped at 1,500 ms. The local initial result was min 894.7 ms, median 902.5 ms, with a 2,295,459-byte review payload serialized in at most 7.7 ms; no optimization was warranted.

## 2026-07-10 - v0.4 error and recovery audit

- User-facing failure paths use one direct sentence plus an actionable recovery: Git root, `gh`, coverage, watch scope, editor discovery, AI keys, demo write access, and port fallback are all explicit. Raw stacks remain gated behind `SIFT_DEBUG=1` at the CLI boundary.
- Review state is protected by a timestamped backup on corruption. Freshness sidecar corruption remains silent by design because the file is disposable; the troubleshooting guide distinguishes the two rather than overstating its importance.

## 2026-07-10 - v0.4 package installation proof

- The CLI package remains private. Naming remains centralized through the existing product/binary constants plus `package.json`, so an eventual npm name decision remains localized.
- `pack-check` builds first, then uses `npm pack --pack-destination` and a clean temporary `npm install --ignore-scripts`. It asserts every runtime web/grammar asset, runs the installed bin rather than the workspace bin, and performs its terminal review inside a freshly generated demo repository.

## 2026-07-10 - v0.4 closing documentation

- The README presents the verified dark workbench first, keeps the complete five-capture gallery, and documents the actual fix loop rather than promising agent autonomy. Windows guidance names the Claude settings path and keeps PowerShell commands copyable.
- Final deviations: the optional GIF/video stretch was cut and documented. No functional cut-line item was removed: watch/SSE, Windows CI, deferred visual work, still screenshots, performance harness, and pack-install proof all remain.

## 2026-07-11 - v0.4.1 Finish (visual refinement)

- Scope is UI-only: `packages/web/**`, tokens, fonts, assay Shiki themes, `scripts/shots.ts`, screenshots, README images, CHANGELOG, DECISIONS. No keymap/API/CLI/core behavior changes. Labels already existed on `RiskReason`; UI now prefers `label` over `code`.
- Fonts: removed `@fontsource-variable/instrument-sans` and `@fontsource-variable/jetbrains-mono`; added `@fontsource-variable/bricolage-grotesque` (variable wght available) and `@fontsource/ibm-plex-mono` weights 400/500/600. Network-font audit of built CSS shows only `/assets/*.woff2` local urls — no Google Fonts / CDN requests.
- Motion stayed CSS-only (stamp, pane stagger, palette scale-fade, progress width, hover 120ms); `motion` package not added.

### Craft pass v3 — shot-inspect-fix loops

**Loop 1** (`pnpm shots` → inspect workbench-dark/light, queue, inspector, timeline, focus, completion):

- Red rarity: queue pills gone; only `CRIT` tags + score/spine + one hunk chip + lockup. Stray full-height red divider removed (was `.diff.critical` inset box-shadow). Still felt loud on the selected-row spine alone — acceptable per spine spec.
- Generic dashboard risk: HUD lockup + continuous bar + ghost header actions read more product-specific than the old segment soup.
- Typography hierarchy: Bricolage titles vs Plex scores/meta working; reason rows show label primary / `CODE · +w` suffix.
- Diff vs chrome: add wash at ~7% + 2px gutter; assay theme keywords `#96A6CE` (verified via Shiki) — no risk/verdict hue collision.
- Timeline empty was blank (sessions `null` after load race) — **fixed** empty state for `!sessions || length===0`; shots now wait for `.timeline-empty`.
- Both themes AA: contrast test updated (body 4.5:1, large/chip pairs 3:1) — 46 checks green.

**Loop 2** (reshoot after timeline + highlight wait + light `data-theme` wait):

- Timeline empty state present (sieve at 30%, copy, `sift hooks install`, Learn how).
- Syntax paint confirmed in captures (cool slate keywords, olive strings, restrained green wash).
- Light theme pixel-sampled (`#f4f6f9` / white panels) — description noise earlier was wrong; theme toggle works.
- Red still rare; chrome quieter than diff; reduced-motion rules cover stamp/stagger/palette/live-dot/progress.
- Checklist: D1–D8 each visible in committed screenshots; no network fonts; suite green with updated contrast test.

## 2026-07-11 - v0.5 Proven (baseline + plan)

- Baseline gate green before upgrade: `pnpm i`, `lint`, `typecheck`, `test` (212), `build`, `smoke`, `perf` (median 866 ms), `pack-check`. Core line coverage 88.89%.
- Demo GIF/mp4/webm is **absent** from `docs/` (v0.4 stretch was cut). Producing it per v0.4 §6.4 joins this release's Phase 8 (cut-line 2 if blocked).
- Build order (commit per phase): 0 baseline/plan · 1 decision-core + web rewire + shots · 2 eval corpus+invariants · 3 fuzzer+fixes · 4 eval report+spot-check · 5 TUI · 6 live MCP · 7 lock.json+CI · 8 GIF+landing · 9 init+RELEASING · 10 docs/audit.
- Cut-line protocol active: (1) landing page, (2) demo GIF, (3) `sift init`, (4) TUI quick-flag+undo (keep a/x/u), (5) eval corpus may shrink to 3×20. Must not cut: eval invariants+fuzzer core, live MCP, decision-core, TUI core loop.
- Tuning boundary: risk weights/bands frozen unless an invariant/spec contradiction; each such fix cites the clause in DECISIONS.
- Corpus choices (Phase 2): pin `zod`, `express`, `flask`, `httpx`, `chi`, `fastify` (or nearest permissively licensed SHAs) in `packages/eval/corpus.lock.json`; clones in `.evalcache/` (gitignored).

## 2026-07-11 - v0.5 Phase 1: decision-core

- Extracted framework-agnostic review session into `packages/core/src/session/` (queue/sort, selection/navigation, undo, fresh lifecycle, `ReviewSession` event store). Zero DOM/React/Ink.
- Web zustand store is a thin adapter over `ReviewSession` via the browser-safe `@sift-review/core/session` subpath export (avoids pulling Node `git`/`fs` into Vite).
- Flag-reason constants live in `flag-reasons.ts` (shared by config + session) so the session graph stays Node-free.
- Migrated undo + session tests into core; web store/keyboard tests still pass as adapter coverage. Screenshots re-shot for pixel parity check.

## 2026-07-11 - v0.5 Phase 2: eval harness

- Added private `@sift-review/eval` with `corpus.lock.json` pinning zod / express / flask / httpx / chi / fastify at exact SHAs (MIT/BSD), clones in `.evalcache/`.
- Runner analyzes each of the most recent 40 non-merge commits as `C^..C` via core `ingestDiff` + tree-sitter sources + `analyzeDiff` (provenance/AI/coverage off). Never builds or executes corpus code — git + parse only.
- Hard invariants: no-crash, completeness, independent mechanical honesty (whitespace / token-format / import-reorder / rename groups — not via classifier), determinism double-run, score/line bounds, per-repo state-safety sample (25), perf budget × `PERF_MULT`.
- First full run: 6×40, **1442 hunks, 0 violations** (~4 min wall with warm cache, PERF_MULT=2). Env knobs: `EVAL_REPOS`, `EVAL_COMMITS`, `PERF_MULT`; repro via `pnpm eval --repo X --sha Y`.
- Root scripts: `pnpm eval`. Report gitignored at `packages/eval/report/`; committed summary deferred to Phase 4 (`docs/EVAL.md`).

## 2026-07-11 - v0.5 Phase 3: fuzzer

- Added `packages/eval/src/fuzz.ts` (fast-check, allowlisted). Parser: mutate fixture patches (truncate, corrupt `@@`, binary, invalid UTF-8, huge lines, duplicate hunks, CRLF, path quoting). Pipeline: synthetic + mutated diffs; never throws; digests present; determinism holds.
- Volumes: local 10_000 / 1_000; CI via `CI=true` → 1_500 / 200; seed `FUZZ_SEED` default `0x5f17`.
- First full local run: **zero failures**. No regression fixtures yet beyond the README placeholder in `fuzz-regressions/`.
- Root script: `pnpm fuzz`. No scoring/weight changes.

## 2026-07-11 - v0.5 Phase 4: eval summary + spot-check

- Committed trimmed summary at `docs/EVAL.md` from the green 6×40 run (1442 hunks, 0 violations).
- Human spot-check (mechanical sample + all 3 high-band hunks — corpus only produced 3 high):
  - **Mechanical correct:** rename-only zod docs; ast-format-only silver.tsx brace wrap; most COMMENT_ONLY doc/comment edits in express/zod/chi/fastify.
  - **Mechanical wrong → fixed:** chi `//go:build` / `// +build` constraint edits classified COMMENT_ONLY. Build directives change compile behavior; treating them as comments contradicts the COMMENT_ONLY mechanical rule. Fix: `isBuildOrCompilerDirective` exclusion in `categories.ts`. Fixture: `fixtures/diffs/go-build-tags.patch` + `fuzz-regressions/go-build-tags-not-comment-only.patch`. **Tuning-boundary citation:** mechanical COMMENT_ONLY must describe documentation/comment text only — compiler directives are not comments for this rule.
  - **Mechanical debatable:** express JSDoc edits that change documented return values (`undefined`→`false`) — still comment text, but behaviorally meaningful docs; left as COMMENT_ONLY (spec-aligned).
  - **High correct:** flask session API removal (logic/high); httpx SSLContext test migration with `verify=False` (tests/high).
  - **High debatable:** zod `package.json` dep bumps scored high via config path + signals — noisy vs real risk, but not an invariant bug; recommendation only (no weight change).
- Re-ran focused fixture test green. Weights in `score.ts`/`signals.ts` untouched aside from the COMMENT_ONLY predicate fix (no weight table edits).

## 2026-07-11 - v0.5 Phase 5: TUI

- Added `sift tui` Ink app in `packages/cli/src/tui.tsx` over shared `ReviewSession`, same pipeline/`state.json` as web.
- Runtime deps: `ink@7` + `react@19` (Ink 7 peer); `ink-testing-library` + `@types/react` as CLI devDeps. Logged as allowlist peers, not new analysis deps.
- Keys: j/k/g/G/n/p/a/x(+quick reasons)/u/z/A/space/o/?/q; `--watch` reuses `startLiveWatcher`; `--print-frame` for CI.
- Smoke asserts `tui --print-frame`. README + TROUBLESHOOTING updated.

## 2026-07-11 - v0.5 Phase 6: live MCP

- MCP tools now freshness-aware: fingerprint = `HEAD` + porcelain `-z` + `state.json`/`seen.json` mtimes; state re-read every call; pipeline refresh serialized with in-flight coalesce.
- Integration test covers mid-session file+flag visibility and concurrent call coalescing.
- `docs/MCP.md` updated for the live loop.

## 2026-07-11 - v0.5 Phase 7: lock + CI eval

- `.sift/lock.json` `{pid,surface,startedAt}` on web and TUI start; warn if another live pid holds the lock; release on exit; stale locks tolerated.
- CI job `eval` (ubuntu, blocking): restore `.evalcache` from actions/cache keyed on `corpus.lock.json`, `pnpm eval` with PERF_MULT=2, `pnpm fuzz` CI subset. Expected ~4–8 min warm.
- TUI `--print-frame` already in smoke (Phase 5).

## 2026-07-11 - v0.5 Phase 8–9: stage prep

- **Cut (cut-line 2): demo GIF/mp4** — still absent. Playwright scripted video + ffmpeg encode deferred; README continues to lead with the workbench screenshot. Revisit before public launch (`RELEASING.md` §4).
- Landing page shipped under `site/` (static HTML/CSS, Assay tokens, local woff2, workbench shot). `.github/workflows/pages.yml` present but inert until the repo is public (commented in-file).
- `sift init` writes commented `.sift/config.json` + `.sift/rules.yml` if absent; idempotent; prints 5-line quickstart.
- `RELEASING.md` mechanical launch runbook (npm rename, pack-check, publish, tag, Pages, post-publish smoke).

## 2026-07-11 - v0.5 Phase 10: final audit

- Full gate green: lint · typecheck · test (231) · build · smoke · perf (median ~925 ms) · pack-check. Core line coverage **88.93%** (≥80%).
- Scoring audit vs v0.4.1 (`55b9ed2`): `score.ts` and `signals.ts` **unchanged**. Only `categories.ts` gained `isBuildOrCompilerDirective` (COMMENT_ONLY predicate fix; no weight/band edits).
- Eval package spawn audit: only `git` via `execFile` in `corpus.ts` — no install/build/execute of corpus trees.
- Cuts logged: demo GIF/mp4 (cut-line 2). Not cut: eval invariants+fuzzer, live MCP, decision-core, TUI core loop, landing, init, RELEASING.
- Closing headline: **6×40 corpus, 1442 hunks, 0 invariant violations**; fuzz empty at full volume; one mechanical misclassification fixed (Go build tags).

### New-user commands

```bash
pnpm i && pnpm build
pnpm sift                 # web cockpit
pnpm sift -- tui          # terminal cockpit
pnpm sift -- --watch      # live web
pnpm sift -- init         # starter config/rules
```

## 2026-07-12 — v0.5.1 Ship Prep

- npm name is `siftdiff` (confirmed available per the spec); the binary/command stays `sift` and the brand constant `PRODUCT_NAME` stays "Sift". Only `packages/cli` is published; `@sift-review/*` remain private and bundled by tsup `noExternal`.
- Version reconciliation: `packages/cli/package.json` version is `0.5.0` and `SIFT_VERSION` was bumped `0.1.0 → 0.5.0` so `sift --version` matches the published artifact (test fixtures hardcode their own `siftVersion` strings, so nothing broke). The ship-prep meta-changes are logged under a CHANGELOG `[0.5.1]` heading even though the published package is `0.5.0`, because this pass changes packaging only and rides on the 0.5.0 tarball; the next runtime change would be the real 0.5.1.
- `prepack` runs a single node script (`packages/cli/scripts/prepack.mjs`) that builds the bundle and stages `LICENSE` + `README.md`. It routes the child build's stdout to stderr so `scripts/pack-check.ts`, which parses `npm pack --json` stdout, sees clean JSON. README relative image embeds are rewritten to `raw.githubusercontent.com/PLACEHOLDER_OWNER/sift/main/...` and relative doc links to repo blob URLs, because npm renders the README outside the repo tree. Staged `LICENSE`/`README.md` are gitignored in the package.
- `pack-check` now asserts the packed name is `siftdiff`, the tarball contains `LICENSE`/`README.md` and the five grammar wasm files, the installed manifest is not private and has no `workspace:` range or `@sift-review/*` dependency, and `dist/index.js` contains no runtime `@sift-review/*` require/import. It also prints the packed file list.
- Packed tarball (`npm pack --json`): name `siftdiff`, version `0.5.0`, 345 files, ~15.6 MB unpacked. Grouped: `dist/index.js`, 14 `dist/*.d.ts(.map)` pairs, `dist/grammars/*` (5 wasm), `dist/web/**` (310 files — the Vite bundle incl. Shiki language chunks), `LICENSE`, `README.md`, `package.json`. No `@sift-review/*` or `workspace:` leaks (asserted).
- `release.yml` is inert: it triggers only on `v*` tag push or manual dispatch, and the publish step is gated with `if: ${{ env.NPM_TOKEN != '' }}` — GitHub Actions forbids `secrets.*` in `if:`, so the secret is mapped to a job-level env var and the `if:` tests that. With no `NPM_TOKEN` secret configured, the publish step is skipped. `pages.yml` already triggers on the same `v*` tags, so one tag push both publishes and deploys the site; both stay inert on a private repo without Pages enabled.
- Demo GIF (cut-line §4): **cut this pass.** `ffmpeg` is not available in this environment, so the specified mp4 + ≤3 MB gif (palettegen) pipeline cannot encode its deliverable. Playwright is present but the primary artifact is unreachable without ffmpeg, and driving a 15 s scripted flow blind to produce only a webm was not worth the risk. Per the cut-line protocol, the README continues to lead with `docs/screenshots/workbench-dark.png`; the human records the GIF manually (steps remain in RELEASING/site).
- Only remaining intentional placeholder in the tree is `PLACEHOLDER_OWNER` (GitHub owner/org), used in `packages/cli/package.json`, `packages/cli/scripts/prepack.mjs`, `site/index.html`, and `SECURITY.md`'s advisory link context. Listed for the human to replace before publish.

## 2026-07-12 — v0.5.2 preflight audit remediation

- The claimed v0.5.1 package proof missed three release-facing details: the repository README still embedded relative screenshot paths, the packed CLI manifest retained internal `@sift-review/core` and `@sift-review/claude-adapter` development dependencies, and the root `build` script still filtered for the old `@sift-review/cli` name. The first breaks npm-hosted image rendering; the second violates the sealed-package boundary even though tsup bundles the code; the third made `pnpm build` silently omit the renamed CLI in a clean clone.
- Screenshot embeds now use absolute raw-GitHub URLs (with the documented `PLACEHOLDER_OWNER` token), the internal workspace references live only at the private root for source builds, and the build target is `siftdiff`. The packed `siftdiff` manifest is free of `workspace:` and `@sift-review/*` references. `pnpm typecheck` and `pnpm pack-check` passed after the correction.

## 2026-07-12 — v0.5.2 Preflight

- `pnpm preflight` is a Node/tsx orchestrator in `scripts/preflight/`. It runs A–H sequentially, emits a one-line completion result for each stage, always writes ignored `PREFLIGHT.md`, optionally writes `PREFLIGHT.json`, and returns non-zero only when a stage fails. `--fast` skips the network-heavy eval and full clone install; `--only <stage>` keeps failure investigation narrow.
- No runtime or development dependency was added. Preflight dynamically resolves the already-installed `yaml`, `zod`, Playwright, and MCP SDK packages from their owning workspace, keeping the root package manifest unchanged apart from the new command.
- Network-dependent work (eval corpus fetching, clean install, README URL HEAD checks) reports `SKIP` with its exact reason when unavailable. The normal local analysis path remains offline-first, read-only in Git, and never executes code from a repository being reviewed.
- Stage C makes the v0.5.1 release promises executable: package identity, tarball allowlist, packed-manifest sealing, README links, documented placeholders, OSS files, workflow parsing/secret guard, and changelog entries. Its focused tests seed disallowed files, unexpected placeholders, and unguarded publishing to prove the detector paths.
- Full preflight produces disposable fresh-user and installed-package proofs. The latter runs the packed binary, MCP stdio liveness after a synthetic worktree mutation, sandboxed hook round-trip, idempotent init, and package-local web/wasm/font checks. It never authenticates, publishes, tags, pushes, or runs reviewed-repository code.
- A missing demo video is an explicit bounded `SKIP`, not a false pass: the scorecard carries the exact encoder result and a one-line manual recording instruction. The Stage H scorecard contains the 10 mechanical patch/repro samples when a full eval report is available, plus the PowerShell-only manual ship list.

## 2026-07-13 — v0.5.3 Directive Comments

- `LINT_SUPPRESSED` is the only signal-table amendment in this hotfix: compiler/linter/coverage/formatter and declaration-tooling directives are +25 primary signals on both additions and removals. A shared comment-aware detector also blocks COMMENT_ONLY demotion independently of weight, while eval keeps a separate lexical guard against directive hunks becoming mechanical.
- The published CLI version remains `0.5.0`. This is a pre-launch corrective pass folded into the first `0.5.0` artifact, consistent with the earlier v0.5.1/v0.5.2 pre-publish reconciliation; the changelog records the work as v0.5.3 without changing the package or CLI version.
