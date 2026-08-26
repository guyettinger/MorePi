#!/usr/bin/env node
// queue-state.mjs — inspect / drive the MorePi findings queue without an API.
//
// Usage:
//   node queue-state.mjs next          # print the first pending item (status != "done"), or "ALL DONE"
//   node queue-state.mjs status        # print a table of every item
//   node queue-state.mjs validate      # parse the checkpoint + check required fields
//
// The checkpoint (docs/findings/.checkpoint.json) is a plain JSON file; this
// tool only *reads* it. Draining the queue — editing queue.md, appending to
// ledger.md, and marking items done — is the orchestrator's job, one write per
// item, per the skill. The how-to lives in docs/findings/usage.md. Override the
// path with `--file <path>`; the default is docs/findings/.checkpoint.json,
// resolved against the current working directory (run from the repo root).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED = [
	"id",
	"title",
	"status",
	"disposition",
	"summary",
	"changedFiles",
	"updatedAt",
];

function parseArgs(rest) {
	const fileIdx = rest.indexOf("--file");
	const file = fileIdx !== -1 ? rest[fileIdx + 1] : undefined;
	const command = fileIdx === -1 ? rest[0] : rest.filter((_, i) => i !== fileIdx && i !== fileIdx + 1)[0];
	return { command, file };
}

function fail(message, code = 1) {
	process.stderr.write(`${message}\n`);
	process.exit(code);
}

async function loadCheckpoint(file) {
	const path = resolve(process.cwd(), file);
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		fail(`cannot read checkpoint at ${path}: ${error.message}`);
		return null; // unreachable: fail() exits
	}
	try {
		return { path, doc: JSON.parse(raw) };
	} catch (error) {
		fail(`checkpoint at ${path} is not valid JSON: ${error.message}`);
		return null; // unreachable: fail() exits
	}
}

async function next(doc, sourcePath) {
	const items = doc.items;
	if (!Array.isArray(items)) fail(`no "items" array in ${sourcePath}`);
	const pending = items.find((item) => item?.status !== "done" && String(item?.status ?? "pending") !== "done");
	if (!pending) {
		process.stdout.write("ALL DONE\n");
		return;
	}
	const lines = [
		`next item: ${pending.id} — ${pending.title}`,
		`  status:      ${pending.status ?? "pending"}`,
		`  disposition: ${pending.disposition ?? "?"}`,
		`  caveat:       ${pending.caveat ?? "(none)"}`,
		pending.summary ? `  summary:      ${pending.summary}` : "",
	].filter(Boolean);
	process.stdout.write(`${lines.join("\n")}\n`);
}

function status(doc, sourcePath) {
	const items = doc.items;
	if (!Array.isArray(items)) fail(`no "items" array in ${sourcePath}`);
	const done = items.filter((i) => i?.status === "done").length;
	process.stdout.write(`checkpoint: ${sourcePath}    (${done}/${items.length} done)\n\n`);
	for (const item of items) {
		const st = item?.status ?? "pending";
		const mark = st === "done" ? "DONE " : st === "in-progress" ? "PROG " : "TODO ";
		const files = Array.isArray(item?.changedFiles) ? item.changedFiles.length : 0;
		const title = String(item?.title ?? "").padEnd(40);
		const disp = String(item?.disposition ?? "?").padEnd(14);
		process.stdout.write(`${mark} ${String(item?.id ?? "?").padEnd(3)} ${title} ${disp} ${files} file(s)\n`);
	}
}

function validate(doc, sourcePath) {
	const problems = [];
	const items = doc.items;
	if (!Array.isArray(items)) {
		problems.push('missing or non-array "items"');
	} else {
		const seen = new Set();
		for (const [i, item] of items.entries()) {
			if (typeof item !== "object" || item === null) {
				problems.push(`items[${i}] is not an object`);
				continue;
			}
			const label = item.id ?? "?";
			for (const field of REQUIRED) {
				if (!(field in item)) problems.push(`items[${i}] (${label}) missing "${field}"`);
			}
			const st = item.status;
			if (st !== "pending" && st !== "in-progress" && st !== "done") {
				problems.push(`items[${i}] (${label}) has invalid status "${st}"`);
			}
			if (st === "done" && (item.disposition === "apply" || item.disposition === "apply-withcare")) {
				const gates = item.gates;
				for (const g of ["lint", "typecheck", "test", "smoke"]) {
					if (!gates || typeof gates[g] !== "string" || gates[g].length === 0) {
						problems.push(`items[${i}] (${label}) done but gate "${g}" missing`);
					}
				}
				if (!Array.isArray(item.changedFiles)) {
					problems.push(`items[${i}] (${label}) "changedFiles" is not an array`);
				}
			}
			if (item.id) {
				if (seen.has(item.id)) problems.push(`duplicate item id "${item.id}"`);
				seen.add(item.id);
			}
		}
	}
	if (problems.length === 0) {
		process.stdout.write(`${items.length} item(s) valid in ${sourcePath}\n`);
		return;
	}
	process.stdout.write(`problems in ${sourcePath}:\n`);
	for (const p of problems) process.stdout.write(`    - ${p}\n`);
	process.exit(1);
}

const { command, file } = parseArgs(process.argv.slice(2));
const loaded = await loadCheckpoint(file ?? "docs/findings/.checkpoint.json");
if (!loaded) process.exit(1);
const { doc, path: sourcePath } = loaded;

switch (command) {
	case "next":
		await next(doc, sourcePath);
		break;
	case "status":
		status(doc, sourcePath);
		break;
	case "validate":
		validate(doc, sourcePath);
		break;
	default:
		process.stdout.write("usage: queue-state.mjs <next|status|validate> [--file <path>]\n");
		process.exit(2);
}
