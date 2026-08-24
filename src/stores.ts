import { homedir } from "node:os";
import { createGovernance, type Governance } from "./audit.js";
import { DEFAULT_CONFIG, type FrameworkConfig, resolvePaths, type SelfPaths } from "./config.js";
import { MemoryStore } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import { ToolRegistry } from "./tools/evolution.js";

/**
 * Central place to construct and cache the on-disk stores.
 *
 * - Memory / skills / evolved tools are *project-scoped* (under
 *   `<cwd>/.pi/self`): recall is project-aware and nothing leaks between
 *   repositories.
 * - The audit log and snapshot store are *global* (under
 *   `<configDir>/agent/self`): a single centralized, always-available ledger
 *   spanning every project, which is what makes rollback and accountability
 *   meaningful across sessions.
 *
 * Stores are memoized by cwd so repeated calls in the same session reuse the
 * same in-memory instances.
 */
export interface ScopedStores {
	config: FrameworkConfig;
	paths: SelfPaths;
	memory: MemoryStore;
	skills: SkillLibrary;
	registry: ToolRegistry;
}

export interface StoreManager {
	project: (cwd: string, config: FrameworkConfig) => ScopedStores;
	governance: (config: FrameworkConfig) => Governance;
}

function projectStores(config: FrameworkConfig, cwd: string): ScopedStores {
	const { project } = resolvePaths({ projectCwd: cwd, configDirName: config.configDirName });
	return {
		config,
		paths: project,
		memory: new MemoryStore(project.memory),
		skills: new SkillLibrary(project.skillsDir),
		registry: new ToolRegistry(project.toolsDir),
	};
}

function globalGovernance(config: FrameworkConfig): Governance {
	const { global } = resolvePaths({ projectCwd: homedir(), configDirName: config.configDirName });
	return createGovernance({ paths: global });
}

/**
 * Build a store manager. The `cwd` used for the default project scope is taken
 * from `fallbackCwd` so the manager can be constructed at extension-load time
 * (before any ctx exists) and later re-scoped per call via `project(cwd)`.
 */
export function createStoreManager(_fallbackCwd: string, config?: Partial<FrameworkConfig>): StoreManager {
	const effective: FrameworkConfig = { ...DEFAULT_CONFIG, ...config };
	const cache = new Map<string, ScopedStores>();
	let globalGov: Governance | undefined;

	return {
		project(cwd, cfg = effective) {
			const key = `${cwd}::${cfg.configDirName}`;
			const hit = cache.get(key);
			if (hit) return hit;
			const stores = projectStores(cfg, cwd);
			cache.set(key, stores);
			return stores;
		},
		governance(cfg = effective) {
			globalGov ??= globalGovernance(cfg);
			return globalGov;
		},
	};
}
