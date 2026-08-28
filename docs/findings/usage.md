# Using the findings queue

This is the **how-to** for the findings workflow — kept separate from the queue
so the queue itself stays a pure list of pending work. It is the human-readable
companion to the machine skill
[`.agents/skills/process-findings/SKILL.md`](../../.agents/skills/process-findings/SKILL.md).

The workflow turns the [queue](./queue.md) into a finished, evidenced change set,
tracked through three co-located artifacts in `docs/findings/`:

| Artifact | Kind | Role |
| --- | --- | --- |
| `queue.md` | working | The **pending** findings. Addressed items are removed from here. |
| `ledger.md` | append-only record | Disposition + evidence + gates for every **addressed** finding. |
| `.checkpoint.json` | machine state | Resume state; per-item `status`, gates, changed files. |
| `usage.md` (this file) | documentation | How to run the workflow. |

The **checkpoint** is the source of truth for *where we are*; the **ledger** is
the source of truth for *what was done and why*; the **queue** is the source of
truth for *what is left*.

---

## Core rules (do not regress)

1. **One fresh subagent per finding.** `concurrency=1`. No session reuse, no
   transcript passing between items. The orchestrator coordinates; the subagent
   owns the code change **and** runs the gates for its item. For a slow local
   model launch it with a 24h `timeoutMs` and a patient
   `control.needsAttentionAfterMs` (`86_400_000`) so idle thinking is not read as
   a stall (see the slow local-model protocol).
2. **Checkpoint persisted after every item.** Never leave the run with the
   in-memory plan ahead of the on-disk checkpoint.
3. **Resume from the first item whose `status != "done"`.** Work is
   additive/idempotent when scoped to one finding, so resuming is safe.
4. **Gates must be green before an item is marked `done`.** `npm run lint`,
   `npm run typecheck`, `npm test`, `npm run smoke` — record each in the item.
5. **Preserve the six safety invariants** ([threat model](../threat-model.md)): no
   arbitrary code execution, lossless forgetting, framework-source guard, and the
   hard-stop lists (`DESTRUCTIVE`, `PRIVILEGE`, `NETWORK_INJECT`, `SECRET_DIRS`).
   A finding that touches any of them is **sensitive** (below).
6. **Behavior-preserving by default.** Refactor findings keep semantics identical
   and prove it with tests. Never change user-visible wording, gating thresholds,
   or security behavior "for free."

A clean, behavior-preserving pass lands a `src/util.ts` plus
`test/util.test.ts`; the two **sensitive** findings (thresholds, display
wording) are approved explicitly and separately. Suggested order: **C + D + E**
as one coherent, behavior-preserving pass, then **A** and **B** on their own,
with **F** and **G** as small scoped tail items.

---

## Producing findings (generate-findings)

The [generate-findings](../../.agents/skills/generate-findings/SKILL.md) skill is the
producer counterpart to this drain. It reviews the code across four passes —
**structural** (DRY / reduction / reuse / dead code), **semantic** (inline-vs-file
documentation sync), **logical** (control-flow / path tracing), and **safety**
(the six invariants) — one fresh read-only subagent per pass, run **one at a time
(sequential, with a 24h lifetime and a patient `needsAttentionAfterMs` for slow
local models)**, then consolidates, de-duplicates against the checkpoint, and
records the batch through
[findings-log.mjs](../../.agents/skills/generate-findings/scripts/findings-log.mjs):

```bash
node .agents/skills/generate-findings/scripts/findings-log.mjs log <findings.json> [--check]
node .agents/skills/generate-findings/scripts/findings-log.mjs next-id
node .agents/skills/generate-findings/scripts/findings-log.mjs list-pending
node .agents/skills/generate-findings/scripts/findings-log.mjs selftest
```

The writer auto-assigns the next free id per finding, sets a `caveat` for
`Sensitive` findings, re-renders `queue.md`'s `QUEUE-APPEND` region (script-owned —
never hand-edit it), and stamps `.checkpoint.json`. A finding object is
`{ title, category, finding, locations[], recommendation, risk, behavior, priority }`
— see the shape in the generate skill. New pending items use
`status: "pending"`, `disposition: ""`, `summary: ""`, `gates: {}`,
`changedFiles: []`, plus the finding's `category`, `finding`, `recommendation`,
`risk`, `behavior`, and `priority` fields.

`generate` **only proposes** — it never edits `src/`. Addressing a finding is this
workflow's job. After a generate run, `npm run format` then `npm run check` must be
green.

---

## Invoking a run

1. **Load the run.** Read `docs/findings/.checkpoint.json`. Confirm it parses and
   that `gitHeadBaseline` matches the current `git rev-parse HEAD` (or record the
   drift and re-baseline).
2. **Find the next item.**
   ```bash
   node .agents/skills/process-findings/scripts/queue-state.mjs next   # first pending item, or "ALL DONE"
   node .agents/skills/process-findings/scripts/queue-state.mjs status # full table
   ```
3. **For that finding only:** open its section in `queue.md` by id, read the
   current state of the files it cites, then dispatch a **fresh** subagent. Give
  the subagent *only that finding's text* plus the minimal current-state context
   — not the whole transcript. Launch it with `timeoutMs: 86_400_000` and
    `control: { needsAttentionAfterMs: 86_400_000, activeNoticeAfterMs: 86_400_000 }`
   so a slow local model is patient; a `needs_attention` event is a watchdog artifact,
  not a failure — never stop a finding for being slow.
4. **The subagent applies the change and runs all four gates**, returning which
   files it changed, each gate's outcome, and why.
5. **Drain the item.** On green gates: **remove** the finding from `queue.md`,
   **append** its entry to `ledger.md` (disposition + evidence + gates + changed
   files), and update the matching `.checkpoint.json` item (`status`, `gates`,
   `changedFiles`, `updatedAt`). Persist the checkpoint *before* moving on.
6. **Repeat** until `next` reports `ALL DONE`.

---

## Dispositions

Use exactly one `disposition` per item:

- `noop-verify` — already applied in the baseline; verify + record, no change.
- `apply` — apply the change; behavior-preserving, gates prove it.
- `apply-withcare` — apply a change that must preserve a specific per-caller
  behavior; note the preserved behavior in the `caveat`.
- `scoped` — apply only the safe concrete part; defer the rest, documenting why.
- `skip` — do not act; record the reason.

Mark an item `status: "done"` only when its gates are green and the ledger +
checkpoint entries agree.

---

## Sensitive findings

A finding is **sensitive** when it touches gating thresholds, user-visible
wording/behavior, or any of the six invariants (thresholds, hard stops,
destructive shell, privilege escalation, network injection, secret dirs). For a
sensitive item:

- set `caveat` to name the sensitivity,
- get **user-visible confirmation** before or immediately after applying,
- record the drift/confidence in the item summary.

Never "just" change a threshold or a user-visible string as part of a cleanup.

---

## The checkpoint item schema

Each item in `docs/findings/.checkpoint.json`:

```jsonc
{
	"id": "C",                          // matches the finding id in queue.md / ledger.md
	"title": "...",                     // short label
	"status": "pending | in-progress | done",
	"disposition": "noop-verify | apply | apply-withcare | scoped | skip",
	"caveat": "sensitivity or scoping note (omit if none)",
	"summary": "what was done, how, and why",
	"gates": {                         // required when status == "done"
		"lint": "PASS (...)",
		"typecheck": "PASS (...)",
		"test": "PASS (...)",
		"smoke": "PASS (...)"
	},
	"changedFiles": ["src/..."],        // [] for noop-verify / skip
	"updatedAt": "ISO-8601"
}
```

`ledger.md` mirrors this as a human entry (finding, recommendation,
disposition/caveat, evidence, gates, changed files). Keep the two in sync.

---

## Resuming an interrupted run

1. Run `…/queue-state.mjs validate` (parses JSON + checks required fields).
2. Run `…/queue-state.mjs next` to get the first non-`done` item.
3. If its `status` is `in-progress`, treat it as not-yet-committed: re-check the
   gates for the files it touched; if green, finalize the ledger/checkpoint, else
   redo it.
4. Continue the loop.

---

## How to verify after any change

Run the full gate set from the [developer guide](../developer.md) and keep the six
invariants in [threat model](../threat-model.md) intact:

```bash
npm run lint        # biome check .
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run smoke       # node scripts/smoke.mjs
```

Add or update a `test/util.test.ts` for new helpers, and confirm the existing
suites still pass (the public APIs they import are unchanged; only internal
helpers move into `util.ts`).

---

## Safety checklist before you mark a run complete

- [ ] Every addressed finding has a `ledger.md` entry and a `.checkpoint.json`
      item that agree.
- [ ] Every `done` item has all four gates recorded green.
- [ ] Every sensitive item has a `caveat` and (where required) a user-visible
      confirmation noted.
- [ ] Every addressed finding has been **removed from `queue.md`** (the queue
      drains).
- [ ] The six invariants are untouched; `git diff` shows only intended changes.
- [ ] Full `npm run lint`, `npm run typecheck`, `npm test`, and `npm run smoke`
      are green.
