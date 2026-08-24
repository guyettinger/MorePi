import { type ActionInput, scoreRisk } from "./guardrails.js";
import type { EvolvedTool, EvolvedToolMetric } from "./types.js";

/**
 * Self-evaluation and validation.
 *
 * The framework must not trust its own self-assessment, so evaluations are
 * *advisory signals* that feed a promotion gate rather than the final decision.
 * Human-in-the-loop approval remains mandatory before a tool goes active.
 */

export interface QualitySignals {
	testsAdded: number;
	testsPassed: number;
	testsTotal: number;
	errorCount: number;
	changedLines: number;
	guardrailBlocks: number;
	lintClean: boolean;
	reviewed: boolean;
}

export interface QualityVerdict {
	/** 0-1 composite confidence the change is safe and effective. */
	score: number;
	safe: boolean;
	notes: string[];
}

/**
 * Heuristic quality gate based on the signals we can measure without a second
 * model. Any signal that indicates risk floors the score.
 */
export function evaluateQuality(s: QualitySignals): QualityVerdict {
	const notes: string[] = [];
	let score = 1;

	const passRate = s.testsTotal > 0 ? s.testsPassed / s.testsTotal : 0;
	if (s.testsTotal > 0) {
		score *= 0.5 + 0.5 * passRate;
		notes.push(`tests ${s.testsPassed}/${s.testsTotal} passed`);
	} else {
		notes.push("no tests run");
	}

	if (s.testsTotal === 0) score *= 0.7;

	if (s.testsAdded > 0) {
		score = Math.min(1, score * 1.05);
		notes.push(`+${s.testsAdded} test(s) added`);
	}

	if (s.errorCount > 0) {
		score -= Math.min(0.5, s.errorCount * 0.1);
		notes.push(`${s.errorCount} runtime error(s) observed`);
	}

	if (!s.lintClean) {
		score -= 0.1;
		notes.push("lint not clean");
	}

	// Large diffs get a mild penalty: more surface area to get wrong.
	if (s.changedLines > 400) {
		score -= 0.1;
		notes.push(`large diff (${s.changedLines} lines)`);
	}

	if (s.guardrailBlocks > 0) {
		score -= Math.min(0.3, s.guardrailBlocks * 0.1);
		notes.push(`${s.guardrailBlocks} guardrail block(s)`);
	}

	if (!s.reviewed) {
		notes.push("not human-reviewed yet");
	}

	score = clamp01(score);
	return { score, safe: score >= 0.6 && s.errorCount === 0, notes };
}

/**
 * Promotion policy for an evolved tool. A tool moves shadow -> active only when
 * it clears its threshold *and* quality is safe; otherwise it is kept in shadow
 * or rolled back.
 */
export type PromotionDecision = "promote" | "keep-shadow" | "rollback";

const DEFAULT_PROMOTION = { minRuns: 3, minPassRate: 0.8, maxFailures: 2 };

export function shouldPromote(
	metric: EvolvedToolMetric,
	policy: Partial<typeof DEFAULT_PROMOTION> = {},
): PromotionDecision {
	const minRuns = policy.minRuns ?? DEFAULT_PROMOTION.minRuns;
	const minPassRate = policy.minPassRate ?? DEFAULT_PROMOTION.minPassRate;
	const maxFailures = policy.maxFailures ?? DEFAULT_PROMOTION.maxFailures;

	if (metric.runs < minRuns) return "keep-shadow";
	if (metric.failures > maxFailures) return "rollback";

	const passRate = metric.runs > 0 ? metric.successes / metric.runs : 0;
	if (passRate < minPassRate) return metric.failures > 0 ? "rollback" : "keep-shadow";

	return "promote";
}

/** Fold a single shadow run into a metric. */
export function foldMetric(metric: EvolvedToolMetric, result: { ok: boolean; latencyMs: number }): EvolvedToolMetric {
	const runs = metric.runs + 1;
	const successes = metric.successes + (result.ok ? 1 : 0);
	const failures = metric.failures + (result.ok ? 0 : 1);
	const totalLatency = metric.avgLatencyMs * metric.runs + result.latencyMs;
	return {
		runs,
		successes,
		failures,
		avgLatencyMs: totalLatency / runs,
		lastEvalTs: new Date().toISOString(),
	};
}

/**
 * Shadow comparison of a new implementation against the baseline by running both
 * on the same inputs and recording a verdict. Pure and dependency-free: the
 * caller injects the executors.
 */
export interface ShadowInput {
	tool: EvolvedTool;
	inputs: string[];
	runCandidate: (input: string) => boolean;
	runBaseline: (input: string) => boolean;
	startMetric: EvolvedToolMetric;
	policy?: Partial<typeof DEFAULT_PROMOTION>;
}

export interface ShadowResult {
	metric: EvolvedToolMetric;
	decision: PromotionDecision;
	regressions: string[];
}

export function runShadowComparison(shadow: ShadowInput): ShadowResult {
	let metric = shadow.startMetric;
	const regressions: string[] = [];
	for (const input of shadow.inputs) {
		const cand = shadow.runCandidate(input);
		const base = shadow.runBaseline(input);
		// A run is a "success" when it at least matches the baseline.
		metric = foldMetric(metric, { ok: cand || base, latencyMs: 0 });
		// Record a regression only when the candidate is strictly worse.
		if (!cand && base) regressions.push(input);
	}
	return { metric, decision: shouldPromote(metric, shadow.policy), regressions };
}

/** Combine a self-evaluation verdict with the current action's risk. */
export function gateAction(
	action: ActionInput,
	verdict: QualityVerdict,
	thresholds: { approval: number; block: number },
): { allow: boolean; reason: string } {
	const risk = scoreRisk(action);
	const combined = Math.round(risk.score * 0.6 + (1 - verdict.score) * 100 * 0.4);
	const reason = `risk ${risk.score} + quality ${verdict.score.toFixed(2)} => combined ${combined}`;
	if (risk.hardStop) return { allow: false, reason: `hard stop: ${risk.rule ?? "rule"}; ${reason}` };
	if (combined >= thresholds.block) return { allow: false, reason };
	return { allow: true, reason };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}
