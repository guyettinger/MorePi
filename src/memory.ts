import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryRecord } from "./types.js";

/**
 * Persistent, cross-session memory.
 *
 * Each fact is stored as a {@link MemoryRecord} in a JSONL file. Recalling is
 * done with a small, dependency-free hashed bag-of-words embedding and cosine
 * similarity, which keeps the subsystem self-contained (no pgvector, no
 * embeddings API key) while still giving useful "related facts" recall. The
 * embedding is deterministic so the same text always recalls the same facts.
 */

const DEFAULT_DIMS = 32;

/**
 * Deterministic hashed bag-of-words embedding.
 *
 * Splits on word boundaries, lowercases, and scatters each token into a fixed
 * dimension using two FNV-1a hashes: one picks the bucket, one picks the sign
 * (signed hashing reduces collisions in the dot product). Tags are given extra
 * weight since they are strong recall signals.
 */
export function embed(text: string, tags: string[] = [], dims: number = DEFAULT_DIMS): number[] {
	const vector = new Array<number>(dims).fill(0);
	const tokens = tokenize(text);
	for (const token of tokens) addTerm(vector, token, 1, dims);
	for (const tag of tags) addTerm(vector, tag, 3, dims);
	return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < len; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		na += (a[i] ?? 0) * (a[i] ?? 0);
		nb += (b[i] ?? 0) * (b[i] ?? 0);
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** A recalled fact plus its similarity score. */
export interface RecallResult {
	record: MemoryRecord;
	score: number;
}

export interface RecallOptions {
	limit?: number;
	minScore?: number;
	tags?: string[];
}

/**
 * Reads and writes a memory corpus. Kept as a thin JSONL layer so the recall
 * math stays pure and testable.
 */
export class MemoryStore {
	private readonly file: string;
	private records: MemoryRecord[] = [];
	private loaded = false;

	constructor(file: string, opts?: { initial?: MemoryRecord[] }) {
		this.file = file;
		if (opts?.initial) this.records = opts.initial;
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		let raw: string;
		try {
			raw = await readFile(this.file, "utf8");
		} catch {
			return;
		}
		this.records = raw
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((line) => parseLine(line))
			.filter((r): r is MemoryRecord => r !== null);
	}

	async all(): Promise<MemoryRecord[]> {
		await this.ensureLoaded();
		return this.records.slice();
	}

	async count(): Promise<number> {
		await this.ensureLoaded();
		return this.records.length;
	}

	async add(input: { content: string; tags?: string[]; source?: string; superseded?: boolean }): Promise<MemoryRecord> {
		await this.ensureLoaded();
		const record: MemoryRecord = {
			id: `mem_${randomUUID().slice(0, 12)}`,
			ts: new Date().toISOString(),
			content: normalize(input.content),
			tags: unique(input.tags ?? []),
			source: input.source ?? "unknown",
			embedding: embed(input.content, input.tags ?? []),
			weight: 1,
			...(input.superseded ? { superseded: true } : {}),
		};
		this.records.push(record);
		await mkdir(dirnameSafe(this.file), { recursive: true });
		await appendFile(this.file, `${JSON.stringify(record)}\n`, "utf8");
		return record;
	}

	/**
	 * Return the most relevant, non-superseded facts for a query.
	 */
	async recall(query: string, options: RecallOptions = {}): Promise<RecallResult[]> {
		await this.ensureLoaded();
		const limit = options.limit ?? 5;
		const minScore = options.minScore ?? 0.15;
		const queryVec = embed(query, options.tags ?? []);

		const scored = this.records
			.filter((r) => !r.superseded)
			.map((record) => ({
				record,
				score: cosineSimilarity(queryVec, record.embedding) + Math.min(0.25, record.weight * 0.02),
			}))
			.filter((r) => r.score >= minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return scored;
	}

	/** Reinforce a fact, increasing its weight so it ranks higher next time. */
	async reinforce(id: string): Promise<void> {
		await this.ensureLoaded();
		const record = this.records.find((r) => r.id === id);
		if (!record) return;
		record.weight += 1;
		await this.persist();
	}

	async supersede(id: string, replacement?: string): Promise<void> {
		await this.ensureLoaded();
		const record = this.records.find((r) => r.id === id);
		if (record) record.superseded = true;
		if (replacement) await this.add({ content: replacement, tags: record?.tags ?? [], source: "supersede" });
		await this.persist();
	}

	private async persist(): Promise<void> {
		await mkdir(dirnameSafe(this.file), { recursive: true });
		await writeFile(this.file, `${this.records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
	}
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"of",
	"to",
	"in",
	"on",
	"for",
	"with",
	"is",
	"are",
	"was",
	"were",
	"be",
	"as",
	"at",
	"by",
	"that",
	"this",
	"it",
	"from",
	"we",
	"you",
	"i",
	"they",
	"he",
	"she",
	"will",
	"should",
	"can",
	"could",
	"would",
	"into",
	"about",
	"than",
	"then",
	"so",
	"if",
	"when",
	"there",
	"here",
	"not",
	"no",
	"yes",
	"do",
	"does",
	"did",
	"has",
	"have",
	"had",
	"been",
	"been",
]);

function addTerm(vector: number[], term: string, weight: number, dims: number): void {
	const h1 = fnv1a(term) % dims;
	const h2 = fnv1a(`sign:${term}`);
	const sign = h2 & 1 ? 1 : -1;
	vector[h1] = (vector[h1] ?? 0) + sign * weight;
}

function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	// 32-bit unsigned-ish.
	return hash >>> 0;
}

function normalize(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

function unique(ts: string[]): string[] {
	return Array.from(new Set(ts.filter((t) => t.trim().length > 0)));
}

function parseLine(line: string): MemoryRecord | null {
	try {
		const r = JSON.parse(line) as Partial<MemoryRecord>;
		if (typeof r.content !== "string" || !Array.isArray(r.embedding) || typeof r.weight !== "number") return null;
		return r as MemoryRecord;
	} catch {
		return null;
	}
}

function dirnameSafe(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? "." : p.slice(0, idx);
}

export { join };
