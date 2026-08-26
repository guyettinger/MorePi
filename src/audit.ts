import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SelfPaths } from "./config.js";
import type { AuditEntry, StateSnapshot } from "./types.js";
import { ensureDir, genId } from "./util.js";

/**
 * The audit + rollback subsystem.
 *
 * The audit log is append-only JSONL and is the source of truth for "what did
 * the framework change and when." Snapshots capture the full on-disk state so
 * an evolution or compaction step can be rolled back.
 */

export type AuditKind = AuditEntry["kind"];

interface RecordInput {
	kind: AuditKind;
	actor: AuditEntry["actor"];
	summary: string;
	payload?: Record<string, unknown>;
	traceId?: string;
}

class AuditLog {
	private readonly file: string;

	constructor(file: string) {
		this.file = file;
	}

	async record(input: RecordInput): Promise<AuditEntry> {
		const entry: AuditEntry = {
			id: genId("aud_", 12),
			ts: new Date().toISOString(),
			kind: input.kind,
			actor: input.actor,
			summary: input.summary,
			...(input.payload ? { payload: input.payload } : {}),
			...(input.traceId ? { traceId: input.traceId } : {}),
		};
		await this.append(entry);
		return entry;
	}

	private async append(entry: AuditEntry): Promise<void> {
		await ensureDir(this.file);
		await appendFile(this.file, `${JSON.stringify(entry)}\n`, "utf8");
	}

	async entries(limit?: number): Promise<AuditEntry[]> {
		let raw: string;
		try {
			raw = await readFile(this.file, "utf8");
		} catch {
			return [];
		}
		const lines = raw.split("\n").filter((l) => l.trim().length > 0);
		const parsed = lines.map((line) => parseLine<AuditEntry>(line)).filter((e): e is AuditEntry => e !== null);
		if (limit && limit < parsed.length) return parsed.slice(parsed.length - limit);
		return parsed;
	}
}

/**
 * Snapshot store. Serializes a caller-supplied state object to
 * `snapshots/<id>.json` and tracks them in `state.json` so a later restore can
 * find the payload.
 */
class SnapshotStore {
	private readonly paths: SelfPaths;

	constructor(paths: SelfPaths) {
		this.paths = paths;
	}

	private async indexPath(): Promise<StateSnapshot[]> {
		try {
			const raw = await readFile(this.paths.stateIndex, "utf8");
			return JSON.parse(raw) as StateSnapshot[];
		} catch {
			return [];
		}
	}

	private async writeIndex(index: StateSnapshot[]): Promise<void> {
		await ensureDir(this.paths.stateIndex);
		await writeFile(this.paths.stateIndex, `${JSON.stringify(index, null, 2)}\n`, "utf8");
	}

	async snapshot(payload: StateSnapshotInit, label = "auto"): Promise<StateSnapshot> {
		const id = genId("snap_", 8);
		const ts = new Date().toISOString();
		const snapshot: StateSnapshot = {
			id,
			ts,
			label,
			memoryCount: payload.memory,
			skillCount: payload.skills,
			toolCount: payload.tools,
			payloadPath: join(this.paths.snapshotsDir, `${id}.json`),
		};
		await mkdir(this.paths.snapshotsDir, { recursive: true });
		await writeFile(snapshot.payloadPath, JSON.stringify(payload.data, null, 2), "utf8");

		const index = await this.indexPath();
		index.push(snapshot);
		// Keep the index bounded.
		if (index.length > 100) index.splice(0, index.length - 100);
		await this.writeIndex(index);
		return snapshot;
	}

	async list(): Promise<StateSnapshot[]> {
		return (await this.indexPath()).slice().reverse();
	}

	async latest(): Promise<StateSnapshot | undefined> {
		const index = await this.indexPath();
		return index[index.length - 1];
	}

	async restore(id: string): Promise<RestoredSnapshot | null> {
		const index = await this.indexPath();
		const snap = index.find((s) => s.id === id);
		if (!snap) return null;
		let data: unknown;
		try {
			data = JSON.parse(await readFile(snap.payloadPath, "utf8"));
		} catch {
			return null;
		}
		return { snapshot: snap, data };
	}
}

export interface StateSnapshotInit {
	memory: number;
	skills: number;
	tools: number;
	data: Record<string, unknown>;
}

export interface RestoredSnapshot {
	snapshot: StateSnapshot;
	data: unknown;
}

/** A ready-to-use governance bundle over a set of paths. */
export interface Governance {
	audit: AuditLog;
	snapshots: SnapshotStore;
}

/** Build a governance bundle, choosing project vs global paths. */
export function createGovernance(opts: { paths: SelfPaths }): Governance {
	return {
		audit: new AuditLog(opts.paths.audit),
		snapshots: new SnapshotStore(opts.paths),
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLine<T>(line: string): T | null {
	try {
		return JSON.parse(line) as T;
	} catch {
		return null;
	}
}
