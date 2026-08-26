import type { CompactionArtifact } from "./types.js";
import { unique } from "./util.js";

/**
 * Compaction.
 *
 * When the agent's context approaches its window, pi fires
 * `session_before_compact`. The framework replaces the default "keep the last
 * N tokens" behavior with:
 *   1. a structured summary of everything that will be discarded,
 *   2. a durable index of "what was compacted" (files touched, open items),
 *   3. extraction of high-value facts into permanent memory,
 * so that nothing the agent "learned" is silently lost.
 *
 * The actual LLM call is injected (`summarize`) so this module stays pure and
 * testable; index.ts supplies the real implementation from `ctx.modelRegistry`.
 */

export interface SummarizeContext {
	tokensBefore: number;
	messagesText: string;
	previousSummary?: string;
	openTasks?: string[];
}

function buildSummaryPrompt(ctx: SummarizeContext): string {
	const prev = ctx.previousSummary ? `\n\nExisting summary to merge:\n${ctx.previousSummary}\n` : "";
	return [
		"You are summarizing a coding session that is being compacted to save context.",
		"Produce a comprehensive, self-contained summary. Format strictly as a JSON object:",
		"{",
		'  "summary": "<prose summary of goals, decisions, and current state>",',
		'  "filesTouched": ["<file>", ...],',
		'  "openItems": ["<unresolved task/question>", ...],',
		'  "facts": ["<durable fact worth remembering long-term>", ...]',
		"}",
		"",
		ctx.openTasks?.length ? `Known open tasks: ${ctx.openTasks.join("; ")}` : "Known open tasks: none provided",
		"",
		prev,
		`<conversation>${ctx.messagesText}</conversation>`,
	].join("\n");
}

export interface ParsedCompact {
	summary: string;
	filesTouched: string[];
	openItems: string[];
	facts: string[];
	/** True if the summary text could not be parsed and we fall back to raw. */
	raw: boolean;
}

/**
 * Parse the model's structured output. Tolerant of fences, trailing prose, and
 * minor JSON errors: we extract whatever we can and mark the rest as raw.
 */
export function parseCompactionOutput(text: string, tokensBefore: number): ParsedCompact & { tokensBefore: number } {
	const json = extractJsonObject(text) as {
		summary?: unknown;
		filesTouched?: unknown;
		openItems?: unknown;
		facts?: unknown;
	} | null;
	if (!json) {
		return {
			summary: text.trim() || `(empty compaction)`,
			filesTouched: [],
			openItems: [],
			facts: [],
			raw: true,
			tokensBefore,
		};
	}
	return {
		summary: asString(json.summary) || "(no prose summary)",
		filesTouched: asStringArray(json.filesTouched),
		openItems: asStringArray(json.openItems),
		facts: asStringArray(json.facts),
		raw: false,
		tokensBefore,
	};
}

/** Build a compaction artifact record from parsed output. */
export function artifactFrom(parsed: ParsedCompact, tokensBefore: number): CompactionArtifact {
	return {
		ts: new Date().toISOString(),
		summary: parsed.summary,
		filesTouched: unique(parsed.filesTouched),
		openItems: unique(parsed.openItems),
		tokenBudgetUsed: tokensBefore,
	};
}

export interface Summarizer {
	summarize: (prompt: string, signal?: AbortSignal) => Promise<string>;
}

export interface RunCompactionOptions {
	ctx: SummarizeContext;
	summarizer: Summarizer;
	onArtifact?: (artifact: CompactionArtifact) => void;
	onFact?: (fact: string, tags: string[], source: string) => void;
	signal?: AbortSignal;
	/** Called to report progress to the UI, if available. */
	onNotify?: (message: string) => void;
}

/**
 * Run the full compaction pipeline. Returns the parsed output so the caller can
 * build pi's CompactionResult. All side effects (artifact index, memory facts,
 * notifications) are pushed through callbacks, keeping the module pure.
 */
export async function runCompaction(opts: RunCompactionOptions): Promise<ParsedCompact & { tokensBefore: number }> {
	opts.onNotify?.(`summarizing ${opts.ctx.tokensBefore.toLocaleString()} tokens...`);
	const prompt = buildSummaryPrompt(opts.ctx);

	let text: string;
	try {
		text = await opts.summarizer.summarize(prompt, opts.signal);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		opts.onNotify?.(`compaction summarization failed: ${message}; keeping default behavior`);
		throw err;
	}

	const parsed = parseCompactionOutput(text, opts.ctx.tokensBefore);
	if (parsed.raw) opts.onNotify?.("could not parse structured summary; kept raw summary");

	opts.onArtifact?.(artifactFrom(parsed, opts.ctx.tokensBefore));
	for (const fact of parsed.facts) opts.onFact?.(fact, dedupeTags(opts.ctx), "compaction");

	return parsed;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): Record<string, unknown> | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidates = [fenced?.[1], text].filter((c): c is string => Boolean(c?.length));
	for (const candidate of candidates) {
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start === -1 || end === -1 || end < start) continue;
		try {
			const parsed = JSON.parse(candidate.slice(start, end + 1));
			if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
		} catch {}
	}
	return null;
}

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter((x): x is string => typeof x === "string")
		.map((s) => s.trim())
		.filter(Boolean);
}

function dedupeTags(ctx: SummarizeContext): string[] {
	return unique(["compaction", ...(ctx.tokensBefore > 50_000 ? ["long-session"] : [])]);
}
