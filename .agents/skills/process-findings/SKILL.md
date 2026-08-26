---
name: process-findings
description: >
  Drain the MorePi findings queue to completion, one finding at a time,
  checkpoint-driven and resumable, for the MorePi framework. Use when the user
  asks to "process the findings", "address the review", "work the findings
  queue", "continue the review", "drain the queue", "go through the findings",
   or to resume a partially-finished run. Keeps a live queue, an append-only
  ledger, and a machine checkpoint co-located in docs/findings/; one fresh
  subagent per finding; all quality gates green between items.
---

# Process findings

Drain the **findings queue** ([docs/findings/queue.md](docs/findings/queue.md))
into a finished, evidenced change set, tracked through three co-located
artifacts:

| Artifact | Kind | Role |
| --- | --- | --- |
| `docs/findings/queue.md` | working | The **pending** findings. Addressed items are **removed** from it (the queue drains). |
| `docs/findings/ledger.md` | append-only record | Disposition + evidence + gates for every **addressed** finding. |
| `docs/findings/.checkpoint.json` | machine state | Resume state: per-item `status`, gates, changed files. **This run owns it.** |

The full how-to lives in [docs/findings/usage.md](docs/findings/usage.md) —
**read it first**: core rules, dispositions, the checkpoint schema, resuming, and
the safety checklist. This skill is a terse pointer to that workflow.

## Core loop

1. **Load the run.** Read `docs/findings/.checkpoint.json`; confirm it parses and
   that `gitHeadBaseline` matches `git rev-parse HEAD` (else record the drift).
2. **Next item.**
    ```bash
   node .agents/skills/process-findings/scripts/queue-state.mjs next    # first pending, or "ALL DONE"
    ```
3. **For that finding only:** open its section in `queue.md`, read the current
   state of the cited files, and dispatch a **fresh** subagent (concurrency=1, no
   session reuse, no transcript passing) given *only that finding's text* plus
   the minimal current-state context.
4. **The subagent applies the change and runs all four gates** (`lint`,
   `typecheck`, `test`, `smoke`), returning changed files + each gate's outcome.
5. **Drain the item** on green gates: **remove** it from `queue.md`, **append**
   its entry to `ledger.md`, and update the `.checkpoint.json` item
   (`status: "done"`, `gates`, `changedFiles`, `updatedAt`). Persist the
   checkpoint *before* continuing.
6. **Repeat** until `next` reports `ALL DONE`.

An item is `done` only when its gates are green and the ledger + checkpoint agree.
Preserve the six safety invariants ([threat model](docs/threat-model.md)); a
finding that touches a threshold, user-visible wording, or an invariant is
**sensitive** and needs user-visible confirmation — see usage.md.
