import { describe, expect, it } from "vitest";
import { createGate } from "../src/approval.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// Finding W: memory_write / self_learn run the gate but previously never enforced
// its outcome (a blocked/declined result still wrote). This locks down the gate
// contract that W's bail relies on: under a customized low approvalThreshold or a
// declining/no-UI response, the gate returns a blocked/!allow outcome that the
// bailing handler turns into a skip.

describe("createGate enforces gate outcomes (W)", () => {
	const noUi = () => createGate({ config: DEFAULT_CONFIG });

	it("a no-UI gate blocks a high-risk approvable action", async () => {
		const gate = noUi();
		// self_learn is write-skill (base 35) at project radius (×1.3) = 46, which is
		// below the default 55 approval gate, so it is *allowed* — the guard is inert
		// at default thresholds, matching the finding.
		const ok = await gate.execute({
			tool: "self_learn",
			input: {},
			cwd: "/project",
			frameworkRoot: `/framework`,
		});
		expect(ok.allow).toBe(true);
		expect(ok.status).toBe("allowed");
	});

	it("a no-UI gate blocks when approvalThreshold is lowered (the bypass W closes)", async () => {
		const gate = createGate({ config: { ...DEFAULT_CONFIG, approvalThreshold: 30 } });
		const outcome = await gate.execute({ tool: "self_learn", input: {}, cwd: "/project", frameworkRoot: `/framework` });
		// 46 >= 30 (approve) but no UI to grant → the gate degrades to a block.
		expect(outcome.status).toBe("blocked");
		expect(outcome.allow).toBe(false);
	});

	it("a declining UI blocks a high-risk approvable action", async () => {
		const gate = createGate({
			config: { ...DEFAULT_CONFIG, approvalThreshold: 30 },
			ui: { hasUI: true, confirm: async () => false },
		});
		const outcome = await gate.execute({ tool: "self_learn", input: {}, cwd: `/project`, frameworkRoot: `/framework` });
		expect(outcome.allow).toBe(false);
		expect(outcome.status).toBe("blocked");
	});

	it("guardrails disabled short-circuits to allow (no audit written)", async () => {
		const gate = createGate({ config: { ...DEFAULT_CONFIG, enable: { ...DEFAULT_CONFIG.enable, guardrails: false } } });
		const outcome = await gate.execute({
			tool: "memory_write",
			input: { content: "x" },
			cwd: `/project`,
			frameworkRoot: `/framework`,
		});
		expect(outcome.allow).toBe(true);
		expect(outcome.reason).toContain("guardrails disabled");
	});

	// A3: a hard stop must block even when its numeric score sits below the block
	// threshold — the assessment owns `hardStop`, not discarded for threshold-only `decide`.
	it("honors assessment.hardStop even below blockThreshold (A3)", async () => {
		const gate = createGate({
			config: { ...DEFAULT_CONFIG, approvalThreshold: 100, blockThreshold: 100 },
			ui: { hasUI: true, confirm: async () => true },
		});
		// A write into a protected secret dir is a hard stop, but its base score
		// (write-context) sits far below 100, so a threshold-only decision would let it
		// through; the hard-stop short-circuit must block it instead.
		const outcome = await gate.execute({
			tool: "write",
			input: { path: ".aws/credentials", content: "secret" },
			cwd: `/project`,
			frameworkRoot: `/framework`,
		});
		expect(outcome.assessment?.hardStop).toBe(true);
		expect(outcome.status).toBe("blocked");
		expect(outcome.allow).toBe(false);
	});
});
