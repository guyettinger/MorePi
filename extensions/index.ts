/**
 * MorePi — self-modifying framework for pi (extension entry point).
 *
 * This file is what pi auto-discovers (the `pi.extensions` manifest points at
 * this directory). It re-exports the default extension factory so the package
 * can be loaded via `pi -e ./extensions/index.ts`, `pi install`, or placed in
 * `~/.pi/agent/extensions/`.
 *
 * Loaded by pi through jiti, so it can be authored in TypeScript directly.
 */
export { default } from "../src/index.js";
