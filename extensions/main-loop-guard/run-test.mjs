// node --test extensions/main-loop-guard/run-test.mjs
// La prueba importa pi-subagents, que importa pi y typebox de node_modules. node no los carga solos. jiti sí, como hace pi.
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
await jiti.import("./index.test.ts");
