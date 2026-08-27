import { describe, expect, it } from "vitest";
import {
	BranchState,
	type EntryLike,
	emptyState,
	reconstructState,
	STATE_CUSTOM_TYPE,
	safeLoadState,
} from "../src/registry.js";

describe("emptyState / reconstructState", () => {
	it("emptyState returns the default shape", () => {
		const s = emptyState();
		expect(s.version).toBe(1);
		expect(s.remembered).toEqual([]);
		expect(s.forgotten).toEqual([]);
		expect(s.artifactIndex).toEqual([]);
		expect(s.activatedTools).toEqual([]);
	});

	it("reconstructState ignores non-self-state entries (stays empty)", () => {
		const entries: EntryLike[] = [{ type: "message" }, { type: "custom", customType: "other" }];
		expect(reconstructState(entries)).toEqual(emptyState());
	});

	it("reconstructState picks the most recent self-state entry", () => {
		const older = { version: 1, remembered: ["a"], forgotten: [], artifactIndex: [], activatedTools: [] };
		const newer = { version: 1, remembered: ["b"], forgotten: [], artifactIndex: [], activatedTools: [] };
		const entries: EntryLike[] = [
			{ type: "custom", customType: STATE_CUSTOM_TYPE, data: older },
			{ type: "custom", customType: STATE_CUSTOM_TYPE, data: newer },
		];
		const s = reconstructState(entries);
		expect(s.remembered).toEqual(["b"]);
	});
});

// Finding K: loadBranch must degrade when getBranch() itself throws, because the
// reader is invoked inside the try (via safeLoadState), not just reconstruction.
describe("safeLoadState graceful degradation", () => {
	it("falls back to emptyState when the reader throws", () => {
		let threw = false;
		const state = safeLoadState(() => {
			threw = true;
			throw new Error("malformed session");
		});
		expect(threw).toBe(true);
		expect(state).toEqual(emptyState());
	});

	it("reconstructs state from a valid reader", () => {
		const data = { version: 1, remembered: ["x"], forgotten: ["y"], artifactIndex: [], activatedTools: ["t1"] };
		const state = safeLoadState(() => [{ type: "custom", customType: STATE_CUSTOM_TYPE, data }] as EntryLike[]);
		expect(state.remembered).toEqual(["x"]);
		expect(state.forgotten).toEqual(["y"]);
		expect(state.activatedTools).toEqual(["t1"]);
	});

	it("falls back to emptyState when the reader returns a bad payload", () => {
		const state = safeLoadState(() => [{ bogus: true }] as unknown as EntryLike[]);
		expect(state).toEqual(emptyState());
	});
});

describe("BranchState", () => {
	it("remember/forget dedupe and cross-drop", () => {
		const b = new BranchState();
		b.remember(["a", "a"]);
		expect(b.current.remembered).toEqual(["a"]);
		b.forget(["a"]);
		expect(b.current.remembered).toEqual([]);
		expect(b.current.forgotten).toEqual(["a"]);
	});
});
