import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillRecord } from "./types.js";

/**
 * Skill generation (a.k.a. "self-learn").
 *
 * The learning loop observes a recurring task pattern (e.g. a sequence of tool
 * calls that reliably accomplished something) and synthesizes a new skill. To
 * keep this safe and reviewable, a generated skill is a plain SKILL.md document
 * written to disk by default; activating it at runtime is a separate,
 * approvable step.
 */

export interface SkillDraft {
	name: string;
	description: string;
	steps: string[];
	triggers: string[];
}

/** Normalize a raw skill name into a valid skill slug. */
export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "untitled-skill"
	);
}

/**
 * Render a complete SKILL.md from a structured draft. Kept pure so the
 * generated text can be unit-tested.
 */
export function renderSkill(record: SkillRecord): string {
	const lines: string[] = [];
	lines.push(`---`);
	lines.push(`name: ${record.name}`);
	lines.push(`version: ${record.version}`);
	lines.push(`description: ${JSON.stringify(record.description)}`);
	lines.push(`triggers:`);
	for (const t of record.triggers.length ? record.triggers : ["manual"]) lines.push(` - ${t}`);
	lines.push(`created: ${record.ts}`);
	lines.push(`source-patterns:`);
	for (const p of record.sourcePatterns.length ? record.sourcePatterns : ["unknown"]) lines.push(` - ${p}`);
	lines.push(`---`);
	lines.push("");
	lines.push(`# ${humanTitle(record.name)}`);
	lines.push("");
	lines.push(record.description);
	lines.push("");
	lines.push(`## Steps`);
	if (record.steps.length === 0) {
		lines.push(`1. TODO: capture the concrete steps observed.`);
	} else {
		record.steps.forEach((s, i) => {
			lines.push(`${i + 1}. ${s}`);
		});
	}
	lines.push("");
	lines.push(`## Triggers`);
	lines.push(record.triggers.length ? record.triggers.map((t) => `- ${t}`).join("\n") : `- (manual)`);
	lines.push("");
	lines.push(`## Notes`);
	lines.push(`This skill was auto-generated and should be reviewed before heavy use.`);
	lines.push("");
	return lines.join("\n");
}

/** Convert "refactor-auth" into "Refactor Auth". */
export function humanTitle(slug: string): string {
	return slug
		.split(/[-_]/)
		.map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
		.join(" ");
}

/** Build a SkillRecord from a draft, assigning id-like fields. */
export function newSkillRecord(draft: SkillDraft, existingCount = 0): SkillRecord {
	return {
		name: slugify(draft.name || draft.triggers[0] || "skill"),
		version: existingCount + 1,
		ts: new Date().toISOString(),
		description: draft.description.trim(),
		steps: draft.steps.map((s) => s.trim()).filter(Boolean),
		triggers: draft.triggers.map((t) => t.trim()).filter(Boolean),
		sourcePatterns: [],
	};
}

/** On-disk skill library. */
export class SkillLibrary {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	async add(record: SkillRecord): Promise<string> {
		const skillDir = join(this.dir, record.name);
		await mkdir(skillDir, { recursive: true });
		const file = join(skillDir, "SKILL.md");
		await writeFile(file, renderSkill(record), "utf8");
		return file;
	}

	async list(): Promise<SkillRecord[]> {
		let entries: Dirent[];
		try {
			entries = await readdir(this.dir, { withFileTypes: true });
		} catch {
			return [];
		}
		const records: SkillRecord[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const file = join(this.dir, entry.name, "SKILL.md");
			try {
				const raw = await readFile(file, "utf8");
				records.push(parseSkillFile(entry.name, raw));
			} catch {}
		}
		return records.sort((a, b) => a.name.localeCompare(b.name));
	}

	async find(name: string): Promise<SkillRecord | undefined> {
		const all = await this.list();
		return all.find((r) => r.name === slugify(name));
	}
}

/** Parse a stored SKILL.md back into a minimal SkillRecord (for display). */
export function parseSkillFile(name: string, raw: string): SkillRecord {
	const m = raw.match(/^---\n([\s\S]*?)\n---/);
	let description = "";
	let version = 1;
	const triggers: string[] = [];
	if (m) {
		const fm = m[1] ?? "";
		const desc = fm.match(/^description:\s*(.+)$/m);
		if (desc) description = stripQuotes(desc[1] ?? "");
		const ver = fm.match(/^version:\s*(\d+)$/m);
		if (ver) version = Number(ver[1] ?? 1);
		const triggerMatch = fm.match(/^triggers:\n((?: - .+\n?)+)/m);
		if (triggerMatch) {
			for (const line of (triggerMatch[1] ?? "").split("\n")) {
				const t = line.replace(/^\s*-\s*/, "").trim();
				if (t && t !== "manual") triggers.push(t);
			}
		}
	}
	const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
	const steps = body
		.split("\n")
		.map((l) => l.match(/^\d+\.\s+(.*)/))
		.filter((x): x is RegExpMatchArray => x !== null)
		.map((x) => x[1]!.trim());
	return {
		name: slugify(name),
		version,
		ts: new Date().toISOString(),
		description,
		steps,
		triggers,
		sourcePatterns: [],
	};
}

function stripQuotes(s: string): string {
	const t = s.trim();
	if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
	return t;
}
