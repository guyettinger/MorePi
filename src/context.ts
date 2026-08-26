import { tokenize } from "./util.js";

/**
 * Context management: the "forget" and "remember" primitives that control what
 * stays in active context.
 *
 * Design rationale (a core rule of the framework): *never silently discard
 * information*. Forgetting is lossless — the fact remains in long-term memory
 * and can be recalled — it is only removed from the *active LLM window*.
 *
 * We implement this via the `context` event, which runs before every LLM call
 * and hands us a deep copy of the messages we may return a modified version of.
 * The "remembered" set is rebuilt into a single synthesized message on each
 * call, so forgetting an id takes effect immediately on the next call and no
 * historical message ever needs to be mutated or pruned.
 */

/** A remembered fact as surfaced to the model. */
export interface RememberedFact {
	id: string;
	content: string;
	tags: string[];
	///source of the fact, for provenance.
	source: string;
}

export interface RememberOptions {
	/** Tags to bias recall by. */
	tags?: string[];
	limit?: number;
	/** Short label recorded on the injection for display/debugging. */
	label?: string;
}

/** Build the transient message that injects currently-remembered facts. */
export function formatRememberedMessage(facts: readonly RememberedFact[]): string {
	if (facts.length === 0) return "";
	const lines = facts.map((f, i) => {
		const tags = f.tags.length ? ` [${f.tags.join(", ")}]` : "";
		return ` ${i + 1}. ${f.content}${tags} (source: ${f.source || "unknown"})`;
	});
	return `— Remembered context (from long-term memory, ${facts.length} fact(s)) —\n${lines.join("\n")}`;
}

/**
 * Resolve which of the requested ids are still "remembered" (not forgotten).
 * The forgotten set wins: a fact that was both remembered and later forgotten is
 * dropped.
 */
export function activeRemembered(requested: readonly RememberedFact[], forgotten: readonly string[]): RememberedFact[] {
	if (forgotten.length === 0) return requested.slice();
	const drop = new Set(forgotten);
	return requested.filter((f) => !drop.has(f.id));
}

/**
 * Given a free-text forget request and a candidate memory index, return the ids
 * that best match the request. Used to translate "forget the DB migration" into
 * a concrete set of memory ids.
 */
export function matchForgetTargets(
	request: string,
	candidates: readonly { id: string; text: string }[],
	limit = 5,
): string[] {
	const want = tokenize(request, { minLength: 3 });
	if (want.length === 0) return [];
	const scored = candidates
		.map((c) => ({ id: c.id, score: countMatches(tokenize(c.text, { minLength: 3 }), want) }))
		.filter((c) => c.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
	return scored.map((c) => c.id);
}

function countMatches(haystack: string[], needles: string[]): number {
	const set = new Set(haystack);
	return needles.reduce((acc, n) => (set.has(n) ? acc + 1 : acc), 0);
}
