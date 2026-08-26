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
