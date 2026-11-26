// node --test vendor/pi-subagents/test/run-test.mjs
// The tests import pi-subagents, which imports pi and typebox from node_modules. node cannot load them alone. jiti can, as pi does.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const pi = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const scoped = (name) => join(pi, "node_modules/@earendil-works", name);
const { createJiti } = await import(join(pi, "node_modules/jiti/lib/jiti.mjs"));
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": join(pi, "dist/index.js"),
		"@earendil-works/pi-ai": scoped("pi-ai"),
		"@earendil-works/pi-tui": scoped("pi-tui"),
		"@sinclair/typebox": createRequire(join(pi, "package.json")).resolve("typebox"),
	},
});
await jiti.import("./resume.test.ts");
