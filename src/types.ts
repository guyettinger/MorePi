/**
 * Shared domain types for the MorePi self-modifying framework.
 *
 * Everything here is plain data with no runtime dependencies so the pure logic
 * modules (guardrails, memory, audit, ...) can be imported and unit-tested in
 * isolation without the pi runtime.
 */

/** Coarse classification of an action's scope of impact. */
export type BlastRadius = "self" | "module" | "project" | "system";

/** How much an action changes behavior or state. */
export type ChangeClass =
	| "read"
	| "write-memory"
	| "write-context"
	| "write-skill"
	| "write-tool"
	| "modify-framework"
	| "external-effect";

/** Confidence in a decision, used for canary/shadow gating. */
export type Confidence = "low" | "med" | "high";

/** A decision about how to handle a change request. */
export type GateDecision = "allow" | "approve" | "block";

export interface RiskAssessment {
	/** 0-100 composite score. Higher is riskier. */
	score: number;
	decision: GateDecision;
	radius: BlastRadius;
	changeClass: ChangeClass;
	/** Human-readable reasons that drove the decision. */
	reasons: string[];
	/** True when a hard-stop rule forbids the action regardless of score. */
	hardStop: boolean;
	/** Optional short identifier of the rule that fired. */
	rule?: string;
}

/** A single appendable audit record. */
export interface AuditEntry {
	id: string;
	ts: string;
	kind:
		| "context-forget"
		| "context-remember"
		| "memory-write"
		| "memory-recall"
		| "skill-learned"
		| "tool-proposed"
		| "tool-activated"
		| "tool-rolled-back"
		| "change-blocked"
		| "change-approved"
		| "compaction"
		| "self-eval"
		| "snapshot"
		| "rollback";
	actor: "agent" | "user" | "system";
	summary: string;
	payload?: Record<string, unknown>;
	/** Correlates records that belong to the same action. */
	traceId?: string;
}

/** A memory fact stored on disk. */
export interface MemoryRecord {
	id: string;
	ts: string;
	content: string;
	tags: string[];
	source: string;
	/** 32-dim hashed embedding for similarity recall. No external deps. */
	embedding: number[];
	/** Incremented when a recall or use reinforces this fact. */
	weight: number;
	/** Set when the fact is superseded or marked stale; excluded from recall. */
	superseded?: boolean;
}

/** A generated skill written to the skill library. */
export interface SkillRecord {
	name: string;
	version: number;
	ts: string;
	description: string;
	steps: string[];
	triggers: string[];
	sourcePatterns: string[];
}

/**
 * A proposed or active evolved tool. Only declarative, data-driven tool
 * definitions are evolved (no arbitrary code execution by default). This keeps
 * evolution within the safe, approvable surface of the extension API.
 */
export interface EvolvedTool {
	name: string;
	version: number;
	ts: string;
	kind: "create" | "modify" | "extend";
	description: string;
	/** Human-readable rationale for the evolution. */
	rationale: string;
	status: "proposed" | "shadow" | "active" | "rolled-back";
	/** Declarative parameter schema in JSON-schema-flattened form. */
	parameters: EvolvedToolParameter[];
	/** A prompt the agent runs to emulate the tool's behavior. */
	behaviorPrompt: string;
	/** Blast radius the evolved tool is allowed to operate within. */
	budget: { maxRadius: BlastRadius; requiresApproval: boolean };
	/** Shadow-evaluation metrics when status === "shadow". */
	metrics?: EvolvedToolMetric;
}

export interface EvolvedToolParameter {
	name: string;
	type: "string" | "number" | "boolean";
	description: string;
	required?: boolean;
}

/** Lightweight metrics captured for a tool candidate during shadow evaluation. */
export interface EvolvedToolMetric {
	runs: number;
	successes: number;
	failures: number;
	avgLatencyMs: number;
	lastEvalTs: string;
}

/**
 * The branch-scoped working state persisted as session custom entries so it
 * survives /tree navigation and branching, following pi conventions.
 */
export interface SessionState {
	version: 1;
	/** Memory ids injected into this branch via context_remember. */
	remembered: string[];
	/** Facts deliberately forgotten (dropped from context) this branch. */
	forgotten: string[];
	/** Index of compaction artifacts produced while on this branch. */
	artifactIndex: CompactionArtifact[];
	/** Tool names that were activated (evolved) on this branch. */
	activatedTools: string[];
}

export interface CompactionArtifact {
	ts: string;
	summary: string;
	filesTouched: string[];
	openItems: string[];
	tokenBudgetUsed: number;
}

/** Snapshot of the on-disk framework state, used for rollback. */
export interface StateSnapshot {
	id: string;
	ts: string;
	label: string;
	memoryCount: number;
	skillCount: number;
	toolCount: number;
	/** Path to the full serialized snapshot payload. */
	payloadPath: string;
}
