# Threat model & safety invariants

Every state-changing action the framework performs passes through a single
governance gate, and the framework holds three invariants that exist to protect
you from its own self-modification. This is the canonical statement of the
safety model; the design *rationale* and the reference systems behind it are in
[Design](./design.md). A change that touches this material must keep all three
invariants intact — see "Do not regress" at the end.

---

## 1. The three core invariants

- **Declarative evolution.** `evolve_tool` records a `ToolEvolutionInput` record
   (name, behavior prompt, parameters, budget); activation materializes it as a
   reviewable `SKILL.md` in the project skill library. It is **never `eval()`,
    `new Function()`, or any code eval.** Behavior is data, not code.
- **Lossless, transient forgetting.** `context_forget` prunes only the `mem_<id>`
    custom messages *this* framework injected (matched by a substring of the
    user's query). It **never touches user or tool messages** in session history
    and **never uses `isError`/`isEmpty` heuristics.** Forgetting reclaims
    window space without destroying information — the underlying fact remains in
    memory.
- **Framework-source guard.** Edits within the framework's own
     `frameworkRoot/src` are **hard-stopped for every tool** except the
     sanctioned `/evolve` pipeline, which routes through the approval gate at
     activation time. The extension's own source cannot be rewritten by
    arbitrary in-session tool use.

---

## 2. The governance gate

`src/guardrails.ts` and `src/approval.ts` form one gate. Every mutating action
passes through it in four steps:

1. **Risk scoring** (`scoreRisk`) — assigns a 0–100 composite score.
2. **Hard stops** — certain patterns are blocked regardless of score.
3. **Decision** (`decide`) — maps the score to allow / approve / block.
4. **Approval** — the `Gate` (`createGate` in `src/approval.ts`) prompts the user
     via `ctx.ui.confirm` in the "approve" range; "allow" passes silently;
     "block" is refused.

### Risk scoring

`score = 0.70 × classWeight + 0.30 × blastRadiusWeight`

| Change class (`ChangeClass`) | Base risk |
| --- | --- |
| `read` | 0 |
| `write-memory` | 20 |
| `write-context` | 30 |
| `write-skill` | 40 |
| `write-tool` | 60 |
| `modify-framework` | 65 |
| `external-effect` | 80 |

| Blast radius (`BlastRadius`) | Increment |
| --- | --- |
| `self` | 0 |
| `module` | 15 |
| `project` | 35 |
| `system` | 60 |

### Decisions (`decide`)

With `approvalThreshold = 55` and `blockThreshold = 80` (both
[configurable](./configuration.md)):

- `score === 0` → **allow silently**
- `0 < score < 55`  → **allow silently**
- `55 ≤ score < 80` → **prompt for approval**
- `score ≥ 80`      → **block outright**

---

## 3. Hard stops

These are blocked **regardless of score** — they are the "blown up" patterns
the gate never lets through:

| Guard | Matches | Reason |
| --- | --- | --- |
| `DESTRUCTIVE` | `rm -rf`, `rm -r`, `rm -fr`, `dd if=`, `mkfs`, `shutdown`, `reboot`, `halt`, `> /dev/sd`, `truncate`, `shred -f`, `> /dev/null` | Irreversible system/file damage. |
| `PRIVILEGE` | `sudo`, `doas`, `su ` | Privilege escalation. |
| `NETWORK_INJECT` | `curl ... | sh`, `curl ... | bash`, `wget ... | bash`, `wget ... | sh` | Remote code execution. |
| `SECRET_DIRS` | Path touches `.git/`, `.env`, `.aws/`, `.ssh/`, `.kube/` | Leaks or corruption of credentials and VCS history. |

Plus the **framework-source guard** (§1): any tool other than the sanctioned
`/evolve` pipeline is hard-stopped from writing within `frameworkRoot/src`.

---

## 4. How to read this

- **Raise `approvalThreshold`** to get fewer prompts for trusted work;
    **lower `blockThreshold`** to be more conservative. (See
    [Configuration](./configuration.md).)
- **The audit log records every gate.** `change-approved`, `change-blocked`, and
     `guarded-off` are first-class `AuditKind`s, so any opt-out of the guards is
    itself logged and reviewable (see [Developer guide](./developer.md) FAQ).
- When evaluating an evolved tool, use `self_eval` for an **advisory** quality
    read and `shouldPromote` for the shadow→active promotion gate. Humans remain
    the gate; `self_eval` never auto-approves.

---

## Do not regress

These invariants protect the user and are enforced by the gates above. A change
that touches `src/` must keep all three intact (`AGENTS.md` repeats this so an
agent reads it before acting):

1. **No arbitrary code execution** — `evolve_tool` stays fully declarative; do
     not reintroduce `eval` / `new Function` / code eval.
2. **Lossless forgetting** — `context_forget` continues to prune only framework
    injected `mem_<id>` messages, matched by query substring. No
    `isError`/`isEmpty` heuristics.
3. **Framework-source guard** — the `/evolve` pipeline stays the *only* path that
    can write within `frameworkRoot/src`, and it stays routed through approval.

---

*See also:* [Design](./design.md) · [User guide](./user-guide.md) ·
[Configuration](./configuration.md)
