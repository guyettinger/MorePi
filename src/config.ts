import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Framework configuration and on-disk layout.
 *
 * The framework keeps durable state on disk because it is inherently
 * cross-session: memory, the skill library, evolved tools, and the audit log
 * must survive beyond a single pi session. Per-branch working state (which
 * facts are remembered/forgotten, the compaction artifact index) is instead
 * persisted through pi session entries so it branches correctly with /tree.
 *
 * Storage layout
 *   Project-local:  <cwd>/.pi/self/
 *   Global:         <home>/.pi/agent/self/
 *
 * Within each root:
 *   memory.jsonl        one MemoryRecord per line
 *   audit.jsonl         one AuditEntry per line (append-only)
 *   metrics.jsonl       one metric sample per line
 *   skills/             one <name>/SKILL.md per skill
 *   tools/              one <name>.json per evolved tool
 *   snapshots/          <id>.json payload per snapshot + index in state.json
 */

export interface SelfPaths {
	root: string;
	memory: string;
	audit: string;
	metrics: string;
	skillsDir: string;
	toolsDir: string;
	snapshotsDir: string;
	stateIndex: string;
	skillsRoot: string;
	/** Directory consumed by pi's native skill loader, mirroring skills/. */
	piSkillsDir: string;
}

export interface FrameworkConfig {
	/** Directory name for project-local config (".pi" by default, overridable by rebrands). */
	configDirName: string;
	/** Feature flags. */
	enable: {
		/** Register context_forget / context_remember tools and commands. */
		context: boolean;
		/** Register memory_write / memory_recall tools and commands. */
		memory: boolean;
		/** Register self_learn skill generation. */
		learn: boolean;
		/** Register evolve_tool and the tool registry. */
		evolve: boolean;
		/** Run the human-in-the-loop gate on high-risk actions. */
		guardrails: boolean;
		/** Record the append-only audit log. */
		audit: boolean;
		/** Run compaction summarization + artifact indexing. */
		compaction: boolean;
	};
	/** Above this risk score an action requests approval rather than blocking. */
	approvalThreshold: number;
	/** At or above this risk score an action is blocked outright. */
	blockThreshold: number;
	/** Context control. */
	context: {
		/** Default fraction of a forgotten fact to keep in the summary. */
		defaultKeepFraction: number;
		/** Max number of forgotten/remembered ids tracked per branch. */
		maxTracked: number;
	};
	/** Memory recall. */
	memoryRecall: {
		/** Default number of matches returned. */
		defaultLimit: number;
		/** Cosine-similarity floor for "relevant" matches. */
		minScore: number;
	};
}

export const CONFIG_DIR_NAME = ".pi";
export const SELF_DIR = "self";
export const AGENT_DIR = "agent";

export const DEFAULT_CONFIG: FrameworkConfig = {
	configDirName: CONFIG_DIR_NAME,
	enable: {
		context: true,
		memory: true,
		learn: true,
		evolve: true,
		guardrails: true,
		audit: true,
		compaction: true,
	},
	approvalThreshold: 55,
	blockThreshold: 80,
	context: {
		defaultKeepFraction: 0.25,
		maxTracked: 500,
	},
	memoryRecall: {
		defaultLimit: 5,
		minScore: 0.15,
	},
};

interface ResolveOptions {
	projectCwd: string;
	home?: string;
	configDirName?: string;
}

/** Build the on-disk layout for both the project scope and the global scope. */
export function resolvePaths(opts: ResolveOptions): {
	project: SelfPaths;
	global: SelfPaths;
} {
	const home = opts.home ?? homedir();
	const configDirName = opts.configDirName ?? CONFIG_DIR_NAME;

	const projectRoot = join(opts.projectCwd, configDirName, SELF_DIR);
	const globalRoot = join(home, configDirName, AGENT_DIR, SELF_DIR);

	return {
		project: buildPaths(projectRoot, join(opts.projectCwd, configDirName, "skills")),
		global: buildPaths(globalRoot, join(home, configDirName, "skills")),
	};
}

function buildPaths(root: string, piSkillsDir: string): SelfPaths {
	return {
		root,
		memory: join(root, "memory.jsonl"),
		audit: join(root, "audit.jsonl"),
		metrics: join(root, "metrics.jsonl"),
		skillsDir: join(root, "skills"),
		toolsDir: join(root, "tools"),
		snapshotsDir: join(root, "snapshots"),
		stateIndex: join(root, "state.json"),
		skillsRoot: join(root, "skills"),
		piSkillsDir,
	};
}
