// node --test extensions/subagent-models/run-test.mjs
// La extensión importa pi de node_modules, que node no carga solo. jiti sí, como hace pi.
// El directorio de pi apunta a uno temporal: así la prueba no toca el subagent-models.json del usuario.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "subagent-models-test-"));
process.on("exit", () => rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true }));
const pi = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const scoped = (name) => join(pi, "node_modules/@earendil-works", name);
const { createJiti } = await import(join(pi, "node_modules/jiti/lib/jiti.mjs"));
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": join(pi, "dist/index.js"),
		"@earendil-works/pi-ai": scoped("pi-ai"),
		"@earendil-works/pi-tui": scoped("pi-tui"),
	},
});
await jiti.import("./index.test.ts");
