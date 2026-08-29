import type { CompactionArtifact, SessionState } from "./types.js";
import { unique } from "./util.js";

/**
 * Branch-scoped working state.
 *
 * Unlike the durable on-disk stores (memory, audit, skills, tools), this state
 * is *per branch*: /tree navigation and /fork must see the right remembered-set,
 * forgotten-set, and compaction index. Following pi convention, it is persisted
 * as session custom entries and reconstructed on session_start / session_tree.
 *
 * Each write appends a full snapshot under the `self-state` custom type
 * (the todo.ts pattern in the pi docs), so reconstruction is simply "take the
 * most recent self-state entry on the branch."
 */

export const STATE_CUSTOM_TYPE = "self-state";

export function emptyState(): SessionState {
	return {
		version: 1,
		remembered: [],
		forgotten: [],
		artifactIndex: [],
		activatedTools: [],
	};
}

/** Minimal structural shape of a session entry we can inspect. */
export interface EntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** Reconstruct the branch state from session entries. */
export function reconstructState(entries: readonly EntryLike[]): SessionState {
	let state = emptyState();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== STATE_CUSTOM_TYPE) continue;
		const next = coerce(entry.data);
		if (next) state = next;
	}
	// Defensive re-slim so oversized lists don't grow unbounded.
	capState(state);
	return state;
}

/**
 * Reconstruct branch state from a possibly-throwing reader, degrading to an
 * empty state when the reader itself throws (e.g. a malformed session).
 * The reader is invoked *inside* the try so a throw in the fetch — not only in
 * reconstruction — falls back to an empty state.
 */
export function safeLoadState(get: () => unknown): SessionState {
	try {
		return reconstructState(get() as readonly EntryLike[]);
	} catch {
		return emptyState();
	}
}

function coerce(data: unknown): SessionState | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Partial<SessionState>;
	if (d.version !== 1) return null;
	return {
		version: 1,
		remembered: Array.isArray(d.remembered) ? (d.remembered as string[]) : [],
		forgotten: Array.isArray(d.forgotten) ? (d.forgotten as string[]) : [],
		artifactIndex: Array.isArray(d.artifactIndex) ? (d.artifactIndex as CompactionArtifact[]) : [],
		activatedTools: Array.isArray(d.activatedTools) ? (d.activatedTools as string[]) : [],
	};
}

function capState(state: SessionState): void {
	state.remembered = state.remembered.slice(-2000);
	state.forgotten = state.forgotten.slice(-2000);
	state.activatedTools = state.activatedTools.slice(-500);
	state.artifactIndex = state.artifactIndex.slice(-100);
}

/** A small mutable wrapper over the current branch state. */
export class BranchState {
	private state: SessionState;

	constructor(initial: SessionState = emptyState()) {
		this.state = initial;
	}

	get current(): SessionState {
		return this.state;
	}

	remember(ids: readonly string[]): void {
		this.state.remembered = unique([...this.state.remembered, ...ids]);
		// Re-remembering a fact that was also forget lifts the forget: a fresh
		// remember wins, so forgetting stays genuinely reversible (symmetric with
		// forget() dropping from remembered).
		this.state.forgotten = this.state.forgotten.filter((id) => !new Set(ids).has(id));
		capState(this.state);
	}

	forget(ids: readonly string[]): void {
		this.state.forgotten = unique([...this.state.forgotten, ...ids]);
		// Forgetting a fact that was also remembered drops it from remembered.
		const drop = new Set(ids);
		this.state.remembered = this.state.remembered.filter((id) => !drop.has(id));
		capState(this.state);
	}

	activateTool(name: string): void {
		if (!this.state.activatedTools.includes(name)) this.state.activatedTools.push(name);
		capState(this.state);
	}

	addArtifact(artifact: CompactionArtifact): void {
		this.state.artifactIndex.push(artifact);
		capState(this.state);
	}

	/** Immutable snapshot suitable for appEntry(). */
	snapshot(): SessionState {
		return structuredCloneSafe(this.state);
	}
}

function structuredCloneSafe(state: SessionState): SessionState {
	return {
		version: 1,
		remembered: state.remembered.slice(),
		forgotten: state.forgotten.slice(),
		artifactIndex: state.artifactIndex.map((a) => ({
			...a,
			filesTouched: a.filesTouched.slice(),
			openItems: a.openItems.slice(),
		})),
		activatedTools: state.activatedTools.slice(),
	};
}
