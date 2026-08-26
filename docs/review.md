# DRY & reduction review

A point-in-time static review of the framework's own source (`src/` and
`src/tools/evolution.ts`) for **duplication (DRY)** and **reduction**
opportunities. It catalogues where the same logic or the same magic value is
repeated, ranks the findings, and recommends a safe order of change — without
modifying anything. The six safety invariants the change must preserve are
[Threat model](./threat-model.md); the quality gates that must stay green are in
[Developer guide](./developer.md).

> **Status: report only.** No code was changed producing this review. The
> findings below are recommendations; A and B in particular touch gating/disply
> semantics and should be approved explicitly before being applied.

---

## 0. Baseline (verified green)

The review started from a clean baseline. All four gates pass:

| Gate | Command | Result |
| --- | --- | --- |
| Lint + format | `npm run lint` (`biome check .`) | Clean, no fixes applied |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | Clean |
| Test | `npm test` (`vitest run`) | 140 tests pass |
| Smoke | `npm run smoke` | Runs; skips the `jiti` load check when `jiti` is absent |

Two observations that do **not** need to change: the smoke skip is expected
(`npm install --ignore-scripts` leaves `jiti` out), and the `test/` suite
imports only the public subsystem APIs — none of the internal helpers this
review proposes to extract are referenced by tests, so extracting them is
test-coupling-safe.

---

## 1. Recommendation at a glance

| # | Finding | Location(s) | Behavior |
| --- | --- | --- | --- |
| **A** | Thresholds `55`/`80` re-typed by hand | `guardrails.ts:175`, `approval.ts:41`, `evolution.ts:115,137` | Sensitive |
| **B** | `evaluateQuality` mirrored in the extension | `index.ts:561-599` | Sensitive |
| **C** | Triplicated `unique`/`dedupe` | `registry.ts:109`, `compaction.ts:167`, `memory.ts:250` | Preserving |
| **D** | `dirnameSafe` + mkdir idiom copied | `memory.ts:264`, `audit.ts:175` | Preserving |
| **E** | Id-suffix pattern + two dead re-exports | `memory.ts:103,269`, `audit.ts:34,92,180` | Preserving |
| **F** | Divergent `tokenize` pipeline | `context.ts:74`, `memory.ts:163` | Preserving* |
| **G** | Smaller smells (dup token, slugs, `parseLine`, empty catches) | various | Mixed |

\* Preserving only if each caller keeps its own min-length / stopword args.

**Suggested order.** Do **C + D + E (+ the `been` part of G)** first as one
coherent, behavior-preserving pass that lands a new `src/util.ts` plus a
`test/util.test.ts`. Treat **A** and **B** separately, since they cross the
gating/display semantics and are better approved explicitly.

---

## 2. Findings

### A. Magic threshold numbers `55` / `80` (highest impact — gating-adjacent)

`DEFAULT_CONFIG.approvalThreshold = 55` and `blockThreshold = 80`
(`config.ts:95-96`) are re-typed as literals in three subsystems, so they
silently drift from a user's configured gate:

- `guardrails.ts:175` — `scoreRisk`'s `decision` field hardcodes `score >= 55`
   and does not consult the configured block threshold.
- `approval.ts:41` — `buildPrompt` computes the display label
   `score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW"`.
- `tools/evolution.ts:115` `initialStatusFor` hardcodes `score >= 80`;
   `:137` `draftEvolution` hardcodes `requiresApproval: risk.score >= 55`.

All three are correct *at the defaults*, but a non-default config will not reach
these sites — a latent mismatch. Note that the runtime gating path already
routes through `Gate.execute` → `decide(score, config.approvalThreshold,
config.blockThreshold)`, so `scoreRisk`'s `decision` is currently
**display-only** (consumed by `self_eval`). That lowers the risk, but the
hardcodes are a genuine duplication of `DEFAULT_CONFIG`.

**Fix.** Route every site through `DEFAULT_CONFIG` (or a shared `thresholds`
object) instead of re-typing `55`/`80`.

**Risk / why flagged.** Sensitive: it changes the risk-label and evolution
status/requiresApproval logic *only* for non-default configs, and `decision` is
part of the displayed verdict. Approve explicitly.

### B. `evaluateQuality` mirrored inside the extension (≈ 40 lines)

`self_eval`'s local `evaluateQualityLocal` (`index.ts:561-599`) is a near-copy
of `evaluation.evaluateQuality` (`evaluation.ts:34-80`): both compute the
pass-rate weighting, apply `score -= Math.min(0.5, errCount * 0.1)`, clamp to
`[0,1]`, and return `safe: score >= 0.6 && errorCount === 0`. The deltas are
cosmetic-plus-one: the mirror omits the `guardrailBlocks` signal and phrases
the note as `"…error(s)"` rather than the canonical `"…error(s) observed"`.
An inline comment justifies the copy ("so the tool stays self-contained").

**Fix.** Delete the local mirror and import `evaluateQuality` from
`evaluation.ts` (passing `guardrailBlocks: 0` when the self-eval signals do not
supply it).

**Risk / why flagged.** Sensitive: it changes the `self_eval` *display* text.
Behavior of the score is otherwise equivalent, but the changed wording is a
user-visible diff — approve explicitly.

### C. Triplicated uniqueness helper (behavior-preserving)

`Array.from(new Set(…))` appears three times, under three names:

- `registry.ts:109-110` — `unique<T>(xs)` (generic, plain).
- `compaction.ts:167-168` — `dedupe(xs)` (plain).
- `memory.ts:250-251` — `unique(ts)` with an extra `ts.filter(t => t.trim().length > 0)`.

The first two are byte-identical; the third adds a trim filter.

**Fix.** One `unique<T>(xs)` in a new `src/util.ts`; `memory` becomes
`unique(xs.filter((t) => t.trim().length > 0))`.

### D. `dirnameSafe` + the `mkdir` idiom copied (behavior-preserving)

- `memory.ts:264-267` and `audit.ts:175-178` define an identical
   `dirnameSafe(p)`: `const idx = p.lastIndexOf("/"); return idx === -1 ? "." : p.slice(0, idx);`.
- The call `mkdir(dirnameSafe(file), { recursive: true })` repeats in
   `memory` (`add`, `persist`) and `audit` (`append`, `writeIndex`,
   `snapshot`).

**Fix.** One `dirnameSafe` plus an `ensureDir(file) = mkdir(dirnameSafe(file),
{ recursive: true })` in `src/util.ts`; the four call sites call `ensureDir`.
This is a clean, zero-risk DRY win.

### E. Id-suffix pattern + two dead re-exports (behavior-preserving)

Two distinct but safe reductions:

- **Id generation.** `` `mem_${randomUUID().slice(0, 12)}` ``
   (`memory.ts:103`), `` `aud_${…12}` `` (`audit.ts:34`), and
   `` `snap_${…8}` `` (`audit.ts:92`) are the same pattern with a prefix and
   length. Collapse to `genId(prefix, len)` in `src/util.ts`.
- **Dead re-exports.** `export { join }` (`memory.ts:269`, re-exporting
   `node:path`) and `export { resolvePaths }` (`audit.ts:180`, re-exporting
   `./config.js`) have **no importers** — every real use imports from
   `node:path` / `./config.js` directly. Both can be removed.

### F. Divergent `tokenize` (behavior-preserving, with care)

Two tokenizers share the `lower → replace(/[^\p{L}\p{N}\s]+/g, " ") →
split(/\s+/)` pipeline but then diverge on the tail filter:

- `context.ts:74-80` keeps `t.length > 2` (i.e. ≥ 3), no stopwords.
- `memory.ts:163-169` keeps `t.length > 1` (i.e. ≥ 2) and filters
   `STOPWORDS`.

**Fix.** One `tokenize(text, { minLength, stopwords })` in `src/util.ts`;
`context` calls it with `{ minLength: 3 }` and `memory` with
`{ minLength: 2, stopwords: STOPWORDS }`. Preserving **only** if each caller
passes its own args — the two are intentionally semantically different.

### G. Smaller smells

- **Duplicate token.** `STOPWORDS` is a `Set` but lists `"been"` twice
   (`memory.ts:225-226`). Functionally a no-op (it is a `Set`), but a literal
   duplicate to remove.
- **Slug grammar, deliberately distinct.** `skills.ts:24` `slugify`
   (dash separator, static `"untitled-skill"` fallback) vs the evolved-tool
   `slugName` (underscore separator, dynamic `evolved_${randomUUID().slice(0,6)}`
   fallback) look mergeable but use **different** slash grammar and a dynamic
   fallback. Not safe to merge naively; leave them as distinct domain
   helpers. If a parameterized `slug(input, { sep, maxLen })` is wanted, it
   must also carry a `keepUnderscore` option and a per-call fallback — optional,
   not recommended now.
- **`parseLine` asymmetry.** `audit.ts:167`'s generic `parseLine<T>` (bare
   `JSON.parse`) vs the validating parser in `memory` are intentionally
   different (memory validates content/embedding/weight). A shared
   `readJsonl<T>(file, parse)` could still unify the `read → split("\n") →
   filter(blank) → map(parse) → filter(null)` idiom that repeats in
   `audit.entries` and `memory`'s loader, leaving each store its own parse.
   Worthwhile but it touches both load paths — lower priority.
- **Empty `catch {}` blocks.** A few silent catches (`recordAudit`, the
   transient-context injection, branch-state load) are intentional
   "never break the primary operation" swallows. They are acceptable; a
   one-line comment on each would document the intent.

---

## 3. How to verify after any change

Whichever subset is applied, run the full gate set from the
[Developer guide](./developer.md) and keep the six invariants in
[Threat model](./threat-model.md) intact:

```bash
npm run lint       # biome check .
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run smoke      # node scripts/smoke.mjs
```

Add or update a `test/util.test.ts` for the new helpers, and confirm the
existing suites still pass (the public APIs they import are unchanged; only
internal helpers move into `util.ts`).
