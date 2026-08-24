import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createGovernance, type Governance } from "../src/audit.js";
import type { SelfPaths } from "../src/config.js";

describe("audit", () => {
	let gov: Governance;
	let paths: SelfPaths;

	beforeEach(async () => {
		const dir = await mkdtemp(join(tmpdir(), "morepi-audit-"));
		paths = {
			root: dir,
			memory: join(dir, "memory.jsonl"),
			audit: join(dir, "audit.jsonl"),
			metrics: join(dir, "metrics.jsonl"),
			skillsDir: join(dir, "skills"),
			toolsDir: join(dir, "tools"),
			snapshotsDir: join(dir, "snapshots"),
			stateIndex: join(dir, "state.json"),
			skillsRoot: join(dir, "skills"),
			piSkillsDir: join(dir, "pi-skills"),
		};
		gov = createGovernance({ paths });
	});

	it("createGovernance returns audit and snapshots", () => {
		expect(gov.audit).toBeDefined();
		expect(gov.snapshots).toBeDefined();
	});

	it("AuditLog.entries returns [] for empty log", async () => {
		const entries = await gov.audit.entries();
		expect(entries).toEqual([]);
	});

	it("AuditLog.record appends and entries returns the entry", async () => {
		const entry = await gov.audit.record({
			kind: "memory-write",
			actor: "agent",
			summary: "test audit entry",
		});
		expect(entry.id).toMatch(/^aud_/);
		expect(entry.kind).toBe("memory-write");
		expect(entry.actor).toBe("agent");
		expect(entry.summary).toBe("test audit entry");
		expect(entry.ts).toBeDefined();

		const all = await gov.audit.entries();
		expect(all.length).toBe(1);
		expect(all[0]!.id).toBe(entry.id);
	});

	it("records multiple entries and entries(limit) truncates", async () => {
		void (await gov.audit.record({ kind: "memory-write", actor: "agent", summary: "first" }));
		const e2 = await gov.audit.record({ kind: "skill-learned", actor: "agent", summary: "second" });
		await gov.audit.record({ kind: "tool-proposed", actor: "agent", summary: "third" });

		const all = await gov.audit.entries();
		expect(all.length).toBe(3);

		const limited = await gov.audit.entries(2);
		expect(limited.length).toBe(2);
		// limit returns the last N
		expect(limited[0]!.id).toBe(e2.id);
	});

	it("entries includes payload when provided", async () => {
		await gov.audit.record({
			kind: "memory-write",
			actor: "agent",
			summary: "with payload",
			payload: { foo: "bar", num: 42 },
			traceId: "trace_123",
		});
		const all = await gov.audit.entries();
		expect(all[0]!.payload).toEqual({ foo: "bar", num: 42 });
		expect(all[0]!.traceId).toBe("trace_123");
	});

	it("SnapshotStore.list returns [] when empty", async () => {
		const snaps = await gov.snapshots.list();
		expect(snaps).toEqual([]);
	});

	it("SnapshotStore.snapshot + restore roundtrip", async () => {
		const snap = await gov.snapshots.snapshot({ memory: 5, skills: 2, tools: 1, data: { a: 1 } }, "round1");
		expect(snap.id).toMatch(/^snap_/);
		expect(snap.memoryCount).toBe(5);
		expect(snap.skillCount).toBe(2);
		expect(snap.toolCount).toBe(1);

		const latest = await gov.snapshots.latest();
		expect(latest).toBeDefined();
		expect(latest!.id).toBe(snap.id);

		const restored = await gov.snapshots.restore(snap.id);
		expect(restored).not.toBeNull();
		expect(restored!.snapshot.id).toBe(snap.id);
		expect(restored!.data).toEqual({ a: 1 });
	});

	it("SnapshotStore.restore returns null for unknown id", async () => {
		const restored = await gov.snapshots.restore("snap_nonexistent");
		expect(restored).toBeNull();
	});

	it("SnapshotStore.list reverses (newest first)", async () => {
		const s1 = await gov.snapshots.snapshot({ memory: 0, skills: 0, tools: 0, data: { v: 1 } }, "s1");
		const s2 = await gov.snapshots.snapshot({ memory: 0, skills: 0, tools: 0, data: { v: 2 } }, "s2");
		const list = await gov.snapshots.list();
		expect(list[0]!.id).toBe(s2.id);
		expect(list[1]!.id).toBe(s1.id);
	});
});
