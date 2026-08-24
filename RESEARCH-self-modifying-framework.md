# Research: Smallest Self-Modifying App Framework (Pi + Local Ollama, TypeScript)

## TL;DR

Pi is already an agent harness. The smallest self-modifying framework is **~150–250 lines of TypeScript** — one Ollama provider config + one "evolution loop" extension that uses Pi's existing `ctx.newSession()`, `ctx.reload()`, `pi.registerTool()`, and `pi.registerCommand()` primitives. The model runs 100% locally. No additional dependencies beyond `@earendil-works/pi-coding-agent`.

---

## 1. The Building Blocks (What Pi Already Gives You)

Pi ships a complete agent loop. You don't build the loop; you configure it.

| Capability | Pi primitive | Location |
|---|---|---|
| Agent loop (prompt → think → tool → repeat) | `createAgentSession()` | Core SDK |
| Streaming + event subscription | `session.subscribe()` | Core SDK |
| Tool execution (read, write, edit, bash, grep, find, ls) | Built-in tools | Core SDK |
| Custom tools (register at any time) | `pi.registerTool()` | Extension API |
| Dynamic reload of extensions/skills/prompts | `/reload` / `ctx.reload()` | Extension API |
| Fresh sessions (Ralph pattern) | `ctx.newSession()` / `ctx.fork()` | Extension API |
| Session persistence + branching | `SessionManager` tree | Core SDK |
| Context compaction | `session.compact()` / auto-compaction | Core SDK |
| Event interception / guards | `pi.on("tool_call", …)` | Extension API |
| System prompt mutation | `pi.on("before_agent_start", …)` | Extension API |
| Provider abstraction | `pi.registerProvider()` or `models.json` | Extension / config |
| Ollama support | Built-in `openai-completions` API type | Native |

**The key insight:** you do *not* need to build a loop. Pi IS the loop. Self-modification = an extension that modifies the system's own artifacts (code, extensions, prompts, tools) and triggers a reload or new session.

---

## 2. Ollama Provider — 10 Lines

Ollama speaks OpenAI-compatible `/v1/chat/completions`. Pi already supports this.

### Option A: `~/.pi/agent/models.json` (zero code)

```jsonc
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",             // placeholder; Ollama ignores it
      "compat": {
        "supportsDeveloperRole": false,    // Ollama uses "system" not "developer"
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": false
      },
      "models": [
        { "id": "qwen2.5-coder:7b", "contextWindow": 32768, "maxTokens": 8192 },
        { "id": "llama3.1:8b",      "contextWindow": 131072, "maxTokens": 8192 }
      ]
    }
  }
}
```

Reload at any time via `/model`. No restart needed.

### Option B: Extension for dynamic model discovery (fetches `/v1/models`)

```typescript
// extension: ollama-provider.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const res = await fetch("http://localhost:11434/v1/models");
  const { data } = await res.json();

  pi.registerProvider("ollama", {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    api: "openai-completions",
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
    },
    models: data.map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.context_window ?? 32768,
      maxTokens: m.max_tokens ?? 8192,
    })),
  });
}
```

This is the pattern from Pi's `custom-provider-gitlab-duo` example, simplified for Ollama.

---

## 3. Self-Modification Pattern (What the Loop Actually Is)

Based on research of three reference systems:

### 3a. Ouroboros (arxiv 2608.08311) — the "full" self-developing agent

Components:
- **Launcher/Supervisor** (non-mutable): process startup, panic-stop, release bootstrapping
- **Evolvable body** (mutable): source code, prompts, tools, memory, architecture
- **Constitution** (protected): always-loaded, re-read each iteration, cannot be deleted
- **Commit pipeline**: preflight → stage diff → multi-model review → fingerprint → commit
- **Three runtime modes**: `light` (blocks edits), `advanced` (permits edits, protects governance), `pro` (permits protected edits w/ review)
- **Safety**: panic-stop channel (operator-only, non-bypassable), spend cap (agent-can't-raise), git reversibility

### 3b. pi-ralph-lingum-loop — the "practical" self-improvement loop

Components (~1 file):
1. **Bootstrap** (iteration 0): agent writes `PROMPT.md` (constitution) + `plan.md` (checklist)
2. **Per iteration:**  compose prompt = `PROMPT.md` + `learnings.md` + `plan.md` + protocol
3. **Fresh `ctx.newSession()`** runs one plan item, verifies, commits
4. **Distill:** agent merges lessons into `learnings.md` (the self-improvement channel)
5. **Done-check:** agent writes `.ralph/DONE` when all items + verification pass
6. **Repeat** until DONE, stall (3 consecutive no-progress), or `/ralph-stop`

Safety: stall detector, kill switches, git commits per iteration.

### 3c. nanoagent — the "essence" (~100 lines Python)

Minimal agent = **3 tools + 1 loop**:
1. Send messages + tool schemas → LLM
2. Receive tool calls or final answer
3. Execute tools, append outputs
4. Repeat until no tool calls

Pi already IS this loop. Everything above it is optional layering.

### 3d. pi-reflect (jo-inc) — the "surgical edit" pattern

- Collects evidence (transcripts, logs, files)
- LLM proposes *surgical edits* to target markdown files (`AGENTS.md`, `MEMORY.md`)
- Safety: dry-run diff, reject large deletions, backup, auto-git-commit
- Convergence metric: correction rate trending down over runs

---

## 4. Smallest Viable Self-Modifying Framework (MVP)

**Stack:** Pi SDK + Ollama + 1 extension (~150–200 lines)

### Architecture diagram

```
┌─────────────────────────────────────────────────────┐
│  LAUNCHER (you write this, ~30 lines)                │
│                                                      │
│  createAgentSession({ model: ollama, tools, ... })   │
│  session.subscribe() → log/stream                     │
│  session.prompt(mission)                              │
│                                                      │
│  Or: pi CLI with extension loaded                    │
│  pi -e ./evolve.ts --model ollama/qwen2.5-coder:7b   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  PI (the loop, already built)                        │
│                                                      │
│  prompt → LLM → tool call → execute → append →       │
│  repeat → agent_end                                  │
│                                                      │
│  Ollama provider (models.json or extension)          │
│  Built-in tools: read, write, edit, bash, grep, find │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  EVOLUTION EXTENSION (~100–150 lines)                │
│                                                      │
│  on agent_end:                                       │
│    1. Read .evolve/state.json                        │
│    2. If next_action != "done":                      │
│       a. Compose next-iteration prompt from:         │
│          - .evolve/constitution.md (PROTECTED)        │
│          - .evolve/lessons.md (distilled learnings)   │
│          - .evolve/plan.md (remaining items)          │
│       b. ctx.newSession() → withSession:             │
│          ctx.sendUserMessage(composedPrompt)          │
│       c. Agent runs, modifies .evolve/ files:        │
│          - Updates plan.md (check off items)          │
│          - Appends/rewrites lessons.md                │
│          - May write new tools/extensions via         │
│            write tool (auto-loaded on reload)         │
│    3. Stall detector: 3 no-progress → abort           │
│    4. Constitution guard: never delete/modify         │
│       constitution.md via tool_call intercept         │
│                                                      │
│  Safety:                                             │
│  - tool_call guard on "edit"/"write" to constitution  │
│  - Stall detector                                    │
│  - /evolve-stop command + .evolve/STOP file          │
│  - git commit per iteration (reversibility)           │
└─────────────────────────────────────────────────────┘
```

### Files in `.evolve/`

| File | Writer | Purpose |
|---|---|---|
| `constitution.md` | Human (or bootstrap) | Immutable mission + invariants + what's protected |
| `plan.md` | Agent | Checklist, one item per iteration |
| `lessons.md` | Agent | Distilled learnings, rewritten each iteration |
| `state.json` | Extension | `{iteration, stallCount, goal, lastAction}` |
| `history.jsonl` | Extension | Append-only log of all iterations |
| `DONE` | Agent | Written when all done + verified |
| `STOP` | Human | `touch .evolve/STOP` to halt |

### Minimal extension sketch (pseudo-TS)

```typescript
// evolve.ts — ~150 lines
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  const DIR = join(process.cwd(), ".evolve");
  ensureState();

  // ── Safety guard: protect constitution ──
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = (event.input as any)?.path ?? (event.input as any)?.file;
      if (path?.includes("constitution.md")) {
        return { block: true, reason: "Constitution is protected" };
      }
    }
  });

  // ── Self-evolution loop ──
  pi.on("agent_end", async (_event, ctx) => {
    const state = readState();
    if (existsSync(join(DIR, "DONE")) || existsSync(join(DIR, "STOP"))) return;

    // Stall detection
    if (!checkProgress(state)) {
      state.stallCount++;
      if (state.stallCount >= 3) {
        ctx.ui.notify("Stall detected. Aborting.", "error");
        writeState(state);
        return;
      }
    } else {
      state.stallCount = 0;
    }
    state.iteration++;
    writeState(state);

    // Compose next prompt
    const nextPrompt = composePrompt(state);

    // Fresh session with the composed prompt
    await ctx.newSession({
      withSession: async (ctx2) => {
        await ctx2.sendUserMessage(nextPrompt, { deliverAs: "steer" });
      },
    });
  });

  // ── Kill switch ──
  pi.registerCommand("evolve-stop", {
    description: "Stop the self-evolution loop",
    handler: async (_args, ctx) => {
      writeFileSync(join(DIR, "STOP"), "");
      ctx.ui.notify("Evolution stopped", "info");
    },
  });

  // ── Register a self-reload tool (agent can call it to hot-reload) ──
  pi.registerTool({
    name: "self_reload",
    label: "Self-Reload",
    description: "Reload extensions, tools, and config after self-modification",
    parameters: Type.Object({}),
    async execute() {
      // Tools can't call ctx.reload(); use command queue
      pi.sendUserMessage("/reload", { deliverAs: "followUp" });
      return {
        content: [{ type: "text", text: "Reloading..." }],
        details: {},
      };
    },
  });
}

function composePrompt(state: State): string {
  const constitution = readFileSync(join(DIR, "constitution.md"), "utf-8");
  const lessons = existsSync(join(DIR, "lessons.md"))
    ? readFileSync(join(DIR, "lessons.md"), "utf-8") : "";
  const plan = existsSync(join(DIR, "plan.md"))
    ? readFileSync(join(DIR, "plan.md"), "utf-8") : "";

  return `## Constitution (PROTECTED)\n${constitution}\n\n` +
         `## Lessons from previous iterations\n${lessons || "None yet"}\n\n` +
         `## Remaining Work\n${plan || "No plan yet — create one"}\n\n` +
         `## Instructions\n` +
         `- Pick ONE remaining item from the plan\n` +
         `- Implement it using your available tools\n` +
         `- Update .evolve/plan.md (check off the item)\n` +
         `- Update .evolve/lessons.md with what you learned\n` +
         `- If all items are done, run verification, then create .evolve/DONE\n` +
         `- May write new tools/extensions to .pi/extensions/ and call /reload\n`;
}
```

---

## 5. What Pi's Architecture Enables for Self-Modification

| Self-mod surface | Pi mechanism | Hot-reload? |
|---|---|---|
| System prompt | `before_agent_start` handler or `ctx.getSystemPrompt()` | Per-iteration (no reload) |
| Context / messages | `on("context", …)` returns filtered messages | Per-turn |
| New/changed tools | Agent writes `.pi/extensions/my-tool.ts` → `pi.reload()` | Yes, via `/reload` or `ctx.reload()` |
| New/changed skills | Agent writes `.pi/skills/` or `.agents/skills/` markdown → reload | Yes |
| New/changed prompts | Agent writes `.pi/prompts/` markdown → reload | Yes |
| Provider models | `models.json` edit → next `/model` picks up changes | Yes |
| Session branching | `ctx.fork()`, `ctx.newSession()`, SessionManager tree | Instant |
| Extension logic | Agent edits `.pi/extensions/` → `/reload` | Yes |
| Architecture / data flow | Agent edits its own `.evolve/` config → next iteration | Per-iteration |
| Constitution / invariants | Protected via `tool_call` intercept | **Never mutable by agent** |

Extensions are loaded via **jiti** (TypeScript, no build step). The agent can write `.ts` files and `/reload` picks them up immediately.

---

## 6. Ollama-Specific Considerations

| Concern | Guidance |
|---|---|
| Model size vs. context | Local models have limited *usable* context. 7B models hit ceiling fast. Micro-tasks work; multi-file agentic work needs 14B+ with enough RAM |
| `compat` block | **Required.** Set `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `supportsUsageInStreaming: false` |
| Tool calling | Ollama supports `tools` (function calling) via OpenAI compat. Qwen2.5-coder is the best current option for coding tasks |
| Speed | Benchmark your hardware. The agentic loop is serial-wait-bound. A 7B on M-series may be ~5–15 tok/s |
| `apiKey` | Use placeholder string `"ollama"` — Pi requires *some* auth presence to mark models as available |
| Context window | Set honestly. 32K for small models, not 128K. The model's *effective* usable context is smaller than advertised |
| Thinking models | Ollama v0.13.3+ supports `reasoning: {effort}` via OpenAI compat. Use `thinkingFormat: "openrouter"` or `"together"` in compat if desired |

---

## 7. Risk / Safety Taxonomy

From Ouroboros, pi-ralph, and pi-reflect:

| Risk | Mitigation |
|---|---|
| **Constitution drift** (agent rewrites its own rules) | `tool_call` intercept blocks write/edit to constitution.md. Constitution re-read from disk each iteration |
| **Runaway cost** (infinite loop) | Stall detector + hard iteration budget + `/evolve-stop` + `.evolve/STOP` |
| **Destructive changes** (agent deletes key code) | Per-iteration git commits. `git revert` is the undo. Gondolin VM sandbox option for isolation |
| **Context rot** (fresh agent doesn't know what happened) | Lessons channel (`lessons.md`). Distill, don't append. Compaction as backstop |
| **Silent failure** (agent claims DONE but didn't) | Skeptic verification step. Agent reviews its own output critically before writing DONE |
| **Process safety** (agent runs `rm -rf /`) | `tool_call` guard on dangerous bash. Gondolin micro-VM for full isolation |

---

## 8. Dependency Surface

| Dependency | Purpose | Why |
|---|---|---|
| `@earendil-works/pi-coding-agent` | Agent loop, tool execution, session, provider | Core harness |
| `@earendil-works/pi-ai` | Provider types, model resolution | Transitive |
| `typebox` | Tool parameter schemas | Transitive (Pi extension convention) |
| `node:fs`, `node:path` | `.evolve/` state management | Built-in |
| **Ollama** (running locally) | LLM inference | `ollama pull qwen2.5-coder:7b` |

**No npm install of additional packages needed.** Pi is the framework. Extensions are jiti-loaded TypeScript.

---

## 9. Build Sequence (Suggested)

1. **Day 0:** Get Pi + Ollama working end-to-end. `models.json` with Ollama. Run a prompt.
2. **Day 1:** Write `bootstrap` — agent creates `.evolve/constitution.md` + `.evolve/plan.md` from a mission string.
3. **Day 1:** Write `evolve.ts` extension — the agent_end → newSession loop with stall detection + constitution guard.
4. **Day 2:** Test the loop. Agent modifies its own tools/prompts. Reload. Verify iteration N+1 uses iteration N's changes.
5. **Day 2:** Add safety — git checkpoint per iteration, Gondolin sandbox for destructive ops.
6. **Day 3:** Add `lessons.md` distillation channel. Verify that iteration N+1 is *actually different* from N.
7. **Day 3:** Add review gate — a second LLM call (or the same model in "skeptic mode") reviews the diff before it's committed.
8. **Lateral:** pi-reflect for post-hoc analysis. pi-ralph for the "fresh session per item" variant.

---

## 10. Key Sources

| Source | URL |
|---|---|
| Ouroboros paper (arxiv 2608.08311) | https://arxiv.org/html/2608.08311 |
| Ouroboros site | https://ouroboros-agent.ai/ |
| pi-ralph-lingum-loop | https://github.com/nileshteji/pi-ralph-lingum-loop |
| pi-reflect | https://github.com/jo-inc/pi-reflect |
| nanoagent (essence) | https://github.com/aznikline/nanoagent |
| Pi SDK docs | https://pi.dev/docs/latest/sdk/ |
| Pi Ollama models.json | https://pi.dev/docs/latest/models |
| Ollama OpenAI compat | https://docs.ollama.com/api/openai-compatibility |
| Pi extension examples | `examples/extensions/` in the Pi package |
| Pi SDK examples | `examples/sdk/` in the Pi package |
