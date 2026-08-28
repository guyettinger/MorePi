# User guide

This guide shows you how to **use** MorePi's capabilities and commands. Install
and verify the extension first in the [Getting started](./getting-started.md)
guide. Everything the framework does passes through a single **governance gate**,
so nothing can escape your control — see [Threat model](./threat-model.md) for
why.

---

## The six capabilities

Each capability below is a **how-to with a concrete example**, phrased as what
you tell the agent or run, and what the framework does under the hood.

### 1. Persistent memory (`memory_write` / `memory_recall`)

Memory is the most-used capability and the one you can start using immediately.
Facts are plain self-contained sentences stored in a JSONL ledger and recalled by
relevance — no embeddings API key, no vector database.

**Store a fact.** Tell the agent something durable, or call the tool directly:

```text
You: From now on, we ship to a canary host first, then promote to prod.
```

The agent fires `memory_write`:

```text
memory_write({ content: "We ship to a canary host first, then promote to prod.",
               tags: ["release", "deployment"], source: "user" })
```

It returns the fact id, e.g. `Remembered as mem_9f3a21b0c4d2 [release, deployment].`

| Field | Required | Notes |
| --- | --- | --- |
| `content` | yes | A **self-contained** sentence. |
| `tags` | no | Strong recall signals; weighted 3× in the embedding. |
| `source` | no | Where it came from (defaults to `"user"`; also `"compaction"`, `"supersede"`). |

**Recall it later (in any session).** Recall is relevance-ranked by a
dependency-free FNV-1a bag-of-words similarity with a cosine floor:

```text
You: What's our release process?
```

The agent calls `memory_recall({ query: "release process" })` and gets, ranked
and scored, e.g.:

```text
1. (0.62) We ship to a canary host first, then promote to prod. [release, deployment]   [mem_9f3a21b0c4d2]
2. (0.41) Canary must stay hot for 30 minutes with no errors before promotion. [canary]   [mem_cx…]
```

Recall options: `limit` (1–25, **default 5**), `tags` (filter), `minScore`
(cosine floor, **default 0.15**). These are configurable — see
[Configuration](./configuration.md).

**Tips.** Store *decisions, constraints, conventions* — not ephemeral scratch.
A fact can later be **reinforced** (ranks higher next time) or **superseded**
(mark it stale and add a replacement); see §2 and §6 below.

---

### 2. Context control (`context_remember` / `context_forget`)

Memory and the live *context window* are separate. A fact in memory is not in the
model's working context until you **remember** it; `context_forget` is its
**lossless** inverse. This is how a long agent run stays fast without forgetting
anything.

**Bring facts into context.**

```text
context_remember({ query: "deployment strategy", tags: ["release"], label: "deploy" })
```

Every model call from here on gets a transient user message carrying those
remembered facts (see the `context` event handler in `src/index.ts`). When the
topic is done, drop it from the window:

```text
context_forget({ target: "the deploy strategy" })
```

> **Lossless, by design.** Forgetting prunes only the transient `mem_<id>`
> messages the framework injected. Your original messages and the underlying facts
> in memory are untouched — re-remember them any time. `context_forget` can also
> accept an exact `mem_<id>` and an optional `supersede: true` to mark the fact
> stale in memory. Use `context_forget` only to reclaim space, never to destroy
> information.

---

### 3. Self-learning (`self_learn`)

When a task recurs or you just completed a multi-step procedure, capture it as a
reusable **skill** — a plain `SKILL.md` in your project skill library that the
agent can review and reuse.

```text
You: That migration dance took a while — make it a skill.
```

```text
self_learn({ name: "db-migration",
             description: "Run the reviewed Postgres migration flow on a staging DB.",
             steps: ["stop writers", "apply SQL", "verify checksum", "resume writers"],
             triggers: ["user asks to migrate the database", "pre-deploy migration"],
             examples: ["migration on 2025-08-01"] })
```

What happens:

1. A risk gate scores `write-skill` (project radius) — low risk, usually passes
    silently.
2. `skills.add` writes `.pi/self/skills/db-migration/SKILL.md` and a mirrored
    `piSkillsDir` entry so pi's native loader can pick it up.
3. An audit entry `skill-learned` is recorded.
4. The agent receives `Generated skill "db-migration" v1 -> .pi/self/skills/...`.

> **Never auto-executed.** A generated skill is a *document for review*. It only
> changes agent behavior once you have read it and (optionally) it has been
> promoted. That is the difference between "the agent wrote a recipe" and "the
> agent ran arbitrary code."

---

### 4. Governed tool evolution (`evolve_tool` + `/evolve`)

When the agent is missing a capability, it can **propose** one. This is the most
delicate capability, so it is *fully declarative* and gated at every step. A
proposal is just a record — **never** `eval`/`new Function`; the new tool's
behavior is materialized as a reviewable `SKILL.md`, and activation is a separate
action you run. (See [Threat model](./threat-model.md) for the invariant.)

**Propose a tool (the agent does this for you).**

```text
evolve_tool({ action: "create",
              name: "batch-import",
              rationale: "Manual CSV imports are repetitive and error-prone.",
              description: "Import a CSV into the staging table with type checks.",
              parameters: [
                 { name: "path", type: "string", description: "CSV path", required: true },
                 { name: "dryRun", type: "boolean", description: "Validate without writing" }
               ],
              behaviorPrompt: "Read the CSV, validate each row against the staging schema, and report a summary.",
              maxRadius: "project",
              runShadow: true })
```

Lifecycle: `proposed → shadow → active` (or `rolled-back` at any point).

- `runShadow: true` runs a shadow evaluation: the new behavior is exercised in
  the background without affecting the real system; its pass/fail metrics feed
  the promotion gate.
- The proposal is risk-scored and audited as `tool-proposed`. If it hard-stops
  the record is kept in status `proposed` and reported as blocked.
- The `behaviorPrompt` is written to a companion skill
   `batch-import-behavior/SKILL.md` for your review **before** anything runs.

**Manage it with `/evolve`** — a single command with four verbs:

```text
/evolve list                # name, version, status, blast radius of every evolved tool
/evolve show batch-import   # full JSON of the latest version
/evolve activate batch-import
/evolve rollback batch-import
```

`activate` re-runs the gate (`createGate` → `gate.execute`) on the *activation*
action; a high-risk or hard-stop tool is blocked from activating and you see
`Activation of … blocked: …`. Activation sets the tool `active` and logs
`tool-activated`. `rollback` marks the latest version `rolled-back` and logs
`tool-rolled-back`.

> **Prefer `modify`/`extend` over `create`.** The framework scores `create` new
> tools higher (`write-tool`, base 60) and `modify`/`extend` even higher
> (`modify-framework`, base 65) — both are more likely to request approval. Use
> the smallest change that gets the job done, and never use `evolve_tool` to
> bypass a guardrail or remove a safety check.

---

### 5. Evaluation & promotion (`self_eval`)

`self_eval` is an **advisory** self-assessment of a change: a quality score plus
a governance read of how a given action would score. It is *advisory only* —
humans remain the gate; it never auto-approves.

```text
self_eval({ testsPassed: 41, testsTotal: 42, testsAdded: 3,
            errorCount: 0, changedLines: 180, reviewed: true,
            actionTool: "evolve_tool" })
```

Typical output:

```text
Quality: 0.91 (safe)
  - tests 41/42 passed
  - +3 test(s) added
  - not human-reviewed yet
Risk(write-tool, module): 66/100 -> approve
```

How the quality score is built (`evaluateQuality` / the local mirror in
`src/index.ts`): starts at `1.0`, folds test pass rate (`0.5 + 0.5·passRate`),
penalizes runtime errors, lint, and diffs over 400 lines, rewards added tests,
and flags a `safe` verdict only when `score ≥ 0.6` **and** `errorCount === 0`.
When `actionTool` is given, it also runs `scoreRisk` against that tool and
reports its decision and any hard-stop.

This is the signal that decides whether a **shadow** tool is *promoted* to
`active`, *kept* in shadow, or *rolled back* (`shouldPromote` in
`src/evaluation.ts`, driven by `minRuns` / `minPassRate` / `maxFailures`).

---

### 6. Audit log & rollback

Every state-changing action is written to an **append-only JSONL audit log**, and
the framework keeps **state snapshots** so evolution and compaction can be undone.
Two commands surface it:

```text
/self-audit            # or /self-audit 20   — last 20 entries (default 20)
/self-audit 50
```

Output columns are `time  actor  kind  summary`, e.g.:

```text
     12:04:11  agent   context-remember   remembered 4 fact(s): "deployment strategy"
     12:04:18  system  change-blocked     blocked bash: destructive command detected
     12:05:02  user    tool-activated     activated batch-import v3
```

Audit `kind` values you will see: `memory-write`, `memory-recall`,
`context-remember`, `context-forget`, `skill-learned`, `tool-proposed`,
`tool-activated`, `tool-rolled-back`, `change-approved`, `change-blocked`,
`compaction`. Actors are `agent`, `user`, or `system`.

**Rolling back.** Two layers of undo:

- **Tool level:** `/evolve rollback <name>` flips the latest version to
   `rolled-back` and keeps the prior version intact.
- **State level:** the `SnapshotStore` (`src/audit.ts`) records payloads keyed
  by id plus a `state.json` index, so a compaction or evolution step can be
  reversed to its prior snapshot.

The audit log itself is append-only and lives in the **global** scope
(`~/.pi/agent/self/audit.jsonl`), so it survives across projects and is hard to
silently rewrite. See [Configuration](./configuration.md) for where data is kept.

---

## The bundled slash commands

Three commands give you a quick console. Type them at a prompt in an interactive
session.

| Command | What it does |
| --- | --- |
| `/self` | Dashboard: memory fact count, skill names + versions, and the last 8 audit entries. |
| `/self-audit [n]` | Last `n` audit entries (**default 20**), columns `time / actor / kind / summary`. |
| `/evolve <verb> [name]` | Manage the evolved-tool registry (see below). |

`/evolve` verbs:

```text
/evolve list                   # every tool: name, version, status, blast radius
/evolve show batch-import      # full JSON of the latest version of "batch-import"
/evolve activate batch-import  # run the gate; set active (or report blocked)
/evolve rollback batch-import  # mark the latest version rolled-back
/evolve                        # no verb → behaves like `list`
```

---

*See also:* [Getting started](./getting-started.md) ·
[Configuration](./configuration.md) · [Threat model](./threat-model.md) ·
[Design](./design.md)
