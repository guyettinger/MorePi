# Findings queue

This is a **queue**: the ordered list of findings that are *not yet addressed*.
It is a working document, not a frozen report. The three artifacts that make up
the [findings workflow](./usage.md) live together in `docs/findings/`:

| Artifact | Kind | Role |
| --- | --- | --- |
| `queue.md` (this file) | working | The queue — one section per **pending** finding. Grows when a finding is logged, **shrinks when a finding is addressed**. |
| `ledger.md` | append-only record | One entry per **addressed** finding: disposition, evidence, gates, changed files. |
| `.checkpoint.json` | machine state | Resume state: per-item `status`, gates, changed files. Owned by the run that drains the queue. |
| `usage.md` | documentation | **How to use** the queue and run the workflow (the how-to lives here, *not* in the queue). |

**Queue invariant.** A finding exists in the queue *until it is addressed*. When
an item is addressed:

1. its entry is **removed from this file** (the queue drains),
2. a disposition entry is **appended to `ledger.md`** (nothing is lost — the
   finding text, the recommended fix, and the gates all travel with it),
3. the matching item in `.checkpoint.json` is marked `status: "done"`.

When the queue is empty, the work is complete: `node
.agents/skills/process-findings/scripts/queue-state.mjs next` prints `ALL DONE`.

> The **queue** below is a live, script-owned view of the checkpoint's *pending*
> items — it fills when the
> [generate-findings](../../.agents/skills/generate-findings/SKILL.md) skill records a
> review and drains when [process-findings](../../.agents/skills/process-findings/SKILL.md)
> addresses it. Findings **A** through **G** (a point-in-time DRY & reduction
> review of `src/` and `src/tools/evolution.ts`) are recorded, in full, in the
> [ledger](./ledger.md); none are pending. To produce new findings, run the
> [generate-findings](../../.agents/skills/generate-findings/SKILL.md) skill; to process them, run the
> [workflow](./usage.md). The region between the `QUEUE-APPEND` markers is
> rendered by
> [findings-log.mjs](../../.agents/skills/generate-findings/scripts/findings-log.mjs).

---

## Pending findings

<!-- QUEUE-APPEND-START --><!-- QUEUE-APPEND-END -->

---

## How to log a new pending finding

Findings are produced by the
[generate-findings](../../.agents/skills/generate-findings/SKILL.md) skill, which
records each finding into the checkpoint and re-renders the marked region above —
**do not hand-edit the region between the `QUEUE-APPEND` markers** (a later render
overwrites it). To add a finding by hand (rare), append a finding object to a
batch JSON array and run the companion writer, which assigns the next free id and
keeps the checkpoint + this file in sync:

```bash
# batch file is a JSON array of findings (see the shape below)
node .agents/skills/generate-findings/scripts/findings-log.mjs log findings.json
node .agents/skills/generate-findings/scripts/findings-log.mjs log findings.json --check   # dry run
node .agents/skills/generate-findings/scripts/findings-log.mjs next-id                      # next free id
node .agents/skills/generate-findings/scripts/findings-log.mjs selftest                     # sanity check
```

Each finding object (the writer auto-assigns missing ids and validates enums):

```jsonc
{
	"title": "short title",              // required; unique, idempotency key
	"category": "structural",            // structural | semantic | logical | safety
	"finding": "what is duplicated / reduced / at risk, and why it matters",
	"locations": ["src/memory.ts:250"],  // required; file:line refs
	"recommendation": "the concrete fix",
	"risk": "behavior-preserving? sensitive? which invariant?",
	"behavior": "Preserving",            // Preserving | Sensitive | Mixed
	"priority": "med"                    // high | med | low
}
```

Keeping a finding **self-sufficient** matters: once addressed it leaves this file. The
queue section the writer emits mirrors this shape:

```markdown
## <ID>. <short title>

- **Category**: <structural | semantic | logical | safety> — <blurb>
- **Priority**: <high | med | low>
- **Finding**: <what is duplicated / reduced / at risk, and why it matters>
- **Locations**: <file:line, file:line — where the smell lives>
- **Recommendation**: <the concrete fix>
- **Risk / why flagged**: <behavior-preserving? sensitive? which invariant?>
- **Behavior**: `Preserving` | `Sensitive` | `Mixed`
```

A finding is **sensitive** when it touches a gating threshold, user-visible
wording/behavior, or any of the six safety invariants; say so in **Risk / why
flagged** — sensitive items require explicit user confirmation before or after
they are applied (see [usage.md](./usage.md#sensitive-findings)).

The six invariants a fix must preserve are in
[threat model](../threat-model.md); the gates that must stay green are in
[developer guide](../developer.md).
