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

A maintainer *developing* the framework can enable **develop mode** (`frameworkGuard: "develop"`,
or `MOREPI_DEVELOP=1`), which relaxes that hard-stop so framework-source edits route through the
normal approval/allow path. Every such edit is **recorded in the audit log** (`change-approved,
actor system`), so the opt-in is conscious and reversible, never silent.

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

Scoring is purely **multiplicative**: a class *base* risk is multiplied by a
radius *multiplier*, then rounded. (The additive `0.70 × classWeight + 0.30 ×
blastRadiusWeight` blend was an earlier model; the code implements multiplication.)

`score = round(base[changeClass] × radiusMult[radius])`, then clamped to `0–100`.

| Change class (`ChangeClass`) | Base risk |
| --- | --- |
| `read` | 5 |
| `write-memory` | 20 |
| `write-context` | 25 |
| `write-skill` | 35 |
| `write-tool` | 60 |
| `modify-framework` | 65 |
| `external-effect` | 55 |

| Blast radius (`BlastRadius`) | Multiplier |
| --- | --- |
| `self` | 1 |
| `module` | 1.1 |
| `project` | 1.3 |
| `system` | 1.6 |

Specific rule checks then raise the floor for destructive / privilege /
network-injection commands and for framework-pipeline edits, and hard stops
force a `block` regardless of the resulting score (see §3).

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
the gate never lets through. Each maps to a `rule` label in `scoreRisk` with a
score floor (or a straight hard stop):

| Rule (label) | Floor | Matches |
| --- | --- | --- |
| `system-path` | hard stop | `touchesSystem` — a write/read targeting a system dir (`/etc/`, `/bin/`, `/usr/`, …) or a cwd outside the project |
| `protect-git-history` | hard stop | a command that touches `.git` with `rm` or `git push` |
| `protected-secret` | hard stop | write/edit into `SECRET_DIRS` (`.git/`, `.env`, `.aws/`, `.ssh/`, `.kube/`) — leaks or corruption of credentials and VCS history |
| `framework-source` | hard stop, unless via `/evolve` pipeline (floor 70) or in develop mode (relaxed + audited) | write/edit targeting `frameworkRoot/src` |
| `destructive-command` | 85 | `DESTRUCTIVE`: recursive `rm` in any flag arrangement (short or long-form: `rm -rf`, `rm -fr`, `rm -r -f`, `rm --recursive`, …), `del /s`, `rmdir /s`, `mkfs`, `dd\ if=`, `format`, `> /dev/sd` |
| `privilege-escalation` | 90 | `PRIVILEGE`: `sudo`, `doas`, `runas` |
| `network-injection` | 80 | `NETWORK_INJECT`: `curl`/`wget`/`fetch`/`nc`/`ncat` piped to `sh`/`bash`/`zsh`/`python`/`node` — the path-prefixed (`\… \| /bin/sh`) and versioned (`… \| python3`) forms are now hard-stopped |

A deliberate exception to the `NETWORK_INJECT` hard stop: **download-then-run** 
commands (e.g. `curl e/x.sh -o x.sh && sh x.sh`) are *not* hard-stopped, because only 
*piped* remote execution (`curl … | sh`) is. Such commands fall through to the 
`external-effect` class and are **approval-gated** rather than outright-blocked, so a 
legitimate remote fetch can proceed with human sign-off. This boundary is intentional, 
not incidental, and a test locks in that download-then-run is never a hard stop 
(`test/guardrails.test.ts`).

Plus the **framework-source guard** (§1): by default any tool other than the sanctioned
`/evolve` pipeline is hard-stopped from writing within `frameworkRoot/src`. The single exception
is a consciously enabled **develop mode** (`frameworkGuard: "develop"` / `MOREPI_DEVELOP=1`):
a maintainer editing the framework's own checkout may write to `frameworkRoot/src`, but every
such edit is still logged to the audit ledger, so the opt-in never happens silently.

**Known boundary — `bash` as the raw escape hatch.** The framework-source guard is
enforced only on the structured `write`/`edit` tools' write paths (via
`isFrameworkSource`); the `bash` arm does *not* statically detect redirection or
in-place edits of `frameworkRoot/src` (e.g. `echo x > <frameworkRoot>/src/x.ts`,
`sed -i …`, `tee`). This is deliberate: the `bash` tool is the agent's raw escape
hatch, and statically parsing shell redirections is error-prone and would block
legitimate local commands. The guard is therefore scoped to the structured write/
edit surface; a maintainer who wants `bash` writes to framework source audited too
should stay in `develop` mode (which logs framework-source edits) and treat raw
`bash` as their own responsibility. This is the same intentional-boundary stance
taken for the `NETWORK_INJECT` download-then-run case above.

---

## 4. How to read this

- **Raise `approvalThreshold`** to get fewer prompts for trusted work;
    **lower `blockThreshold`** to be more conservative. (See
    [Configuration](./configuration.md).)
- **The audit log records every gate decision.**
     `change-approved` / `change-blocked` are first-class `AuditEntry.kind` values,
      so **decisions** are logged and reviewable. Caveat: **disabling
      `enable.guardrails` is *not* itself logged** (the guardrail path
      short-circuits, so no entry is written); turning the guards off is a silent,
      deliberate opt-out (see [Developer guide](./developer.md) FAQ).
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
3. **Framework-source guard** — the `/evolve` pipeline stays the *only default* path that
    can write within `frameworkRoot/src`, and it stays routed through approval. `develop` mode
    is the *only sanctioned* way to edit the framework outside that pipeline; it is an audited,
    reversible opt-in (`frameworkGuard: "develop"`, default `protect`) — never a silent relaxation.

---

*See also:* [Design](./design.md) · [User guide](./user-guide.md) ·
[Configuration](./configuration.md)
