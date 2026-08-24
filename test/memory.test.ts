import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cosineSimilarity, embed, MemoryStore } from "../src/memory.js";

describe("embed", () => {
	it("returns a 32-element vector by default", () => {
		const v = embed("hello world");
		expect(v).toHaveLength(32);
	});

	it("is deterministic: same input always yields the same vector", () => {
		const a = embed("test input");
		const b = embed("test input");
		expect(a).toEqual(b);
	});

	it("different inputs produce different vectors", () => {
		const a = embed("database schema design");
		const b = embed("kitten playing in the garden");
		const same = a.every((v, i) => v === b[i]!);
		expect(same).toBe(false);
	});

	it("tags are weighted more than plain text (higher vector norm)", () => {
		const plain = embed("test", []);
		const tagged = embed("test", ["important", "critical"]);
		const norm = (v: number[]) => v.reduce((a, b) => a + b * b, 0) ** 0.5;
		expect(norm(tagged)).toBeGreaterThan(norm(plain));
	});

	it("empty input produces a zero vector", () => {
		const v = embed("");
		expect(v.every((x) => x === 0)).toBe(true); // empty string -> no tokens -> zero vector
		// actually empty string → no tokens → zero or near-zero
		expect(v).toHaveLength(32);
	});

	it("custom dims work", () => {
		const v = embed("hello", [], 8);
		expect(v).toHaveLength(8);
	});
});

describe("cosineSimilarity", () => {
	it("same vector has cosine 1", () => {
		const v = embed("the cat sat on the mat");
		expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
	});

	it("identical inputs always get cosine 1", () => {
		const a = embed("alpha beta gamma");
		const b = embed("alpha beta gamma");
		expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
	});

	it("zero vector returns 0", () => {
		const a = new Array(32).fill(0);
		const b = embed("some text");
		expect(cosineSimilarity(a, b)).toBe(0);
	});

	it("empty vectors return 0", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("different inputs generally have lower cosine than identical", () => {
		const a = embed("database schema design and migration");
		const b = embed("kitten playing in the sunny garden");
		const c = embed("database schema design and migration");
		expect(cosineSimilarity(a, b)).toBeLessThan(cosineSimilarity(a, c));
	});
});

describe("MemoryStore", () => {
	async function makeStore() {
		const dir = await mkdtemp(join(tmpdir(), "morepi-mem-"));
		const store = new MemoryStore(join(dir, "memory.jsonl"));
		return store;
	}

	it("add + all returns added records", async () => {
		const store = await makeStore();
		const rec = await store.add({
			content: "user prefers TypeScript",
			tags: ["language", "preference"],
			source: "user",
		});
		expect(rec.id).toMatch(/^mem_/);
		expect(rec.content).toBe("user prefers TypeScript");
		expect(rec.tags).toEqual(["language", "preference"]);
		const all = await store.all();
		expect(all).toHaveLength(1);
		expect(all[0]!.id).toBe(rec.id);
	});

	it("count reflects number of stored records", async () => {
		const store = await makeStore();
		expect(await store.count()).toBe(0);
		await store.add({ content: "one" });
		await store.add({ content: "two" });
		expect(await store.count()).toBe(2);
	});

	it("recall finds relevant facts", async () => {
		const store = await makeStore();
		await store.add({ content: "user prefers TypeScript over JavaScript", tags: ["language"] });
		await store.add({ content: "cat is a programming language", tags: ["cat"] });
		const results = await store.recall("TypeScript language preference", { limit: 5, minScore: 0.05 });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]!.record.content).toContain("TypeScript");
	});

	it("superseded records are excluded from recall", async () => {
		const store = await makeStore();
		const rec = await store.add({ content: "user prefers Python", tags: ["language"] });
		await store.supersede(rec.id);
		const results = await store.recall("user prefers Python", { minScore: 0.01 });
		expect(results.length).toBe(0);
	});

	it("supersede with replacement adds new record", async () => {
		const store = await makeStore();
		const rec = await store.add({ content: "old fact", tags: ["test"] });
		await store.supersede(rec.id, "new fact");
		const all = await store.all();
		expect(all.length).toBe(2);
		const superseded = all.find((r) => r.id === rec.id)!;
		expect(superseded.superseded).toBe(true);
		// new record from replacement
		expect(all.some((r) => r.content === "new fact")).toBe(true);
	});

	it("reinforce increases weight", async () => {
		const store = await makeStore();
		const rec = await store.add({ content: "test fact" });
		expect(rec.weight).toBe(1);
		await store.reinforce(rec.id);
		const all = await store.all();
		expect(all[0]!.weight).toBe(2);
	});

	it("recall with minScore filters low-score results", async () => {
		const store = await makeStore();
		await store.add({ content: "apple banana cherry", tags: ["fruits"] });
		const results = await store.recall("quantum physics theory", { minScore: 0.5 });
		expect(results.length).toBe(0);
	});

	it("all() returns a copy, not a reference", async () => {
		const store = await makeStore();
		await store.add({ content: "test" });
		const arr = await store.all();
		arr.push({ id: "fake", ts: "", content: "x", tags: [], source: "", embedding: [], weight: 1 });
		const arr2 = await store.all();
		expect(arr2).toHaveLength(1);
	});
});
