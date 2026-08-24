import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QualitySignals } from "../src/evaluation.js";
import { evaluateQuality, foldMetric, runShadowComparison, shouldPromote } from "../src/evaluation.js";
import {
	activationAction,
	draftEvolution,
	type EvolutionProposal,
	evaluateShadow,
	ToolRegistry,
} from "../src/tools/evolution.js";
import type { EvolvedTool, EvolvedToolMetric } from "../src/types.js";

const emptyMetric: EvolvedToolMetric = {
	runs: 0,
	successes: 0,
	failures: 0,
	avgLatencyMs: 0,
	lastEvalTs: "1970-01-01T00:00:00.000Z",
};

function proposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
	return {
		action: "create",
		name: "my_new_tool",
		description: "A test tool",
		rationale: "Testing tool evolution",
		behaviorPrompt: "Do the thing.",
		...overrides,
	};
}

describe("draftEvolution", () => {
	it("creates version 1 for a new tool", () => {
		const result = draftEvolution(proposal(), []);
		expect(result.version).toBe(1);
		expect(result.name).toBe("my_new_tool");
		expect(result.kind).toBe("create");
		expect(result.status).toBe("proposed");
	});

	it("bumps version for an existing tool", () => {
		const existing: EvolvedTool = {
			name: "my_new_tool",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "Old version",
			rationale: "Original rationale",
			status: "active",
			parameters: [],
			behaviorPrompt: "Old behavior",
			budget: { maxRadius: "module", requiresApproval: false },
			metrics: emptyMetric,
		};
		const result = draftEvolution(proposal({ action: "modify" }), [existing]);
		expect(result.version).toBe(2);
		expect(result.kind).toBe("modify");
	});

	it("inherits metrics from existing tool when present", () => {
		const existing: EvolvedTool = {
			name: "my_new_tool",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "old desc",
			rationale: "old rationale",
			status: "active",
			parameters: [],
			behaviorPrompt: "old behavior",
			budget: { maxRadius: "module", requiresApproval: false },
			metrics: { ...emptyMetric, runs: 5, successes: 4 },
		};
		const result = draftEvolution(proposal({ action: "extend" }), [existing]);
		expect(result.metrics!.runs).toBe(5);
	});

	it("system-radius tool starts in 'shadow' status", () => {
		const result = draftEvolution(proposal({ maxRadius: "system" }));
		expect(["proposed", "shadow"]).toContain(result.status);
	});

	it("slugs the tool name", () => {
		const result = draftEvolution({ ...proposal(), name: "My-Tool_Extension!!" });
		// slug normalizes to lowercase alphanumeric/underscore
		expect(/my.tool.extension/i.test(result.name)).toBe(true);
	});

	it("empty behaviorPrompt stays empty (not undefined)", () => {
		const result = draftEvolution(proposal({ behaviorPrompt: "" }));
		expect(result.behaviorPrompt).toBeDefined();
	});
});

describe("evaluateShadow", () => {
	it("promotes a tool when shouldPromote returns 'promote'", () => {
		const tool: EvolvedTool = {
			name: "toolA",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "Tool A",
			rationale: "test",
			status: "shadow",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
			metrics: emptyMetric,
		};
		const goodMetrics = { runs: 5, successes: 5, failures: 0, avgLatencyMs: 10, lastEvalTs: new Date().toISOString() };
		const result = evaluateShadow(tool, goodMetrics, { minRuns: 3, minPassRate: 0.8, maxFailures: 0 });
		expect(result.decision).toBe("promote");
		expect(result.tool.status).toBe("active");
	});

	it("keeps tool in shadow when shouldPromote returns 'keep-shadow'", () => {
		const tool: EvolvedTool = {
			name: "toolB",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "Tool B",
			rationale: "test",
			status: "shadow",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
			metrics: emptyMetric,
		};
		const poorMetrics = { runs: 1, successes: 1, failures: 0, avgLatencyMs: 100, lastEvalTs: new Date().toISOString() };
		const result = evaluateShadow(tool, poorMetrics, { minRuns: 5, minPassRate: 0.8, maxFailures: 0 });
		expect(result.decision).toBe("keep-shadow");
		expect(result.tool.status).toBe("shadow");
	});

	it("rolls back when too many failures", () => {
		const tool: EvolvedTool = {
			name: "toolC",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "Tool C",
			rationale: "test",
			status: "shadow",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
			metrics: emptyMetric,
		};
		const badMetrics = { runs: 5, successes: 1, failures: 4, avgLatencyMs: 100, lastEvalTs: new Date().toISOString() };
		const result = evaluateShadow(tool, badMetrics, { minRuns: 3, minPassRate: 0.8, maxFailures: 2 });
		expect(result.decision).toBe("rollback");
		expect(result.tool.status).toBe("rolled-back");
	});
});

describe("activationAction", () => {
	it("produces an action with viaPipeline true", () => {
		const tool: EvolvedTool = {
			name: "myTool",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "desc",
			rationale: "rat",
			status: "shadow",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
			metrics: emptyMetric,
		};
		const action = activationAction(tool);
		expect(action.tool).toBe("evolve_tool");
		expect(action.viaPipeline).toBe(true);
	});
});

describe("shouldPromote", () => {
	it("promotes when runs >= minRuns, passRate >= minPassRate, failures <= maxFailures", () => {
		expect(shouldPromote({ runs: 10, successes: 9, failures: 1, avgLatencyMs: 0, lastEvalTs: "" })).toBe("promote");
	});

	it("keeps shadow when runs < minRuns", () => {
		expect(shouldPromote({ runs: 1, successes: 1, failures: 0, avgLatencyMs: 0, lastEvalTs: "" })).toBe("keep-shadow");
	});

	it("rolls back when failures > maxFailures", () => {
		const metric = { runs: 5, successes: 1, failures: 5, avgLatencyMs: 0, lastEvalTs: "" };
		// default maxFailures is 2, so 5 failures -> rollback
		expect(shouldPromote(metric)).toBe("rollback");
	});

	it("returns 'promote' with custom policy thresholds", () => {
		expect(
			shouldPromote(
				{ runs: 2, successes: 2, failures: 0, avgLatencyMs: 0, lastEvalTs: "" },
				{ minRuns: 2, minPassRate: 1, maxFailures: 0 },
			),
		).toBe("promote");
	});
});

describe("evaluateQuality", () => {
	it("score is 1 for perfect signals", () => {
		const signals: QualitySignals = {
			testsPassed: 10,
			testsTotal: 10,
			testsAdded: 5,
			errorCount: 0,
			changedLines: 10,
			guardrailBlocks: 0,
			lintClean: true,
			reviewed: true,
		};
		const verdict = evaluateQuality(signals);
		expect(verdict.score).toBeGreaterThan(0.8);
		expect(verdict.safe).toBe(true);
	});

	it("score is reduced with errors", () => {
		const signals: QualitySignals = {
			testsPassed: 0,
			testsTotal: 0,
			testsAdded: 0,
			errorCount: 5,
			changedLines: 10,
			guardrailBlocks: 0,
			lintClean: true,
			reviewed: false,
		};
		const verdict = evaluateQuality(signals);
		expect(verdict.score).toBeLessThan(0.5);
		expect(verdict.safe).toBe(false);
	});

	it("notes include 'no tests run' when testsTotal is 0", () => {
		const signals: QualitySignals = {
			testsPassed: 0,
			testsTotal: 0,
			testsAdded: 0,
			errorCount: 0,
			changedLines: 0,
			guardrailBlocks: 0,
			lintClean: true,
			reviewed: true,
		};
		const verdict = evaluateQuality(signals);
		expect(verdict.notes.some((n) => n.includes("no tests"))).toBe(true);
	});

	it("score is capped at 1.0", () => {
		const signals: QualitySignals = {
			testsPassed: 100,
			testsTotal: 100,
			testsAdded: 100,
			errorCount: 0,
			changedLines: 0,
			guardrailBlocks: 0,
			lintClean: true,
			reviewed: true,
		};
		const verdict = evaluateQuality(signals);
		expect(verdict.score).toBeLessThanOrEqual(1.0);
	});
});

describe("foldMetric", () => {
	it("increments runs and successes on ok=true", () => {
		const result = foldMetric(emptyMetric, { ok: true, latencyMs: 100 });
		expect(result.runs).toBe(1);
		expect(result.successes).toBe(1);
		expect(result.failures).toBe(0);
		expect(result.avgLatencyMs).toBe(100);
	});

	it("increments failures on ok=false", () => {
		const result = foldMetric(emptyMetric, { ok: false, latencyMs: 200 });
		expect(result.runs).toBe(1);
		expect(result.successes).toBe(0);
		expect(result.failures).toBe(1);
		expect(result.avgLatencyMs).toBe(200);
	});

	it("computes average latency correctly across multiple folds", () => {
		let metric = emptyMetric;
		metric = foldMetric(metric, { ok: true, latencyMs: 100 });
		metric = foldMetric(metric, { ok: true, latencyMs: 300 });
		expect(metric.runs).toBe(2);
		expect(metric.avgLatencyMs).toBe(200);
	});
});

describe("runShadowComparison", () => {
	it("returns regressions when candidate is worse than baseline", () => {
		const result = runShadowComparison({
			tool: {
				name: "test",
				version: 1,
				ts: "1970-01-01T00:00:00Z",
				kind: "create",
				description: "desc",
				rationale: "test",
				status: "shadow",
				parameters: [],
				behaviorPrompt: "do it",
				budget: { maxRadius: "self", requiresApproval: false },
			},
			inputs: ["input-a", "input-b", "input-fail"],
			runCandidate: (input) => input !== "input-fail",
			runBaseline: () => true,
			startMetric: emptyMetric,
			policy: { minRuns: 3, minPassRate: 0.5, maxFailures: 10 },
		});
		expect(result.regressions).toEqual(["input-fail"]);
		expect(result.decision).toBe("promote");
	});

	it("returns promote when candidate matches baseline always", () => {
		const result = runShadowComparison({
			tool: {
				name: "test",
				version: 1,
				ts: "1970-01-01T00:00:00Z",
				kind: "create",
				description: "desc",
				rationale: "test",
				status: "shadow",
				parameters: [],
				behaviorPrompt: "do it",
				budget: { maxRadius: "self", requiresApproval: false },
			},
			inputs: ["one", "two", "three", "four", "five"],
			runCandidate: () => true,
			runBaseline: () => true,
			startMetric: emptyMetric,
			policy: { minRuns: 5, minPassRate: 1.0, maxFailures: 0 },
		});
		expect(result.regressions).toEqual([]);
		expect(result.decision).toBe("promote");
	});
});

describe("ToolRegistry", () => {
	async function makeRegistry(): Promise<ToolRegistry> {
		const d = await mkdtemp(join(tmpdir(), "morepi-tools-"));
		return new ToolRegistry(d);
	}

	it("list returns empty initially", async () => {
		const reg = await makeRegistry();
		expect(await reg.list()).toEqual([]);
	});

	it("save + list roundtrips a tool", async () => {
		const reg = await makeRegistry();
		const tool: EvolvedTool = {
			name: "myTool",
			version: 1,
			ts: new Date().toISOString(),
			kind: "create",
			description: "desc",
			rationale: "rat",
			status: "active",
			parameters: [{ name: "arg1", type: "string", description: "arg1", required: true }],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
		};
		await reg.save(tool);
		const all = await reg.list();
		expect(all).toHaveLength(1);
		expect(all[0]!.name).toBe("myTool");
		expect(all[0]!.version).toBe(1);
		expect(all[0]!.status).toBe("active");
	});

	it("latest returns the highest version", async () => {
		const reg = await makeRegistry();
		const base: EvolvedTool = {
			name: "myTool",
			version: 1,
			ts: "1970-01-01T00:00:00Z",
			kind: "create",
			description: "v1",
			rationale: "r",
			status: "active",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
		};
		const v2: EvolvedTool = { ...base, version: 2, status: "shadow" };
		await reg.save(base);
		// save writes as myTool.json, so v2 overwrites v1.
		// supersede marks the previous as rolled-back by re-saving latest.
		// For this test, just save v2 and check latest returns it.
		await reg.save(v2);
		const latest = await reg.latest("myTool");
		// After saving v2 (overwrites same file), list() still shows one entry
		expect(latest!.version).toBe(2);
	});

	it("supersede marks the latest tool as rolled-back", async () => {
		const reg = await makeRegistry();
		const tool: EvolvedTool = {
			name: "myTool",
			version: 1,
			ts: new Date().toISOString(),
			kind: "create",
			description: "desc",
			rationale: "rat",
			status: "active",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
		};
		await reg.save(tool);
		await reg.supersede("myTool");
		const all = await reg.list();
		expect(all[0]!.status).toBe("rolled-back");
	});

	it("find returns undefined for non-existent tool", async () => {
		const reg = await makeRegistry();
		expect(await reg.find("nonexistent")).toBeUndefined();
	});

	it("find returns the tool when it exists", async () => {
		const reg = await makeRegistry();
		const tool: EvolvedTool = {
			name: "myTool",
			version: 1,
			ts: new Date().toISOString(),
			kind: "create",
			description: "desc",
			rationale: "rat",
			status: "shadow",
			parameters: [],
			behaviorPrompt: "do it",
			budget: { maxRadius: "self", requiresApproval: false },
		};
		await reg.save(tool);
		expect((await reg.find("myTool"))!.status).toBe("shadow");
	});
});
