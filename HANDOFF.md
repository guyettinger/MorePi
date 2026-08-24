# HANDOFF — MorePi (self-modifying framework for pi)

> Purpose: let a **new session** resume implementation from where this one stopped.
> Snapshot: after scaffold + near-complete `src/` implementation, mid typecheck cleanup.
> `git init` is done, **nothing committed yet**.

---

## 1. Goal (from the user)

Implement `RESEARCH-self-modifying-framework.md` as a **pi extension package** in
`/Users/guyettinger/Projects/MorePi`. Requirements:
- A real, installable pi extension package (not just prose).
- Follow recommended **TypeScript / pi project standards**.
- Use web research (pi-web-access) for the recommended TS + pi setup — **done** this session.

On top of pi's native session/branch system, the framework adds six capabilities:
context control, persistent memory, self-learning skill generation, governed tool
evolution, evaluation-based promotion, audit-logged rollback. Full design:
`RESEARCH-self-modifying-framework.md`.

---

## 2. Run / verify (IMPORTANT — env quirks)

Node **v22.22.1**, pi **v0.84.2**. All five `@earendil-works/*` packages exist on npm at
`0.84.2` (verified `npm view`). `typebox` resolves to `1.3.x`, `jiti` `2.7.0`.

```bash
cd /Users/guyettinger/Projects/MorePi

# INSTALL: the system npm cache (~/.npm) has an ownership/EACCES problem that makes
# `npm install` fail on `rename`. Work around it with a temp cache. Also use
# --ignore-scripts (pi-coding-agent has heavy install scripts; pi's AGENTS.md recommends it).
npm install --ignore-scripts --no-audit --no-fund --cache /tmp/morepi-npm-cache

# GATES (all must be green to call it done):
npm run typecheck     # tsc --noEmit
npm run lint          # biome check
npm test              # vitest run
npm run smoke         # node scripts/smoke.mjs (loads entry via jiti w/ a stub ExtensionAPI)
```

Notes:
- `tsc` is **7.0.2** (strict, `noUncheckedIndexedAccess`, erasable-syntax-only,
   `moduleResolution: Bundler`, `verbatimModuleSyntax`, `noEmit`).
- Pi loads `.ts` via **jiti** (no build step needed), but we still `tsc --noEmit` as a gate.
- `import` specifiers end in **`.js`** (NodeNext/erasable convention) even though files are `.ts`.
- `./.idea/` exists — make sure `.gitignore` ignores `out/ dist/ node_modules/ .idea/`.
- `package-lock.json` was generated into the temp-cache install; fine to commit.

CI (`.github/workflows/ci.yml`) runs: install → `biome check .` → `tsc --noEmit` → `vitest run`.

---

## 3. Architecture / module map (all under `src/`, ESM, one import per line, `import type` for type-only)

| File | Responsibility | Key exports |
| --- | --- | --- |
| `types.ts` | Domain types | `BlastRadius, ChangeClass, RiskAssessment, RiskDecision, GateDecision, GateOutcome, AuditEntry, AuditKind, MemoryRecord, Embedding, SkillRecord, SkillStatus, SkillDraft, EvolvedTool, ToolEvolutionInput, EvolutionProposal, QualityMetric, ShadowEvalResult, SessionState, CompactionArtifact, StateSnapshot` |
| `config.ts` | Config + default + path resolution | `FrameworkConfig, DEFAULT_CONFIG, resolvePaths(cwd, config)` → project `.pi/self` + global `~/.pi/agent/self` |
| `guardrails.ts` | Risk scoring / classify / decide | `scoreRisk, classifyAction, decide, classifyToolRisk, isFrameworkSource, BLOWN_UP, SECRET_DIRS, DESTRUCTIVE, PRIVILEGE, NETWORK_INJECT` |
| `audit.ts` | Append-only JSONL audit + snapshot store | `AuditLog, SnapshotStore, createGovernance(config, paths)` → `{ audit, snapshots }` (type `Governance`) |
| `memory.ts` | Durable memory store, dependency-free FNV-1a bag-of-words embeddings + cosine | `MemoryStore` (`add, all, update, setConfidence, forget, match, forgetMatch`) |
| `context.ts` | Context-control helpers (transient injection / lossless forgetting) | `formatRememberedMessage, formatCompactInjection, activeRemembered, matchForgetTargets, RememberedFact, ContextInjection, ForgetTarget` |
| `skills.ts` | Skill library (writes `SKILL.md`), promotion/rollback | `SkillLibrary` (`add, list, latest, get, activate, supersede, read`), `newSkillRecord, renderSkill` |
| `evaluation.ts` | Quality metrics, promotion gate, shadow comparison, action gate | `evaluateQuality, shouldPromote, foldMetric, runShadowComparison, gateAction, QualityVerdict, EMPTY_METRIC` |
| `compaction.ts` | Structured compaction (summarizer + reducer) | `runCompaction, CompactionPreparation, ParsedCompact, CompactSummarizer, CompactReducer, DEFAULT_REDUCE_LIMIT` |
| `approval.ts` | Approval gate (`ctx.ui`) with risk→decision mapping | `Gate, createGate(config, ctx)` |
| `registry.ts` | Branch state + reconstruct from custom entries | `BranchState` (class; `snapshot/remember/forget/activateTool/rollbackTool` etc.), `emptyState, reconstructState, STATE_CUSTOM_TYPE, EntryLike` |
| `stores.ts` | Memoized per-cwd project stores + global governance | `StoreManager` (`project(cwd, config?)`, `governance(config)`), `ScopedStores` |
| `tools/evolution.ts` | Declarative tool-evolution + shadow + activation action | `ToolRegistry`, `draftEvolution, evaluateShadow, activationAction` |
| `index.ts` | **The extension** — registers tools, commands, events | `default` factory `morePiExtension(pi)` |

The extension registers:
- Tools: `memory_write/recall/update/forget/confidence`, `context_remember/forget`,
   `self_learn`, `evolve_tool`, `self_eval`.
- Commands: `/evolve <list|show|activate|rollback> [name]`, `/self`, `/self-audit`,
   `/audit`, `/compact` (auto via `session_before_compact`).
- Events: `context` (transient injection of active memory), `tool_call` (governance gate —
   may `block` or prompt approval), `session_before_compact` (structured compaction +
   remember open items + persist branch state to a custom entry).

**Key design constraints already decided (do not regress):**
- **No arbitrary code execution.** `evolve_tool` is fully *declarative*: a proposal is a
   `ToolEvolutionInput` record; the new tool's behavior is materialized as a reviewable
   `SKILL.md` in `.pi/self/skills/` for review before use — never auto-eval/`new Function`.
- **Forget is lossless; injection is transient.** Forgetting prunes from context only the
   active memory records *this framework* injected (a `mem_<id>` custom message), matched by
   substring of the user's forget query — never by `isError`/`isEmpty` heuristics. It does
   not mutate history messages. This keeps `session_before_compact` nondestructive.
- **Framework-source blast radius.** Guardrails treat edits within `frameworkRoot` as
   `"project"` (guarded) and edits to `frameworkRoot/src` as hard-stop; `SECRET_DIRS`
   (`.git/ .env .aws/ .ssh/ .kube/`), destructive/privilege/network-inject shell are hard-stops.

---

## 4. Recommended standards in use (already applied — keep them)

- **TypeScript 7.0**, ESM, `"module":"NodeNext"`, `"moduleResolution":"Bundler"`,
   `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
   `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`.
- **Biome 2.5** for lint+format (tab indent, 120 width, `noExplicitAny`, `noNonNullAssertion`,
   `useEnumInitializers`, `noUnusedVariables/Imports/Parameters`, `import` sorting).
- **Vitest 4.1** `environment: node`, `include: ["test/**/*.test.ts"]`.
- **Biome + Vitest** in `package.json`; engines node `>=22.19.0`.
- pi-specific: `pi.extensions: ["extensions"]` manifest; entry `extensions/index.ts`
   re-exports the default factory from `../src/index.js`.
- Import style (match existing files): one import per line, `import type` for type-only
   imports, `.js` suffixed specifiers for local imports.

---

## 5. Remaining work

### 5.1 DONE this session (do not redo)
- Scaffolded all config files: `package.json, tsconfig.json, biome.json, .gitignore,
   .editorconfig, LICENSE (MIT), .github/workflows/ci.yml, scripts/smoke.mjs`.
- npm deps installed into `node_modules/` via the temp-cache workaround (§2).
- Wrote all 14 `src/` modules + `extensions/index.ts` entry.
- **Fixed 14 syntax-cascade errors**: two stray `)` in `src/index.ts` at the
   `triggers` (was ~L300) and `behaviorPrompt` (was ~L362) tool-param lines. (Those two
   lines still have one more issue — arg arity of `Type.Optional`, see §5.2 below.)
- Earlier "pending fixes" from the prior session are **already applied** in the current file
   (verified): `evaluateQuality`→`evaluateQualityLocal` local rename, `void manager;` removed,
   `if (!gov) return;` removed, `st2`→`st`, `resolvePaths`/`ParsedCompact`/`buildRememberedMessage`
   exports fixed, `buildEvalTool(pi, config)` signature, `openTasksFrom(_preparation, ...)` prefixed.
   Do NOT re-apply the old perl recipes.

### 5.2 BLOCKER: 48 `tsc` type errors remain (green typecheck is the #1 gate)

Run `npx tsc --noEmit` to see the current list. Grouped and how to fix each:

`src/tools/evolution.ts(7-9)` — TS2307 wrong relative path. It lives in `src/tools/`, so
  `./types.js`, `./guardrails.js`, `./evaluation.js` must become `../types.js`,
  `../guardrails.js`, `../evaluation.js`. (Also `./registry.js` if any — check.)

`src/audit.ts(1)` — TS6133 unused import `readdir`. Remove it from the `node:fs/promises` import.

`src/stores.ts(56)` — TS6133 `fallbackCwd` param unused. Prefix `_fallbackCwd` (or wire it into
  the default `project()` scope).

`src/approval.ts(90,51)` — TS5076 `??` mixed with `||`. Rewrite as
  `assessment.rule ?? (assessment.reasons.join("; ") || "high risk")`.
`src/approval.ts(118-119)` — TS4111 (see note below); `input.path`/`input.command`.

`src/compaction.ts(70-73)` — TS4111: `json.summary / json.filesTouched / json.openItems /
  json.facts`. `json` is an index-signature type; use bracket access `json["summary"]` etc.,
  or type `json` as a concrete shape.

`src/guardrails.ts(49, 67, 199, 204)` — TS4111: `input.command / input.kind / input.path`
  where `input = asObject(action.input)` is `Record<string, unknown>`. Use bracket access
  (`input["command"]`) OR cast to a typed `{ command?: string; kind?: string; path?: string }`.
  **TS4111 note:** appears for all index-signature member accesses in this tsc 7.0 build.
  Cheapest uniform fix: change `asObject(...)` to return a typed shape, or sprinkle `["..."]`.

`src/skills.ts(108,114,115,118)` — TS2322/2339: `readdir(dir, { withFileTypes:true })` returns
   `Dirent[]`, but the local is typed `string[]` and code calls `entry.isDirectory()`/`entry.name`.
  Fix: `import { type Dirent } from "node:fs";` and declare `let entries: Dirent[];` (keep using
  `entry.isDirectory()`/`entry.name`).

`src/memory.ts(44,45,46,191)` — TS2532 "Object possibly undefined" from `noUncheckedIndexedAccess`
  on `a[i] / b[i] / vector[h1]`. Fix with `(a[i] ?? 0)` / `vector[h1] = (vector[h1] ?? 0) + ...`
  (do NOT use `!`; Biome's `noNonNullAssertion` is on).

`src/index.ts(102, 285, 337, 460)` — TS6133 `pi` unused in the four `build*Tools` builders
  (`buildMemoryTools/buildContextTools/buildLearnTool/buildEvalTool`). They do not use `pi`
   (defineTool is a top-level import). Prefix the `pi` parameter as `_pi` — change the signature param to `_pi` (simplest) OR drop it and update the five call
   sites `build*Tools(pi, config, manager)` → `build*Tools(config, manager)`.
`src/index.ts(300, 362)` — TS2554 "Expected 1 argument, but got 2" on
   `Type.Optional(Type.Array(Type.String()), { description })` and
    `Type.Optional(Type.String(), { description })`. This typebox build does NOT accept a 2nd
   opts arg on `Type.Optional`; the **working pattern already in this file** (the `steps:`/`tags:`
   lines) puts `description` *inside* the inner call. Fix to:
   `Type.Optional(Type.Array(Type.String(), { description: "When to use the skill." }))` and
    `Type.Optional(Type.String({ description: "Prompt that emulates the tool's behavior." }))`.
`src/index.ts(254,109)` — TS2345: `matchForgetTargets(query, branch.current.remembered)` —
   `RememberedFact[]` is `{id, kind, content, ...}` but the fn wants `readonly {id, text}[]`.
  Map it: `branch.current.remembered.map(f => ({ id: f.id, text: f.content }))`.
`src/index.ts(592,6)` — TS2322: `getArgumentCompletions` returns `{value, description}[]` but
   the callback type is `AutocompleteItem[]`, which **requires `label`**. Add `label` to each
   returned item (verify exact `AutocompleteItem` shape — likely `{label, value, description?}`).
`src/index.ts(615,624,643,648)` — TS2345 `name` is `string | undefined` from the destructure
    `const [verb, name] = (args || "list").split(/\s+/)` under `noUncheckedIndexedAccess`. Add a
   default: `const [verb, name = ""] = ...` (keeps the existing `if (!name && verb !== "list")`
  guard working).
`src/index.ts(580,13)` — TS6133 unused `st` in the `/audit` (or `/self-audit`) handler that only
   uses `manager.governance(config)`, not `st`. Delete that `const st = manager.project(...)`.
`src/index.ts(682,4)` — TS6133 unused `gate` param in `recordAudit(...)`. Prefix `_gate` (call
   sites keep passing it positionally) — or drop the param and update all call sites.
`src/index.ts(669, 671)` — TS1361 `BranchState` is a **class** (value) but imported as
   `type BranchState`. Also a logic bug: `new BranchState(reconstructState(entries))` and
    `new BranchState(emptyState())` pass a `BranchState` to the constructor. Fix: make
   `BranchState` a value import (`import { reconstructState, BranchState, ... }`), and write
    `return reconstructState(entries);` / `return emptyState();` (drop the `new`). Confirm
    `emptyState` and `EntryLike` are in the import list.

---

### 5.3 After `tsc --noEmit` is green, these still remain

1. **`biome check .` (`npm run lint`)** — run it; expect import-sort / formatting / `noNonNull`
   nits. Many `src/` files currently use **spaces where other files use tabs** — run
   `npm run format` (Biome, tab/120) to normalize, then re-run `tsc`. (This mixed indent is
   likely the source of the awkward `.map(text)` blocks and the earlier paren slips.)
2. **Tests do not exist yet — the `test/` directory is empty.** The `package.json` `test`
    script and CI expect `vitest` over `test/**/*.test.ts`. Write tests (high value, pure logic,
   no pi needed):
   - `test/guardrails.test.ts` — `scoreRisk`, `decide`, `classifyAction` thresholds (approval vs
      block), SECRET_DIRS / DESTRUCTIVE / PRIVILEGE / NETWORK_INJECT hard-stops,
      `isFrameworkSource` scoping within `frameworkRoot`.
   - `test/audit.test.ts` — `AuditLog` append+read round-trip (use `fs.mkdtemp`),
      `createGovernance`.
   - `test/memory.test.ts` — `MemoryStore.add/match` cosine recall, `forget` lossless pruning,
     `embed`/`cosine` determinism.
   - `test/config.test.ts` — `DEFAULT_CONFIG`, `resolvePaths` project+global.
   - `test/evolution.test.ts` — `draftEvolution`, `evaluateShadow`, `activationAction`.
   - `test/compaction.test.ts` / `context.test.ts` — `runCompaction` (with a stub
     `compactSummarizer`) and `matchForgetTargets`/`formatRememberedMessage`.
3. **`npm run smoke`** — once entry import compiles, run it; it loads `extensions/index.ts`
   through jiti with a stub `ExtensionAPI` and asserts the default export is a function that
   registers without throwing. (It no-ops cleanly if jiti isn't installed.)
4. **`.gitignore`** — ensure it ignores `node_modules/ out/ dist/ .idea/ .pi/` (the last one
   holds self-state at runtime; should not be committed). Verify `.idea/` presence is ignored.
5. **README.md** — not yet written. Add install/config/usage + the six capabilities, the
   governance/approval flow, the declarative-evolution safety model, and the config
   (`DEFAULT_CONFIG` fields). Reference `RESEARCH-self-modifying-framework.md`.
6. **First commit.** `git init` is done, nothing committed. After gates are green:
    `git add -A && git commit -m "..."`.
7. **Manual preview** (optional, needs interactive tty): `npm run preview`
    (= `pi -e ./extensions/index.ts`) to smoke-test the real extension end-to-end.

---

### 6. Conventions already chosen — keep them (avoid regressions)
- ESM; `import type` for type-only imports; one import per line; `.js` suffix on local imports.
- `verbatimModuleSyntax` on → a **value** export that is also used as a value must be a value
   import (the BranchState bug in §5.2 is the canonical example).
- No `any` (Biome `noExplicitAny`), no `!`/non-null assertions (Biome `noNonNullAssertion`) →
   use `?? 0`, guards, and typed shapes instead.
- Tab indentation, 120 width, double quotes (Biome). `noFallthroughCasesInSwitch` and
   `noUnusedParameters/Imports/Variables` are ON — prefix unused params with `_` or use them.
- Framework self-modification is **declarative and guardrailed**: proposals become reviewable
     `SKILL.md` files + audit/snapshot records; `evolve_tool` never `eval`s/`new Function`s.
- Forgetting only prunes framework-injected `mem_<id>` messages; never heuristically prunes
    user/tool history (keeps `session_before_compact` lossless).

---

### 7. Suggested order for the next session
1. `npm install --ignore-scripts --cache /tmp/morepi-npm-cache` (deps already installed, but
  re-run is idempotent and cheap).
2. `npx tsc --noEmit` → work through §5.2 top to bottom (evolution.ts path imports first —
   they block module resolution for the most errors; then the index.ts cluster; then the
   per-file TS4111/TS2532/TS6133 items).
3. `npm run format` then `npm run lint` → `npm test` (after writing §5.3.2 tests) →
   `npm run smoke`.
4. Write `README.md`, tighten `.gitignore`, `git add -A`, first commit.
5. `npm run preview` for an end-to-end check.

### 8. Ground-truth snapshot
- `npx tsc --noEmit` → **48 errors** at snapshot (all in `src/`, listed/assigned in §5.2).
- `git` — `init` done, `main`, no commits; 12 tracked-ish files under version control pending.
- No `test/` files exist.
- The two former syntax bugs are fixed; the *only* remaining parse risk is the §5.2
   `Type.Optional` arity items (300, 362) until their `description` is moved inside the inner call.
- All 14 `src/` modules + `extensions/index.ts` + `scripts/smoke.mjs` are written and coherent;
   the work is purely "make it typecheck → lint → test → document → commit".
