# Developer guide

Build, test, run, and extend the framework, plus the troubleshooting the
maintainers hit. This replaces the old per-session handoff with the up-to-date
developer workflow. For the package overview see the [README](../README.md); for
the safety invariants a change must preserve, see
[Threat model](./threat-model.md).

---

## 1. Build, typecheck, lint, test

MorePi is a pi **extension**: the TypeScript in `src/` is loaded by pi through
`jiti`, so **there is no build step** to *run* the extension, and the default
factory is `morePiExtension(pi)` in `src/index.ts`. You still want a type
compiler and linter to keep the code clean.

After a fresh clone:

```bash
# Work around the macOS npm-cache `rename`/EACCES and pi's heavy install scripts.
npm install --ignore-scripts --no-audit --no-fund --cache /tmp/morepi-npm-cache
```

The full gate set (each must be green):

```bash
npm run typecheck   # tsc --noEmit (TS7 strict: noUncheckedIndexedAccess, verbatimModuleSyntax, noEmit)
npm run lint        # biome check .
npm test            # vitest run
npm run smoke       # node scripts/smoke.mjs — loads the entry via jiti with a stub ExtensionAPI
npm run preview     # pi -e ./extensions/index.ts — needs a TTY; the full interactive experience
```

- **`smoke`** exercises the *real* entry under `jiti`, but swaps the live pi
     `ExtensionAPI` for a stub that captures registered tools/commands/events, so
     it runs headless with **no TTY and no ollama**.
- **`preview`** boots the real extension (or your local override) in a real pi
     session — the end-to-end test. It **needs a TTY**, so run it in an
     interactive terminal (a non-TTY shell prints a hint and exits).
- **Local run, no build:** `pi -e ./extensions/index.ts` (= `npm run preview`)
     or your project's `pi -e ./extensions/index.ts` override.
- **No `build`:** the extension is loaded as `.ts` by jiti; there is no compiled
     artifact. (A compiled bundle is only ever needed *for distribution*, not for
     running the framework.)

### Continuous Integration

`.github/workflows/ci.yml` runs the gates on push / PR to `main`, on a
**Node 22 / 24 matrix**: a clean `--ignore-scripts` install (no lifecycle
scripts) → `npm run lint` → `tsc --noEmit` → `vitest run`. Green on the matrix
means the framework both type-checks and passes its unit tests on current Node.

### Where the code lives

The framework is ESM, one module per concern, all under `src/`.
**[`src/index.ts`](../src/index.ts) is the extension entry point** — start here.
The full module map and per-file responsibilities live in
[`AGENTS.md`](../AGENTS.md) (the section "What this repository is / Repository
layout") — that file is the canonical developer reference and the source an
agent reads before acting.

---

## 2. Testing

- **Framework:** Vitest (`node` environment) over `test/**/*.test.ts`, one suite
    per subsystem (`guardrails`, `audit`, `memory`, `context`, `compaction`,
    `evaluation`, `evolution`, `config`). Target one file:
    `npm test -- test/guardrails.test.ts`. **Add or update the tests that cover
    your change, even when the task did not ask for it**, and keep the six
    safety invariants intact (see [Threat model](./threat-model.md)).
- **End-to-end smoke:** a hand-written `scripts/smoke.mjs` loads the real entry
    through `jiti` with a stub `ExtensionAPI` — see §1.
- **Live run:** `npm run preview` for the full interactive path.
- **CI matrix:** see §1 (Node 22 / 24).

---

## 3. Troubleshooting / FAQ

**"Why is there no `build` / no `dist`?"**
Pi loads the extension as `.ts` via `jiti`, so running it needs no compiled
artifact. `tsc --noEmit` is a *typecheck gate*, not a build step. There is
nothing to build for a local run.

**"`npm run smoke` says `jiti … not installed`."**
Run the gated install (`--ignore-scripts`, scratch cache) from §1. If `jiti` is
absent `smoke` skips *gracefully* with a clear message — it is not a hard
failure.

**"My changes are in `src/`, but `tsc` still complains about old errors."**
`tsconfig` targets both `src` and `test` (`"include": ["src", "test"]`),
`rootDir: "."`, `noEmit: true` — the `.js`-suffixed relative imports resolve under
`moduleResolution: "Bundler"` + `jiti`. Make sure `src/` and `test/` are
included and you are running from the repo root.

**"I run as a non-root user and `npm install` complains about `rename` / EACCES
(macOS)."**
This is the known scratch-cache workaround: `npm install --ignore-scripts
--no-audit --no-fund --cache /tmp/morepi-npm-cache`. `--ignore-scripts` is the
right call because it disables pi-coding-agent's heavy install scripts without
affecting the extension's runtime.

**"I added a new subsystem (or a new module). What else?"**
Wire it in `src/index.ts`: register the tool(s)/command(s)/events, add a test
suite in `test/<name>.test.ts`, and confirm the full gate set (§1) stays green.
For an evolved tool, prefer `modify`/`extend` over `create` and always route
through the gate (see [User guide](./user-guide.md) §4 and
[Threat model](./threat-model.md)).

**"Where does state live, and is it committed?"**
`.pi/self/` is project-local and gitignored; `~/.pi/agent/self/` is the global
audit ledger + snapshots. See [Configuration](./configuration.md) for the full
layout.

**"How do I confirm the extension actually loaded?"**
Run `/self` in an interactive session and watch the `morepi` status widget and
the `session_start` banner — see [Getting started](./getting-started.md) §3.

**"I want a capability off / the guards off."**
Set the matching `enable.*` flag to `false` (Configuration §1): e.g.
`enable.evolve: false` unregisters `evolve_tool` and `/evolve`;
`enable.guardrails: false` makes high-risk actions auto-approve — it is a
deliberate opt-out that the audit log records as `guarded-off`, so keep it on
unless you mean it.

---

*See also:* [Getting started](./getting-started.md) ·
[User guide](./user-guide.md) · [Configuration](./configuration.md) ·
[Threat model](./threat-model.md)
