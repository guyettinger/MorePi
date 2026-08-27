---
name: generate-findings
description: >
  Produce a code-review findings batch for the MorePi framework and record it into
  the findings queue, then let the process-findings skill drain it. Use when the
  user asks to "generate findings", "audit the codebase", "review the code for
  improvements", "find ways to DRY / reduce / improve", "check the docs are in
  sync", "trace the logic for issues", or to "run a review pass". It works the
  code across three dimensions — structural (DRY, reduction, reuse, dead code),
  semantic (inline-vs-file documentation sync), and logical (control-flow /
  path-trace issues) — plus a safety-invariant pass. Each pass is a fresh
  read-only subagent; findings are consolidated, de-duplicated against the
  checkpoint, prioritized, and logged to docs/findings/queue.md + .checkpoint.json
  via .agents/skills/generate-findings/scripts/findings-log.mjs.
---

# Generate findings

This is the **producer** half of the findings workflow. It *fills* the queue that
[process-findings](../process-findings/SKILL.md) *drains*. Run **generate** to
collect a review; run **process** to address it. The three artifacts are
co-located in `docs/findings/`:

| Artifact | Kind | Role |
| --- | --- | --- |
| `docs/findings/queue.md` | working | Pending findings. **Script-owned** between the `QUEUE-APPEND` markers. |
| `docs/findings/.checkpoint.json` | machine state | Resume + de-dup index. |
| `docs/findings/ledger.md` | append-only | Addressed findings. Touched only by process-findings. |

The companion how-to lives in
[docs/findings/usage.md](../../../docs/findings/usage.md); the safety invariants to
preserve while *fixing* are in
[threat model](../../../docs/threat-model.md), and the gates that must stay green
are in [developer guide](../../../docs/developer.md).

> **This skill only *proposes*.** It writes pending findings; it does not touch
> `src/`. Applying a fix is process-findings' job, one fresh subagent per finding,
> with the four gates green. A finding that is **Sensitive** or **safety** is
> recorded with a `caveat` and needs user-visible confirmation *when it is
> applied* — generate just flags it.

---

## The four passes

Each pass is analysis, not change. Dispatch one **fresh** subagent per pass —
read-only, no session reuse between passes. Passes are independent, so they may
run in parallel (concurrency > 1 is safe; *writing* is still serialized through one
`findings-log.mjs log` call). Give each subagent the pass brief below *plus* the
minimal current-state it needs (the file it is tracing); never the whole
transcript.

### 1. Structural — DRY / reduction / reuse / dead code

Hunt for code that should be shared or removed. Concrete targets:

- **Duplication.** Near-identical functions/blocks in different files. `src/util.ts`
  is the canonical home for shared order-preserving / id / dir / tokenize helpers —
  anything still living in a subsystem that another subsystem has should move there.
- **Reduction.** Functions that can be simplified, collapsed, or expressed with an
  existing helper. Look for the same idiom written out twice.
- **Dead code.** Unused exports, re-exports with zero importers, dead branches
  (a branch whose result equals its fall-through), unreachable returns, swallowed
  results.
- **Cross-cutting.** Same concern expressed in `src/` and `src/tools/evolution.ts`,
  or repeated config/threshold literals that should route through
  `DEFAULT_CONFIG`.

### 2. Semantic — documentation sync

Inline comments and file-based docs must agree with the code. Check:

- The **AGENTS.md** file-responsibility table and the six-capabilities table
  (file → role, tool names, slash commands) versus the actual `src/` modules and
  registered tools in `src/index.ts`.
- **Inline comments / JSDoc** that contradict the code they sit above (stale
  "always", "never", line refs, removed concepts).
- **Docs prose** (`docs/*.md`, README) that references removed items, wrong
  thresholds, or a threshold/threshold-wording that no longer matches
  `DEFAULT_CONFIG` (`approvalThreshold` / `blockThreshold`).
- **Wording drift**: user-visible strings in `src/` (e.g. `self_eval` notes,
  approval confirmations) versus what the docs say they say.

### 3. Logical — control-flow / path tracing

Trace the real execution paths and find logic issues or improvements:

- **Governance path.** `classifyAction` → `scoreRisk` → `decide` → the `Gate`
  (`approval.ts`) → audit write. Is every state-changing tool routed through it?
  Can any `changeClass`/`radius` combination *silently* clear or miss a threshold?
  Is any `if` branch effectively dead (e.g. a branch that returns the same value as
  its fall-through)?
- **Every tool handler** registered in `src/index.ts` — missing `await`, swallowed
  `catch`, an `?? 0` that hides `undefined` under `noUncheckedIndexedAccess`, an
  off-by-one, a guard that can never fire.
- **Every event handler** — `context` injection/pruning, session/branch
  reconstruction in `registry.ts`, `StoreManager` memoization races.
- **Invariant checks** (pass 4 overlaps here): lossless forgetting prunes *only*
  `mem_<id>` messages this framework injected; the framework-source guard is
  enforced for every tool except the sanctioned `/evolve` pipeline; the hard-stop
  lists (`DESTRUCTIVE`, `PRIVILEGE`, `NETWORK_INJECT`, `SECRET_DIRS`) are not
  weakened.

### 4. Safety invariant pass

Verify — read only — that the six invariants in the threat model still hold in
code: no arbitrary code execution (evolution is declarative), lossless
forgetting, framework-source guard, and the hard-stop lists. Any weakness is a
**safety** finding with `behavior: "Sensitive"`. A finding here is flagged but
**never auto-applied** — it always carries a `caveat` and requires explicit user
confirmation.

---

## Finding shape

Each finding is one object. The writer (`findings-log.mjs`) auto-assigns the id,
validates the enums, and sets the `caveat` automatically when `behavior` is
`Sensitive`:

```jsonc
{
	"title": "short, specific, noun-phrase title",   // required; idempotency key
	"category": "structural",        // structural | semantic | logical | safety
	"finding": "what is wrong / duplicated / at risk, and why it matters",
	"locations": ["src/memory.ts:250", "src/util.ts:20"],  // required; file:line
	"recommendation": "the concrete fix",
	"risk": "behavior-preserving? sensitive? which invariant? which threshold?",
	"behavior": "Preserving",     // Preserving | Sensitive | Mixed
	"priority": "med"             // high | med | low
}
```

**Category** drives the blurb in the queue and which pass owned the finding:

| Category | What it is |
| --- | --- |
| `structural` | DRY / reduction / reuse / dead code |
| `semantic` | documentation sync (inline vs file-based) |
| `logical` | control-flow / path-trace issue |
| `safety` | one of the six safety invariants is at risk |

**Behavior** drives the `caveat` and how process-findings treats the fix:

- `Preserving` — the fix keeps semantics byte-identical; proven by a test. No
  sensitivity.
- `Mixed` — partly preserving, partly user-visible; split the change or note it.
- `Sensitive` — touches a gating threshold, user-visible wording, or an invariant;
  needs **user-visible confirmation** when applied. generate sets a `caveat`
  automatically; say so in `risk`.

---

## Core loop

1. **Baseline.** Confirm the working tree is clean of unrelated noise
   (`git status`); record `git rev-parse HEAD` (the checkpoint's
   `gitHeadBaseline`). Note it if it drifts from the checkpoint.
2. **Dispatch the passes.** One fresh read-only subagent per pass (parallel ok).
   Each returns a list of findings in the shape above, each **self-sufficient**
   (its own analysis — it leaves the checkpoint once addressed).
3. **Consolidate + de-dup.** Drop any finding whose title already exists in
   `.checkpoint.json` (any status) — that smell was already logged or addressed.
   Merge near-identical findings; keep the strongest. Rank by `priority`.
4. **Write the batch.** Put the surviving findings in a JSON array
   (e.g. `docs/findings/.pending-batch.json`) and log them:
   	```bash
   node .agents/skills/generate-findings/scripts/findings-log.mjs log docs/findings/.pending-batch.json --check
   	```
   The writer auto-assigns the next free ids (it prints them), sets each
   `caveat`, re-renders `queue.md`'s marker region, and stamps the checkpoint.
5. **Normalize.** Run the formatter so the newly written JSON passes lint, then the
   full gate:
   	```bash
   npm run format          # biome normalizes the tab-formatted checkpoint + queue
   	npm run check         # lint + typecheck — both must be green
   	```
6. **Report.** Print the ids + titles of the findings just logged, their
   `behavior`, and how many are **Sensitive** (these need user-visible confirmation
   before they are *applied*). Then remove the batch file if it was a scratch
   artifact.
7. **Hand off.** Tell the user the queue is filled and to run
   [process-findings](../process-findings/SKILL.md) to drain it.

---

## Rules (do not regress)

1. **Read-only on `src/`.** This skill never edits framework source; it only
   *proposes*. Applying a fix is process-findings' job.
2. **One fresh subagent per pass.** No session reuse between passes; a subagent
   sees only its brief + the minimal current-state, not the transcript.
3. **De-dup against the checkpoint.** Never re-log a finding whose title is already
   recorded. The title is the idempotency key.
4. **Every finding is self-sufficient.** It carries its own analysis, so it is
   still actionable after it leaves the queue.
5. **Flag sensitivity, never act on it.** Sensitive / safety findings get a
   `caveat` and a `Sensitive` behavior; the *user*, at apply time, confirms.
6. **Preserve the six invariants in the report.** Any finding that would touch one
   is `safety`/`Sensitive`. (See [threat model](../../../docs/threat-model.md).)
7. **Keep the gates green.** After writing the batch, `npm run format` +
   `npm run check` must be green.

---

## How to verify a generate run

- `node .agents/skills/generate-findings/scripts/findings-log.mjs list-pending`
   shows the just-added findings; `next-id` shows the next free id.
- `node .agents/skills/generate-findings/scripts/findings-log.mjs selftest` passes.
- `queue.md`'s marker region lists the pending findings; `.checkpoint.json` has a
   matching `status: "pending"` item per finding.
- `git diff` shows only `docs/findings/*` and the (optional) batch file changed —
   **no `src/` edits**.
- `npm run check` is green.

---

## Where to read more

- [Process findings](../process-findings/SKILL.md) — the drain half.
- [docs/findings/usage.md](../../../docs/findings/usage.md) — the checkpoint item
   schema, dispositions, resuming, sensitive findings, and the safety checklist.
- [docs/findings/queue.md](../../../docs/findings/queue.md) — the live pending list.
- [docs/threat-model.md](../../../docs/threat-model.md) — the invariants to preserve
   when a finding is eventually *fixed*.
