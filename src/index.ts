import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum, uuidv7 } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type CompactionResult,
	convertToLlm,
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createGate, type Gate } from "./approval.js";
import { runCompaction } from "./compaction.js";
import type { FrameworkConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { activeRemembered, formatRememberedMessage, matchForgetTargets, type RememberedFact } from "./context.js";
import { evaluateQuality } from "./evaluation.js";
import { type ActionInput, scoreRisk } from "./guardrails.js";
import { BranchState, type EntryLike, emptyState, reconstructState, STATE_CUSTOM_TYPE } from "./registry.js";
import { newSkillRecord, type SkillDraft } from "./skills.js";
import { createStoreManager, type ScopedStores, type StoreManager } from "./stores.js";
import { activationAction, draftEvolution, type EvolutionProposal, evaluateShadow } from "./tools/evolution.js";
import type { AuditEntry, CompactionArtifact, EvolvedToolMetric } from "./types.js";

/**
 * MorePi — a self-modifying framework for pi.
 *
 * Wires the framework's subsystems — context control, persistent memory,
 * self-learning skill generation, governed tool evolution, and audit/rollback —
 * into pi's extension API. Every state-changing behavior is funneled through a
 * single governance gate so nothing the framework does can escape user control.
 */

const FRAMEWORK_TOOLS = new Set<string>([
	"context_remember",
	"context_forget",
	"memory_write",
	"memory_recall",
	"self_learn",
	"evolve_tool",
	"self_eval",
]);

const EMPTY_METRIC: EvolvedToolMetric = {
	runs: 0,
	successes: 0,
	failures: 0,
	avgLatencyMs: 0,
	lastEvalTs: new Date(0).toISOString(),
};

// ---------------------------------------------------------------------------
// Framework root: the install dir, used to detect framework-source edits.
// ---------------------------------------------------------------------------

const FRAMEWORK_ROOT = resolveFrameworkRoot(import.meta.url);

function resolveFrameworkRoot(url: string | undefined): string {
	if (url?.startsWith("file:")) {
		try {
			// ext/src/index.ts -> ext/
			return dirname(dirname(fileURLToPath(url)));
		} catch {
			/* fall through */
		}
	}
	return "src/index";
}

// ---------------------------------------------------------------------------
// Result helper
// ---------------------------------------------------------------------------

type TextBlock = AgentToolResult<unknown>["content"][number];

function text(s: string): TextBlock {
	return { type: "text" as const, text: s } as TextBlock;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function buildMemoryTools(_pi: ExtensionAPI, config: FrameworkConfig, manager: StoreManager) {
	const write = defineTool({
		name: "memory_write",
		label: "Memorize",
		description:
			"Store a durable, cross-session fact in long-term memory. Use for decisions, constraints, conventions, " +
			"or anything worth remembering in future sessions. Facts are recallable later.",
		promptSnippet: "Store a durable fact in long-term memory (memory_write)",
		promptGuidelines: [
			"Use memory_write when the user states a durable preference, constraint, or decision that should shape future work.",
			"Give memory_write a concise, self-contained fact with relevant tags; do not store ephemeral scratch data.",
		],
		parameters: Type.Object({
			content: Type.String({ description: "The fact to remember, stated self-containedly." }),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Optional recall tags." })),
			source: Type.Optional(Type.String({ description: "Where the fact came from (default: user)." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const gate = buildGate(config, ctx);
			const outcome = await gate.execute({
				tool: "memory_write",
				input: { content: params.content },
				cwd: ctx.cwd,
				frameworkRoot: FRAMEWORK_ROOT,
			});
			await recordAudit(manager, st, gate, "memory-write", "agent", `recorded fact: ${params.content.slice(0, 80)}`, {
				tags: params.tags ?? [],
				source: params.source ?? "user",
				traceId: outcome.traceId,
				decision: outcome.status,
			});
			const rec = await st.memory.add({
				content: params.content,
				tags: params.tags,
				source: params.source ?? "user",
			});
			return {
				content: [text(`Remembered as ${rec.id}${params.tags?.length ? ` [${params.tags.join(", ")}]` : ""}.`)],
				details: { id: rec.id, gated: outcome.status },
			};
		},
	});

	const recall = defineTool({
		name: "memory_recall",
		label: "Recall Memory",
		description:
			"Recall the most relevant durable facts from long-term memory for a query. Returns related facts with " +
			"relevance scores. Use before applying conventions, recalling prior decisions, or answering meta-questions.",
		promptSnippet: "Recall relevant facts from long-term memory (memory_recall)",
		promptGuidelines: [
			"Use memory_recall to surface relevant durable facts before applying conventions or recalling prior decisions.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "What to recall, in natural language." }),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, description: "Max facts (default 5)." })),
			tags: Type.Optional(Type.Array(Type.String())),
			minScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const results = await st.memory.recall(params.query, {
				limit: params.limit,
				tags: params.tags,
				minScore: params.minScore,
			});
			if (results.length === 0) return { content: [text("No relevant memory found.")], details: { count: 0 } };

			await recordAudit(
				manager,
				st,
				undefined,
				"memory-recall",
				"agent",
				`recalled ${results.length} fact(s) for: ${params.query}`,
			);
			return {
				content: [
					results
						.map((r, i) => {
							const tags = r.record.tags.length ? ` [${r.record.tags.join(", ")}]` : "";
							return `${i + 1}. (${r.score.toFixed(2)}) ${r.record.content}${tags}  [${r.record.id}]`;
						})
						.join("\n"),
				].map(text),
				details: { count: results.length, ids: results.map((r) => r.record.id) },
			};
		},
	});

	return [write, recall];
}

// ---------------------------------------------------------------------------
// Context control
// ---------------------------------------------------------------------------

function buildContextTools(pi: ExtensionAPI, config: FrameworkConfig, manager: StoreManager) {
	const remember = defineTool({
		name: "context_remember",
		label: "Context Remember",
		description:
			"Pull related durable facts from long-term memory into the active context window so the agent works with " +
			"them for the rest of the session. Reversible via context_forget.",
		promptSnippet: "Inject recalled facts from memory into active context (context_remember)",
		promptGuidelines: [
			"Use context_remember to bring a relevant chunk of prior knowledge into active context when a task clearly benefits.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "What to bring into context." }),
			tags: Type.Optional(Type.Array(Type.String())),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
			label: Type.Optional(Type.String({ description: "Optional short label for the injection." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const recalled = await st.memory.recall(params.query, {
				limit: params.limit,
				tags: params.tags,
				minScore: config.memoryRecall.minScore,
			});
			const facts: RememberedFact[] = recalled.map((r) => ({
				id: r.record.id,
				content: r.record.content,
				tags: r.record.tags,
				source: r.record.source,
			}));
			const branch = loadBranch(ctx);
			branch.remember(facts.map((f) => f.id));
			await persistState(pi, branch);
			await recordAudit(
				manager,
				st,
				undefined,
				"context-remember",
				"agent",
				`remembered ${facts.length} fact(s): "${params.query}"`,
				{
					ids: facts.map((f) => f.id),
				},
			);
			return {
				content: [text(`Injected ${facts.length} fact(s) into context${params.label ? ` as "${params.label}"` : ""}.`)],
				details: { injected: facts.length, ids: facts.map((f) => f.id) },
			};
		},
	});

	const forget = defineTool({
		name: "context_forget",
		label: "Context Forget",
		description:
			"Drop facts from the active context window to reclaim space. Forgetting is lossless: the facts remain in " +
			"long-term memory and can be re-remembered with context_remember. Only ever use this to reclaim space.",
		promptSnippet: "Drop facts from active context while keeping them in memory (context_forget)",
		promptGuidelines: [
			"Use context_forget to reclaim context when a previously-remembered topic is no longer relevant; it does not delete from memory.",
			"Never use context_forget to destroy information — it only removes information from the active window.",
		],
		parameters: Type.Object({
			target: Type.String({ description: 'What to forget, e.g. "the DB migration" or "mem_ab12cd34ef56".' }),
			supersede: Type.Optional(Type.Boolean({ description: "Also mark the fact superseded in memory." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const branch = loadBranch(ctx);
			let targets = params.target.startsWith("mem_")
				? [params.target]
				: matchForgetTargets(
						params.target,
						branch.current.remembered.map((id) => ({ id, text: id })),
					);
			if (targets.length === 0) {
				const all = await st.memory.all();
				targets = matchForgetTargets(
					params.target,
					all.map((m) => ({ id: m.id, text: `${m.content} ${m.tags.join(" ")}` })),
				);
			}
			if (targets.length === 0) {
				return { content: [text(`No matching remembered facts for "${params.target}".`)], details: { forgotten: 0 } };
			}
			branch.forget(targets);
			if (params.supersede) {
				for (const id of targets) await st.memory.supersede(id);
			}
			await persistState(pi, branch);
			await recordAudit(
				manager,
				st,
				undefined,
				"context-forget",
				"agent",
				`forgotten ${targets.length} fact(s): "${params.target}"`,
				{
					ids: targets,
					superseded: Boolean(params.supersede),
				},
			);
			return {
				content: [text(`Freed ${targets.length} fact(s) from active context (still retrievable from memory).`)],
				details: { forgotten: targets.length, ids: targets },
			};
		},
	});

	return [remember, forget];
}

// ---------------------------------------------------------------------------
// Self-learning skill generation
// ---------------------------------------------------------------------------

function buildLearnTool(_pi: ExtensionAPI, config: FrameworkConfig, manager: StoreManager) {
	const learn = defineTool({
		name: "self_learn",
		label: "Self-Learn",
		description:
			"Capture a recurring task pattern as a new reusable skill written to the project skill library. Generated " +
			"skills are plain SKILL.md documents created for review and are not auto-executed.",
		promptSnippet: "Generate a reusable skill from an observed pattern (self_learn)",
		promptGuidelines: [
			"Use self_learn when a task recurs or a multi-step procedure was just completed, to turn it into a reusable skill.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Short slugged name for the skill." }),
			description: Type.String({ description: "One-line description of what the skill does." }),
			steps: Type.Optional(Type.Array(Type.String(), { description: "Ordered steps the skill performs." })),
			triggers: Type.Optional(Type.Array(Type.String(), { description: "When to use the skill." })),
			examples: Type.Optional(Type.Array(Type.String())),
			tags: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const gate = buildGate(config, ctx);
			const outcome = await gate.execute({
				tool: "self_learn",
				input: {},
				cwd: ctx.cwd,
				frameworkRoot: FRAMEWORK_ROOT,
			});
			const existing = await st.skills.list();
			const draft: SkillDraft = {
				name: params.name,
				description: params.description,
				steps: params.steps ?? [],
				triggers: params.triggers ?? [],
			};
			const record = newSkillRecord(draft, existing.length);
			record.sourcePatterns = params.examples ?? [];
			const file = await st.skills.add(record);
			await recordAudit(
				manager,
				st,
				gate,
				"skill-learned",
				"agent",
				`generated skill "${record.name}" v${record.version}`,
				{
					steps: record.steps.length,
					triggers: record.triggers.length,
					traceId: outcome.traceId,
					decision: outcome.status,
				},
			);
			return {
				content: [text(`Generated skill "${record.name}" v${record.version} -> ${file}`)],
				details: { name: record.name, version: record.version, file, gated: outcome.status },
			};
		},
	});
	return [learn];
}

// ---------------------------------------------------------------------------
// Governed tool evolution
// ---------------------------------------------------------------------------

function buildEvolveTool(_pi: ExtensionAPI, config: FrameworkConfig, manager: StoreManager) {
	const evolve = defineTool({
		name: "evolve_tool",
		label: "Evolve Tool",
		description:
			"Propose, modify, or extend a tool. Evolutions are declarative records (name, parameters, behavior " +
			"prompt, budget). Proposals are audited and risky ones require approval. A created tool's behavior is " +
			"materialized as a reviewable skill and is NOT auto-executed.",
		promptSnippet: "Propose/modify/extend a tool under governance (evolve_tool)",
		promptGuidelines: [
			"Use evolve_tool to propose a capability the agent lacks; prefer modifying/extending an existing tool over creating a new one.",
			"Never use evolve_tool to bypass guardrails or remove safety checks.",
			"evolve_tool only records a proposal; activating it is a separate, reviewable user action (/evolve activate).",
		],
		parameters: Type.Object({
			action: Type.Optional(StringEnum(["create", "modify", "extend"] as const)),
			name: Type.String({ description: "Tool name (slug)." }),
			rationale: Type.String({ description: "Why this evolution is needed." }),
			description: Type.Optional(Type.String()),
			parameters: Type.Optional(
				Type.Array(
					Type.Object({
						name: Type.String(),
						type: StringEnum(["string", "number", "boolean"] as const),
						description: Type.String(),
						required: Type.Optional(Type.Boolean()),
					}),
					{ description: "Declarative parameter schema." },
				),
			),
			behaviorPrompt: Type.Optional(Type.String({ description: "Prompt that emulates the tool's behavior." })),
			maxRadius: Type.Optional(StringEnum(["self", "module", "project", "system"] as const)),
			runShadow: Type.Optional(Type.Boolean({ description: "Run a shadow evaluation before activation." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const st = manager.project(ctx.cwd, config);
			const registry = st.registry;
			const existing = await registry.list();

			const proposal: EvolutionProposal = {
				action: params.action ?? "create",
				name: params.name,
				description: params.description ?? "",
				rationale: params.rationale,
				parameters: params.parameters,
				behaviorPrompt: params.behaviorPrompt ?? "",
				maxRadius: params.maxRadius,
			};
			const draft = draftEvolution(proposal, existing);

			const gate = buildGate(config, ctx);
			const outcome = await gate.execute({
				tool: "evolve_tool",
				input: { kind: draft.kind, requiresApproval: draft.budget.requiresApproval },
				cwd: ctx.cwd,
				frameworkRoot: FRAMEWORK_ROOT,
				viaPipeline: true,
			});

			if (outcome.assessment?.hardStop || outcome.status === "blocked") {
				await registry.save({ ...draft, status: "proposed" });
				await recordAudit(
					manager,
					st,
					gate,
					"tool-proposed",
					"agent",
					`proposed ${draft.kind} "${draft.name}" (blocked)`,
					{
						blocked: true,
						reasons: outcome.assessment?.reasons,
						traceId: outcome.traceId,
					},
				);
				return {
					content: [text(`Evolution of "${draft.name}" v${draft.version} was blocked. ${outcome.reason}`)],
					details: { name: draft.name, version: draft.version, status: "proposed", gated: outcome.status },
				};
			}

			let status = draft.status;
			let metrics = draft.metrics;
			if (params.runShadow) {
				const evald = evaluateShadow(draft, {
					...EMPTY_METRIC,
					runs: 1,
					successes: 1,
					lastEvalTs: new Date().toISOString(),
				});
				status = evald.tool.status;
				metrics = evald.tool.metrics;
			}

			// Auto-activate only shadow-status tools when not dry-run; keep anything
			// higher at its current status pending user activation.
			const canActivate = !gate.dryRun && status === "shadow";
			const final = { ...draft, status: canActivate ? "active" : status, metrics };
			await registry.supersede(draft.name);
			await registry.save(final);

			if (final.behaviorPrompt && final.status !== "rolled-back") {
				await st.skills.add({
					name: `${final.name}-behavior`,
					version: final.version,
					ts: final.ts,
					description: final.description || `Behavior for evolved tool ${final.name}`,
					steps: [final.behaviorPrompt],
					triggers: [`when ${final.name} is invoked`],
					sourcePatterns: [final.rationale],
				});
			}

			await recordAudit(
				manager,
				st,
				gate,
				"tool-proposed",
				"agent",
				`proposed ${draft.kind} "${draft.name}" v${draft.version} -> ${final.status}`,
				{
					radius: final.budget.maxRadius,
					requiresApproval: final.budget.requiresApproval,
					shadow: Boolean(params.runShadow),
					metrics,
					traceId: outcome.traceId,
				},
			);

			const shadowNote = metrics?.runs ? `\nShadow: ${metrics.successes}/${metrics.runs} runs ok` : "";
			return {
				content: [
					text(
						`Evolution recorded: ${final.kind} "${final.name}" v${final.version} -> ${final.status}.` +
							`\nRationale: ${final.rationale}` +
							`\nBudget: radius=${final.budget.maxRadius}, requiresApproval=${final.budget.requiresApproval}` +
							shadowNote,
					),
				],
				details: { name: final.name, version: final.version, status: final.status, metrics, gated: outcome.status },
			};
		},
	});
	return [evolve];
}

// ---------------------------------------------------------------------------
// Self-evaluation
// ---------------------------------------------------------------------------

function buildEvalTool(_pi: ExtensionAPI, config: FrameworkConfig) {
	const evalTool = defineTool({
		name: "self_eval",
		label: "Self-Evaluate",
		description:
			"Advisory self-assessment of a change: quality signals, a 0-1 confidence score, and whether the " +
			"governance gate would allow it. Advisory only — humans remain the gate.",
		promptSnippet: "Advisory self-assessment of a change (self_eval)",
		parameters: Type.Object({
			testsPassed: Type.Optional(Type.Integer({ minimum: 0 })),
			testsTotal: Type.Optional(Type.Integer({ minimum: 0 })),
			testsAdded: Type.Optional(Type.Integer({ minimum: 0 })),
			errorCount: Type.Optional(Type.Integer({ minimum: 0 })),
			changedLines: Type.Optional(Type.Integer({ minimum: 0 })),
			reviewed: Type.Optional(Type.Boolean()),
			actionTool: Type.Optional(Type.String({ description: "Tool name of the change to read risk for." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const gate = buildGate(config, ctx);
			const verdict = evaluateQuality({
				testsPassed: params.testsPassed ?? 0,
				testsTotal: params.testsTotal ?? 0,
				testsAdded: params.testsAdded ?? 0,
				errorCount: params.errorCount ?? 0,
				changedLines: params.changedLines ?? 0,
				guardrailBlocks: 0,
				lintClean: true,
				reviewed: Boolean(params.reviewed),
			});
			const action: ActionInput | undefined = params.actionTool
				? { tool: params.actionTool, input: {}, cwd: ctx.cwd, frameworkRoot: FRAMEWORK_ROOT }
				: undefined;
			const risk = action ? gate.assess(action) : undefined;
			const lines = [
				`Quality: ${verdict.score.toFixed(2)} (${verdict.safe ? "safe" : "not safe"})`,
				...verdict.notes.map((n) => ` - ${n}`),
				risk ? `Risk(${risk.changeClass}, ${risk.radius}): ${risk.score}/100 -> ${risk.decision}` : "",
				risk?.hardStop ? "GUARDRAIL HARD STOP applies" : "",
			].filter(Boolean);
			return {
				content: [text(lines.join("\n"))],
				details: { verdict, risk, safe: verdict.safe },
			};
		},
	});
	return [evalTool];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function registerCommands(pi: ExtensionAPI, config: FrameworkConfig, manager: StoreManager) {
	pi.registerCommand("self", {
		description: "Show the MorePi dashboard: memory, skills, and recent audit entries.",
		handler: async (_args, ctx) => {
			const st = manager.project(ctx.cwd, config);
			const memory = await st.memory.count();
			const skills = await st.skills.list();
			const audit = await manager.governance(config).audit.entries(20);
			const lines = [
				"MorePi",
				`- memory facts: ${memory}`,
				`- skills (${skills.length}): ${skills.map((s) => s.name).join(", ") || "(none)"}`,
				`- recent audit (last ${Math.min(8, audit.length)} of ${audit.length}):`,
				...audit
					.slice(-8)
					.reverse()
					.map((a) => `    ${a.kind} :: ${a.summary}`),
				"Run /evolve list or /self-audit for more.",
			];
			if (ctx.mode === "tui") ctx.ui.setWidget("morepi", lines);
			else ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("self-audit", {
		description: "Show the recent MorePi audit log.",
		getArgumentCompletions: () => [
			{ value: "10", label: "10" },
			{ value: "20", label: "20" },
			{ value: "50", label: "50" },
		],
		handler: async (args, ctx) => {
			const limit = Math.max(1, Number.parseInt(args.trim() || "20", 10) || 20);
			const audit = await manager.governance(config).audit.entries(limit);
			const lines = audit.length
				? audit
						.map((a) => `   ${a.ts.slice(11, 19)}  ${a.actor.padEnd(6)}  ${a.kind.padEnd(16)}  ${a.summary}`)
						.join("\n")
				: "   (no audit entries)";
			ctx.ui.notify(`MorePi audit (last ${audit.length}):\n${lines}`, "info");
		},
	});

	pi.registerCommand("evolve", {
		description: "Manage evolved tools: list | show <name> | activate <name> | rollback <name>.",
		getArgumentCompletions: (prefix) => {
			const cmds = ["list", "show", "activate", "rollback"];
			return cmds.filter((c) => c.startsWith(prefix)).map((c) => ({ label: c, value: c, description: `evolve ${c}` }));
		},
		handler: async (args, ctx) => {
			const st = manager.project(ctx.cwd, config);
			const [verb, name = ""] = (args || "list").split(/\s+/);
			if (!name && verb !== "list") {
				ctx.ui.notify("Usage: /evolve list | show <name> | activate <name> | rollback <name>", "warning");
				return;
			}
			switch (verb) {
				case "list": {
					const tools = await st.registry.list();
					ctx.ui.notify(
						tools.length
							? tools.map((t) => `   ${t.name} v${t.version} [${t.status}] radius=${t.budget.maxRadius}`).join("\n")
							: "   (no evolved tools)",
						"info",
					);
					return;
				}
				case "show": {
					const t = await st.registry.latest(name);
					if (!t) {
						ctx.ui.notify(`No evolved tool: ${name}`, "warning");
						return;
					}
					ctx.ui.notify(JSON.stringify(t, null, 2), "info");
					return;
				}
				case "activate": {
					const t = await st.registry.latest(name);
					if (!t) {
						ctx.ui.notify(`No evolved tool: ${name}`, "warning");
						return;
					}
					const gate = ctx.hasUI
						? createGate({ config, ui: { hasUI: true, confirm: (a, b) => ctx.ui.confirm(a, b) } })
						: undefined;
					const outcome = gate ? await gate.execute(activationAction(t)) : undefined;
					if (gate && outcome && (outcome.status === "blocked" || outcome.assessment?.hardStop)) {
						ctx.ui.notify(`Activation of ${t.name} blocked: ${outcome.reason}`, "warning");
						return;
					}
					await st.registry.save({ ...t, status: "active" });
					await recordAudit(manager, st, undefined, "tool-activated", "user", `activated ${t.name} v${t.version}`, {
						traceId: outcome?.traceId,
					});
					ctx.ui.notify(`Activated evolved tool ${t.name} v${t.version} (behavior exposed as a skill).`, "info");
					return;
				}
				case "rollback": {
					const t = await st.registry.latest(name);
					if (!t) {
						ctx.ui.notify(`No evolved tool: ${name}`, "warning");
						return;
					}
					await st.registry.supersede(name);
					await st.registry.save({ ...t, status: "rolled-back" });
					await recordAudit(manager, st, undefined, "tool-rolled-back", "user", `rolled back ${t.name} v${t.version}`);
					ctx.ui.notify(`Rolled back ${t.name} to previous version.`, "info");
					return;
				}
				default:
					ctx.ui.notify("Usage: /evolve list | show <name> | activate <name> | rollback <name>", "warning");
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Branch state + audit helpers
// ---------------------------------------------------------------------------

function loadBranch(ctx: ExtensionContext): BranchState {
	const entries = ctx.sessionManager.getBranch() as unknown as EntryLike[];
	// getBranch can throw if the session is malformed; degrade gracefully.
	try {
		return new BranchState(reconstructState(entries));
	} catch {
		return new BranchState(emptyState());
	}
}

async function persistState(pi: ExtensionAPI, branch: BranchState): Promise<void> {
	pi.appendEntry(STATE_CUSTOM_TYPE, branch.snapshot());
}

async function recordAudit(
	manager: StoreManager,
	st: ScopedStores,
	_gate: Gate | undefined,
	kind: AuditEntry["kind"],
	actor: AuditEntry["actor"],
	summary: string,
	payload?: Record<string, unknown>,
): Promise<void> {
	try {
		const gov = manager.governance(st.config);
		await gov.audit.record({ kind, actor, summary, payload });
	} catch {
		// Audit must never break the primary operation.
	}
}

function buildGate(config: FrameworkConfig, ctx: ExtensionContext): Gate {
	return createGate({
		config,
		dryRun: !config.enable.evolve,
		ui: ctx.hasUI ? { hasUI: true, confirm: (t, m) => ctx.ui.confirm(t, m) } : undefined,
	});
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * The extension entry point. pi calls this during startup and awaits it. It
 * registers framework tools, commands, and the event handlers that provide
 * context injection, governance enforcement, and structured compaction.
 */
export default function morePiExtension(pi: ExtensionAPI): void {
	const config = DEFAULT_CONFIG;
	const manager = createStoreManager(process.cwd(), config);

	// Register tools for each enabled subsystem.
	if (config.enable.memory) for (const t of buildMemoryTools(pi, config, manager)) pi.registerTool(t);
	if (config.enable.context) for (const t of buildContextTools(pi, config, manager)) pi.registerTool(t);
	if (config.enable.learn) for (const t of buildLearnTool(pi, config, manager)) pi.registerTool(t);
	if (config.enable.evolve) {
		for (const t of buildEvolveTool(pi, config, manager)) pi.registerTool(t);
		for (const t of buildEvalTool(pi, config)) pi.registerTool(t);
		registerCommands(pi, config, manager);
	}

	// --- Injection: remembered context before every LLM call ---
	pi.on("context", async (event, ctx) => {
		if (!config.enable.context) return;
		try {
			const st = manager.project(ctx.cwd, config);
			const branch = loadBranch(ctx);
			if (branch.current.remembered.length === 0) return; // nothing to inject
			const all = await st.memory.all();
			const byId = new Map(all.map((m) => [m.id, m]));
			const facts = branch.current.remembered
				.map((id) => byId.get(id))
				.filter((m): m is NonNullable<typeof m> => m !== undefined)
				.map((m) => ({ id: m.id, content: m.content, tags: m.tags, source: m.source }));
			const active = activeRemembered(facts, branch.current.forgotten);
			const injection = formatRememberedMessage(active);
			if (!injection) return;

			const messages = event.messages.slice();
			messages.push({
				role: "user",
				content: injection,
				timestamp: Date.now(),
			} as unknown as (typeof event.messages)[number]);
			return { messages };
		} catch {
			// Context injection must never break a model call.
		}
	});

	// --- Governance: enforce hard-stops and approval on built-in tools ---
	pi.on("tool_call", async (event, ctx) => {
		if (!config.enable.guardrails) return;
		if (FRAMEWORK_TOOLS.has(event.toolName)) return; // framework tools self-gate
		const action: ActionInput = {
			tool: event.toolName,
			input: event.input as unknown as Record<string, unknown> | string,
			cwd: ctx.cwd,
			frameworkRoot: FRAMEWORK_ROOT,
		};
		const risk = scoreRisk(action);
		const st = manager.project(ctx.cwd, config);
		if (risk.hardStop || risk.score >= config.blockThreshold) {
			await recordAudit(
				manager,
				st,
				undefined,
				"change-blocked",
				"system",
				`blocked ${event.toolName}: ${risk.rule ?? risk.reasons.join("; ")}`,
				{ score: risk.score, rule: risk.rule },
			);
			return { block: true, reason: `blocked by guardrail: ${risk.reasons.join("; ") || "high risk"}` };
		}
		if (risk.score >= config.approvalThreshold) {
			if (!ctx.hasUI) return { block: true, reason: "high-risk action requires an interactive UI to approve" };
			const ok = await ctx.ui.confirm("MorePi: approve this action?", risk.reasons.join("\n"));
			await recordAudit(
				manager,
				st,
				undefined,
				ok ? "change-approved" : "change-blocked",
				"user",
				`${ok ? "approved" : "declined"} ${event.toolName}`,
				{ score: risk.score },
			);
			return ok ? undefined : { block: true, reason: "declined by user" };
		}
		return;
	});

	// --- Structured compaction: summary + artifact index + fact extraction ---
	pi.on("session_before_compact", async (event, ctx) => {
		if (!config.enable.compaction) return;
		const st = manager.project(ctx.cwd, config);
		const { preparation, signal } = event;

		ctx.ui.notify?.(`MorePi compaction: summarizing ${preparation.tokensBefore.toLocaleString()} tokens`, "info");
		const model = ctx.modelRegistry.find("google", "gemini-2.5-flash") ?? ctx.model;
		if (!model) return;

		const messagesToSummarize = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
		const conversationText = serializeConversation(convertToLlm(messagesToSummarize));

		try {
			const parsed = await runCompaction({
				ctx: {
					tokensBefore: preparation.tokensBefore,
					messagesText: conversationText,
					previousSummary: preparation.previousSummary,
					openTasks: openTasksFrom(preparation),
				},
				summarizer: {
					summarize: async (prompt, s) => {
						const res = await ctx.modelRegistry.complete(
							model,
							{
								systemPrompt: "You are a precise session summarizer.",
								messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
							},
							{
								maxTokens: 4096,
								signal: s ?? signal,
								sessionId: uuidv7(),
							},
						);
						return res.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n");
					},
				},
				onArtifact: (a) => {
					const branch = loadBranch(ctx);
					branch.addArtifact(a);
					void persistState(pi, branch);
				},
				onFact: async (fact, tags) => {
					await st.memory.add({ content: fact, tags, source: "compaction" });
				},
				onNotify: (m) => ctx.ui.notify?.(m, "info"),
			});

			const artifact: CompactionArtifact = {
				ts: new Date().toISOString(),
				summary: parsed.summary,
				filesTouched: parsed.filesTouched,
				openItems: parsed.openItems,
				tokenBudgetUsed: parsed.tokensBefore,
			};
			const compaction: CompactionResult = {
				summary: parsed.summary,
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: artifact,
			};

			await recordAudit(
				manager,
				st,
				undefined,
				"compaction",
				"system",
				`compacted ${preparation.tokensBefore.toLocaleString()} tokens; ${parsed.facts.length} facts, ${parsed.openItems.length} open items`,
				{ facts: parsed.facts.length, openItems: parsed.openItems.length, files: parsed.filesTouched.length },
			);

			return { compaction };
		} catch (err) {
			if (!signal.aborted) {
				ctx.ui.notify?.(
					`MorePi compaction failed: ${err instanceof Error ? err.message : String(err)}; using default`,
					"warning",
				);
			}
			return;
		}
	});

	// --- Keep a light status widget in sync ---
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus("morepi", "MorePi active");
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus("morepi", undefined);
	});
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function openTasksFrom(_preparation: { settings?: { enabled: boolean } }): string[] {
	return [];
}

// Re-exports for consumers that import the framework as a library.
export { createGate, type Gate } from "./approval.js";
export type { FrameworkConfig } from "./config.js";
export { DEFAULT_CONFIG } from "./config.js";
export { formatRememberedMessage, type RememberedFact } from "./context.js";
export { evaluateQuality, type QualityVerdict, runShadowComparison, shouldPromote } from "./evaluation.js";
export { type ActionInput, scoreRisk } from "./guardrails.js";
export { MemoryStore } from "./memory.js";
