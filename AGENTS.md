# AGENTS.md

This file follows the open [AGENTS.md](https://agents.md) format — a minimal,
plain-Markdown "README for agents" that many coding agents read before acting.
It is the single source of project context; symlink it to `CLAUDE.md` if you want
Claude and other tools to share one file.

## What this repository is

**MorePi** is a *self-modifying framework* for
[pi](https://github.com/earendil-works/pi), the coding agent. It adds six
durable capabilities to a pi extension — **context control, persistent memory,
self-learning skill generation, governed tool evolution, evaluation-based
promotion, and audit-logged rollback** — layered over pi's native session/branch
system.

The framework is a pi **extension package** loaded through `jiti`, so the
TypeScript in `src/` runs directly with **no build step for the extension
itself**. Read `README.md` for the one-page package overview and
`docs/design.md` for the full design and threat model.
Start coding from `src/index.ts` (the extension factory).

## Repository layout

The whole framework lives under `src/` as ESM modules (one import per line,
`.js`-suffixed local specifiers, `import type` for type-only imports):

| File | Responsibility |
| --- | --- |
| `types.ts` | Domain types (`ChangeClass`, `BlastRadius`, `RiskAssessment`, `GateDecision`, `AuditEntry`, `MemoryRecord`, `SkillRecord`, `EvolvedTool`, …). |
| `config.ts` | `FrameworkConfig`, `DEFAULT_CONFIG`, path resolution → project `.pi/self/` + global `~/.pi/agent/self/`. |
| `guardrails.ts` | Risk scoring / classification / decision (`scoreRisk`, `classifyAction`, `decide`); hard-stop lists. |
| `audit.ts` | Append-only JSONL audit log + snapshot store (`createGovernance`). |
| `memory.ts` | Durable `MemoryStore` with dependency-free FNV-1a bag-of-words embeddings + cosine recall. |
| `context.ts` | Transient context injection and **lossless** forgetting. |
| `skills.ts` | `SkillLibrary` — writes reviewable `SKILL.md`; activate / supersede / rollback. |
| `evaluation.ts` | Quality metrics, promotion gate, shadow comparison. |
| `compaction.ts` | Structured compaction (summarizer + reducer). |
| `approval.ts` | The approval `Gate` (`ctx.ui.confirm`) mapping risk → decision. |
| `registry.ts` | Branch state + reconstruction from custom session entries. |
| `stores.ts` | Memoized per-cwd project stores + global governance (`StoreManager`). |
| `tools/evolution.ts` | Declarative tool evolution: draft → shadow → activation. |
| `index.ts` | **The extension** — registers tools, commands, and events. |

`extensions/index.ts` is the pi-discovered entry point (`pi.extensions` manifest);
it re-exports `default` from `../src/index.js`. `test/` holds the Vitest suite;
`scripts/smoke.mjs` loads the entry through jiti with a stub `ExtensionAPI`.

## Environment & prerequisites

| Requirement | Version | Check |
| --- | --- | --- |
| Node.js | `>= 22.19.0` | `node --version` |
| pi | `>= 0.84.2` (developed against `0.84.2`) | `pi --version` |
| TypeBox | `1.3.x` (a pi peer dependency) | in your pi tree |

## Install

On some macOS setups the system npm cache breaks on `rename`, and pi-coding-agent
ships heavy install scripts. The workaround used throughout development:

```bash
npm install --ignore-scripts --no-audit --no-fund --cache /tmp/morepi-npm-cache
```

`--ignore-scripts` is recommended by pi itself and does not affect the extension's
runtime (pi loads `.ts` through `jiti`). A clean checkout has no `node_modules/`
until this step — `npm run smoke` skips gracefully if `jiti` is absent.

## Quality gates

All four must be green before calling work done (this mirrors CI in
`.github/workflows/ci.yml`, which runs install → lint → typecheck → test):

```bash
npm run lint        # biome check .            (lint + format check)
npm run typecheck   # tsc --noEmit            (strict, the #1 gate)
npm test            # vitest run
npm run smoke       # node scripts/smoke.mjs
```

After moving files or changing imports, always re-run `npm run lint` and
`npm run typecheck` — import-sort, casing, and index-access nits are the common
failures. Fix everything until the whole suite green.

## Testing

- Vitest, `node` environment, over `test/**/*.test.ts`.
- One suite per subsystem: `guardrails`, `audit`, `memory`, `context`,
  `compaction`, `evaluation`, `evolution`, `config`.
- Target one test: `npm test -- -t "name"`. Run a file: `npm test -- test/guardrails.test.ts`.
- **Add or update tests for the code you change, even if you were not asked.**
  Prefer pure-logic coverage that needs no live pi session.

## Code style & conventions

These are the applied standards — **keep them; do not regress**:

- **TypeScript 7.0, strict.** `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `isolatedModules`, `noEmit`. Because index access can be
  `undefined` under `noUncheckedIndexedAccess`, guard it (use `?? default` or an
  early check); avoid non-null assertions that hide `undefined`.
- **ESM, no build.** Local relative imports end in **`.js`** even though the
  files are `.ts` (resolves under `moduleResolution: "Bundler"` + jiti).
- **Import hygiene:** one import per line; use `import type` for type-only
  imports and the inline `type` modifier for mixed value/type imports
  (`verbatimModuleSyntax` enforces this).
- **Biome 2.5** formats and lints TS/JSON/Markdown: **tab** indentation,
  **line width 120**, LF line endings, recommended preset. `noExplicitAny` is an
  error — no `any`; prefer precise types or `unknown`. Run `npm run format`
  before committing so the formatter normalizes indentation.

## The six capabilities

All state-changing actions pass through **one governance gate**
(`scoreRisk` → `decide` → the `Gate`). Usage in `docs/user-guide.md`; the gate
and the enforced invariants in `docs/threat-model.md`:

| # | Capability | Tools / events | Key property |
| --- | --- | --- | --- |
| 1 | Context control | `context_remember` / `context_forget` + `context` event | Lossless: forgetting prunes only framework-injected `mem_<id>` messages. |
| 2 | Persistent memory | `memory_write` / `memory_recall` | Durable JSONL; FNV-1a bag-of-words embedding; weighted recall. |
| 3 | Self-learning | `self_learn` | Recurring patterns → reviewable `SKILL.md`; never auto-executed. |
| 4 | Tool evolution | `evolve_tool` / `/evolve` | Fully declarative; proposals become `SKILL.md`, no arbitrary code. |
| 5 | Evaluation & promotion | `self_eval`, shadow comparison | Quality signals gate shadow → active promotion. |
| 6 | Audit & rollback | `/self-audit` / `/audit` / `SnapshotStore` | Append-only JSONL log; snapshots enable full rollback. |

## Safety model — do not regress

These invariants protect the user and are enforced by the gates above:

- **No arbitrary code execution.** `evolve_tool` is fully *declarative*: a
  proposal is a `ToolEvolutionInput` record whose behavior is materialized as a
  reviewable `SKILL.md` — **never `eval()`, `new Function()`, or code eval.**
  Behavior is data, not code.
- **Lossless, transient forgetting.** `context_forget` prunes only the `mem_<id>`
  custom messages *this* framework injected (matched by substring of the user's
  query) — never user/tool history, never `isError`/`isEmpty` heuristics.
- **Framework-source guard.** Edits within the framework's own `frameworkRoot/src`
  are hard-stopped for every tool except the sanctioned `/evolve` pipeline, which
  routes through approval at activation.
- **Hard stops regardless of score:** `DESTRUCTIVE` shell commands, `PRIVILEGE`
  escalation (`sudo`), `NETWORK_INJECT` (`curl … | bash`), and `SECRET_DIRS`
  (`.git/`, `.env`, `.aws/`, `.ssh/`, `.kube/`).

## Commands cheat sheet

```bash
npm run check        # lint + typecheck (the fast gate bundle)
npm run typecheck    # tsc --noEmit
npm test             # vitest run   (+ npm test:watch to watch)
npm run smoke        # load entry via jiti with a stub ExtensionAPI
npm run preview      # pi -e ./extensions/index.ts  (interactive, needs a TTY)
```

## PR & commit instructions

- Make a change only after `npm run lint` and `npm run typecheck` are green.
- Every PR must pass the full gate set: lint, typecheck, test, and smoke.
- Add or update tests for changed code; keep the six safety invariants intact.
- Follow conventional commit style in line with the existing history
  (e.g. `feat: …`, `fix: …`, `docs: …`).

## Where to read more

- `README.md` — one-page package overview and a hub that links to the docs.
- `docs/index.md` — documentation index / "where to start".
- `docs/getting-started.md` — installing, running, and verifying the extension.
- `docs/user-guide.md` — using the six capabilities and the slash commands.
- `docs/configuration.md` — config fields, tuning the gate, and where state lives.
- `docs/threat-model.md` — enforced safety invariants, risk scoring, hard stops.
- `docs/design.md` — full design rationale, threat reasoning & external research.
- `docs/developer.md` — build, test, verify, and contributor troubleshooting.
- `src/index.ts` — where the framework wires itself into pi.
