# Findings ledger

This is the **append-only record** of findings that have been addressed. Each
section is one addressed finding: its text (carried over from the
[queue](./queue.md) so nothing is lost), the recommended fix, the disposition,
the gates that were run, and the files that changed. Entries are appended in
processing order, newest last. The machine resume state lives alongside in
`.checkpoint.json`; the **how-to** lives in [usage.md](./usage.md).

All items in this ledger are **addressed**; the
[queue](./queue.md) is empty. The six safety invariants (see
[threat model](../threat-model.md)) were preserved by every entry, and each `done`
entry below records all four gates green.

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

