import { describe, expect, it } from "vitest";
import { tokenize, unique } from "../src/util.js";

describe("unique", () => {
	it("removes duplicate values but preserves first-occurrence order", () => {
		expect(unique(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
	});

	it("returns an empty array as-is", () => {
		expect(unique([])).toEqual([]);
	});

	it("keeps a single element", () => {
		expect(unique(["only"])).toEqual(["only"]);
	});

	it("is generic over non-string element types (numbers)", () => {
		expect(unique([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
	});

	it("is a pure trim-filter helper target: callers pre-filter empties", () => {
		// registry/compaction pass plain arrays; memory pre-filters trimmed
		// empties before calling, so the helper itself needs no knowledge of
		// what "empty" means.
		const filtered = ["  ", "ok", "", "  ok  "].filter((t) => t.trim().length > 0);
		expect(unique(filtered)).toEqual(["ok", "  ok  "]);
	});
});

describe("tokenize", () => {
	// Proves the shared pipeline is behavior-preserving per caller:
	// lower -> strip non [\p{L}\p{N}\s] -> split on whitespace -> length/stopword tail.

	// context.ts calls with { minLength: 3 } and no stopwords.
	it("context args ({ minLength: 3 }): drops sub-3-char tokens, keeps stop tokens unfiltered", () => {
		const out = tokenize("The quick Ab fox", { minLength: 3 });
		// "ab" is 2 chars -> dropped; "the" is a stopword but no stopwords set -> kept.
		expect(out).toEqual(["the", "quick", "fox"]);
		expect(out).toContain("the");
		expect(out).not.toContain("ab");
	});

	// memory.ts calls with { minLength: 2, stopwords: STOPWORDS }.
	it("memory args ({ minLength: 2, stopwords }): filters stop tokens, keeps 2-char tokens", () => {
		const stopwords = new Set(["the", "and", "of", "to"]);
		const out = tokenize("ab the and of code", { minLength: 2, stopwords });
		// "ab" 2-char non-stopword -> kept; "the"/"and" stopwords -> dropped.
		expect(out).toEqual(["ab", "code"]);
		expect(out).toContain("ab");
		expect(out).not.toContain("the");
		expect(out).not.toContain("and");
	});

	it("without a stopwords set, stop tokens survive (context-equivalent)", () => {
		const out = tokenize("the quick brown fox", { minLength: 3 });
		expect(out).toContain("the");
	});
});
