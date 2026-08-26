# MorePi documentation

MorePi is a self-modifying framework for
[pi](https://github.com/earendil-works/pi), the coding agent. It layers six
durable capabilities — context control, persistent memory, self-learning skill
generation, governed tool evolution, evaluation-based promotion, and audit-logged
rollback — over pi's native session/branch system. Every state-changing action
passes through a single governance gate, so nothing the framework does can escape
your control.

Start with [README](../README.md) for the one-page overview, then pick a track
below.

## Where to start

| I want to… | Read |
| --- | --- |
| Install and get the extension running | [Getting started](./getting-started.md) |
| Use the six capabilities and the slash commands | [User guide](./user-guide.md) |
| Tune the gates or change where state is stored | [Configuration](./configuration.md) |
| Understand the threat model and safety invariants | [Threat model](./threat-model.md) |
| Understand the design rationale and research | [Design](./design.md) |
| Build, test, or contribute | [Developer guide](./developer.md) |
| Drain a findings review to completion | [Findings queue & usage](./findings/usage.md) |

## Reference

- [`AGENTS.md`](../AGENTS.md) — the "README for agents": layout, quality gates,
  and the safety invariants every change must preserve.
- [`src/index.ts`](../src/index.ts) — the extension entry point and wiring.
  Start here to understand the architecture.
