// node --test extensions/status-line/run-test.mjs
// Las piezas importan pi y pi-tui, que node no resuelve solo: jiti sí, como hace pi. El entorno se
// aísla antes de importar porque ghostty.ts y settings.ts leen las rutas al cargarse.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandbox = mkdtempSync(join(tmpdir(), "status-line-"));
process.on("exit", () => rmSync(sandbox, { recursive: true, force: true }));
process.env.HOME = sandbox;
process.env.XDG_CONFIG_HOME = join(sandbox, "config");
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
process.env.GHOSTTY_RESOURCES_DIR = join(sandbox, "resources");
process.env.STATUS_LINE_SANDBOX = sandbox;

const pi = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { createJiti } = await import(join(pi, "node_modules/jiti/lib/jiti.mjs"));
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": join(pi, "dist/index.js"),
		"@earendil-works/pi-tui": join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js"),
	},
});
await jiti.import("./ghostty.test.ts");
await jiti.import("./settings.test.ts");
await jiti.import("./segments.test.ts");
await jiti.import("./index.test.ts");
