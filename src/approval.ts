import { DEFAULT_CONFIG, type FrameworkConfig } from "./config.js";
import { type ActionInput, decide, scoreRisk } from "./guardrails.js";
import type { RiskAssessment } from "./types.js";

/**
 * Human-in-the-loop gate.
 *
 * Turns a {@link RiskAssessment} into a concrete allow / block / (requested
 * approval) outcome, prompting the user only when an action is high-risk and the
 * UI can accept a response. In non-interactive modes the gate degrades to "block
 * on unresolved approvable actions" rather than silently allowing them.
 */

export interface GateOptions {
	config: FrameworkConfig;
	/** True to record actions but never actually execute the gated effect. */
	dryRun?: boolean;
	/** A UI capable of confirmation, or undefined to enforce fail-closed. */
	ui?: { hasUI: boolean; confirm: (title: string, message: string) => Promise<boolean> };
}

export type GateOutcomeStatus = "allowed" | "approved" | "blocked" | "approved-dry-run";

export interface GateOutcome {
	allow: boolean;
	status: GateOutcomeStatus;
	reason: string;
	traceId?: string;
	assessment?: RiskAssessment;
}

export interface Gate {
	config: FrameworkConfig;
	dryRun?: boolean;
	execute: (action: ActionInput) => Promise<GateOutcome>;
	assess: (action: ActionInput) => RiskAssessment;
}

/** Render a compact, description-only prompt so the user can decide. */
function buildPrompt(assessment: RiskAssessment, action: ActionInput): { title: string; body: string } {
	const risk =
		assessment.score >= DEFAULT_CONFIG.blockThreshold
			? "HIGH"
			: assessment.score >= DEFAULT_CONFIG.approvalThreshold
				? "MEDIUM"
				: "LOW";
	const target = targetOf(action);
	const lines = [
		`Risk: ${risk} (${assessment.score}/100)`,
		`Change: ${assessment.changeClass}`,
		`Blast radius: ${assessment.radius}`,
		target ? `Target: ${target}` : "",
		assessment.rule ? `Rule: ${assessment.rule}` : "",
		...assessment.reasons.map((r) => `- ${r}`),
	].filter(Boolean);
	return { title: "Approve this action?", body: lines.join("\n") };
}

/** Build a gate bound to configuration and an optional UI. */
export function createGate(opts: GateOptions): Gate {
	const { config, dryRun = false, ui } = opts;

	const assess = (action: ActionInput): RiskAssessment =>
		scoreRisk(action, { approvalThreshold: config.approvalThreshold });

	const requestApproval = async (assessment: RiskAssessment, action: ActionInput): Promise<boolean> => {
		if (!ui?.hasUI) return false;
		const { title, body } = buildPrompt(assessment, action);
		return ui.confirm(title, body);
	};

	const autoTrustsRadius = (radius: string): boolean => radius === "self" || radius === "module";

	const gate: Gate = {
		config,
		dryRun,
		assess,
		async execute(action) {
			const traceId = `gate_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
			const assessment = assess(action);

			const make = (status: GateOutcomeStatus, allow: boolean, reason: string): GateOutcome => ({
				status,
				allow,
				reason,
				traceId,
				assessment,
			});

			if (!config.enable.guardrails) return make("allowed", true, "guardrails disabled");

			const decision = decide(assessment.score, config.approvalThreshold, config.blockThreshold);

			if (decision === "block") {
				return make("blocked", false, `blocked: ${assessment.rule ?? (assessment.reasons.join("; ") || "high risk")}`);
			}

			if (decision === "approve") {
				if (autoTrustsRadius(assessment.radius)) {
					return make("allowed", true, `auto-allowed within trusted radius (${assessment.radius})`);
				}
				const allowed = await requestApproval(assessment, action);
				if (!allowed) return make("blocked", false, "declined by user (no UI or user said no)");
				if (dryRun) return make("approved-dry-run", false, "approved in dry-run mode (effect not executed)");
				return make("approved", true, "approved by user");
			}

			return make("allowed", true, `low risk (score ${assessment.score})`);
		},
	};

	return gate;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function targetOf(action: ActionInput): string {
	const input = action.input;
	if (!input) return "";
	if (typeof input === "string") return truncate(input, 120);
	const obj = input as { path?: string; command?: string };
	if (typeof obj.path === "string") return obj.path;
	if (typeof obj.command === "string") return truncate(obj.command, 120);
	return "";
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
}
