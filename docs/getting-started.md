# Getting started

This guide gets MorePi installed and running on a pi session, and confirms the
extension actually loaded. For the package overview see the
[README](../README.md); for using the capabilities see the
[User guide](./user-guide.md).

---

## 1. Before you start: prerequisites

MorePi is a pi **extension package**, not a standalone binary. It is executed by
pi itself, so you need a working pi installation.

| Requirement | Version | How to check |
| --- | --- | --- |
| **Node.js** | `>= 22.19.0` | `node --version` |
| **pi** | `>= 0.84.2` (the framework is developed against `0.84.2`) | `pi --version` |
| **TypeBox** | `1.3.x` (a peer dependency pi provides) | already in your pi tree |

MorePi is loaded by pi through `jiti`, so **there is no build step for the
extension itself**: the TypeScript in `src/` runs directly. You do, however,
need a TypeScript compiler and Biome **only** if you build or test the
framework locally (see the [Developer guide](./developer.md)).

> **Environment note (macOS, from the maintainers).** On some macOS setups the
> system npm cache (`~/.npm`) has an ownership problem that makes `npm install`
> fail on a `rename`. The workaround used throughout development is to use a
> scratch cache and `--ignore-scripts`:
>
> ```bash
> npm install --ignore-scripts --no-audit --no-fund --cache /tmp/morepi-npm-cache
> ```
>
> `--ignore-scripts` is recommended by pi itself because `pi-coding-agent` ships
> heavy install scripts; it does not affect the extension's runtime.

---

## 2. Installing MorePi

Pick **one** of the routes below. All three end with the extension on disk so
pi can discover it via the `pi.extensions: ["extensions"]` manifest in
`MorePi/package.json`.

### 2.1 As a pi extension (recommended, user-level)

```bash
pi install morepi
```

This drops the package into your pi extensions directory and pi loads it on the
next start.

### 2.2 As a dev dependency (local use)

```bash
npm install morepi
```

### 2.3 By hand, into your agents' extensions directory

```bash
mkdir -p ~/.pi/agent/extensions
cp -r path/to/your/cloned/morepi ~/.pi/agent/extensions/morepi
```

To run a **local checkout** directly (no install needed):

```bash
pi -e ./extensions/index.ts
```

or, from the MorePi repo, the convenience script:

```bash
npm run preview    # == pi -e ./extensions/index.ts (interactive, needs a TTY)
```

> **Requirements recap:** Node `>= 22.19.0`. No build step is required to *run*
> the extension; pi loads `extensions/index.ts` via `jiti`, which re-exports the
> default factory `morePiExtension(pi)` from `src/index.js`.

---

## 3. Launching and verifying MorePi is active

You know MorePi is loaded when three things happen at startup:

1. A status widget labeled **`morepi`** appears in the TUI showing
   `"MorePi active"` (set on `session_start`, cleared on `session_shutdown`).
2. The framework's tools are registered (check them with the dashboard, below).
3. No errors are emitted while pi loads `extensions/index.ts`.

### First check: the `/self` dashboard

Once in an interactive session, run:

```text
/self
```

Output (in a TUI this is a widget; otherwise a notification):

```text
MorePi
- memory facts: 12
- skills (3): db-migration, weekly-report, evolve-batch-import
- recent audit (last 8 of 47):
    context-remember :: remembered 4 fact(s): "deployment strategy"
    memory-write :: recorded fact: "we ship to canary first, then prod"
     ...
Run /evolve list or /self-audit for more.
```

This is your at-a-glance health check: how many durable facts exist, which
skills have been generated, and the tail of the audit log.

### Verifying tool registration

The framework registers these **tools** (each is gated by the `enable.*` flags
in [Configuration](./configuration.md); all are `true` by default):

| Tool | Subsystem |
| --- | --- |
| `memory_write`, `memory_recall` | Persistent memory |
| `context_remember`, `context_forget` | Context control |
| `self_learn` | Self-learning |
| `evolve_tool` | Governed tool evolution |
| `self_eval` | Evaluation & promotion |

…plus three **commands**: `/self`, `/self-audit`, and `/evolve` (detailed in the
[User guide](./user-guide.md)). You can also ask the agent, in plain language:
*"list the MorePi tools you have"* — the prompt snippets (`promptSnippet` /
`promptGuidelines`) wire each tool into the model's system prompt so it knows
when to reach for them.

> Nothing is auto-executed. `self_learn` and `evolve_tool` **record** artifacts
> for your review; activation is always a separate, gated step you run.

---

*See also:* [README](../README.md) · [User guide](./user-guide.md) ·
[Configuration](./configuration.md) · [Threat model](./threat-model.md) ·
[Design](./design.md)
