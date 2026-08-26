import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

/**
 * Small shared helper functions.
 *
 * Kept dependency-free and pure so every subsystem can rely on the same
 * primitives without re-deriving them. This module currently hosts the
 * order-preserving dedupe used by registry, compaction, and memory, plus the
 * parent-directory idiom shared by the memory and audit stores.
 */

/**
 * Order-preserving uniqueness: returns the input with duplicate values removed,
 * keeping the first occurrence of each. Works for any element type.
 */
export function unique<T>(xs: T[]): T[] {
	return Array.from(new Set(xs));
}

/**
 * Build a prefixed, length-truncated id from a random UUID.
 *
 * Collapses the ad-hoc ``PREFIX_${randomUUID().slice(0, len)}`` id pattern into
 * one shared helper. Output format is preserved: the prefix followed by the
 * first `len` characters of a fresh random UUID.
 */
export function genId(prefix: string, len: number): string {
	return `${prefix}${randomUUID().slice(0, len)}`;
}

/**
 * Return the parent-directory portion of a path, falling back to `.` when the
 * path has no directory separator (e.g. a bare filename in the cwd).
 */
export function dirnameSafe(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? "." : p.slice(0, idx);
}

/**
 * Create the parent directory of `file` (recursively), so a subsequent write to
 * that file succeeds even when its directory tree does not yet exist.
 */
export async function ensureDir(file: string): Promise<void> {
	await mkdir(dirnameSafe(file), { recursive: true });
}

/**
 * Tokenize free text into lowercase alnum/whitespace tokens.
 *
 * Shared pipeline behind the context and memory subsystems: lowercase, strip
 * everything that is not a letter, digit, or whitespace, then split on runs of
 * whitespace. The tail filter is caller-driven so each subsystem keeps its own
 * behavior:
 *
 * - `minLength` keeps tokens whose length is `>= minLength` (the old context
 *   `t.length > 2` is `>= 3`, the old memory `t.length > 1` is `>= 2`).
 * - `stopwords`, when provided, drops any token present in the set (the old
 *   memory behavior). When `undefined`, no stopword filtering occurs (the old
 *   context behavior), because `!opts.stopwords?.has(t)` is `true` for an absent
 *   set (optional chaining short-circuits to `undefined`, and `!undefined` is
 *   `true`).
 */
export function tokenize(text: string, opts: { minLength: number; stopwords?: Set<string> }): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length >= opts.minLength && !opts.stopwords?.has(t));
}
