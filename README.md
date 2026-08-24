# MorePi

A self-modifying framework for [pi](https://github.com/earendil-works/pi): it adds six capabilities — context control, persistent memory, self-learning skill generation, governed tool evolution, evaluation-based promotion, and audit-logged rollback — as a pi extension package, layered over pi's native session/branch system.

## Installation

```bash
# As a dev dependency (local use)
npm install morepi

# As a pi extension (installed by the user)
pi install morepi

# Or copy into your agent extensions directory
mkdir -p ~/.pi/agent/extensions
cp -r your/cloned/morepi ~/.pi/agent/extensions/morepi
```

The extension auto-registers via the `pi.extensions: ["extensions"]` manifest in `package.json`. Pi loads it through jiti, so no build step is required — the `TypeScript` is executed directly.

> **Requirements**: Node >= 22.19.0. See `RESEARCH-self-modifying-framework.md` for the full design rationale.

## The Six Capabilities

| # | Capability | Tools / Events | Key Property |
|---|-----------|----------------|--------------|
| 1 | **Context Control** | `context_remember`, `context_forget` + `context` event | Lossless: forgetting prunes only framework-injected `mem_<id>` messages; underlying facts stay in memory |
| 2 | **Persistent Memory** | `memory_write`, `memory_recall` | Durable JSONL; FNV-1a bag-of-words embedding (no external API); weighted recall |
| 3 | **Self-Learning** | `self_learn` | Recurring task patterns are written as reviewable `SKILL.md` files; never auto-executed |
| 4 | **Tool Evolution** | `evolve_tool`, `/evolve` | Fully declarative: proposals become `SKILL.md` behavior records; no arbitrary code execution |
| 5 | **Evaluation & Promotion** | `self_eval`, shadow comparison | Quality signals (tests, lint, reviewed) feed a promotion gate; shadow → active only when thresholds are met |
| 6 | **Audit & Rollback** | `/self-audit`, `/audit`, `SnapshotStore` | Append-only JSONL audit log; state snapshots enable full rollback of evolution/compaction actions |

## Governance Flow

Every state-changing action the framework performs passes through a single governance gate:

1. **Risk scoring** (`scoreRisk`) — assigns a 0–100 composite score based on change class (`read`, `write-memory`, `write-context`, `write-skill`, `write-tool`, `modify-framework`, `external-effect`) and blast radius (`self` → `module` → `project` → `system`).
2. **Hard stops** — `DESTRUCTIVE` shell commands, `PRIVILEGE` escalation (`sudo`), `NETWORK_INJECT` (`curl|bash`), `SECRET_DIRS` (`.git/`, `.env`, `.aws/`, `.ssh/`, `.kube/`) all trigger immediate block regardless of score.
3. **Decision** (`decide`) — maps score against `approvalThreshold` (55) and `blockThreshold` (80).
4. **Approval** — the `Gate` prompts the user via `ctx.ui.confirm` for actions in the "approve" range; actions in "allow" range pass silently; "block" actions are refused.

Framework-source edits within `frameworkRoot/src` are hard-stopped for non-pipeline calls but permitted via the sanctioned `/evolve` pipeline, which performs its own approval gate at activation time.

## Safety Model

Three core invariants protect the user:

- **Declarative evolution**: `evolve_tool` records a `ToolEvolutionInput` (name, behavior prompt, parameters, budget); activation creates a `SKILL.md` in the project skill library — never `new Function()`, never `eval()`. Behavior is data, not code.
- **Lossless forgetting**: `context_forget` prunes only the transient `mem_<id>` custom messages the framework itself injected. It never touches user or tool messages in session history.
- **Framework-source guard**: Edits to the framework's own `src/` directory are hard-stopped for any tool except the sanctioned evolution pipeline; the pipeline routes through approval.

## Configuration

All configuration lives in `DEFAULT_CONFIG` (extensible via `FrameworkConfig`):

| Field | Default | Description |
|-------|---------|-------------|
| `enable.context` | `true` | Register `context_remember` / `context_forget` |
| `enable.memory` | `true` | Register `memory_write` / `memory_recall` |
| `enable.learn` | `true` | Register `self_learn` |
| `enable.evolve` | `true` | Register `evolve_tool` and `/evolve` commands |
| `enable.guardrails` | `true` | Apply risk scoring and approval gates |
| `enable.audit` | `true` | Record append-only audit log |
| `enable.compaction` | `true` | Structured compaction with fact extraction |
| `approvalThreshold` | `55` | Risk score that requires user approval |
| `blockThreshold` | `80` | Risk score that blocks outright |
| `context.defaultKeepFraction` | `0.25` | Fraction of forgotten fact to keep in summary |
| `context.maxTracked` | `500` | Max remembered/forgotten ids per branch |
| `memoryRecall.defaultLimit` | `5` | Default facts returned by `memory_recall` |
| `memoryRecall.minScore` | `0.15` | Cosine-similarity floor for relevant matches |
| `configDirName` | `.pi` | Project-local state directory (`.pi/self/`) |

State is stored in two locations:
- **Project-local** (`<cwd>/.pi/self/`): memory, skills, evolved tools
- **Global** (`<home>/.pi/agent/self/`): audit log, snapshots (centralized ledger)

## Development

```bash
npm install --ignore-scripts --cache /tmp/morepi-npm-cache
npm run typecheck  # tsc --noEmit
npm run lint       # biome check .
npm test           # vitest run
npm run smoke      # node scripts/smoke.mjs
npm run preview    # pi -e ./extensions/index.ts (interactive)
```

## See Also

- `RESEARCH-self-modifying-framework.md` — full design document and threat model.
- `src/index.ts` — the extension entry point; start here to understand the architecture.
