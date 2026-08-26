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

> **The queue is currently empty — every finding has been addressed.** Findings
> **A** through **G** (a point-in-time DRY & reduction review of `src/` and
> `src/tools/evolution.ts`) are recorded, in full, in the
> [ledger](./ledger.md). To re-open work, log a new pending finding at the end of
> the list below using the template, then run the [workflow](./usage.md).

---

## Pending findings

_None. All findings A–G are addressed and recorded in
[ledger.md](./ledger.md)._

---

## How to log a new pending finding

Append a new numbered section to **Pending findings** above, in the next free
id, and add a matching `status: "pending"` item to `.checkpoint.json` (see the
schema in [usage.md](./usage.md#the-checkpoint-item-schema)). Keep the finding
**self-sufficient** — it must carry its own analysis, because once addressed it
leaves this file:

```markdown
## <ID>. <short title>

- **Finding**: <what is duplicated / reduced, and why it matters>
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
