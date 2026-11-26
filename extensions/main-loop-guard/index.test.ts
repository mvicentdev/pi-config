// node --test extensions/main-loop-guard/run-test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { extensionCanonicalNames } from "../../vendor/pi-subagents/src/agent-runner.ts";
import { EDIT_REASON } from "./guard.ts";
import mainLoopGuard from "./index.ts";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIRECTORY, "..", "..");

const root = realpathSync(mkdtempSync(join(tmpdir(), "main-loop-guard-")));
mkdirSync(join(root, "repo", ".git"), { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));

// Un pi de mentira que guarda lo que la extensión registra.
function toolCall() {
	const handlers = new Map();
	mainLoopGuard({ on: (name: string, handler: unknown) => handlers.set(name, handler) } as never);
	return handlers.get("tool_call");
}

test("el bucle principal no edita código de un repositorio", () => {
	const result = toolCall()({ toolName: "edit", input: { path: "src/App.ts" } }, { cwd: join(root, "repo") });
	assert.deepEqual(result, { block: true, reason: EDIT_REASON });
});

test("el bucle principal edita markdown y ficheros fuera de un repositorio", () => {
	const handler = toolCall();
	assert.equal(handler({ toolName: "write", input: { path: "README.md" } }, { cwd: join(root, "repo") }), undefined);
	assert.equal(handler({ toolName: "write", input: { path: "notes.ts" } }, { cwd: root }), undefined);
});

test("el bucle principal no deja que lsp_fix escriba código de un repositorio, pero sí que lo muestre", () => {
	const handler = toolCall();
	const ctx = { cwd: join(root, "repo") };
	assert.deepEqual(handler({ toolName: "lsp_fix", input: { path: "src/App.ts", write: true } }, ctx), { block: true, reason: EDIT_REASON });
	assert.equal(handler({ toolName: "lsp_fix", input: { path: "src/App.ts", write: false } }, ctx), undefined);
	assert.equal(handler({ toolName: "lsp_fix", input: { path: "src/App.ts" } }, ctx), undefined);
});

// pi-subagents carga en un subagente las extensiones del bucle principal salvo las de exclude_extensions.
test("ningún subagente carga la extensión", () => {
	const names = extensionCanonicalNames(join(DIRECTORY, "index.ts"));
	const agents = readdirSync(join(ROOT, "agents")).filter((file) => file.endsWith(".md"));
	assert.ok(agents.length > 0);
	for (const file of agents) {
		const text = readFileSync(join(ROOT, "agents", file), "utf8");
		const excluded = (text.match(/^exclude_extensions:(.*)$/m)?.[1] ?? "").split(",").map((name) => name.trim().toLowerCase());
		assert.ok(names.some((name) => excluded.includes(name)), `${file} excluye main-loop-guard`);
		assert.doesNotMatch(text, /^extensions:/m, `${file} no fija su propia lista de extensiones`);
	}
	// Los agentes por defecto cargan todas las extensiones, sin exclusiones.
	assert.equal(JSON.parse(readFileSync(join(ROOT, "subagents.json"), "utf8")).disableDefaultAgents, true);
});
