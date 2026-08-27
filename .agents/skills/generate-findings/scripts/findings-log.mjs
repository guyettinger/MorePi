#!/usr/bin/env node
// findings-log.mjs — the machine-driven *producer* companion to queue-state.mjs.
//
// process-findings DRAINS the queue (queue.md -> ledger.md + checkpoint).
// generate-findings FILLS it: it records a batch of *pending* findings that the
// code review produced into two co-located artifacts:
//
//   docs/findings/.checkpoint.json    machine resume + de-dup state
//   docs/findings/queue.md            human-readable pending list (marker region)
//
// Usage:
//   node findings-log.mjs log <findings.json> [--check] [--no-queue]   append + render
//   node findings-log.mjs next-id                                       next free single-letter id
//   node findings-log.mjs list-pending                                  table of pending items
//   node findings-log.mjs selftest                                      bundled checks in a tmp dir
//
// Options:
//    --check         dry run: print what would change, write nothing
//    --no-queue      skip the docs/findings/queue.md render (checkpoint only)
//    --checkpoint p  override the checkpoint path (default docs/findings/.checkpoint.json)
//    --queue p       override the queue path (default docs/findings/queue.md)
//
// A batch file is either a JSON array of findings or { "findings": [...] }.
// Each finding object:
//    { title, category?, finding, locations[], recommendation?,
//      risk?, behavior?, priority?, id? }
//   category  structural | semantic | logical | safety    (default "structural")
//   behavior  Preserving | Sensitive | Mixed               (default "Preserving")
//   priority  high | med | low                            (default "med")
//
// Idempotency: a finding whose title matches an existing checkpoint item (any
// status) is skipped, so re-running generate does not duplicate pending items and
// findings already addressed in the ledger never re-appear.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const QUEUE_START = "<!-- QUEUE-APPEND-START -->";
const QUEUE_END = "<!-- QUEUE-APPEND-END -->";
const QUEUE_EMPTY =
	"\n_(queue is empty — run the `generate-findings` skill to produce findings, or none\nare pending; processed findings live in [ledger](./ledger.md).)_\n";
const CATEGORIES = ["structural", "semantic", "logical", "safety"];
const BEHAVIORS = ["Preserving", "Sensitive", "Mixed"];
const PRIORITIES = ["high", "med", "low"];

function now() {
	return new Date().toISOString();
}

function fail(message, code = 1) {
	process.stderr.write(`${message}\n`);
	process.exit(code);
}

function parseArgs(rest) {
	const positionals = [];
	const opts = {
		check: false,
		queue: true,
		checkpoint: "docs/findings/.checkpoint.json",
		queuePath: "docs/findings/queue.md",
	};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--check") opts.check = true;
		else if (a === "--no-queue") opts.queue = false;
		else if (a === "--checkpoint") {
			opts.checkpoint = rest[++i] ?? "";
		} else if (a === "--queue") {
			opts.queuePath = rest[++i] ?? "";
		} else positionals.push(a);
	}
	return { command: positionals[0], batchFile: positionals[1], opts };
}

async function readJson(path) {
	const raw = await readFile(path, "utf8");
	try {
		return JSON.parse(raw);
	} catch (error) {
		fail(`invalid JSON at ${path}: ${error.message}`);
		return null; // unreachable: fail() exits
	}
}

// Highest existing single-letter id -> its char code; -1 when none.
function maxLetterCode(items) {
	let max = -1;
	for (const item of items) {
		const id = item?.id;
		if (typeof id === "string" && /^[A-Z]$/.test(id)) max = Math.max(max, id.charCodeAt(0));
	}
	return max;
}

// A single letter A..Z, then "A1", "B1"... once past Z.
function letterId(code) {
	if (code <= 91) return String.fromCharCode(code); // 'A'(65) .. 'Z'(91)
	const over = code - 91;
	return over <= 26 ? `A${over}` : String.fromCharCode(64 + ((over - 1) % 26) + 1) + Math.ceil(over / 26);
}

function titleKey(title) {
	return String(title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function categoryBlurb(category) {
	switch (category) {
		case "structural":
			return "DRY / reduction / reuse / dead code";
		case "semantic":
			return "documentation sync (inline vs file-based)";
		case "logical":
			return "logic / control-flow / path-trace issue";
		case "safety":
			return "one of the six safety invariants is at risk";
		default:
			return "";
	}
}

// Render one pending checkpoint item as a queue.md section, mirroring the
// "How to log a new pending finding" template in docs/findings/queue.md.
function renderSection(item) {
	const lines = [
			`## ${item.id}. ${item.title}`,
			`- **Category**: ${item.category ?? "?"} — ${categoryBlurb(item.category)}`,
			`- **Priority**: ${item.priority ?? "med"}`,
			`- **Finding**: ${item.finding ?? ""}`,
			`- **Locations**: ${Array.isArray(item.locations) ? item.locations.join("; ") : String(item.locations ?? "")}`,
			`- **Recommendation**: ${item.recommendation ?? ""}`,
			`- **Risk / why flagged**: ${item.risk ?? ""}`,
			`- **Behavior**: ${item.behavior ?? "Preserving"}`,
			"",
	];
	return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

// Render the pending view: all non-done items, sorted by id. Shared by BOTH the
// queue.md render and the self-test, so they can never drift.
function renderPendingBlock(doc) {
	const items = Array.isArray(doc.items) ? doc.items : [];
	const pending = items
			.filter((i) => (i?.status ?? "pending") !== "done")
			.slice()
			.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
	return pending.length === 0 ? QUEUE_EMPTY : `\n${pending.map(renderSection).join("")}\n`;
}

// Fold a batch of raw findings into the checkpoint. Returns the list of NEW
// items appended (so the caller can render/report them). Idempotent by title.
function applyBatch(doc, findings) {
	const items = Array.isArray(doc.items) ? doc.items : (doc.items = []);
	const seen = new Set(items.map((i) => titleKey(i?.title)));
	const added = [];
	let nextLetter = Math.max(65, maxLetterCode(items) + 1); // next free id; "A" when empty
	for (const raw of findings) {
		if (typeof raw !== "object" || raw === null) fail("each finding must be an object");
		const key = titleKey(raw.title);
		if (!key) fail(`finding is missing a non-empty title:\n${JSON.stringify(raw)}`);
		if (seen.has(key)) continue; // idempotent: this title is already known

		const category = raw.category ?? "structural";
		const behavior = raw.behavior ?? "Preserving";
		const priority = raw.priority ?? "med";
		if (!CATEGORIES.includes(category)) fail(`invalid category ${JSON.stringify(category)} (want ${CATEGORIES.join("|")})`);
		if (!BEHAVIORS.includes(behavior)) fail(`invalid behavior ${JSON.stringify(behavior)} (want ${BEHAVIORS.join("|")})`);
		if (!PRIORITIES.includes(priority)) fail(`invalid priority ${JSON.stringify(priority)} (want ${PRIORITIES.join("|")})`);
		const locations = Array.isArray(raw.locations)
				? raw.locations.map(String)
				: raw.locations
				? [String(raw.locations)]
				: [];

			// Auto-assign an id unless one is supplied; a supplied id that collides
			// errors out rather than silently overwriting.
		let id;
		if (raw.id) {
			id = String(raw.id);
			if (items.some((i) => i?.id === id)) fail(`finding id ${JSON.stringify(id)} already exists in the checkpoint`);
			if (!/^[A-Z0-9]+$/.test(id)) fail(`finding id ${JSON.stringify(id)} must match /^[A-Z0-9]+$/`);
		} else {
			id = letterId(nextLetter);
			nextLetter++;
		}

		const item = {
			id,
			title: raw.title,
			status: "pending",
			disposition: "", // process-findings fills disposition at drain time
			caveat: behavior === "Sensitive" ? String(raw.risk ?? "sensitive finding — needs user-visible confirmation") : "",
			summary: "",
			gates: {},
			changedFiles: [],
			category,
			finding: String(raw.finding ?? ""),
			locations,
			recommendation: String(raw.recommendation ?? ""),
			risk: String(raw.risk ?? ""),
			behavior,
			priority,
			updatedAt: now(),
		};
		seen.add(key);
		items.push(item);
		added.push(item);
	}
	return added;
}

// Render docs/findings/queue.md. The region between QUEUE-APPEND-START and
// QUEUE-APPEND-END is script-owned and fully re-rendered from the checkpoint's
// pending items, so the queue is a deterministic view of machine state.
function renderQueue(queueText, doc) {
	if (!queueText.includes(QUEUE_START) || !queueText.includes(QUEUE_END)) {
		process.stderr.write(
				`warning: queue.md lacks \`${QUEUE_START}\`/\`${QUEUE_END}\` markers — appending pending sections at end of file; add the markers for deterministic renders\n`,
		);
		const block = renderPendingBlock(doc);
		const tail = block.startsWith("\n") ? block.slice(1) : block;
		const sep = queueText.endsWith("\n") ? "" : "\n";
		return `${queueText}${sep}${tail}\n`;
	}
	const startIdx = queueText.indexOf(QUEUE_START) + QUEUE_START.length;
	const endIdx = queueText.indexOf(QUEUE_END);
	const block = renderPendingBlock(doc);
	return `${queueText.slice(0, startIdx)}\n${block}${queueText.slice(endIdx)}`;
}

function cmdNextId(doc) {
	const items = Array.isArray(doc.items) ? doc.items : [];
	process.stdout.write(`${letterId(Math.max(65, maxLetterCode(items) + 1))}\n`);
}

function cmdListPending(doc) {
	const items = Array.isArray(doc.items) ? doc.items : [];
	const pending = items
			.filter((i) => (i?.status ?? "pending") !== "done")
			.slice()
			.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
	if (pending.length === 0) {
		process.stdout.write("no pending findings\n");
		return;
	}
	process.stdout.write(`${pending.length} pending finding(s):\n`);
	for (const item of pending) {
		process.stdout.write(
				`    ${String(item.id ?? "?").padEnd(3)} [${String(item.category ?? "?").padEnd(10)} ${String(item.priority ?? "?")} · ${String(item.behavior ?? "Preserving")}] ${item.title ?? ""}\n`,
		);
	}
}

async function cmdLog(doc, batchFile, opts) {
	const batch = await readJson(resolve(process.cwd(), batchFile));
	const findings = Array.isArray(batch) ? batch : batch?.findings;
	if (!Array.isArray(findings)) fail(`batch ${batchFile} must be a JSON array or { "findings": [...] }`);
	if (findings.length === 0) {
		process.stdout.write("0 findings in batch — nothing to log\n");
		return;
	}
	const added = applyBatch(doc, findings);
	stampMeta(doc);
	if (added.length === 0) process.stdout.write(`all ${findings.length} finding(s) already known — idempotent no-op\n`);
	process.stdout.write(`added ${added.length} new pending finding(s): ${added.map((i) => i.id).join(", ")}\n`);

	if (opts.check) {
		process.stdout.write("[--check] no files written\n");
		return;
	}
	await writeFile(opts.checkpointAbs, `${JSON.stringify(doc, null, "\t")}\n`, "utf8");
	if (opts.queue) {
		const next = renderQueue(await safeRead(opts.queueAbs), doc);
		await writeFile(opts.queueAbs, next, "utf8");
		process.stdout.write(`queue re-rendered -> ${opts.queueAbs}\n`);
	}
	process.stdout.write(`checkpoint written -> ${opts.checkpointAbs}\n`);
}

// Keep the checkpoint's bookkeeping fields current on every log.
function stampMeta(doc) {
	doc.updatedAt = now();
	if (doc.gitHeadBaseline === undefined) doc.gitHeadBaseline = "";
	if (typeof doc.version !== "number") doc.version = 2;
	if (!Array.isArray(doc.items)) doc.items = [];
}

async function safeRead(path) {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

// ---- self-test ------------------------------------------------------------
function assert(cond, message) {
	if (!cond) fail(`selftest FAIL: ${message}`);
}

async function mkTempDir() {
	const base = resolve(tmpdir(), `findings-log-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
	await mkdir(base, { recursive: true });
	return base;
}

async function selfTest() {
	const dir = await mkTempDir();
	try {
		const checkpointPath = resolve(dir, ".checkpoint.json");
		const queuePath = resolve(dir, "queue.md");
		await writeFile(checkpointPath, `${JSON.stringify({ version: 2, items: [{ id: "A", title: "Existing done", status: "done" }] }, null, "\t")}\n`, "utf8");
		await writeFile(queuePath, `# Queue\n\n${QUEUE_START}\n\n${QUEUE_END}\n`, "utf8");

			// 1) log two pending findings; ids auto-assign B, C (A is done)
		const doc = await readJson(checkpointPath);
		const batch = [
				{ title: "Dropped dedupe in memory", finding: "dup", locations: ["src/memory.ts:250"], category: "structural", behavior: "Preserving" },
				{ title: "Threshold drift on display", finding: "x", locations: ["src/approval.ts:41"], category: "safety", behavior: "Sensitive", risk: "gating-adjacent", priority: "high" },
			];
		const added = applyBatch(doc, batch);
		assert(added.length === 2, `1: expected 2 added, got ${added.length}`);
		assert(added[0]?.id === "B" && added[1]?.id === "C", `1: ids were ${added[0]?.id}, ${added[1]?.id}`);
		assert(added[1]?.caveat?.includes("gating-adjacent"), "1: sensitive caveat not set");
		assert(added[0]?.caveat === "", "1: preserving caveat should be empty");

			// 2) idempotency: logging the same batch adds nothing new
		assert(applyBatch(doc, batch).length === 0, "2: expected 0 re-adds");

			// 3) the pending view lists B + C (not the done A), with category + locations
		let block = renderPendingBlock(doc);
		assert(block.includes("## B.") && block.includes("## C.") && !block.includes("## A."), "3: pending view wrong");
		assert(block.includes("**Category**: structural") && block.includes("**Category**: safety"), "3: category tag missing");
		assert(block.includes("src/memory.ts:250"), "3: locations missing");

			// 4) marking B done drops it from the render
		const b = doc.items.find((i) => i.id === "B");
		if (b) b.status = "done";
		block = renderPendingBlock(doc);
		assert(!block.includes("## B.") && block.includes("## C."), "4: done/drop mismatch");

			// 5) an empty queue renders the placeholder, not a bare block
		const doneDoc = { version: 2, items: [{ id: "Z", title: "old", status: "done" }] };
		const empty = renderPendingBlock(doneDoc);
		assert(empty.includes("_(queue is empty") && !empty.includes("## Z."), "5: empty placeholder wrong");

			// 6) the full queue.md render threads the markers and keeps surrounding text
		const full = renderQueue(`# Queue\n\n${QUEUE_START}\n\n${QUEUE_END}\n`, doc);
		assert(full.includes(QUEUE_START) && full.includes(QUEUE_END) && full.includes("## C."), "6: marker render wrong");

			// 7) next-id after A..C is D
		assert(letterId(maxLetterCode(doc.items) + 1) === "D", "7: next-id should be D");

			// 8) a brand-new empty checkpoint assigns its first finding the letter A
		const freshDoc = { version: 2, items: [] };
		const first = applyBatch(freshDoc, [{ title: "from empty", finding: "f", locations: ["x"] }]);
		assert(first.length === 1 && first[0]?.id === "A", `8: first id from empty should be A (got ${first[0]?.id})`);

		process.stdout.write("findings-log.mjs selftest: PASS\n");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ---- entry point ----------------------------------------------------------
const { command, batchFile, opts } = parseArgs(process.argv.slice(2));

if (command === "selftest") {
	await selfTest();
	process.exit(0);
}

if (command === undefined) {
	process.stdout.write(
			"usage: findings-log.mjs <log <findings.json> | next-id | list-pending | selftest> [--check] [--no-queue] [--checkpoint p] [--queue p]\n",
	);
	process.exit(2);
}
if (command !== "log" && command !== "next-id" && command !== "list-pending") {
	fail(`unknown command ${JSON.stringify(command)} (want log|next-id|list-pending|selftest)`);
}
if (command === "log" && !batchFile) fail(`log requires a batch file. usage: findings-log.mjs log <findings.json>`);

opts.checkpointAbs = resolve(process.cwd(), opts.checkpoint);
opts.queueAbs = resolve(process.cwd(), opts.queuePath);
const doc = await readJson(opts.checkpointAbs);
if (!doc || typeof doc !== "object") fail(`checkpoint ${opts.checkpointAbs} did not load as an object`);

if (command === "log") await cmdLog(doc, batchFile, opts);
else if (command === "next-id") cmdNextId(doc);
else cmdListPending(doc);
