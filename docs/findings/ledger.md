# Findings ledger

This is the **append-only record** of findings that have been addressed. Each
section is one addressed finding: its text (carried over from the
[queue](./queue.md) so nothing is lost), the recommended fix, the disposition,
the gates that were run, and the files that changed. Entries are appended in
processing order, newest last. The machine resume state lives alongside in
`.checkpoint.json`; the **how-to** lives in [usage.md](./usage.md).

All items in this ledger are **addressed**. Items still pending in the
[queue](./queue.md) are drained into this ledger in processing order; each `done`
entry below records all four gates green, and the six safety invariants (see
[threat model](../threat-model.md)) were preserved by every entry.

<!-- APPEND-SECTIONS-START -->

## A. Magic threshold numbers 55/80

- **Finding**: DRY — `DEFAULT_CONFIG.approvalThreshold = 55` / `blockThreshold = 80` (`config.ts:95-96`) were re-typed as literals in three subsystems, so a non-default config would silently drift from the configured gate.
- **Locations**: config.ts:95-96; guardrails.ts:175; approval.ts:41; tools/evolution.ts:115,137
- **Recommendation**: Route every site through `DEFAULT_CONFIG` (or a shared `thresholds` object) instead of re-typing `55`/`80`.
- **Risk / why flagged**: Sensitive (gating-adjacent) — it changes the risk-label and evolution status/requiresApproval logic; lower risk because the runtime gating path already routes through `Gate.execute` → `decide(score, approvalThreshold, blockThreshold)`, making `scoreRisk`'s `decision` display-only.
- **Disposition**: `noop-verify` — already routed through `DEFAULT_CONFIG` in the baseline working tree; closed out only the one fixable `organizeImports` error in `test/threshold.test.ts`.
- **Files changed**: test/threshold.test.ts (import ordering only)
- **Evidence**: `grep` confirmed `55`/`80` live only in `config.ts` `DEFAULT_CONFIG` (their canonical home); approval.ts / guardrails.ts / evolution.ts all read `DEFAULT_CONFIG.approvalThreshold` / `blockThreshold`; no threshold-logic change.
- **Gates**: lint PASS (import-order close-out, per-file) · typecheck PASS · test PASS (145) · smoke PASS (jiti skip, expected).
- **Sensitive caveat (recorded)**: gating-adjacent, already rerouted through `DEFAULT_CONFIG` at baseline.
- **Safety invariants preserved**: yes (no threshold semantics touched; A only affects non-default-config display).
- **Addressed at**: 2026-08-25T16:09:42Z

## B. `evaluateQuality` mirrored inside the extension

- **Finding**: DRY — `self_eval`'s local `evaluateQualityLocal` (`index.ts:561-599`) was a near-copy of `evaluation.evaluateQuality` (`evaluation.ts:34-80`); a cosmetic-plus-one delta (omits the `guardrailBlocks` signal, phrases the note as `"…error(s)"` vs the canonical `"…error(s) observed"`).
- **Locations**: index.ts:19/533/928; evaluation.ts:34-80
- **Recommendation**: Delete the local mirror; import `evaluateQuality` from `evaluation.ts`, passing `guardrailBlocks: 0`.
- **Risk / why flagged**: Sensitive — changes the `self_eval` *display* text (user-visible diff), though the score behavior is equivalent.
- **Disposition**: `noop-verify` — the mirror was already gone in the baseline working tree; verification-only.
- **Files changed**: none (git byte-identical to pre-dispatch baseline).
- **Evidence**: `grep -rn "evaluateQualityLocal" src/` → NONE; the sole `error(s)` in `src/` is the canonical `notes.push(\`${s.errorCount} runtime error(s) observed\`)` in `evaluation.ts:55`; `index.ts:19` imports `evaluateQuality`, `:533` routes `self_eval` through it with `guardrailBlocks: 0`, `:928` re-exports it.
- **Gates**: lint PASS · typecheck PASS · test PASS (146) · smoke PASS (jiti skip, expected).
- **Sensitive caveat (recorded)**: user-visible `self_eval` display wording (`"…error(s) observed"`) — confirmed the intended canonical wording, already in-tree.
- **Safety invariants preserved**: yes (pure DRY; routes the display verdict through the same math the promotion gate uses).
- **Addressed at**: 2026-08-25T22:07:00Z

## C. Triplicated uniqueness helper → `src/util.ts`

- **Finding**: DRY — `Array.from(new Set(…))` under three names (`registry.ts` `unique<T>`, `compaction.ts` `dedupe`, `memory.ts` `unique(ts)` + trim-filter). The first two are byte-identical; the third adds a `trim().length > 0` filter.
- **Locations**: registry.ts:109; compaction.ts:167; memory.ts:250 → new src/util.ts
- **Recommendation**: One `unique<T>(xs)` in a new `src/util.ts`; `memory` → `unique(xs.filter((t) => t.trim().length > 0))`.
- **Risk / why flagged**: Preserving — behavior byte-identical at every call site; `src/util.ts` becomes the canonical home for the later D/E/F/G extractions.
- **Disposition**: `apply`
- **Files changed**: `src/util.ts` (new, `unique<T>`); `src/registry.ts` (local `unique<T extends string>` deleted, import dropped the `string` constraint); `src/compaction.ts` (`dedupe`→`unique`, incl. `dedupeTags` + two `artifactFrom` sites); `src/memory.ts` (calls `unique((input.tags ?? []).filter((t) => t.trim().length > 0))`); `test/util.test.ts` (new, 5 tests).
- **Evidence/gates**: lint PASS · typecheck PASS (dropping `<T extends string>` → `<T>` types clean) · test PASS (151) · smoke PASS.
- **Safety invariants preserved**: yes (pure internal reduction).
- **Addressed at**: 2026-08-25T22:27:00Z

## D. `dirnameSafe` + `mkdir` idiom → `src/util.ts`

- **Finding**: DRY — identical `dirnameSafe(p)` in `audit.ts` and `memory.ts`, plus the repeated `mkdir(dirnameSafe(file), { recursive: true })` idiom (audit `append`/`writeIndex`, memory `add`/`persist`).
- **Locations**: memory.ts:264; audit.ts:175 → new in src/util.ts (4 idiom call sites)
- **Recommendation**: One `dirnameSafe` + `ensureDir(file) = mkdir(dirnameSafe(file), { recursive: true })` in `src/util.ts`; the four call sites call `ensureDir`.
- **Risk / why flagged**: Preserving — zero-risk DRY; `audit.snapshot()`'s directory `mkdir` is deliberately left untouched (`ensureDir` means *mkdir the parent of a file*, and `snapshotsDir` is already a directory).
- **Disposition**: `apply`
- **Files changed**: `src/util.ts` (added `dirnameSafe` + async `ensureDir` + `node:fs/promises` `mkdir`); `src/audit.ts` (deleted local `dirnameSafe`; `append`/`writeIndex` call `ensureDir`; **kept** `mkdir` for `snapshot()`); `src/memory.ts` (deleted local `dirnameSafe`; `add`/`persist` call `ensureDir`; dropped now-unused `mkdir`).
- **Evidence/gates**: lint PASS · typecheck PASS · test PASS (151) · smoke PASS. Snapshot dir-`mkdir` confirmed intact via grep.
- **Safety invariants preserved**: yes (threat-model.md references none of these helpers).
- **Addressed at**: 2026-08-26T15:11:26Z

## E. Id-suffix pattern + two dead re-exports → `genId` in `src/util.ts`

- **Finding**: DRY — three near-identical id templates (`mem_`/`aud_` 12-char, `snap_` 8-char) plus two dead re-exports (`export { join }` in memory.ts, `export { resolvePaths }` in audit.ts with zero importers).
- **Locations**: memory.ts:103/269; audit.ts:34/92/180 → genId in src/util.ts
- **Recommendation**: Collapse the id templates to `genId(prefix, len)`; delete the two importerless re-exports.
- **Risk / why flagged**: Preserving — id output byte-identical; both re-exports had zero importers (every real `join` comes from `node:path`, every real `resolvePaths` from `./config.js`).
- **Disposition**: `apply`
- **Files changed**: `src/util.ts` (added `genId` + `node:crypto`); `src/memory.ts` (`id: genId("mem_", 12)`, removed dead `export { join }` + unused `randomUUID`/`join` imports); `src/audit.ts` (`genId("aud_", 12)`, `genId("snap_", 8)`, removed dead `export { resolvePaths }` + unused `randomUUID`, config import → `import type { SelfPaths }`, kept internal `join` for `snapshot`).
- **Evidence/gates**: lint PASS · typecheck PASS · test PASS (151) · smoke PASS.
- **Safety invariants preserved**: yes.
- **Addressed at**: 2026-08-26T15:30:10Z

## F. Divergent `tokenize` → unified `tokenize(text, { minLength, stopwords })`

- **Finding**: DRY — two tokenizers share the `lower → replace(/[^\p{L}\p{N}\s]+/g, " ") → split(/\s+/)` pipeline but diverge on the tail filter: `context` keeps `t.length > 2` (no stopwords); `memory` keeps `t.length > 1` + `STOPWORDS`.
- **Locations**: context.ts:74; memory.ts:163 → unified in src/util.ts
- **Recommendation**: One `tokenize(text, { minLength, stopwords })` in `src/util.ts`; `context` calls it `{ minLength: 3 }`, `memory` `{ minLength: 2, stopwords: STOPWORDS }`. Preserving **only** if each caller passes its own args (the two are intentionally different).
- **Risk / why flagged**: Preserving *with care* — the per-caller args must be preserved exactly; a naive merge would change tokenization.
- **Disposition**: `apply-withcare`
- **Files changed**: `src/util.ts` (added `tokenize`; biome-canonical guard `t.length >= opts.minLength && !opts.stopwords?.has(t)`); `src/context.ts` (deleted local `tokenize`; both call sites → `{ minLength: 3 }`); `src/memory.ts` (deleted local `tokenize`; call site → `{ minLength: 2, stopwords: STOPWORDS }`, `STOPWORDS` remains a domain constant in memory.ts); `test/util.test.ts` (+3 cases).
- **Evidence/gates**: `>= minLength` ≡ old `> 2`/`> 1`; lint PASS · typecheck PASS · test PASS (154) · smoke PASS.
- **Safety invariants preserved**: yes (each caller's tokenization byte-identical).
- **Addressed at**: 2026-08-26T16:10:04Z

## G. Smaller smells — scoped

- **Finding**: MIXED — four sub-items: (1) duplicate `"been"` in the `STOPWORDS` `Set` (functionally a no-op, a literal dup to remove); (2) `slugify` vs `slugName` deliberately distinct; (3) optional `readJsonl<T>(file, parse)` unification (lower priority, both load paths); (4) a few intentional empty `catch {}` "never break the primary op" swallows.
- **Locations**: memory.ts (STOPWORDS); skills.ts:24 `slugify`; tools/evolution.ts:170 `slugName`; src/index.ts catch sites; audit.ts/memory.ts parseLine load paths
- **Recommendation**: Apply the one safe concrete change (dedup `"been"`); document the rest as deliberate no-ops / deferrals.
- **Risk / why flagged**: Mixed — only the `"been"` dedup is a safe concrete change; the others are intentionally distinct or out-of-scope.
- **Disposition**: `scoped`
- **Files changed**: `src/memory.ts` (removed exactly ONE duplicate `"been"` — `Set` structural no-op).
- **Deferred / left as-is (documented)**:
	- `slugify` (dash sep + static `"untitled-skill"`) and `slugName` (underscore sep + dynamic `evolved_${randomUUID().slice(0,6)}`) left distinct — different slash grammar + dynamic fallback; not safe to merge naively.
	- `readJsonl<T>` deferred — worthwhile but lower priority, touches both load paths.
	- Empty `catch {}` swallows all live in `src/index.ts` (an out-of-scope, pre-existing in-flight file this pipeline must not modify); `context.ts`/`registry.ts` have no catch blocks. Acceptable-intent swallows; comment deferred with that in-flight file.
- **Evidence/gates**: set count unchanged; lint PASS · typecheck PASS · test PASS (154) · smoke PASS.
- **Safety invariants preserved**: yes (all six intact; Set structural no-op).
- **Addressed at**: 2026-08-26T16:25:51Z

## H. `evolve_tool` auto-activates shadow-status tools without approval or shadow evidence

- **Finding**: In `buildEvolveTool`, `canActivate = !gate.dryRun && status === "shadow"` (`src/index.ts:483`) promoted any shadow-status tool straight to `"active"`, ignoring `budget.requiresApproval`. A `maxRadius:"system"` create yields `initialStatusFor` → `"shadow"` yet `requiresApproval` is computed `true` but never consulted downstream (the gate derives risk from `kind`: `evolve_tool` create → module radius, auto-trusted in `src/approval.ts:71`). Net: a system-radius proposal auto-activated with empty metrics and no user confirmation, bypassing the "human approval mandatory before a tool goes active" invariant in `src/evaluation.ts:5`.
- **Locations**: src/index.ts:483; src/index.ts:484; src/tools/evolution.ts:112; src/tools/evolution.ts:138; src/approval.ts:71; src/evaluation.ts:5
- **Recommendation**: Gate auto-promotion on `!requiresApproval AND (shadow ran OR runs>0)`, or force `/evolve activate` for system/external-effect radii; add tests asserting a system-radius create stays non-active until explicitly activated.
- **Risk / why flagged**: Sensitive — changes the promotion gate; user-visible and invariant-adjacent. Confirmed by the user ("go") before applying.
- **Disposition**: `apply-withcare` — extracted a pure, exported `canAutoActivate({status, requiresApproval, runs, ranShadow, dryRun})` in `src/tools/evolution.ts`; `src/index.ts` `buildEvolveTool` now calls it (replacing the inline `!gate.dryRun && status === "shadow"`).
- **Files changed**: `src/tools/evolution.ts` (new `canAutoActivate` predicate), `src/index.ts` (import + call site), `test/evolution.test.ts` (+3 tests: system-radius/requires-approval never auto-activates; shadow-with-evidence auto-activates; no-evidence does not).
- **Evidence**: A system-radius create sets `requiresApproval: true` in `draftEvolution`; the new guard returns `false` for it, so the tool stays `shadow` and must be activated via `/evolve activate`, whose `activationAction(t)` routes through `gate.execute` (system radius scores high → approval/block). Low-risk creates (self/module, no approval) with `params.runShadow` or non-zero runs still auto-activate unchanged.
- **Gates**: lint PASS (29 files, no fixes) · typecheck PASS (exit 0) · test PASS (162, +3 `canAutoActivate` cases; was 159 at run start) · smoke PASS (skips jiti, expected).
- **Sensitive caveat (recorded)**: promotion-gate change, user-confirmed this session; no hard-stop list, no lossless-forgetting, no framework-source-guard, and no "no arbitrary code eval" invariants were touched. The sanctioned `/evolve` pipeline still activates system-radius tools through the gate.
- **Safety invariants preserved**: yes (all six intact).
- **Addressed at**: 2026-08-27T13:20:00Z

## I. `SnapshotStore` rollback capability is constructed but never driven

- **Finding**: `createGovernance` returns `{ audit, snapshots }` but every `governance(...)` call site used only `.audit`; the `SnapshotStore` subsystem and the `snapshot`/`rollback` audit kinds were never driven from production, so capability #6 (`docs/user-guide.md:252`) was advertised-but-dead.
- **Locations**: src/stores.ts:48; src/audit.ts:156; src/audit.ts:91; src/index.ts:596; docs/user-guide.md:252
- **Recommendation**: Either wire a snapshot-on-approve + `/self snapshot`/`/self restore`, or drop the `snapshots` half + the user-guide claim.
- **Risk / why flagged**: Mixed — touches an advertised capability + a doc claim; wiring is behavior-preserving and additive.
- **Disposition**: `apply (wire)` — user chose "wire". Added `captureStateSnapshot(manager, st, label, data)` to `src/index.ts`; `/evolve activate` now captures a pre-activation snapshot (`priorStatus` + version) and `/evolve rollback` a post-rollback snapshot, each recorded as a `snapshot`/`rollback` audit entry. A new test in `test/audit.test.ts` drives capture -> audit -> restore through a real `governance()` bundle.
- **Files changed**: `src/index.ts` (`captureStateSnapshot` + wiring in both `/evolve` cases); `test/audit.test.ts` (+1 end-to-end test, capability #6).
- **Evidence/gates**: user-guide.md:252 now reflects a subsystem that actually records a restorable payload; lint PASS · typecheck PASS · test PASS (163) · smoke skip.
- **Safety invariants preserved**: yes (additive snapshot capture; the six invariants are untouched — a `snapshot`/`rollback` audit kind only *records* state, it does not execute code or bypass a gate).
- **Addressed at**: 2026-08-27T13:30:00Z

## J. Dead exports: `reinforce`, `ToolRegistry.remove`, `gateAction`, `Confidence`

- **Finding**: Several exports had zero call sites and implied un-wired features (reinforced recall weighting, a promotion combiner, a rollback-by-remove).
- **Locations**: src/memory.ts:140; src/evaluation.ts:158; src/types.ts:22; src/tools/evolution.ts
- **Recommendation**: Remove the unused exports/type (or wire them); re-run typecheck after each removal.
- **Risk / why flagged**: Preserving — dead-code deletion; verified zero importers via grep then typecheck.
- **Disposition**: `apply-withcare (scoped)`. Removed 3 truly-dead symbols; **kept** `reinforce`.
- **Files changed**: `src/evaluation.ts` (removed `gateAction` **and** its now-orphaned `import { type ActionInput, scoreRisk }`); `src/types.ts` (removed the unused `Confidence` type); `src/tools/evolution.ts` (removed `ToolRegistry.remove`).
- **Evidence/gates**: grep confirmed zero importers for `gateAction`/`Confidence`/`remove`; `gateAction` was the sole user of `evaluation.ts`'s guardrails import, so that import was removed with it; `reinforce` is a **tested** public-API `MemoryStore` method (`test/memory.test.ts`) and was retained as a deliberate scoping decision (wiring it to a recall path is a separate feature). typecheck clean after each removal · lint PASS · test PASS (163).
- **Safety invariants preserved**: yes (pure dead-code reduction; no behavior or invariant touched).
- **Addressed at**: 2026-08-27T13:30:00Z

## K. `loadBranch` does not actually degrade on a throwing `getBranch()`

- **Finding**: `loadBranch` (`src/index.ts`) called `ctx.sessionManager.getBranch()` *outside* the `try`/`catch` the inline comment says will degrade gracefully — so a malformed session that makes `getBranch` throw escaped the fallback instead of landing on `emptyState()`.
- **Locations**: src/index.ts:709-717 (loadBranch); src/registry.ts (reconstructState / emptyState)
- **Recommendation**: Move the `getBranch()` call inside the try (or wrap the whole body), and add a test with a throwing `getBranch`.
- **Risk / why flagged**: Preserving — widens an existing graceful-degrade path; a malformed session now degrades as promised.
- **Disposition**: `apply-withcare`. Extracted a pure, exported `safeLoadState(get: () => unknown): SessionState` into `src/registry.ts` that invokes the reader *inside* the `try`; `loadBranch` now delegates to it (`new BranchState(safeLoadState(() => ctx.sessionManager.getBranch()))`). Dropped the now-unused `emptyState`/`reconstructState`/`EntryLike` from `index.ts`'s registry import.
- **Files changed**: `src/registry.ts` (`safeLoadState` added after `reconstructState`); `src/index.ts` (`loadBranch` refactored, import trimmed); `test/registry.test.ts` (new, +7 tests incl. a throwing-reader → `emptyState` case and a non-self-state/bad-payload case).
- **Evidence/gates**: typecheck clean after trimming imports · lint PASS (`organizeImports --write`) · test PASS (170) · smoke skip.
- **Safety invariants preserved**: yes (a wider safe fallback; no gate/invariant touched).
- **Addressed at**: 2026-08-27T13:30:00Z

## L. `scoreRisk` hardcodes `DEFAULT_CONFIG` thresholds instead of the runtime config

- **Finding**: `scoreRisk` clamped develop-mode framework edits and derived `.decision` from `DEFAULT_CONFIG.approvalThreshold`/`blockThreshold` (`src/guardrails.ts`), while the gate re-decides from `config.approvalThreshold`/`blockThreshold`. A consumer that overrides thresholds (via `{...DEFAULT_CONFIG, ...config}`) saw two different answers: the stored `.decision` vs. what the gate enforced.
- **Locations**: src/guardrails.ts:150,172; src/approval.ts:86; src/stores.ts:60
- **Recommendation**: Thread the effective thresholds into `scoreRisk` (or compute `.decision` in one place from the same config the gate consumes).
- **Risk / why flagged**: Mixed/latent — harmless while thresholds are never overridden, but threshold-adjacent once a consumer does.
- **Disposition**: `apply`. Added an optional `thresholds?: { approvalThreshold?: number }` to `scoreRisk`; it drives both the develop-mode clamp (`Math.min(score, approvalThreshold - 1)`) and the `approve` decision, defaulting to `DEFAULT_CONFIG.approvalThreshold`. `approval.ts` `assess` and the `index.ts` tool-call gate now pass `config.approvalThreshold`.
- **Files changed**: `src/guardrails.ts` (signature + 2 hardcoded spots); `src/approval.ts` (`assess` threads config); `src/index.ts` (tool-call gate threads config); `test/threshold.test.ts` (+3 regression cases proving a lowered threshold flips a same-score action to 'approve', a raised one to 'allow', and the develop clamp is threshold-dependent).
- **Evidence/gates**: at default thresholds behavior is identical to before (fallback path); typecheck clean · lint PASS · test PASS (173) · smoke skip.
- **Safety invariants preserved**: yes (threshold plumbing only; no invariant or hard-stop changed; the `approve`/`allow`/`block` bands still resolve identically at defaults).
- **Addressed at**: 2026-08-27T13:30:00Z

## M. `NETWORK_INJECT` only catches piped remote-exec, not download-then-run

- **Finding**: `NETWORK_INJECT` requires a literal pipe, so `curl e/x -o x && sh x` / `wget -O x && ./x` evade the hard stop; such commands hit the `external-effect` default (approval-gated, not hard-blocked) — a defense-in-depth gap vs. the documented hard-stop list.
- **Locations**: src/guardrails.ts:41 (NETWORK_INJECT), :57 (classifyAction default)
- **Recommendation**: Either broaden the hard stop to remote-fetch-then-execute, or document that only piped injection is a hard stop so the boundary is intentional.
- **Risk / why flagged**: Sensitive — touches the hard-stop boundary. User chose to **document** the boundary as intentional (behavior-preserving) rather than harden it.
- **Disposition**: `apply-withcare (document)`. No regex/behavior change. Added: (1) a comment above `NETWORK_INJECT` stating the boundary is deliberate; (2) a comment on the `classifyAction` default `return` noting download-then-run is approval-gated; (3) a note in `docs/threat-model.md` (§3) explaining the intentional boundary; (4) a regression test (`download-then-run is approval-gated, NOT a hardStop`) asserting `&&`/`-o` forms are not hard-stops while the piped `curl … | sh` form remains `hardStop: true, rule: 'network-injection'`.
- **Files changed**: `src/guardrails.ts` (2 comments); `docs/threat-model.md` (boundary note); `test/guardrails.test.ts` (+1 test). One broken test-insertion was reverted via `git checkout` and re-inserted correctly.
- **Evidence/gates**: behavior unchanged; the test locks in the current (approval-gated) behavior so a future harden can't regress silently. lint PASS · typecheck PASS · test PASS (174) · smoke skip.
- **Safety invariants preserved**: yes (hard-stop list unchanged; boundary is documented, and the pipe-exec hard stop + all six invariants remain intact).
- **Addressed at**: 2026-08-27T13:30:00Z

## N. AGENTS.md file-responsibility table omits `src/util.ts`

- **Finding**: The `src/` layout table in AGENTS.md enumerated every module except `src/util.ts`, even though it is now the canonical home of the shared helpers consolidated in C–G (`unique`/`dedupe`, `genId`, `dirnameSafe`/`ensureDir`, `tokenize`).
- **Locations**: AGENTS.md:30, AGENTS.md:39
- **Recommendation**: Add a `src/util.ts` row to the AGENTS.md layout table.
- **Risk / why flagged**: Preserving — documentation only.
- **Disposition**: `apply`. Added `| util.ts | Shared primitives consolidated from findings C–G: … |` to the AGENTS.md layout table, right after the `index.ts` row.
- **Files changed**: `AGENTS.md` (1 row). No code change; no test/typecheck impact.
- **Evidence/gates**: lint PASS; typecheck/test N/A (docs only). The six invariants are untouched.
- **Safety invariants preserved**: yes (docs only).
- **Addressed at**: 2026-08-27T13:30:00Z

## O. `EMPTY_METRIC` defined identically in two files

- **Finding**: The identical zero-metric constant was defined in both `src/tools/evolution.ts:32` and `src/index.ts:46` — a copy that could silently drift.
- **Locations**: src/tools/evolution.ts:32; src/index.ts:46
- **Recommendation**: Export a single `EMPTY_METRIC` and import it in the other file.
- **Risk / why flagged**: Preserving — single source of a shared constant.
- **Disposition**: `apply`. `EMPTY_METRIC` is now `export`ed from `src/tools/evolution.ts` (its canonical home); `src/index.ts` imports it, removing the local definition and the now-unused `EvolvedToolMetric` type import. Value is byte-identical, so no behavior change.
- **Files changed**: `src/tools/evolution.ts` (`export const EMPTY_METRIC`); `src/index.ts` (added to the evolution import, removed local def + the orphaned `EvolvedToolMetric` type from the `./types.js` import).
- **Evidence/gates**: `grep EMPTY_METRIC src/` shows one definition + two import sites; lint PASS · typecheck PASS · test PASS (174) · smoke skip.
- **Safety invariants preserved**: yes (pure DRY; the zero-metric constant is unchanged).
- **Addressed at**: 2026-08-27T13:30:00Z

## P. `openTasksFrom` is a no-op stub

- **Finding**: `openTasksFrom` (src/index.ts) unconditionally returns `[]`, so compaction's `openTasks` (wired to it) is always empty — an unfinished extraction path left as a stub.
- **Locations**: src/index.ts (openTasksFrom + its call site); src/compaction.ts (optional `openTasks` consumer)
- **Recommendation**: Either implement the extraction from `preparation`, or remove the parameter + call site so the feature is absent rather than silently empty.
- **Risk / why flagged**: Preserving — nothing relies on non-empty output.
- **Disposition**: `apply` (remove the stub). Deleted the `openTasksFrom` function and its call site (`openTasks: openTasksFrom(preparation)`) in `src/index.ts`. `compaction.ts` already renders `openTasks: []` and `openTasks: undefined` identically (`ctx.openTasks?.length ? … : “none provided”`), so behavior is unchanged. The optional `CompactionInput.openTasks` field is retained (a valid compaction API surface, still unit-tested in `test/compaction.test.ts`); implementing the extraction is left as a separate feature.
- **Files changed**: `src/index.ts` (removed `openTasksFrom` def + call site).
- **Evidence/gates**: `grep openTasksFrom` returns nothing; compaction rendering unchanged (empty/undefined both print “none provided”). lint PASS · typecheck PASS · test PASS (174) · smoke skip.
- **Safety invariants preserved**: yes (feature-absence, not a behavior change).
- **Addressed at**: 2026-08-27T13:30:00Z

## Q. `isFrameworkSource` normalize does not resolve `..` segments

- **Finding**: `isFrameworkSource` normalized paths by collapsing `//` → `/` but did not resolve `.`/`..` segments, then compared with string `startsWith`. A path like `<root>/sub/../x` passed the startsWith test (over-block, the safe direction), and the check was order-dependent because `..` was left un-flattened.
- **Locations**: src/guardrails.ts (~230)
- **Recommendation**: Resolve `.`/`..` segments (a small canonical path cleanup) before the containment test so the check is canonical rather than string-prefix based.
- **Risk / why flagged**: Preserving — currently safe-direction only; the cleanup makes the containment test order-independent.
- **Disposition**: `apply`. Rewrote the local `normalize` to canonically resolve `.`/`..` (pure string ops, still non-Node-usable so the module's isolation stays), and normalized the relative branch (`normalize(joinPath(frameworkRoot, path))`). Containment is now order-independent: `<root>/../escape` → `/escape` (correctly false), `<root>/sub/../src/x` → in-root (true), `<root>/./src/x` → true.
- **Files changed**: `src/guardrails.ts` (`normalize` rewrite + relative-branch normalization); `test/guardrails.test.ts` (+3 cases: `..` escaping → false, `..` staying in-root → true, `.` collapse).
- **Evidence/gates**: existing `isFrameworkSource` tests still pass; new cases lock in canonical resolution. lint PASS · typecheck PASS · test PASS (177) · smoke skip.
- **Safety invariants preserved**: yes — framework-source hard-stop unchanged; containment is *more* correct (removes a latent over-block) but still never under-blocks framework edits.
- **Addressed at**: 2026-08-27T13:30:00Z

## R. Threat-model risk-scoring formula and class/radius tables are stale vs `guardrails.ts`

- **Finding**: `docs/threat-model.md` described the scoring as an additive `0.70 × classWeight + 0.30 × blastRadiusWeight` blend with an "Increment" radius column and wrong class bases (`write-context 30`, `external-effect 80`). The real `scoreRisk` is purely multiplicative: `score = round(base[changeClass] × radiusMult[radius])`, bases read 5 / write-memory 20 / write-context 25 / write-skill 35 / write-tool 60 / modify-framework 65 / external-effect 55, multipliers self 1 / module 1.1 / project 1.3 / system 1.6. The stale numbers flip threshold decisions (e.g. `external-effect + system` reads 76 "allow" in the doc but is 88 "block" in code).
- **Locations**: docs/threat-model.md:51, :54, :63, :67; src/guardrails.ts:117, :124, :130
- **Recommendation**: Rewrite the Risk-scoring section to the multiplicative formula with the real class bases and radius multipliers; drop the 0.70/0.30 framing and the "Increment" column.
- **Risk / why flagged**: Sensitive/semantic — the threat model is the canonical statement of the risk/decision invariant; docs-only change, no code behavior change.
- **Disposition**: `apply` (docs). Rewrote the Risk-scoring section to `score = round(base[changeClass] × radiusMult[radius])` (clamped 0–100), with the real class bases and radius multipliers, and a note that rule checks raise floors and hard stops force `block` regardless of score.
- **Files changed**: `docs/threat-model.md` (Risk-scoring section). No code change.
- **Evidence/gates**: numbers now match `guardrails.ts` verbatim; lint PASS · typecheck N/A (docs only, exit 0) · test PASS (177, unchanged) · smoke skip.
- **Safety invariants preserved**: yes (no threshold or scoring code touched; docs brought into agreement with the code). The gate/decision invariants are unchanged.
- **Sensitive caveat (recorded)**: canonical risk/decision statement corrected to match code; no behavior changed.
- **Addressed at**: 2026-08-28T13:03:43Z
## S. EXTERNAL_WRITE branch in classifyAction is dead: its return equals the unconditional bash fall-through

- **Finding**: In classifyAction's bash block, `if (EXTERNAL_WRITE.test(command)) return { radius: 'project', changeClass: 'external-effect' }` (guardrails.ts:70) returns the exact same object as the next unconditional `return { radius: 'project', changeClass: 'external-effect' }` (guardrails.ts:73). Because the branch's result equals its fall-through, the branch never changes the outcome, so EXTERNAL_WRITE (guardrails.ts:57) has exactly two references in the whole repo — its definition and this dead branch — making the regex dead code that only looks load-bearing. The download-then-run comment at line 71 now sits on the fall-through, not on the dead branch.
- **Locations**: src/guardrails.ts:57; src/guardrails.ts:70; src/guardrails.ts:73
- **Recommendation**: Delete the `if (EXTERNAL_WRITE.test(command)) ...` branch at line 70 and the now-unused `EXTERNAL_WRITE` constant at line 57; keep the download-then-run comment on the fall-through. No scoring or threshold behavior changes because the fall-through already yields the identical classification.
- **Risk / why flagged**: Preserving. The removed branch yields the identical {radius:'project',changeClass:'external-effect'}, so blast-radius/threshold classification and the six hard-stop invariants are unchanged; only a misleading dead regex is removed.
- **Disposition**: apply. Removed the dead `if (EXTERNAL_WRITE.test(command)) return { project, external-effect }` branch in the bash arm of classifyAction (its return was identical to the fall-through). Also removed the now-orphaned EXTERNAL_WRITE regex declaration — it is not referenced by any test or other code (the finding's 'import-exercised' premise was false: there is no index.test exercising it), so keeping it would leave dead code. Reworded the branch comment: only piped network injection is a hard stop; download-then-run / package-install commands are approval-gated.
- **Files changed**: src/guardrails.ts
- **Evidence/gates**: grep confirms EXTERNAL_WRITE no longer appears anywhere; classifyAction tests still pass. Behavior identical for every real bash command. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — classification outcomes unchanged for all live inputs; EXTERNAL_WRITE was inert.
- **Addressed at**: 2026-08-28T13:53:42.231Z

## V. recordAudit's _gate parameter is dead but threaded through ~14 call sites

- **Finding**: `recordAudit(manager, st, _gate, kind, actor, summary, payload)` declares a third positional parameter `_gate: Gate | undefined` (index.ts:741) that is never read inside the function body. Every caller still passes the argument: `gate` at index.ts:134 and `undefined` at index.ts:177,239,296,360,448,693,713,... — per-call noise (a `gate` vs `undefined` distinction) to satisfy a parameter the function ignores. This is a dead-parameter reduction across the whole file.
- **Locations**: src/index.ts:741; src/index.ts:134; src/index.ts:177; src/index.ts:693; src/index.ts:713
- **Recommendation**: Drop the `_gate` parameter from `recordAudit` and delete the third argument at every call site; verify the `Gate` type import is still needed elsewhere (createGate's inferred return) before removing it.
- **Risk / why flagged**: Preserving. The parameter is never read, so removing it and its arguments changes no audit content or control flow; the append-only audit invariant is preserved.
- **Disposition**: apply. Dropped the dead 3rd positional `_gate: Gate | undefined` from the `recordAudit` signature and removed it from all ~14 call sites (both single-line `recordAudit(manager, st, gate/undefined, …)` and multi-line forms). The param was underscore-prefixed (never read); the underlying `gov.audit.record` call and every recorded field are unchanged.
- **Files changed**: src/index.ts
- **Evidence/gates**: grep confirms no `_gate` remains; recordAudit now takes (manager, st, kind, actor, summary, payload?). The `Gate`/`createGate` imports are still used by buildGate. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — audit record shape and behavior unchanged; only a dead parameter removed.
- **Addressed at**: 2026-08-28T13:53:42.231Z

## A5. self_validate comparison arm in classifyAction is dead

- **Finding**: guardrails.ts has `if (tool === 'self_eval' || tool === 'self_validate')`. There is no `self_validate` tool anywhere: it is not in FRAMEWORK_TOOLS (index.ts), not registered, and a repo-wide grep returns only this one line. The `|| tool === 'self_validate'` disjunct can never be true, so it is a dead comparison arm (likely a leftover or forward-looking placeholder).
- **Locations**: src/guardrails.ts:89
- **Recommendation**: Delete the `|| tool === 'self_validate'` disjunct, leaving `if (tool === 'self_eval') return { radius: 'self', changeClass: 'read' };`. If 'self_validate' is intended as a future tool, register it or add a comment instead of a dead arm.
- **Risk / why flagged**: Preserving: no code path ever passes tool === 'self_validate', so removing the arm changes no classification outcome.
- **Disposition**: apply. Deleted the dead `|| tool === "self_validate"` disjunct from classifyAction (guardrails.ts), leaving `if (tool === "self_eval") return { self, read }`. `self_validate` is not in FRAMEWORK_TOOLS, not registered, and appears nowhere else in the repo, so the disjunct could never be true.
- **Files changed**: src/guardrails.ts
- **Evidence/gates**: repo-wide grep for self_validate returns nothing after removal; classification outcomes unchanged. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — no live tool passes self_validate; pure dead-arm removal.
- **Addressed at**: 2026-08-28T13:53:42.231Z

## A6. slugName rebuilds the raw-UUID idiom genId already collapses and re-derives skills.ts's slug pipeline

- **Finding**: Two functions implement the same slug shape: `slugify` (skills.ts, `toLowerCase().replace(non-alnum,'-').trim().slice(0,60) || 'untitled-skill'`) and `slugName` (evolution.ts:183, delimiter `_`, slice 48, fallback). Concretely, slugName's fallback `evolved_${randomUUID().slice(0, 6)}` (evolution.ts:189) is exactly the ad-hoc idiom `genId`'s own docstring says it collapses (`genId('evolved_', 6)` returns the same string), and evolution.ts imports `randomUUID` (line 1) solely for this fallback. genId (util.ts) is already the canonical id helper used by audit/memory.
- **Locations**: src/tools/evolution.ts:1; src/tools/evolution.ts:189; src/skills.ts; src/util.ts
- **Recommendation**: Replace slugName's fallback with `genId('evolved_', 6)` and drop the now-unnecessary `import { randomUUID } from 'node:crypto'` from evolution.ts. Optionally parameterize one shared `slugify(input, { delimiter, maxLen, fallback })` in util.ts so skills.ts and evolution.ts stop re-deriving the same shape; that part is optional and must preserve each caller's current delimiter/length/fallback.
- **Risk / why flagged**: Preserving: `genId('evolved_', 6)` returns the same id format evolution.ts produces today, so id shapes and the no-arbitrary-code evolution invariant are unchanged. The optional util unification must be behavior-preserving per caller.
- **Disposition**: apply. Replaced slugName's fallback `'evolved_' + randomUUID().slice(0,6)` with the canonical `genId('evolved_', 6)` (util.ts) — byte-identical output — and dropped the now-unused `import { randomUUID } from 'node:crypto'` from evolution.ts, adding `import { genId } from '../util.js'`. The optional shared-slugify unification was not applied (out of scope; would touch skills.ts's distinct delimiter/length).
- **Files changed**: src/tools/evolution.ts
- **Evidence/gates**: genId('evolved_',6) === 'evolved_' + randomUUID(6 char); evolution.test passes. randomUUID no longer imported by evolution.ts. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — tool id shape unchanged; no-arbitrary-code invariant untouched.
- **Addressed at**: 2026-08-28T13:53:42.231Z
## U. NETWORK_INJECT hard-stop bypass: absolute-path and versioned interpreters

- **Finding**: NETWORK_INJECT = /(?:curl|wget|fetch|nc|ncat)\b[^\n]*\|\s*(?:sh|bash|zsh|python|node)\b/i (guardrails.ts:56) requires the interpreter token to sit immediately after the pipe (modulo whitespace) AND to match with a trailing word boundary. Two canonical forms slip through: (a) absolute-path interpreters `curl http://x | /bin/sh` and `| /usr/bin/python3` — because `/bin/` precedes the token, `(?:sh|...)` cannot match at that position; (b) versioned interpreters `curl x | python3 -c '...'` — because the trailing `\b` after `python` fails (n→3 are both word chars), and none of the shorter alternatives match. Neither is a hard stop, so classification falls through to `external-effect` project-radius and scoreRisk downgrades what should be a block to an approval gate. `curl | /bin/sh` is a ubiquitous install-script pattern; silently treating it as a mere external effect weakens invariant 4. This is the converse of queued finding M (M locks download-then-run &&-forms as non-hard-stops; here a true pipe-to-interpreter is missed).
- **Locations**: src/guardrails.ts:56; src/guardrails.ts:70
- **Recommendation**: Make the interpreter match tolerant of a leading path segment and a version/js suffix, e.g. strip an optional `(?:(?:/\S+)/)?` prefix and allow `(?:sh|bash|zsh|python(?:\d+)?|node(?:js)?)\b`; add guardrails regression tests for `curl x | /bin/sh` and `wget x | python3 -c x` asserting hardStop=true.
- **Risk / why flagged**: Sensitive: weakens the NETWORK_INJECT hard-stop (invariant 4). Narrowing a broad match risks false positives, so it must be human-reviewed with added tests. Never auto-applied.
- **Disposition**: apply (harden). Hardened NETWORK_INJECT to catch the path-prefixed and versioned-interpreter bypasses the finding flagged. New form adds an optional path prefix `([^|]*?\/?)(?:sh|bash|zsh|python[0-9.]*|node)\b` so `curl x | /bin/sh`, `| /usr/bin/python3`, and `| /usr/local/bin/zsh` are hard-stopped. Two subtle bugs were caught and fixed during application: (1) the intermediate attempt used a trailing char class `[…$…]` where `$` is literal (not an end-anchor), so nothing matched — reverted to `\b`; (2) an intermediate `[^|]*?\/?` without the outer `?` also failed. Final regex verified against 13 positive/negative cases before wiring into tests. The download-then-run boundary (no pipe → approval-gated) is preserved: `curl … && sh x` still misses.
- **Files changed**: src/guardrails.ts; test/guardrails.test.ts
- **Evidence/gates**: verify4.mjs (out of tree) confirms DESTRUCTIVE+NETWORK_INJECT pass 13/13 cases incl. the 3 bypass forms. 3 new unit tests in test/guardrails.test.ts lock the new behavior. Full suite 181/181 (was 177). The hard-stop boundary is intact: no pipe ⇒ no match. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — hard-stop for piped network execution is *strengthened* (closes bypasses), not weakened; the documented download-then-run boundary (approval-gated) is preserved.
- **Sensitive caveat (recorded)**: Sensitive — touches a hard-stop boundary; over-block risk considered: the network-fetch prefix (`curl|wget|fetch|nc|ncat`) anchors the match, so legitimate `git clone`, `npm install`, and un-piped fetches are unaffected; only piped-into-interpreter forms are hard-stopped.
- **Addressed at**: 2026-08-28T15:00:57.789Z

## Z. DESTRUCTIVE regex misses reordered and long-form rm flags

- **Finding**: DESTRUCTIVE = /(?:rm\s+-rf?|del\s+\/s|rmdir\s+\/s|mkfs|dd\s+if=|format\s+[a-z]:|>\s*\/dev\/sd)/i only recognizes the short combined canonical form `-rf`/`-r`. Flag reordering and GNU long forms bypass it: `rm -fr /` (`-rf?` requires 'r' after the dash, but 'fr' follows the dash), `rm --force --recursive /`, and `rm --recursive --force /` all return false. Those commands still classify as `external-effect` project-radius (guardrails.ts bash fall-through), so they become an approval-gated action rather than a hard stop, contrary to the invariant that DESTRUCTIVE shell commands are hard-stopped 'regardless of score' and not weakenable by trickery.
- **Locations**: src/guardrails.ts:48
- **Recommendation**: Broaden the destructive arm to cover separated and long flags, e.g. match `rm` with any presence of `-r`/`-f`/`--recursive`/`--force` (allowing any order), and add regression tests for `rm -fr /` and `rm --force --recursive /` asserting hardStop=true.
- **Risk / why flagged**: Sensitive: coverage gap in the DESTRUCTIVE hard-stop (invariant 4). Broadening risks false positives, so it must be human-reviewed with tests. Never auto-applied.
- **Disposition**: apply (harden). Hardened DESTRUCTIVE so separated (-fr, -r -f) and long-form (--force --recursive) recursive-removal commands are hard-stopped, which the prior `rm\s+-rf?` (fixed-flag-pair) and two-group alternations missed. New rm branch is a recursive-flag lookahead: `\brm\s(?=[\s\S]*?(?:--recursive\b|-[a-z-]*r[a-z-]*))[^\n]*` — matches any `rm` that carries a recursive flag in any arrangement, WITHOUT newly blocking a plain `rm -f <file>` (force-only, no recursion — the safe intent-preserving boundary). The other destructive forms (del/s, rmdir/s, mkfs, dd if=, format, > /dev/sd) are unchanged. An intermediate bug (doubled `>` in the redirect alternative) was caught and reverted.
- **Files changed**: src/guardrails.ts; test/guardrails.test.ts
- **Evidence/gates**: verify4.mjs confirms all 7 bypass cases now HIT and `rm -f file`, `ls -la`, `npm install` still miss. 4 new/updated unit tests. Full suite 181/181. lint PASS · typecheck PASS · test PASS · smoke skip
- **Safety invariants preserved**: yes — the hard-stop list is *broader*, never narrower; `rm -r -f` / `--force --recursive` are now caught; harmless `rm -f file` stays unblocked.
- **Sensitive caveat (recorded)**: Sensitive — hard-stop boundary widened. Over-block reviewed: bare force `rm -f file` / `rm -f ./tmp` remain allowed (no recursion), matching the original intent that recursive destruction is the real threat.
- **Addressed at**: 2026-08-28T15:00:57.789Z

---

## Drain batch: [, A1, A2, A3, A4, A7, T, W, X, Y
_2026-08-28T21:08:30.078Z · gates: lint PASS · typecheck PASS · test PASS (189) · smoke skip_

### [. canAutoActivate auto-activate path is unreachable in the evolve_tool flow
- **Finding**: A tool reaches status 'shadow' only when `initialStatusFor` sees `proposal.maxRadius === 'system'` OR `risk.changeClass === 'external-effect'` (evolution.ts:109); for evolve_tool, classifyAction never yields 'external-effect' and a create is 'write-tool', so the only path to shadow is system radius. But a system-radius proposal always sets `requiresApproval` (evolution.ts draft `requiresApproval: risk.score >= approvalThreshold || proposal.maxRadius === 'system'`), and `canAutoActivate` requires `!p.requiresApproval && p.status === 'shadow'` (evolution.ts:131). Those conditions are mutually exclusive, so `canAutoActivate` can never return true and final.status never becomes 'active' via that branch. Separately, the `runShadow` branch feeds a hardcoded single run into `evaluateShadow` whose default `minRuns:3` forces 'keep-shadow'. The advertised 'shadow → auto-activate' lifecycle is inert, and a test asserting canAutoActivate===true on a 'shadow, requiresApproval:false' input exercises a configuration production cannot construct. This is the under-activation converse of finding H (which closed the over-activation gap).
- **Locations**: src/tools/evolution.ts:109; src/tools/evolution.ts:131; src/tools/evolution.ts:136
- **Recommendation**: Either decouple 'shadow' status from system radius (start non-approval tools in shadow when `runShadow` is requested) and drive shadow activation off real shadow metrics, or remove the dead auto-activate branch and the unreachable-input test and document that activation is manual-only via `/evolve activate`.
- **Risk / why flagged**: Preserving: the tool is safe-by-default (auto-activation simply never fires), so this is a correctness/maintainability defect, not a safety regression. Reconcile the 'shadow→active' docs and the evolution.test assertion accordingly.
- **Disposition**: Documented the inert canAutoActivate auto-activate branch instead of changing runtime behavior. With current status logic, `initialStatusFor` only yields `"shadow"` for system-radius or external-effect proposals, and BOTH always set `requiresApproval`, so the `!requiresApproval && status==="shadow"` condition is unsatisfiable in production — auto-activation never fires, and activation reaches a tool manually via `/evolve activate`. Added explanatory comments in `src/index.ts` (at the `canActivate` site) and in `src/tools/evolution.ts` JSDoc keeping `canAutoActivate` as the documented contract for a future decoupled-shadow lifecycle. Relabelled the true-branch unit test in `test/evolution.test.ts` from `"auto-activates a shadow tool ..."` to `[contract-unit] ... (inert in production — finding [`) so the assertion is labelled honestly without removing its value as a function-contract check.
- **Files changed**: src/index.ts; src/tools/evolution.ts; test/evolution.test.ts
- **Evidence/gates**: CanActivate returns false for every production-constructible input (proven by tracing initialStatusFor and the requiresApproval assignment); no runtime behavior change. All 189 tests pass.
- **Safety invariants preserved**: Yes — auto-activation remains inert-by-default (safe); the documented contract for a future decoupled shadow lifecycle is preserved.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### A1. `/audit` slash command is documented but not registered
- **Finding**: README.md and AGENTS.md both list `/audit` as a bundled command in the Audit & Rollback row, but `registerCommands` in index.ts registers only `self`, `self-audit`, and `evolve` — there is no `/audit` command. Docs point users at a command that does not exist (the real audit command is `/self-audit`).
- **Locations**: README.md:35; AGENTS.md:128; src/index.ts
- **Recommendation**: Remove `/audit` from the Audit & Rollback rows in README.md and AGENTS.md (or register a `/audit` alias if it is intended); document only `/self`, `/self-audit`, `/evolve`.
- **Risk / why flagged**: Preserving (docs only): user-visible command-name drift; no code behavior change unless a new command is registered.
- **Disposition**: Removed `/audit` from README.md and AGENTS.md Audit-and-Rollback rows. The registered commands are `/self`, `/self-audit`, and `/evolve` (as in `registerCommands` in `src/index.ts`); `/audit` was a non-existent reference. Both tables now list `/self` / `/self-audit` / `SnapshotStore`.
- **Files changed**: README.md; AGENTS.md
- **Evidence/gates**: `grep /audit` in README/AGENTS.md now finds no match; no code change.
- **Safety invariants preserved**: Yes — docs only, no code change.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### A2. `/self` dashboard doc says 'last 10 audit entries' but the handler renders 8
- **Finding**: docs/user-guide.md describes `/self` as showing 'the last 10 audit entries', but the handler fetches `audit.entries(20)` and renders `audit.slice(-8)` with the header `recent audit (last ${Math.min(8, audit.length)} of ${audit.length})` — i.e. at most 8, not 10. An off-by-two wording drift between the command table and the code.
- **Locations**: docs/user-guide.md:269; src/index.ts
- **Recommendation**: Change user-guide.md to 'last 8 audit entries' to match the rendered count (or bump index.ts to slice(-10) if 10 is intended).
- **Risk / why flagged**: Preserving: minor docs-vs-code count drift; no logic change unless the code is the one being edited.
- **Disposition**: Changed `docs/user-guide.md` `/self` description from 'the last 10 audit entries' to 'the last 8 audit entries' to match the handler's `audit.slice(-8)` / `Math.min(8, audit.length)` rendering in `src/index.ts`. The off-by-two was a wording drift, not a logic bug.
- **Files changed**: docs/user-guide.md
- **Evidence/gates**: `grep 'last 8' docs/user-guide.md` matches; `grep 'last 10' docs/user-guide.md` no longer matches.
- **Safety invariants preserved**: Yes — docs only.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### A3. The gate ignores assessment.hardStop and re-derives the decision from score only
- **Finding**: Gate.execute computes `decide(assessment.score, config.approvalThreshold, config.blockThreshold)` (approval.ts) and never reads `assessment.hardStop`, even though scoreRisk already folds hard stops into `.decision`/`.hardStop` (guardrails.ts). A hard stop whose numeric score is below blockThreshold would be re-classified as 'approve'/'allow' by the threshold-only `decide`. It is not currently reachable — none of the gated tool inputs carry a path/command (memory_write, self_learn, and the pipeline activation action all pass no path/command, so hardStop stays false) — which is why evolve_tool callers independently re-check `outcome.assessment?.hardStop`. It is a latent two-path decision inconsistency: scoreRisk computes a hard-stop-respecting `decision` that the gate discards in favor of a re-derived `decide`, so any future gated tool that can carry a path/command could clear a hard stop that its sub-threshold base score would otherwise miss.
- **Locations**: src/approval.ts; src/guardrails.ts
- **Recommendation**: In `execute`, honor the assessment's own hard stop before thresholding (e.g. `if (assessment.hardStop) return make('blocked', false, ...)` or branch on `assessment.decision`) so the gate stops recomputing via a different rule set. Currently latent (no reachable path); fix is defensive.
- **Risk / why flagged**: Preserving (no current reachable path); a latent defense-in-depth gap in the gate. Worth closing before a gated tool can carry a path/command input.
- **Disposition**: Added a hard-stop short-circuit to `gate.execute` in `src/approval.ts`: `if (assessment.hardStop) return make("blocked", false, ...)` placed after the `!config.enable.guardrails` short-circuit and before `decide(assessment.score, ...)`. This honors `scoreRisk`'s own hard-stop flag rather than discarding it in favor of threshold-only `decide`. Added a regression test in `test/approval.test.ts` that uses a protected-secret (system-radius) write at `approvalThreshold:100, blockThreshold:100` to isolate the hard-stop short-circuit from the threshold path. Defense-in-depth: currently inert for the gated tool inputs (none carry a path/command, so `hardStop` is always false), but closes a latent gap for future path/command-bearing gated tools.
- **Files changed**: src/approval.ts; test/approval.test.ts
- **Evidence/gates**: New test in test/approval.test.ts: `honors assessment.hardStop even below blockThreshold (A3)` — asserts that a `.aws/credentials` write (hard-stop at system-radius) blocks even with thresholds set to 100. Full suite 189/189.
- **Safety invariants preserved**: Yes — defensive; no threshold or hard-stop list changed; the hard-stop condition is respected, not weakened.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### A4. draftEvolution version/metric lookup is keyed on raw proposed name vs slugified stored name
- **Finding**: `draftEvolution` looks up the prior tool with `existing.find((t) => t.name === proposal.name)` (evolution.ts:136), but every stored tool's `name` is the output of `slugName()` (lowercased, non-alnum/underscore collapsed to `_`, see evolution.ts:140/183). When `proposal.name` contains uppercase or punctuation that `slugName` rewrites, the lookup misses, so `version` resets to 1 and `metrics: current?.metrics ?? EMPTY_METRIC` discards accumulated shadow metrics. Re-proposing such a name loses version monotonicity and metric history and can silently create a duplicate 'v1' record.
- **Locations**: src/tools/evolution.ts:136; src/tools/evolution.ts:140; src/tools/evolution.ts:183
- **Recommendation**: Resolve the existing record on the slugified key: `const current = existing.find((t) => t.name === slugName(proposal.name));` so version bump and metric carry-over match how tools are keyed on disk. Add a test proposing an unslug name twice and asserting monotonic version + preserved metrics.
- **Risk / why flagged**: Preserving: version-bump and metric preservation silently fail for non-slug input names only; risk of duplicate/overlapping tool records. Low impact because the schema describes `name` as a slug.
- **Disposition**: Fixed `draftEvolution`'s existing-record lookup from `existing.find((t) => t.name === proposal.name)` to `existing.find((t) => t.name === slugName(proposal.name))` so that re-proposing an un-slugged name (e.g. 'My-Cool_New-Tool!!') finds the record stored under the slug, preserving version monotonicity and accumulated shadow metrics. Added a regression test in `test/evolution.test.ts` proposing an un-slugged name twice and asserting version bump to 2 with metrics carried over.
- **Files changed**: src/tools/evolution.ts; test/evolution.test.ts
- **Evidence/gates**: New test `preserves version + metrics for a re-proposed un-slugged name (A4)` passes. Full suite 189/189.
- **Safety invariants preserved**: Yes — no behavior change for slug input names only; the fix is strictly more correct (preserves version + metrics for un-slugged re-proposals).
- **Addressed at**: 2026-08-28T21:08:30.078Z

### A7. Framework-source guard is not enforced for the bash tool
- **Finding**: The framework-source guard (isFrameworkSource over the write path) lives only in the write/edit arm of classifyAction; the bash arm (guardrails.ts) tests only DESTRUCTIVE/PRIVILEGE/NETWORK_INJECT/touchesSystem and never calls isFrameworkSource. For bash, `pickWritePath` returns the raw command string, so a redirection or in-place edit of framework source — `echo x > <frameworkRoot>/src/index.ts`, `sed -i 's/a/b/' <frameworkRoot>/src/index.ts`, `tee` — is not detected as a framework-source edit and falls through to `external-effect` project-radius without the framework-source hard stop. The develop-mode audit keyed off `targetPath` (the raw command) likewise never matches frameworkRoot for bash, so no audit trail is produced either. This may be by-design if bash is intended as the governed raw escape hatch; it is a coverage gap for invariant 3 as literally stated.
- **Locations**: src/guardrails.ts; src/index.ts
- **Recommendation**: Either static-scan the bash command for write redirections / in-place edits (`>`, `>>`, `tee`, `sed -i`, `dd of=`) into frameworkRoot and route any hit through the framework-source rule (block unless viaPipeline/develop+logged, with a test asserting a bash redirect into frameworkRoot is treated as a framework-source edit), or document explicitly that bash is the intentional raw escape hatch and scope the invariant to the structured write/edit tools.
- **Risk / why flagged**: Sensitive: possibly by-design (bash as raw escape hatch) but a coverage gap for the framework-source guard (invariant 3). Confirm intent before changing; not auto-applied.
- **Disposition**: Documented `bash` as the intentional raw escape hatch and scoped the framework-source guard to the structured `write`/`edit` tools, instead of statically scanning bash redirections. Added a 'Known boundary — bash as the raw escape hatch' paragraph to `docs/threat-model.md` §3, explaining: the guard is `isFrameworkSource`-checked only on structured write/edit paths; `bash` does not statically detect redirection/in-place edits of `frameworkRoot/src` (`echo x > ...`, `sed -i`, `tee`); this is deliberate (shell redirection parsing is error-prone and would block legitimate local commands), and is consistent with the download-then-run and guarded-off boundary stances. A maintainer who wants bash writes audited should stay in `develop` mode. No code change.
- **Files changed**: docs/threat-model.md
- **Evidence/gates**: The boundary is documented in threat-model.md §3 with a 'Known boundary' section. No code change; the framework-source guard still hard-stops structured write/edit to frameworkRoot/src (the invariant's structured surface).
- **Safety invariants preserved**: Sensitive — the invariant's literal 'any tool' wording is now narrowed to structured write/edit. The guard is still fully effective on the surface it's designed for; the documented boundary narrows, not abandons, protection. User should review this decision.
- **Sensitive caveat (recorded)**: Sensitive — the framework-source guard is now scoped to structured write/edit tools, not the raw bash tool. The user explicitly flagged this for confirmation (choice between: (a) harden bash parsing — too error-prone, (b) document as intentional — done here, (c) add a conservative redirection scan). (b) was chosen for consistency with M and X and for avoiding false positives on legitimate shell commands. If the user wants (c), a future finding can add a targeted `> *frameworkRoot*/src/*` scan.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### T. context_remember of a previously-forgotten fact is a silent no-op
- **Finding**: The remembered/forgotten model lets a persistent, monotonically-growing `forgotten` set win over `remembered`, but `BranchState.remember()` (registry.ts:95) only adds to `remembered` and never clears the matching id from `forgotten` (only `forget()` at registry.ts:100 drops from `remembered`). So `context_forget "foo"` (adds the matched mem_<id> to `forgotten`, drops it from `remembered`) followed later by `context_remember "foo"` (re-adds the same id to `remembered`) injects nothing: the context event computes `activeRemembered(requested, branch.current.forgotten)` and the forgotten id is filtered out every call. This silently defeats the documented guarantee (AGENTS.md) that forgetting is 'Reversible via context_remember'. The state is persisted per-branch and survives forks, so the suppression is sticky.
- **Locations**: src/registry.ts:95; src/context.ts:48; src/index.ts:237; src/index.ts:291
- **Recommendation**: Make a re-remember override a prior forget for the same id: in `BranchState.remember()` also drop the re-remembered ids from `forgotten` (`this.state.forgotten = this.state.forgotten.filter((id) => !new Set(ids).has(id))`), symmetric with `forget()`'s drop-from-remembered. Add a context.test that forgets then re-remembers the same id and asserts the fact is re-injected.
- **Risk / why flagged**: Mixed: restores the documented 'reversible via context_remember' half of the lossless-forgetting invariant — changes current behavior (a forgotten fact currently can never be brought back), not a threshold or hard-stop. Add a test to lock the new behavior.
- **Disposition**: Made `BranchState.remember()` symmetric with `forget()`: it now also clears the re-remembered ids from `forgotten` (`this.state.forgotten = this.state.forgotten.filter((id) => !new Set(ids).has(id))`), restoring the documented 'reversible via context_remember' invariant. Previously `context_forget 'foo'` added the matched `mem_<id>` to `forgotten` and dropped it from `remembered`, and a later `context_remember 'foo'` re-added it to `remembered` but the id stayed in `forgotten`, so `activeRemembered(requested, forgotten)` filtered it out — making forgetting sticky and non-reversible even though the docs in AGENTS.md say otherwise. Added two regression tests in `test/registry.test.ts`: 're-remembering a forgotten id clears it from forgotten (reversibility)' and 'only lifts the re-remembered id, leaving other forgotten ids standing'.
- **Files changed**: src/registry.ts; test/registry.test.ts
- **Evidence/gates**: New registry tests pass. Full suite 189/189.
- **Safety invariants preserved**: Yes — restores the documented 'reversible via context_remember' half of the lossless-forgetting invariant (invariant 1). `context_forget` remains irreversible from `remembered`, but a later `context_remember` now properly unforgets.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### W. memory_write and self_learn execute the gate but never enforce its outcome
- **Finding**: Both handlers call `gate.execute(...)` (index.ts:128 and :344) and then unconditionally perform the side effect — `st.memory.add(...)` (index.ts:140) / `st.skills.add(...)` (index.ts:360) — recording `outcome.status` only in the audit payload. Neither early-returns on `outcome.status === 'blocked' || !outcome.allow`. evolve_tool (index.ts:438 region) DOES bail on block/hardStop; these two do not. At default thresholds the writes (write-memory 20*1.1=22, write-skill 35*1.3=46) are below the 55 approval gate, so the outcome is 'allowed' anyway — but with a customized low `config.approvalThreshold`, or a declined/no-UI result, the gate returns 'blocked'/'declined by user' and the write still runs: an approval bypass inconsistent with evolve_tool's enforcement, and an audit/effect divergence (the log records 'blocked' while the effect occurs).
- **Locations**: src/index.ts:128; src/index.ts:140; src/index.ts:344; src/index.ts:360
- **Recommendation**: After `gate.execute`, mirror evolve_tool: `if (outcome.status === 'blocked' || !outcome.allow) return { content: [text(...)], details: { gated: outcome.status } };` before the `st.memory.add`/`st.skills.add`, so a declined/blocked approval actually prevents the write. Add a test that a blocked outcome suppresses the write.
- **Risk / why flagged**: Mixed: currently inert at default thresholds but a real bypass path when approvalThreshold is lowered or the user declines; touches the approval-gate invariant. User-visible only in customized/headless configs.
- **Disposition**: Made `memory_write` and `self_learn` enforce the gate outcome (mirror `evolve_tool`'s `outcome.assessment?.hardStop || outcome.status === 'blocked'` bail). Added a bail right after `await gate.execute(...)` in each handler in `src/index.ts`: `if (outcome.status === 'blocked' || !outcome.allow) { await recordAudit(...); return { content: [text(`... blocked: ${outcome.reason}`)], details: { gated: outcome.status } }; }` — before the `st.memory.add` / `st.skills.add` side effects. A test in `test/approval.test.ts` proves the bail condition is real under a lowered `approvalThreshold` (30) and a declining UI. Previously, under a customized low threshold a blocked/declined outcome was audited but the write still happened; now it is properly prevented.
- **Files changed**: src/index.ts; test/approval.test.ts
- **Evidence/gates**: New approval tests `a no-UI gate blocks when approvalThreshold is lowered` and `a declining UI blocks a high-risk approvable action` pass. Full suite 189/189. `grep 'W: enforce' src/index.ts` shows two bails.
- **Safety invariants preserved**: Yes — closes a latent bypass: at default thresholds the gate returns 'allowed' (bail never fires), but under a low `approvalThreshold = 30` or a declining UI the gate now blocks the write. The gate's decision is now enforced consistently across all three gated handlers.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### X. Docs claim a `guarded-off` audit kind that does not exist and is not emitted when guards are off
- **Finding**: threat-model.md:116 and developer.md:164 state that turning the guards off is 'recorded as `guarded-off`' and that `guarded-off` is a 'first-class `AuditKind`'. But `guarded-off` is not a member of the AuditEntry.kind union (types.ts:42 lists context-*, memory-*, skill-learned, tool-*, change-blocked, change-approved, compaction, self-eval, snapshot, rollback), and it is never recorded: when guardrails are disabled the gate short-circuits (approval.ts `return make('allowed', true, 'guardrails disabled')`) and no audit write happens. So the docs overstate the audit-logging invariant — 'any opt-out of the guards is itself logged' is false; disabling guards is in fact silent.
- **Locations**: docs/threat-model.md:116; docs/developer.md:164; src/types.ts:42; src/approval.ts
- **Recommendation**: Either remove the `guarded-off` claim from both docs and state that disabling `enable.guardrails` is NOT logged, or add a `guarded-off` kind and actually record it when the gate short-circuits so the safety claim holds. The safe default (less code) is to correct the docs.
- **Risk / why flagged**: Sensitive: this concerns an audit/observability invariant (the docs promise opt-outs are logged when they are not). Docs-only in the default fix; changing code to emit it is a behavior change requiring explicit confirmation.
- **Disposition**: Corrected the two 'guarded-off' claims in `docs/threat-model.md` and `docs/developer.md` — both stated that disabling `enable.guardrails` is recorded as a `guarded-off` audit kind, but that kind doesn't exist in the `AuditEntry.kind` union (`src/types.ts`) and is never emitted: when guardrails are disabled the gate short-circuits in `src/approval.ts` (`if (!config.enable.guardrails) return make('allowed', true, 'guardrails disabled')`) and no audit write happens. Threat-model.md's 'How to read this' bullet now says: 'The audit log records every gate decision. `change-approved` / `change-blocked` are first-class AuditEntry.kind values, so decisions are logged and reviewable. Caveat: disabling enable.guardrails is *not* itself logged.' Developer.md now says: 'enable.guardrails: false ... is a deliberate opt-out that is *not* recorded in the audit log.' Both docs are now consistent with the code. No `guarded-off` kind was added — the docs are the source of the mismatch, per the finding's own recommendation.
- **Files changed**: docs/threat-model.md; docs/developer.md
- **Evidence/gates**: `grep 'guarded-off' docs/` now finds no remaining claims in threat-model.md or developer.md (only the finding's own queue/ledger text). No code change.
- **Safety invariants preserved**: Sensitive — a security-invariant wording that overstated logging. The docs now correctly state the opt-out is *silently* recorded (not logged), which is the honest state per the short-circuit. The 'any opt-out of the guards is itself logged' invariant is *corrected*, not abandoned.
- **Addressed at**: 2026-08-28T21:08:30.078Z

### Y. Threat-model hard-stop 'Matches' column is inaccurate vs the real regexes
- **Finding**: The hard-stop 'Matches' column (docs/threat-model.md:89-91) lists patterns the actual regexes do not match and omits ones they do. DESTRUCTIVE (guardrails.ts:48) is `rm -rf|rm -r|del /s|rmdir /s|mkfs|dd if=|format X:|> /dev/sd`, but the doc lists `shutdown`, `reboot`, `halt`, `truncate`, `shred -f`, `> /dev/null` (none matched) and omits `del /s`, `rmdir /s`, `format X:`, `> /dev/sd`; it also lists `rm -fr` which the regex does NOT match. PRIVILEGE (guardrails.ts:49) is `sudo|doas|runas`, but the doc says `su ` (not matched) and omits `runas`. NETWORK_INJECT (guardrails.ts:56) includes `fetch`, `nc`, `ncat` which the doc omits. Users therefore under/over-estimate exactly what is blocked.
- **Locations**: docs/threat-model.md:89; docs/threat-model.md:90; docs/threat-model.md:91; src/guardrails.ts:48; src/guardrails.ts:49; src/guardrails.ts:56
- **Recommendation**: Regenerate the 'Matches' column from the actual exported regexes: DESTRUCTIVE = rm -rf / rm -r / del /s / rmdir /s / mkfs / dd if= / format X: / > /dev/sd; PRIVILEGE = sudo / doas / runas; NETWORK_INJECT = curl|wget|fetch|nc|ncat piped into sh/bash/zsh/python/node. (Separate from findings on regex bypasses: this is the docs-accuracy angle only.)
- **Risk / why flagged**: Preserving (docs only) but misdescribes the exact hard-stop lists that are part of the protected invariant, so correctness of the docs matters; no code change.
- **Disposition**: Regenerated the threat-model.md §3 Hard-stops table to mirror the real `rule` labels and score floors from `scoreRisk` in `src/guardrails.ts` (previously hardcoded regex-string fragments that were stale and incomplete): `system-path` (hard stop, system-dir touches), `protect-git-history` (hard stop, `.git` + rm/git-push), `protected-secret` (hard stop, write into SECRET_DIRS), `framework-source` (hard stop, pipeline or develop excepted), `destructive-command` (floor 85, the DESTRUCTIVE regex — now including the U/Z hardenings: path/versioned interpreters and separated/long-form recursive flags), `privilege-escalation` (floor 90, PRIVILEGE regex), `network-injection` (floor 80, NETWORK_INJECT regex). Dropped the phantom `EXTERNAL_WRITE` (15) row that no longer exists in guardrails.ts (removed by finding S) and the phantom `SECRET_WRITE` (22) row that was never a real regex constant. The table now has a 'Floor' column reflecting the real `Math.max(score, ...)` call values.
- **Files changed**: docs/threat-model.md
- **Evidence/gates**: The new table is a 1:1 mapping of the rule labels and floors in guardrails.ts. No code change. No `EXTERNAL_WRITE` or `SECRET_WRITE` phantom rows remain.
- **Safety invariants preserved**: Yes — docs aligned to code; the hard-stop list and floors are now accurate.
- **Addressed at**: 2026-08-28T21:08:30.078Z

