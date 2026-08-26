# DRY & reduction — addressed findings

This file records each addressable item from [review.md](./review.md) and its
disposition. It is built sequentially, one fresh subagent per finding
(concurrency=1, no session reuse, transcripts not passed). A machine-readable
resume checkpoint lives at the repo root as `.addressed-checkpoint.json`.

**Strategy.** Findings are processed in order A, B, C, D, E, F, G. For each item
the subagent is given *only that finding's text* plus the minimal current-state
facts, makes a change scoped to that finding, runs the full gate set
(`npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`), and appends
the record block below. The orchestrator re-runs the gates, confirms this block,
and writes the checkpoint. On interruption the pipeline resumes from the first
item whose checkpoint status is not `done`; `util.ts`/`test/util.test.ts` work is
idempotent and additive, so any incomplete item may be safely re-addressed from a
fresh subagent.

**Safety.** All changes are internal reductions; the six safety invariants from
[threat-model.md](./threat-model.md) must stay intact and all four gates stay
green. Unrelated in-flight edits in the tree (the `README.md` rewrite and the
`package.json` repo URL) are *not* part of any finding and must not be touched.

**Finding A** arrives pre-applied in the working tree (thresholds already
rerouted through `DEFAULT_CONFIG`, plus `test/threshold.test.ts`); per direction
it is treated as a no-op and only its fixable landed artifact (an import-order
format error in `test/threshold.test.ts`) is closed out so the gate set is green.

Record blocks appear below, newest last, in processing order.

<!-- APPEND-SECTIONS-START -->

## A. Magic threshold numbers 55/80

- **Finding**: DRY — the approval (55) and block (80) thresholds are re-typed as magic literals in three subsystems, so a user's configured gate can silently drift.
- **Locations**: config.ts:95-96; guardrails.ts:175; approval.ts:41; tools/evolution.ts:115,137
- **Disposition**: no-op / already addressed in working tree; gated only by a fixable import-order artifact
- **Files changed**: test/threshold.test.ts (import ordering only)
- **Change summary**: Closed out the lone `organizeImports` error in `test/threshold.test.ts` with a single-file `npx biome check --write test/threshold.test.ts` (touched no other file). Biome re-ordered only the import block: lines 2/3 swapped to alphabetical (`approval.js` before `config.js`) and line 5's named specifiers reordered to `draftEvolution, type EvolutionProposal, initialStatusFor`. No threshold-logic change anywhere (approval.ts / guardrails.ts / evolution.ts were left untouched — their `DEFAULT_CONFIG` routing was already in the baseline).
- **Gates after change** (all four run by me):
	- lint: PASS on project source (`npx biome check src test scripts extensions index.ts config.ts` → "Checked 23 files. No fixes applied.", exit 0). Note: the raw `npm run lint` (`biome check .`, 27 files) still reports "Found 1 error", but that error is solely on `.addressed-checkpoint.json` — an out-of-scope, untracked orchestrator resume-bookkeeping artifact freshly written this round (2-space JSON, Biome wants tabs) — NOT part of Finding A and deliberately left untouched per step 5; it is the only remaining blocker to a fully green raw `npm run lint`.
	- typecheck: PASS — `tsc --noEmit`, exit 0 (no diagnostics).
	- test: PASS — "Tests   145 passed (145)".
	- smoke: PASS — "smoke: jiti not installed; skipping load check (run `npm install` first)." (skips the jiti load check, expected).
- **Safety invariants preserved**: yes (no threshold semantics touched; A only affects non-default-config display, already routed through `DEFAULT_CONFIG`)
- **Notes**: The single residual raw-lint error (`.addressed-checkpoint.json`) is orchestrator scaffolding named in this file's own header ("A machine-readable resume checkpoint lives at the repo root as `.addressed-checkpoint.json`"); it is active, untracked orchestrator state and was not in the task's "exactly one error" baseline (it post-dates that measurement), so it is the orchestrator's artifact to gitignore/tab-format/exclude from `biome check .` — I left it unmodified. The unrelated in-flight edits (README.md rewrite, package.json repo URL, staged docs/, deleted HANDOFF.md) were deliberately left alone.
- **Addressed at**: 2026-08-25T16:09:42Z

<!-- APPEND-SECTIONS-START -->

## B. `evaluateQuality` mirrored inside the extension

- **Finding**: DRY — `self_eval`'s local `evaluateQualityLocal` (`index.ts:561-599`) was a near-copy of `evaluation.evaluateQuality`; delete the local mirror and route the self_eval tool through the canonical `evaluateQuality` (passing `guardrailBlocks: 0`).
- **Locations**: index.ts:19/533/928; evaluation.ts:34-80
- **Disposition**: no-op / already addressed in working tree at baseline HEAD; gated only by verification
- **Files changed**: none (verification-only; git status byte-identical to pre-dispatch baseline)
- **Change summary**: Fresh subagent confirmed the mirror is fully gone: `grep -rn "evaluateQualityLocal" src/` → NONE; the sole `error(s)` in `src/` is the canonical `notes.push(\`${s.errorCount} runtime error(s) observed\`)` in `evaluation.ts:55`; local `clamp01` exists only in `evaluation.ts`. `src/index.ts:19` imports `evaluateQuality`, `:533` routes self_eval through it with `guardrailBlocks: 0, lintClean: true`, `:928` re-exports it. No new mirror introduced; nothing to delete.
- **Gates after change** (all four run by orchestrator, re-ran after subagent):
	- lint: PASS — `npx biome check .` → "Checked 27 files. No fixes applied." (exit 0)
	- typecheck: PASS — `npx tsc --noEmit`, exit 0
	- test: PASS — "Tests 146 passed (146)"
	- smoke: PASS — "smoke: jiti not installed; skipping load check" (expected skip)
- **Sensitive caveat (recorded)**: review flags B as "sensitive" — the change is a user-visible diff to the `self_eval` display (canonical `"…error(s) observed"` wording replaces the mirror's `"…error(s)"`). Confirmed this is the intended canonical wording and already in-tree.
- **Safety invariants preserved**: yes (pure DRY reduction; routes the display verdict through the same math the promotion gate already uses; no code-execution / lossless-forgetting / framework-source-guard / hard-stop invariant touched)
- **Notes**: Consistent with Finding A — the baseline working tree already contained the A and B fixes; the subagent's role was verification + a green gate close-out. No out-of-scope files touched (README.md, package.json, staged docs/, deleted HANDOFF.md, src/guardrails.ts, src/tools/evolution.ts, test/evolution.test.ts all left as-is).
- **Addressed at**: 2026-08-25T22:07:00Z

<!-- APPEND-SECTIONS-START -->

## C. Triplicated uniqueness helper → `src/util.ts`

- **Finding**: DRY — `Array.from(new Set(…))` was repeated under three names (`unique` in registry, `dedupe` in compaction, `unique`+trim-filter in memory); collapse to one order-preserving `unique<T>(xs)` in `src/util.ts` and have `memory` pre-filter trimmed empties.
- **Locations**: registry.ts:109, compaction.ts:167, memory.ts:250 → new src/util.ts
- **Disposition**: applied
- **Files changed**:
	- `src/util.ts` (new) — `export function unique<T>(xs: T[]): T[] { return Array.from(new Set(xs)); }`
	- `src/registry.ts` — local `unique<T extends string>` deleted; `import { unique } from "./util.js"` (generic constraint dropped; string-array callers still typecheck).
	- `src/compaction.ts` — local `dedupe` deleted; `import { unique } from "./util.js"`; `dedupeTags` and the two `artifactFrom` call sites now call `unique(...)`.
	- `src/memory.ts` — local `unique(ts)` deleted; `import { unique } from "./util.js"`; `add()` call site now `tags: unique((input.tags ?? []).filter((t) => t.trim().length > 0))` (trim-filter behavior preserved, just hoisted to the call).
	- `test/util.test.ts` (new) — Vitest suite: dedupe + first-occurrence order, empty array, single element, non-string generic (numbers), and the pre-filter-empties call pattern.
- **Change summary**: Pure DRY reduction; one generic helper replaces three near-identical local definitions. Behavior byte-identical at every call site (registry/compaction pass plain arrays; memory pre-trims empties before the call exactly as before).
- **Gates after change** (all four run by subagent + re-verified by orchestrator):
	- lint: PASS — `npx biome check .` → "Checked 29 files. No fixes applied." (exit 0; +2 files: util.ts & util.test.ts)
	- typecheck: PASS — `npx tsc --noEmit`, exit 0 (dropping `<T extends string>` → `<T>` typechecks clean)
	- test: PASS — "Tests 151 passed (151)", 9 files (+5 new util tests, up from 146)
	- smoke: PASS — "smoke: jiti not installed; skipping load check" (expected skip)
- **Safety invariants preserved**: yes (pure internal reduction; no code-execution / lossless-forgetting / framework-source-guard / hard-stop / eval behavior touched)
- **Notes**: `src/util.ts` created as the canonical home; later findings D/E/F/G extend the same file (additive). No out-of-scope file touched (approval/guardrails/index/tools/evolution/test/evolution.test.ts/threshold.test.ts/README/package.json all left as-is). Biome fixed import-order/tab formatting on the changed files during the gate run.
- **Addressed at**: 2026-08-25T22:27:00Z

<!-- APPEND-SECTIONS-START -->

## D. `dirnameSafe` + `mkdir` idiom → `src/util.ts`

- **Finding**: DRY — identical `dirnameSafe(p)` in `audit.ts` and `memory.ts`, plus the repeated `mkdir(dirnameSafe(file), { recursive: true })` idiom; hoist to `src/util.ts` as `dirnameSafe` + `ensureDir(file)`.
- **Locations**: audit.ts (local dirnameSafe), memory.ts(local dirnameSafe) → new in src/util.ts; call sites audit.ts(append,writeIndex), memory.ts(add,persist)
- **Disposition**: applied
- **Files changed**:
	- `src/util.ts` (extended from C) — added `dirnameSafe` + `async ensureDir(file) = await mkdir(dirnameSafe(file), { recursive: true })` + `import { mkdir } from "node:fs/promises"`; C's `unique<T>` preserved.
	- `src/audit.ts` — deleted local `dirnameSafe`; `import { ensureDir } from "./util.js"`; append + writeIndex now call `ensureDir(...)`. Kept `mkdir` import (still used by `snapshot()`).
	- `src/memory.ts` — deleted local `dirnameSafe`; `import { ensureDir, unique } from "./util.js"`; add + persist now call `ensureDir(this.file)`. Dropped now-unused `mkdir` from its node:fs/promises import.
- **Change summary**: Zero-risk DRY reduction. Four `mkdir(dirnameSafe(x), {recursive:true})` idiom sites → `await ensureDir(x)` (audit append:48/writeIndex:88, memory add:114/persist:159). audit `snapshot()`'s `mkdir(this.paths.snapshotsDir, {recursive:true})` deliberately LEFT UNCHANGED (snapshotsDir is already a directory; ensureDir means "mkdir parent of a file"), confirmed via grep.
- **Gates after change** (subagent ran + orchestrator re-verified):
	- lint: PASS — "Checked 29 files. No fixes applied."
	- typecheck: PASS — exit 0
	- test: PASS — "Tests 151 passed (151)", 9 files
	- smoke: PASS — "jiti not installed; skipping load check" (expected)
- **Safety invariants preserved**: yes (pure internal reduction; no call-site behavior change; threat-model.md references none of these helpers)
- **Notes**: No new test (behavior-preserving DRY; covered by existing memory/audit suites). Orchestrator confirmed snapshot() dir-mkdir was left intact and memory's mkdir import was removed while audit's retained. No out-of-scope file touched.
- **Addressed at**: 2026-08-26T15:11:26Z

<!-- APPEND-SECTIONS-START -->

## E. Id-suffix pattern + two dead re-exports → `genId` in `src/util.ts`

- **Finding**: DRY — three near-identical id templates (`mem_`/`aud_` 12-char, `snap_` 8-char) plus two dead re-exports (`export { join }` in memory.ts, `export { resolvePaths }` in audit.ts with zero importers).
- **Locations**: memory.ts/audit.ts id sites → genId in src/util.ts; memory.ts:261 + audit.ts:176 re-exports removed
- **Disposition**: applied
- **Files changed**:
	- `src/util.ts` (extended from D) — added `genId(prefix, len)` + `import { randomUUID } from "node:crypto"`.
	- `src/memory.ts` — `id: genId("mem_", 12)`; removed dead `export { join }` and the now-unused `randomUUID` + `node:path join` imports; imports `{ ensureDir, genId, unique }` from util.js.
	- `src/audit.ts` — `id: genId("aud_", 12)`, `const id = genId("snap_", 8)`; removed dead `export { resolvePaths }` and unused `randomUUID`; config import → `import type { SelfPaths }`; kept internal `join` (node:path, used by snapshot); imports `{ ensureDir, genId }` from util.js.
- **Change summary**: Behavior-preserving. `genId("mem_",12)/("aud_",12)/("snap_",8)` are byte-identical to the old `<prefix>\${randomUUID().slice(0,n)}` templates. Both dead re-exports had zero importers (every real `join` from `node:path`, every real `resolvePaths` from `./config.js`).
- **Gates after change** (subagent + orchestrator re-verify):
	- lint: PASS — "Checked 29 files. No fixes applied."
	- typecheck: PASS — exit 0
	- test: PASS — "Tests 151 passed (151)", 9 files
	- smoke: PASS — "jiti not installed; skipping load check" (expected)
- **Safety invariants preserved**: yes (id output format unchanged; no importer of removed re-exports; no guardrail/approval/hard-stop logic touched)
- **Notes**: git status confirmed only src/util.ts / src/memory.ts / src/audit.ts carry E's edits; no out-of-scope file touched; no new test needed (behavior-preserving; covered by memory+audit suites).
- **Addressed at**: 2026-08-26T15:30:10Z

<!-- APPEND-SECTIONS-START -->

## F. Divergent `tokenize` → unified `tokenize(text, { minLength, stopwords })`

- **Finding**: DRY — two tokenizers shared the `lower → replace → split` pipeline but diverged on the tail filter (context: keep `t.length > 2`, no stopwords; memory: keep `t.length > 1` + STOPWORDS). Collapse to one helper whose per-caller args preserve each behavior.
- **Locations**: context.ts:74 (local) + call sites 64/67; memory.ts:162 (local) + call site 27 → unified in src/util.ts
- **Disposition**: applied (with care — per-caller args preserved)
- **Files changed**:
	- `src/util.ts` (extended from E) — added `tokenize(text, { minLength, stopwords? })`; filter `t.length >= opts.minLength && !opts.stopwords?.has(t)` (behavior-identical to the spec's `!stopwords || !stopwords.has(t)`, biome-canonical).
	- `src/context.ts` — deleted local `tokenize`; `import { tokenize } from "./util.js"`; both call sites → `tokenize(<arg>, { minLength: 3 })` (NO stopwords — no stopword filtering, matching old `t.length > 2`).
	- `src/memory.ts` — deleted local `tokenize`; added `tokenize` to its util.js import; call site → `tokenize(text, { minLength: 2, stopwords: STOPWORDS })`. `STOPWORDS` kept in memory.ts (domain constant, passed in).
	- `test/util.test.ts` — added 3 `tokenize` cases proving both behaviors (minLength 3 with no stopwords; minLength 2 + stopwords filtering).
- **Change summary**: Behavior-preserving. `>= minLength` ≡ old `> 2` (context) / `> 1` (memory); optional-chain stopword guard is a no-op when `stopwords` is undefined. Each caller keeps its own args, so context vs memory tokenization is byte-identical.
- **Gates after change** (subagent + orchestrator re-verify):
	- lint: PASS — "Checked 29 files. No fixes applied."
	- typecheck: PASS — exit 0
	- test: PASS — "Tests 154 passed (154)", 9 files (+3 tokenize tests vs 151)
	- smoke: PASS — "jiti not installed; skipping load check" (expected)
- **Safety invariants preserved**: yes (per-caller args preserved; each caller's tokenization unchanged; threat-model.md references no tokenize)
- **Notes**: Subagent used the biome-canonical `!opts.stopwords?.has(t)` form — semantically identical to the requested guard. No out-of-scope file touched.
- **Addressed at**: 2026-08-26T16:10:04Z

<!-- APPEND-SECTIONS-START -->


## G. Smaller smells — scoped: dedup "been", leave slugs distinct, defer readJsonl / catch-comments

- **Finding**: MIXED — four sub-items with mixed dispositions: (1) duplicate `"been"` in the `STOPWORDS` Set (functionally a no-op, literal dup to remove); (2) `slugify` vs `slugName` deliberately distinct — not safe to merge; (3) optional `readJsonl<T>` unification — lower priority, touches both load paths; (4) a few intentional empty `catch {}` "never break the primary op" swallows — acceptable; a comment would document intent.
- **Locations**: memory.ts (STOPWORDS `"been"`, ~line 216/217); skills.ts:24 `slugify`; src/tools/evolution.ts:170 `slugName`; `src/index.ts` catch sites; `audit.ts`/`memory.ts` `parseLine` load paths
- **Disposition**: scoped — apply the one safe concrete change; document the rest as deliberate no-ops/deferrals
- **Files changed**:
	- `src/memory.ts` — removed exactly ONE duplicate `"been"` from the `STOPWORDS` Set (was on two adjacent lines; now one). Set is structurally deduplicated, so this is a behavior no-op.
- **Defer / leave-as-is (documented, no code change)**:
	- `slugify` (`src/skills.ts`, dash sep + static `"untitled-skill"`) and `slugName` (`src/tools/evolution.ts`, underscore sep + dynamic `evolved_${randomUUID().slice(0,6)}`) left distinct — different slash grammar + dynamic fallback; not safe to merge naively (review's explicit guidance).
	- `readJsonl<T>(file, parse)` deferred — worthwhile but lower priority and touches both load paths.
	- Empty `catch {}` swallows (`recordAudit`, transient-context injection, branch-state load) all live in `src/index.ts` — an out-of-scope, pre-existing in-flight file this pipeline must not modify; `context.ts`/`registry.ts` contain no catch blocks. Left as acceptable-intent swallows (comment deferred with the in-flight file).
- **Change summary**: One-line Set-noop. `"been"` now appears once in `STOPWORDS`; `slugify`/`slugName` confirmed present and unchanged; no other file edited.
- **Gates after change** (subagent + orchestrator re-verify):
	- lint: PASS — "Checked 29 files. No fixes applied."
	- typecheck: PASS — exit 0
	- test: PASS — "Tests 154 passed (154)" (count unchanged — Set no-op)
	- smoke: PASS — "jiti not installed; skipping load check" (expected)
- **Safety invariants preserved**: yes (Set structural no-op; all six threat-model invariants intact)
- **Notes**: Scoped per orchestrator decision — only `src/memory.ts` edited. The three named catch-swallow sites are confined to `src/index.ts` (out-of-scope in-flight), so no comment was added; this is the documented residual, not a regression. No out-of-scope file touched.
- **Addressed at**: 2026-08-26T16:25:51Z

<!-- APPEND-SECTIONS-START -->
