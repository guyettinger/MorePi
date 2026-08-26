import { DEFAULT_CONFIG } from "./config.js";
import type { BlastRadius, ChangeClass, GateDecision, RiskAssessment } from "./types.js";

/**
 * Guardrails: the governance layer of the framework.
 *
 * Every self-modifying or state-changing action the framework (or the agent
 * routing through framework tools) performs is passed through {@link scoreRisk}
 * to produce a {@link RiskAssessment}. The gate in {@link ./approval.ts} turns
 * that assessment into an allow / approve / block decision.
 *
 * This module is intentionally free of any runtime dependency so it can be
 * unit-tested and reasoned about in isolation. The scoring is deliberately
 * conservative: it over-blocks rather than auto-approving things that could
 * break the system.
 */

export interface ActionInput {
	tool: string;
	/** Raw tool arguments; shape depends on the tool. */
	input?: Record<string, unknown> | string;
	/** Working directory the action runs against. */
	cwd?: string;
	/** True when the action originates from the sanctioned evolution pipeline. */
	viaPipeline?: boolean;
	/**
	 * Absolute root of the framework's own install directory. Framework-source
	 * edits are detected relative to this only, so an ordinary user editing
	 * their own `src/` or `package.json` is never mistaken for a framework
	 * modification.
	 */
	frameworkRoot?: string;
}

/** Credential/secret-like paths that must never be silently written. */
export const SECRET_DIRS = [".git/", ".env", ".aws/", ".ssh/", ".kube/"];
const SYSTEM_DIRS = ["/etc/", "/usr/", "/bin/", "/sbin/", "/sys/", "/boot/", "C:\\Windows", "C:\\System"];

export const DESTRUCTIVE = /(?:rm\s+-rf?|del\s+\/s|rmdir\s+\/s|mkfs|dd\s+if=|format\s+[a-z]:|>\s*\/dev\/sd)/i;
export const PRIVILEGE = /\b(?:sudo|doas|runas)\b/i;
export const NETWORK_INJECT = /(?:curl|wget|fetch|nc|ncat)\b[^\n]*\|\s*(?:sh|bash|zsh|python|node)\b/i;
const EXTERNAL_WRITE = /\b(?:apt|apt-get|brew|npm\s+install|pip\s+install|git\s+push|scp|rsync|docker\s+run|iex)\b/i;

/** Classify the kind of change an action represents. */
export function classifyAction(action: ActionInput): { radius: BlastRadius; changeClass: ChangeClass } {
	const input = asObject(action.input);
	const tool = action.tool;

	if (tool === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (DESTRUCTIVE.test(command) || PRIVILEGE.test(command) || touchesSystem(command, action.cwd)) {
			return { radius: "system", changeClass: "external-effect" };
		}
		if (NETWORK_INJECT.test(command)) return { radius: "system", changeClass: "external-effect" };
		if (EXTERNAL_WRITE.test(command)) return { radius: "project", changeClass: "external-effect" };
		return { radius: "project", changeClass: "external-effect" };
	}

	if (tool === "read" || tool === "ls" || tool === "find" || tool === "grep") {
		return { radius: "self", changeClass: "read" };
	}

	if (tool === "memory_write") return { radius: "module", changeClass: "write-memory" };
	if (tool === "memory_recall") return { radius: "self", changeClass: "read" };
	if (tool === "context_forget" || tool === "context_remember") return { radius: "self", changeClass: "write-context" };
	if (tool === "self_learn") return { radius: "project", changeClass: "write-skill" };
	if (tool === "evolve_tool") {
		const kind = input.kind ?? "create";
		if (kind === "modify" || kind === "extend") return { radius: "project", changeClass: "modify-framework" };
		return { radius: "module", changeClass: "write-tool" };
	}
	if (tool === "self_eval" || tool === "self_validate") return { radius: "self", changeClass: "read" };

	if (tool === "write" || tool === "edit") {
		const path = pickWritePath(action);
		let radius: BlastRadius = "project";
		if (touchesSystem(path, action.cwd)) radius = "system";
		return { radius, changeClass: tool === "write" ? "write-context" : "modify-framework" };
	}

	return { radius: "self", changeClass: "write-context" };
}

/** Compute a risk assessment for an action. */
export function scoreRisk(action: ActionInput): RiskAssessment {
	const { radius, changeClass } = classifyAction(action);
	const reasons: string[] = [];
	let hardStop = false;
	let rule: string | undefined;
	let score = 0;

	// Base score by change class.
	const base: Record<ChangeClass, number> = {
		read: 5,
		"write-memory": 20,
		"write-context": 25,
		"write-skill": 35,
		"write-tool": 60,
		"modify-framework": 65,
		"external-effect": 55,
	};
	score += base[changeClass];
	reasons.push(`change class ${changeClass} (+${base[changeClass]})`);

	// Radius multiplier.
	const radiusMult: Record<BlastRadius, number> = {
		self: 1,
		module: 1.1,
		project: 1.3,
		system: 1.6,
	};
	score = Math.round(score * radiusMult[radius]);
	if (radius !== "self") reasons.push(`blast radius ${radius} (x${radiusMult[radius]})`);

	// Specific rule checks with hard stops.
	const path = pickWritePath(action);
	const command = commandOf(action);

	if (touchesSystem(path, action.cwd) || touchesSystem(command, action.cwd)) {
		hardStop = true;
		rule = "system-path";
		reasons.push("hard stop: targets a system path");
	}

	const touchesGit = command.includes(".git") && /\brm\s|\bgit\s+push/.test(command);
	if (touchesGit) {
		hardStop = true;
		rule = "protect-git-history";
		reasons.push("hard stop: destructive git operation (history is protected)");
	}

	// Writes to credential/secret-like paths are blocked outright.
	const secret = SECRET_DIRS.find((d) => path.includes(d));
	if (secret) {
		hardStop = true;
		rule = "protected-secret";
		reasons.push(`hard stop: writes to a protected path (${secret})`);
	}

	// Direct edits to framework source are blocked unless they go through the
	// sanctioned evolution pipeline (which performs its own approval gating).
	const touchesFramework = isFrameworkSource(path, action.frameworkRoot);
	if (touchesFramework && !action.viaPipeline) {
		hardStop = true;
		rule = "framework-source";
		reasons.push("hard stop: direct framework-source edit bypasses the evolution pipeline");
	} else if (touchesFramework && action.viaPipeline) {
		score = Math.max(score, 70);
		reasons.push("framework change via pipeline (+30 floor)");
	}

	if (DESTRUCTIVE.test(command)) {
		score = Math.max(score, 85);
		if (!action.viaPipeline) hardStop = true;
		rule ??= "destructive-command";
		reasons.push("destructive command detected");
	}
	if (PRIVILEGE.test(command)) {
		score = Math.max(score, 90);
		hardStop = true;
		rule ??= "privilege-escalation";
		reasons.push("privilege escalation (sudo/doas) detected");
	}
	if (NETWORK_INJECT.test(command)) {
		score = Math.max(score, 80);
		hardStop = true;
		rule ??= "network-injection";
		reasons.push("piped network execution detected");
	}

	// Cap and decide.
	score = Math.max(0, Math.min(100, score));

	let decision: GateDecision = "allow";
	if (hardStop) decision = "block";
	else if (score >= DEFAULT_CONFIG.approvalThreshold) decision = "approve";

	return { score, decision, radius, changeClass, reasons, hardStop, rule };
}

/** Map a numeric threshold pair onto a decision for a given score. */
export function decide(score: number, approvalThreshold: number, blockThreshold: number): GateDecision {
	if (score >= blockThreshold) return "block";
	if (score >= approvalThreshold) return "approve";
	return "allow";
}

// ---------------------------------------------------------------------------
// Path / command helpers (pure, no IO)
// ---------------------------------------------------------------------------

function asObject(input: ActionInput["input"]): {
	command?: string;
	path?: string;
	kind?: string;
} {
	if (!input) return {};
	if (typeof input === "string") return { command: input };
	return input as { command?: string; path?: string; kind?: string };
}

function commandOf(action: ActionInput): string {
	const input = asObject(action.input);
	return typeof input.command === "string" ? input.command : "";
}

function pickWritePath(action: ActionInput): string {
	const input = asObject(action.input);
	if (typeof input.path === "string") return input.path;
	if (action.tool === "bash") return commandOf(action);
	return "";
}

export function touchesSystem(path: string, cwd?: string): boolean {
	if (!path) return false;
	const abs = isAbsolute(path) ? path : cwd ? joinPath(cwd, path) : path;
	return SYSTEM_DIRS.some((dir) => abs.startsWith(dir)) || isRootDelete(path);
}

function isRootDelete(path: string | undefined): boolean {
	if (!path) return false;
	return /rm\s+-rf?\s+\/\s*(?:$|\s|)/.test(path) || /rm\s+-rf?\s+\*\/?/.test(path);
}

/**
 * True when `path` resolves inside the framework's install root. Detection is
 * scoped to `frameworkRoot` so a user's own `src/` or `package.json` is never
 * flagged. When `frameworkRoot` is undefined, framework detection is off.
 */
export function isFrameworkSource(path: string, frameworkRoot?: string): boolean {
	if (!path || !frameworkRoot) return false;
	const abs = isAbsolute(path) ? normalize(path) : joinPath(frameworkRoot, path);
	const root = normalize(frameworkRoot);
	return abs === root || abs.startsWith(`${root}/`);
}

// Minimal POSIX path helpers kept local so the module stays usable in non-Node
// test contexts without pulling node:path.
function joinPath(base: string, rel: string): string {
	if (rel.startsWith("/")) return rel;
	return `${base.replace(/\/$/, "")}/${rel}`;
}

function isAbsolute(path: string): boolean {
	return path.startsWith("/") || /^[a-zA-Z]:/.test(path);
}

function normalize(path: string): string {
	// Collapse ./ and ../ minimally for containment checks.
	return path.replace(/\/+\//g, "/");
}
