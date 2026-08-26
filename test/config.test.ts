import { describe, expect, it } from "vitest";
import { AGENT_DIR, CONFIG_DIR_NAME, DEFAULT_CONFIG, resolvePaths, SELF_DIR } from "../src/config.js";

describe("DEFAULT_CONFIG", () => {
	it("has configDirName '.pi'", () => {
		expect(DEFAULT_CONFIG.configDirName).toBe(CONFIG_DIR_NAME);
		expect(CONFIG_DIR_NAME).toBe(".pi");
	});

	it("enables all subsystems by default", () => {
		expect(DEFAULT_CONFIG.enable.context).toBe(true);
		expect(DEFAULT_CONFIG.enable.memory).toBe(true);
		expect(DEFAULT_CONFIG.enable.learn).toBe(true);
		expect(DEFAULT_CONFIG.enable.evolve).toBe(true);
		expect(DEFAULT_CONFIG.enable.guardrails).toBe(true);
		expect(DEFAULT_CONFIG.enable.audit).toBe(true);
		expect(DEFAULT_CONFIG.enable.compaction).toBe(true);
	});

	it("has approvalThreshold 55 and blockThreshold 80", () => {
		expect(DEFAULT_CONFIG.approvalThreshold).toBe(55);
		expect(DEFAULT_CONFIG.blockThreshold).toBe(80);
	});

	it("has context maxTracked 500 and defaultKeepFraction 0.25", () => {
		expect(DEFAULT_CONFIG.context.maxTracked).toBe(500);
		expect(DEFAULT_CONFIG.context.defaultKeepFraction).toBe(0.25);
	});

	it("has memoryRecall defaultLimit 5 and minScore 0.15", () => {
		expect(DEFAULT_CONFIG.memoryRecall.defaultLimit).toBe(5);
		expect(DEFAULT_CONFIG.memoryRecall.minScore).toBe(0.15);
	});

	it("default frameworkGuard mode is 'protect' (self-modification stays gated by default)", () => {
		expect(DEFAULT_CONFIG.frameworkGuard.mode).toBe("protect");
	});
});

describe("resolvePaths", () => {
	it("produces project path under <projectCwd>/.pi/self/", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/myproject" });
		expect(project.root).toContain("/tmp/myproject/.pi/self");
		expect(project.root).toContain(SELF_DIR);
	});

	it("produces global path under <home>/.pi/agent/self/", () => {
		const { global } = resolvePaths({ projectCwd: "/tmp", home: "/home/user" });
		expect(global.root).toContain("/home/user/.pi/agent/self");
		expect(global.root).toContain(AGENT_DIR);
	});

	it("project memory file path contains 'memory.jsonl'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.memory).toContain("memory.jsonl");
	});

	it("project audit file path contains 'audit.jsonl'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.audit).toContain("audit.jsonl");
	});

	it("project snapshotsDir contains 'snapshots'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.snapshotsDir).toContain("snapshots");
	});

	it("project stateIndexPath contains 'state.json'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.stateIndex).toContain("state.json");
	});

	it("project skillsDir contains 'skills'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.skillsDir).toContain("skills");
	});

	it("project toolsDir contains 'tools'", () => {
		const { project } = resolvePaths({ projectCwd: "/tmp/proj" });
		expect(project.toolsDir).toContain("tools");
	});

	it("uses custom configDirName when provided", () => {
		const { project, global } = resolvePaths({ projectCwd: "/tmp/proj", configDirName: ".myagent" });
		expect(project.root).toContain(".myagent/self");
		expect(global.root).toContain(".myagent/agent/self");
	});

	it("uses home parameter when provided", () => {
		const { global } = resolvePaths({ projectCwd: "/tmp", home: "/custom/home" });
		expect(global.root).toContain("/custom/home/.pi/agent/self");
	});
});
