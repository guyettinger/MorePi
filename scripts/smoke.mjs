// Smoke check: attempt to load the extension entry through jiti (the same loader
// pi uses) with a minimal stub ExtensionAPI. This guards against import/runtime
// errors at package-wiring time without requiring a live pi session.
//
// It is intentionally non-fatal when jiti is not resolvable (e.g. before
// `npm install`), so it never breaks a clean checkout.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stubApi() {
   const noop = () => {};
   return {
     on: noop,
     registerTool: noop,
     registerCommand: noop,
     registerShortcut: noop,
     registerFlag: noop,
     registerMessageRenderer: noop,
     registerEntryRenderer: noop,
     registerMarkdownTransformer: noop,
     registerProvider: noop,
     unregisterProvider: noop,
     getFlag: () => undefined,
     sendMessage: noop,
     sendUserMessage: noop,
     appendEntry: noop,
     setSessionName: noop,
     getSessionName: () => undefined,
     setLabel: noop,
     exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
     getActiveTools: () => [],
     getAllTools: () => [],
     setActiveTools: noop,
     getCommands: () => [],
     setModel: async () => false,
     getThinkingLevel: () => "medium",
     setThinkingLevel: noop,
     events: { on: noop, emit: noop },
     __cwd: mkdtempSync(join(tmpdir(), "morepi-smoke-")),
     };
}

const run = async () => {
   let jiti;
   try {
     jiti = (await import("jiti")).default ?? (await import("jiti"));
     } catch {
     console.log("smoke: jiti not installed; skipping load check (run `npm install` first).");
     process.exit(0);
      }

   const loader = jiti({ interopDefault: true });
   const mod = loader("./extensions/index.ts");
   const factory = mod.default ?? mod;
   if (typeof factory !== "function") {
     console.error("smoke: extensions/index.ts default export is not a function");
     process.exit(1);
     }
   factory(stubApi());
   console.log("smoke: extension factory loaded and registered without error.");
};

run().catch((err) => {
   console.error("smoke: failed —", err);
   process.exit(1);
   });
