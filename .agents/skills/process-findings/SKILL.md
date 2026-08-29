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
   the minimal current-state context. Launch it with a **long lifetime and a patient
   activity window** so a slow local model (e.g. Ollama) is never killed or
  interrupted for thinking: `timeoutMs: 86_400_000` (a 24-hour lifetime) and
   `control: { needsAttentionAfterMs: 86_400_000, activeNoticeAfterMs: 86_400_000 }`.
    **`needs_attention` / elapsed-timeout events are watchdog artifacts, not
   failures** — do not stop or steer a finding for being slow; only react to a run
    that has actually *ended*, and then resume or retry that single finding, not the
  batch.
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

## Slow local-model protocol

This run is **single-lane by design** (concurrency=1), which is already ideal for a
slow local model: it is never starved by fan-out. Make each finding subagent
patient so long, silent inference is not misread as a stall:

- **24-hour lifetime** per finding — `timeoutMs: 86_400_000` — so a finding is never
   killed for being slow. The 30-minute default is far too short.
- **Patient activity window** — `control: { needsAttentionAfterMs: 86_400_000,
   activeNoticeAfterMs: 86_400_000 }` — so idle *thinking* does not emit
   `needs_attention` and force an interrupt (the 60-second default trips easily).
- **Do not interrupt, stop, or steer for slowness.** A `needs_attention` / elapsed
   event is a watchdog artifact, not a failure; act only when a run has actually
   ended, then *resume or retry* that one finding. When you **block** on the work
   (`subagent_wait` or a session wait), pass `stopOnAttention: false` and a long
    `timeoutMs` so the wait itself does not give up. In an interactive session,
   return control and let Pi wake you on completion — do not spin a poll loop.
