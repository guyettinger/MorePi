import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.js";
import { type PromotionDecision, shouldPromote } from "../evaluation.js";
import { type ActionInput, scoreRisk } from "../guardrails.js";
import type { EvolvedTool, EvolvedToolMetric } from "../types.js";

/**
 * Governed evolution.
 *
 * Rather than compile and execute arbitrary model-generated code (the unsafe
 * default the research doc warns against), evolution here is *declarative*: a
 * new tool is a JSON description (name, parameters, behavior prompt, budget).
 * Activating it wires a data-driven pi tool whose body runs a prompt through the
 * existing, audited agent loop. That keeps every evolution inside the safe,
 * approvable, auditable surface of the extension API.
 *
 * Lifecycle: proposed -> shadow -> active  (or rollback at any point).
 */

export interface EvolutionProposal {
	action: "create" | "modify" | "extend";
	name: string;
	description: string;
	rationale: string;
	parameters?: EvolvedTool["parameters"];
	behaviorPrompt: string;
	maxRadius?: EvolvedTool["budget"]["maxRadius"];
}

export const EMPTY_METRIC: EvolvedToolMetric = {
	runs: 0,
	successes: 0,
	failures: 0,
	avgLatencyMs: 0,
	lastEvalTs: new Date(0).toISOString(),
};

/** On-disk registry of evolved tools. */
export class ToolRegistry {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	private async readAll(): Promise<EvolvedTool[]> {
		let entries: string[];
		try {
			entries = await readdir(this.dir);
		} catch {
			return [];
		}
		const files = entries.filter((e) => e.endsWith(".json"));
		const out: EvolvedTool[] = [];
		for (const file of files) {
			try {
				const raw = await readFile(join(this.dir, file), "utf8");
				out.push(JSON.parse(raw) as EvolvedTool);
			} catch {}
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	async list(): Promise<EvolvedTool[]> {
		return this.readAll();
	}

	async find(name: string): Promise<EvolvedTool | undefined> {
		const all = await this.readAll();
		return all.find((t) => t.name === name);
	}

	async latest(name: string): Promise<EvolvedTool | undefined> {
		const all = (await this.readAll()).filter((t) => t.name === name);
		return all.sort((a, b) => b.version - a.version)[0];
	}

	private pathFor(tool: EvolvedTool): string {
		return join(this.dir, `${tool.name}.json`);
	}

	async save(tool: EvolvedTool): Promise<string> {
		await mkdir(this.dir, { recursive: true });
		const path = this.pathFor(tool);
		await writeFile(path, `${JSON.stringify(tool, null, 2)}\n`, "utf8");
		return path;
	}

	async supersede(name: string): Promise<void> {
		const prev = await this.latest(name);
		if (!prev) return;
		prev.status = "rolled-back";
		await this.save(prev);
	}
}

/**
 * Decide the initial lifecycle status for a newly proposed tool from its risk
 * profile. System/external-effect tools start in shadow; low-risk creates may
 * start active if they do not require approval.
 */
export function initialStatusFor(
	proposal: EvolutionProposal,
	risk: ReturnType<typeof scoreRisk>,
): EvolvedTool["status"] {
	if (risk.hardStop || risk.score >= DEFAULT_CONFIG.blockThreshold) return "proposed";
	if (proposal.maxRadius === "system" || risk.changeClass === "external-effect") return "shadow";
	return "proposed";
}

/**
 * Decide whether a freshly drafted shadow tool should auto-activate to "active".
 *
 * A tool auto-activates only when it is in shadow status, the gate is not in
 * dry-run mode, it does *not* require external approval, and shadow evidence
 * exists (a shadow run was requested or metrics have accumulated). System-radius
 * proposals always set `requiresApproval`, so this keeps them in shadow where they
 * must be activated by the user via `/evolve activate` — closing the gap where a
 * system-radius create with an empty metric would otherwise reach "active"
 * without any human gate.
 */
export function canAutoActivate(p: {
	status: EvolvedTool["status"];
	requiresApproval: boolean;
	runs: number;
	ranShadow: boolean;
	dryRun: boolean;
}): boolean {
	return !p.dryRun && p.status === "shadow" && !p.requiresApproval && (p.ranShadow || p.runs > 0);
}

/** Create (or bump) an evolved tool from a proposal. */
export function draftEvolution(proposal: EvolutionProposal, existing: EvolvedTool[] = []): EvolvedTool {
	const current = existing.find((t) => t.name === proposal.name);
	const version = (current?.version ?? 0) + 1;
	const risk = scoreRisk({ tool: "evolve_tool", input: { kind: proposal.action }, viaPipeline: true });
	return {
		name: slugName(proposal.name),
		version,
		ts: new Date().toISOString(),
		kind: proposal.action,
		description: proposal.description,
		rationale: proposal.rationale,
		status: initialStatusFor(proposal, risk),
		parameters: proposal.parameters ?? [],
		behaviorPrompt: proposal.behaviorPrompt.trim(),
		budget: {
			maxRadius: proposal.maxRadius ?? "module",
			requiresApproval: risk.score >= DEFAULT_CONFIG.approvalThreshold || proposal.maxRadius === "system",
		},
		metrics: current?.metrics ?? EMPTY_METRIC,
	};
}

/**
 * Evaluate whether a shadow tool should be promoted, kept, or rolled back, and
 * return the resulting tool record with updated metrics/status.
 */
export function evaluateShadow(
	tool: EvolvedTool,
	latestMetrics: EvolvedToolMetric,
	policy?: { minRuns?: number; minPassRate?: number; maxFailures?: number },
): { tool: EvolvedTool; decision: PromotionDecision } {
	const decision = shouldPromote(latestMetrics, policy);
	let status: EvolvedTool["status"] = tool.status;
	if (decision === "promote") status = "active";
	if (decision === "rollback") status = "rolled-back";

	return { tool: { ...tool, status, metrics: latestMetrics }, decision };
}

/** Build the declarative action-input used to gate an activate call. */
export function activationAction(tool: EvolvedTool): ActionInput {
	return {
		tool: "evolve_tool",
		input: { kind: tool.kind, budget: tool.budget.maxRadius, requiresApproval: tool.budget.requiresApproval },
		viaPipeline: true,
	};
}

function slugName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 48) || `evolved_${randomUUID().slice(0, 6)}`
	);
}
