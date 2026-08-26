# MorePi

A self-modifying framework for
[pi](https://github.com/earendil-works/pi): it adds six capabilities — context
control, persistent memory, self-learning skill generation, governed tool
evolution, evaluation-based promotion, and audit-logged rollback — as a pi
extension package, layered over pi's native session/branch system. Every
state-changing action passes through a single governed gate, so nothing the
framework does can escape your control.

## Quick start

```bash
# Install it as a user-level pi extension (recommended)
pi install morepi

# …or load a local checkout directly (needs a TTY)
npm run dev              # == pi -e ./extensions/index.ts
```

Pi loads the extension through `jiti`, so **there is no build step** — it runs
the TypeScript directly. **Requirements:** Node `>= 22.19.0`, pi `>= 0.84.2`.
Full prerequisites, the three install routes, and how to verify the extension is
active: [Getting started](docs/getting-started.md).

## The six capabilities

| # | Capability | Tools / Events | Key Property |
| --- | --- | --- | --- |
| 1 | **Context Control** | `context_remember`, `context_forget` + `context` event | Lossless: forgetting prunes only framework-injected `mem_<id>` messages; underlying facts stay in memory |
| 2 | **Persistent Memory** | `memory_write`, `memory_recall` | Durable JSONL; FNV-1a bag-of-words embedding (no external API); weighted recall |
| 3 | **Self-Learning** | `self_learn` | Recurring task patterns are written as reviewable `SKILL.md` files; never auto-executed |
| 4 | **Tool Evolution** | `evolve_tool`, `/evolve` | Fully declarative: proposals become `SKILL.md` behavior records; no arbitrary code execution |
| 5 | **Evaluation & Promotion** | `self_eval`, shadow comparison | Quality signals gate a `shadow → active` promotion; humans stay the gate |
| 6 | **Audit & Rollback** | `/self-audit`, `/audit`, `SnapshotStore` | Append-only JSONL audit log; state snapshots enable full rollback |

Everything is gated by one risk-and-approval gate; the three enforced safety
invariants (declarative evolution, lossless forgetting, framework-source guard)
and how to tune the thresholds live in the
[Threat model](docs/threat-model.md).

## Documentation

| I want to… | Read |
| --- | --- |
| Install and run the extension | [Getting started](docs/getting-started.md) |
| Use the six capabilities and the slash commands | [User guide](docs/user-guide.md) |
| Tune the gates or relocate state | [Configuration](docs/configuration.md) |
| Understand the threat model and safety invariants | [Threat model](docs/threat-model.md) |
| Read the design rationale and research | [Design](docs/design.md) |
| Build, test, or contribute | [Developer guide](docs/developer.md) |

A fuller index with a "where to start" map: [docs/index.md](docs/index.md).

## Development

```bash
npm run check      # lint + typecheck (the fast gate bundle)
npm test           # vitest run
npm run smoke      # load the entry via jiti with a stub ExtensionAPI
```

Full gate set, CI matrix, troubleshooting, and where the code lives:
[Developer guide](docs/developer.md). The extension wiring is
[`src/index.ts`](src/index.ts); the canonical reference for agents is
[AGENTS.md](AGENTS.md).
