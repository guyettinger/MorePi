# Configuration

All configuration is the `DEFAULT_CONFIG` object in `src/config.ts`, and anything
that takes a framework instance receives a `FrameworkConfig`. The defaults are
sensible and everything is *on*.

For how each capability behaves once configured, see the
[User guide](./user-guide.md).

---

## 1. The `DEFAULT_CONFIG` fields

| Field | Default | What it controls |
| --- | --- | --- |
| `enable.context` | `true` | register `context_remember` / `context_forget` |
| `enable.memory` | `true` | register `memory_write` / `memory_recall` |
| `enable.learn` | `true` | register `self_learn` |
| `enable.evolve` | `true` | register `evolve_tool` and `/evolve` |
| `enable.guardrails` | `true` | run the risk gate (see [Threat model](./threat-model.md)) |
| `enable.audit` | `true` | write the append-only audit log |
| `enable.compaction` | `true` | structured compaction + fact extraction |
| `approvalThreshold` | `55` | score at/above which an action asks for approval |
| `blockThreshold` | `80` | score at/above which an action is blocked outright |
| `frameworkGuard.mode` | `"protect"` | posture toward the framework's **own** source — `"protect"` hard-stops built-in edits to `frameworkRoot/src`; `"develop"` relaxes it (audited) so a maintainer can work on the framework || `context.defaultKeepFraction` | `0.25` | fraction of a forgotten fact kept in its summary |
| `context.maxTracked` | `500` | max remembered/forgotten ids tracked per branch |
| `memoryRecall.defaultLimit` | `5` | facts returned by a default `memory_recall` |
| `memoryRecall.minScore` | `0.15` | cosine floor for "relevant" recall |
| `configDirName` | `.pi` | project-local state dir name (`.pi/self/…`) |

**Tuning the gate.** The two numbers most people touch are `approvalThreshold`
(fewer prompts as you raise it) and `blockThreshold` (more conservative as you
lower it). For memory-heavy sessions, raise `memoryRecall.defaultLimit` so more
facts surface per recall; raise `context.maxTracked` if you remember a lot.

**Letting pi edit the framework itself.** By default `frameworkGuard.mode` is
`"protect"`: a built-in `edit`/`write` that targets the framework's own
`frameworkRoot/src` is hard-stopped, so an end user cannot have the agent rewrite
the extension for them. A maintainer developing the framework enables **develop
mode** by setting `frameworkGuard: { mode: "develop" }` in config, or by exporting
`MOREPI_DEVELOP=1` / `MOREPI_FRAMEWORK_GUARD=develop`. Develop mode relaxes that
hard-stop so framework-source edits route through the normal approval/allow path;
the audit log still records every such edit as a `change-approved` system record, so
the opt-in is conscious, reversible, and never silent.

---

## 2. Overriding config

The default extension factory wires `DEFAULT_CONFIG`, so to change it you supply
a `FrameworkConfig`. The clean way is to drop a small `extensions/index.ts` next
to your project that imports `morePiExtension` and passes your object:

```ts
// extensions/index.ts — local override
import { morePiExtension, DEFAULT_CONFIG } from "morepi";

export default (pi) =>
	morePiExtension(pi, {
		...DEFAULT_CONFIG,
		approvalThreshold: 80, // fewer prompts
		context: { ...DEFAULT_CONFIG.context, maxTracked: 2000 },
	});
```

For a quick local test you may instead edit `DEFAULT_CONFIG` directly, but prefer
the per-project factory so your choice travels with the project and does not leak
into other work. (`configDirName` is the one setting that changes where state is
*written*; changing it orphans your old `.pi/` state, so change it
deliberately.)

---

## 3. Where your data lives

Two state roots, one per scope. Both derive from `configDirName` (default
`.pi`):

| Scope | Root | Holds |
| --- | --- | --- |
| **Project-local** | `<cwd>/.pi/self/` | `memory.jsonl`, `skills/`, `tools/` (evolved-tool registry, one `<name>.json` each) |
| **Global** | `~/.pi/agent/self/` | `audit.jsonl` (the centralized ledger), `snapshots/` |

A few notes from `src/config.ts` / `src/index.ts`:

- **Memory and skills/tools are project-scoped** — each project has its own
    `memory.jsonl`, skill library, and evolved-tool registry.
- **The audit log is global** (`~/.pi/agent/self/audit.jsonl`), so it survives
    across projects in one centralized, append-only ledger.
- **Per-branch working state** (which facts are *remembered/forgotten* right now,
    the compaction artifact index) is **not** on disk as a separate file — it
    rides inside pi's session entries as a `CustomMessage`
    (`STATE_CUSTOM_TYPE`), so it branches correctly with `/tree` and is
    reconstructed via `reconstructState()` when resuming.
- **`piSkillsDir`** is a mirror of the generated skills at `<cwd>/.pi/skills/`
    consumed by pi's native skill loader.
- The repo's `.gitignore` already ignores `.pi/`, `.self/`, `node_modules/`, and
    editor/build dirs, so runtime state stays out of your commits.

---

*See also:* [User guide](./user-guide.md) · [Threat model](./threat-model.md) ·
[Developer guide](./developer.md)
