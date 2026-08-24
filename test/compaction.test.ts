import { describe, expect, it } from "vitest";
import {
	artifactFrom,
	type ParsedCompact,
	parseCompactionOutput,
	runCompaction,
	type Summarizer,
} from "../src/compaction.js";

describe("parseCompactionOutput", () => {
	it("parses valid JSON with all fields", () => {
		const json = JSON.stringify({
			summary: "We refactored the auth module.",
			filesTouched: ["src/auth.ts"],
			openItems: ["Add tests for new auth flow"],
			facts: ["Auth uses JWT tokens"],
		});
		const result = parseCompactionOutput(json, 5000);
		expect(result.summary).toBe("We refactored the auth module.");
		expect(result.filesTouched).toEqual(["src/auth.ts"]);
		expect(result.openItems).toEqual(["Add tests for new auth flow"]);
		expect(result.facts).toEqual(["Auth uses JWT tokens"]);
		expect(result.raw).toBe(false);
		expect(result.tokensBefore).toBe(5000);
	});

	it("parses JSON wrapped in code fences", () => {
		const fenced = `\`\`\`\n${JSON.stringify({ summary: "did stuff", filesTouched: [], openItems: [], facts: [] })}\n\`\`\``;
		const result = parseCompactionOutput(fenced, 100);
		expect(result.summary).toBe("did stuff");
		expect(result.raw).toBe(false);
	});

	it("picks json-labeled fences", () => {
		const fenced =
			"```json\n" +
			JSON.stringify({ summary: "json fenced", filesTouched: ["a.ts"], openItems: [], facts: [] }) +
			"\n```";
		const result = parseCompactionOutput(fenced, 100);
		expect(result.summary).toBe("json fenced");
		expect(result.raw).toBe(false);
	});

	it("falls back to raw text when no JSON found", () => {
		const result = parseCompactionOutput("just plain text, no json here", 2000);
		// raw: true, summary = the trimmed text
		expect(result.raw).toBe(true);
		expect(result.summary).toBe("just plain text, no json here");
		expect(result.filesTouched).toEqual([]);
		expect(result.openItems).toEqual([]);
		expect(result.facts).toEqual([]);
	});

	it("returns empty summary for empty input with raw=true", () => {
		const result = parseCompactionOutput("", 0);
		expect(result.raw).toBe(true);
		expect(result.summary).toBe("(empty compaction)");
		expect(result.tokensBefore).toBe(0);
	});

	it("tolerates missing fields in JSON (uses defaults)", () => {
		const json = JSON.stringify({ summary: "only summary field" });
		const result = parseCompactionOutput(json, 500);
		expect(result.summary).toBe("only summary field");
		expect(result.filesTouched).toEqual([]);
		expect(result.openItems).toEqual([]);
		expect(result.facts).toEqual([]);
	});

	it("uses '(no prose summary)' default when summary field is not a string", () => {
		const json = JSON.stringify({ summary: 42, filesTouched: [] });
		const result = parseCompactionOutput(json, 100);
		expect(result.summary).toBe("(no prose summary)");
	});
});

describe("artifactFrom", () => {
	it("produces a CompactionArtifact with deduped arrays", () => {
		const parsed: ParsedCompact = {
			summary: "test summary",
			filesTouched: ["a.ts", "a.ts", "b.ts"],
			openItems: ["do x", "do x"],
			facts: ["fact1", "fact1"],
			raw: false,
		};
		const artifact = artifactFrom(parsed, 1234);
		expect(artifact.summary).toBe("test summary");
		expect(artifact.tokenBudgetUsed).toBe(1234);
		expect(artifact.filesTouched).toEqual(["a.ts", "b.ts"]);
		expect(artifact.openItems).toEqual(["do x"]);
		expect(artifact.ts).toBeDefined();
	});
});

describe("runCompaction", () => {
	it("calls the summarizer, parses output, and returns parsed result", async () => {
		const summarizer: Summarizer = {
			summarize: async (_prompt, _signal) =>
				JSON.stringify({
					summary: "we worked on auth",
					filesTouched: ["src/auth.ts"],
					openItems: ["finish tests"],
					facts: ["auth uses JWT"],
				}),
		};

		const artifactSummary: string[] = [];

		const result = await runCompaction({
			ctx: { tokensBefore: 10000, messagesText: "test conversation", openTasks: ["fix bugs"] },
			summarizer,
			onArtifact: (artifact) => {
				artifactSummary.push(artifact.summary);
				expect(artifact.summary).toBe("we worked on auth");
			},
			onFact: (fact) => {
				expect(fact).toBe("auth uses JWT");
			},
		});

		expect(result.summary).toBe("we worked on auth");
		expect(result.filesTouched).toEqual(["src/auth.ts"]);
		expect(result.openItems).toEqual(["finish tests"]);
		expect(result.raw).toBe(false);
	});

	it("handles malformed summarizer output gracefully (raw=true)", async () => {
		const summarizer: Summarizer = {
			summarize: async () => "this is not JSON at all",
		};
		const result = await runCompaction({
			ctx: { tokensBefore: 500, messagesText: "stuff" },
			summarizer,
		});
		expect(result.raw).toBe(true);
	});

	it("calls onNotify and onArtifact when provided", async () => {
		let notified = 0;
		let artifactCalled = 0;
		const summarizer: Summarizer = {
			summarize: async () =>
				JSON.stringify({
					summary: "summary",
					filesTouched: [],
					openItems: [],
					facts: [],
				}),
		};
		await runCompaction({
			ctx: { tokensBefore: 999, messagesText: "x" },
			summarizer,
			onNotify: () => {
				notified++;
			},
			onArtifact: () => {
				artifactCalled++;
			},
		});
		expect(artifactCalled).toBe(1);
		expect(notified).toBeGreaterThanOrEqual(1);
	});
});
