import { describe, expect, it } from "vitest";
import { activeRemembered, formatRememberedMessage, matchForgetTargets, type RememberedFact } from "../src/context.js";

function fact(id: string, content: string, tags: string[] = [], source = "user"): RememberedFact {
	return { id, content, tags, source };
}

describe("matchForgetTargets", () => {
	it("returns empty for empty request", () => {
		const candidates = [{ id: "mem_1", text: "database migration" }];
		expect(matchForgetTargets("", candidates)).toEqual([]);
	});

	it("returns empty for request with no matching candidates", () => {
		const candidates = [{ id: "mem_1", text: "apple banana cherry" }];
		expect(matchForgetTargets("quantum theory", candidates)).toEqual([]);
	});

	it("finds matching candidate by text overlap", () => {
		const candidates = [
			{ id: "mem_1", text: "database migration plan" },
			{ id: "mem_2", text: "user account settings" },
			{ id: "mem_3", text: "cooking pasta recipe" },
		];
		const result = matchForgetTargets("migration", candidates);
		expect(result).toContain("mem_1");
		expect(result).not.toContain("mem_2");
	});

	it("returns multiple matching ids sorted by relevance", () => {
		const candidates = [
			{ id: "mem_1", text: "database and SQL" },
			{ id: "mem_2", text: "database schema and query" },
			{ id: "mem_3", text: "cooking recipe pasta" },
		];
		const result = matchForgetTargets("database schema", candidates, 5);
		expect(result).toContain("mem_2");
		expect(result).toContain("mem_1");
	});

	it("respects limit parameter", () => {
		const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `mem_${i}`, text: "shared common words" }));
		const result = matchForgetTargets("shared common", candidates, 3);
		expect(result.length).toBeLessThanOrEqual(3);
	});

	it("filters out single-char tokens from requests", () => {
		// "a b" should not match anything because single chars are filtered
		const candidates = [{ id: "mem_1", text: "actual content here" }];
		expect(matchForgetTargets("a b", candidates)).toEqual([]);
	});
});

describe("formatRememberedMessage", () => {
	it("returns empty string for empty facts", () => {
		expect(formatRememberedMessage([])).toBe("");
	});

	it("formats a single fact", () => {
		const msg = formatRememberedMessage([fact("mem_1", "user prefers TypeScript", ["language"], "user")]);
		expect(msg).toContain("user prefers TypeScript");
		expect(msg).toContain("Remembered context");
	});

	it("includes tag labels", () => {
		const msg = formatRememberedMessage([fact("mem_1", "fact", ["tag1", "tag2"])]);
		expect(msg).toContain("tag1");
		expect(msg).toContain("tag2");
	});

	it("numbers multiple facts in order", () => {
		const msg = formatRememberedMessage([fact("mem_1", "first"), fact("mem_2", "second")]);
		// numbered 1-indexed in order
		expect(msg).toMatch(/1\.\s*first/);
		expect(msg).toMatch(/2\.\s*second/);
	});

	it("indicates source 'unknown' when source is empty string", () => {
		const msg = formatRememberedMessage([fact("mem_1", "fact", [], "")]);
		expect(msg).toContain("unknown");
	});
});

describe("activeRemembered", () => {
	it("returns all requested when forgotten is empty", () => {
		const requested = [fact("mem_1", "a"), fact("mem_2", "b")];
		const active = activeRemembered(requested, []);
		expect(active).toHaveLength(2);
	});

	it("drops forgotten ids", () => {
		const requested = [
			fact("mem_1", "still remembered"),
			fact("mem_2", "forgotten"),
			fact("mem_3", "still remembered 2"),
		];
		const active = activeRemembered(requested, ["mem_2"]);
		expect(active).toHaveLength(2);
		expect(active.find((f) => f.id === "mem_2")).toBeUndefined();
		expect(active.find((f) => f.id === "mem_1")).toBeDefined();
	});

	it("returns a copy (not a mutation of the original)", () => {
		const requested = [fact("mem_1", "a"), fact("mem_2", "b")];
		const active = activeRemembered(requested, ["mem_1"]);
		expect(requested).toHaveLength(2);
		expect(active).toHaveLength(1);
	});

	it("drops all when all are forgotten", () => {
		const requested = [fact("mem_1", "a"), fact("mem_2", "b")];
		expect(activeRemembered(requested, ["mem_1", "mem_2"])).toEqual([]);
	});
});
