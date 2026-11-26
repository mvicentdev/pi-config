// node --test extensions/review-guard/run-test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extensionCanonicalNames } from "../../vendor/pi-subagents/src/agent-runner.ts";
import { createReviewGuard } from "./index.ts";
import { PUBLISH_REASON } from "./review.ts";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIRECTORY, "..", "..");
const REFUSED = { block: true, reason: PUBLISH_REASON };

// Un pi de mentira que guarda lo que la extensión registra, con un reloj que avanza en cada lectura.
function session(entries: unknown[] = []) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const listeners = new Map<string, (data: unknown) => void>();
	let clock = 1000;
	createReviewGuard(() => ++clock)({
		on: (name: string, handler: never) => handlers.set(name, handler),
		events: { on: (name: string, listener: never) => listeners.set(name, listener) },
	} as never);
	const ctx = { cwd: "/tmp", sessionManager: { getBranch: () => entries } };
	handlers.get("session_start")?.({ reason: "startup" }, ctx);
	let id = 0;
	const run = (toolName: string, input: Record<string, unknown>, result: Record<string, unknown> = {}) => {
		const toolCallId = `call-${++id}`;
		const blocked = handlers.get("tool_call")?.({ toolName, toolCallId, input }, ctx);
		if (!blocked) handlers.get("tool_result")?.({ toolName, toolCallId, input, content: [], isError: false, ...result }, ctx);
		handlers.get("tool_execution_end")?.({ toolName, toolCallId }, ctx);
		return blocked;
	};
	return {
		handlers,
		ctx,
		push: (command = "git push") => handlers.get("tool_call")?.({ toolName: "bash", toolCallId: `push-${++id}`, input: { command } }, ctx),
		edit: (path = "README.md") => run("edit", { path, oldText: "a", newText: "b" }),
		run,
		agent: (type: string, report: string | undefined, status = "completed") =>
			listeners.get(status === "completed" || status === "steered" ? "subagents:completed" : "subagents:failed")?.({
				id: `${type}-${id}`, type, status, result: report, durationMs: 0,
			}),
		foreground: (input: Record<string, unknown>, type: string, text: string, status = "completed") =>
			run("Agent", input, {
				content: [{ type: "text", text }],
				details: { subagentType: type, status, durationMs: 0, agentId: "a1" },
			}),
	};
}

test("un cambio sin revisar impide publicar", () => {
	const s = session();
	s.edit();
	assert.deepEqual(s.push(), REFUSED);
	assert.deepEqual(s.push("glab mr create --fill"), REFUSED);
	assert.deepEqual(s.push("gh pr create --fill"), REFUSED);
	assert.equal(s.push("git status"), undefined);
});

test("sin cambios en la sesión se publica", () => {
	const s = session();
	assert.equal(s.push(), undefined);
	s.run("read", { path: "README.md" });
	s.run("lsp_fix", { path: "a.ts" });
	assert.equal(s.push(), undefined);
});

test("un verifier que pasa después del cambio deja publicar", () => {
	const s = session();
	s.edit();
	s.agent("verifier", "**Veredicto: pass.**\n\nSin hallazgos.");
	assert.equal(s.push(), undefined);
	assert.equal(s.push("git -C /tmp/repo push"), undefined);
});

test("un arreglo de un worker después de la revisión vuelve a impedir publicar", () => {
	const s = session();
	s.edit();
	s.agent("verifier", "Verdict: pass");
	s.agent("worker", "Fixed the finding.");
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	assert.equal(s.push(), undefined);
	s.foreground({ subagent_type: "worker", prompt: "fix" }, "worker", "Agent completed in 1s.\n\nDone.");
	assert.deepEqual(s.push(), REFUSED);
});

test("un worker reanudado cuenta como cambio aunque subagent_type diga otra cosa", () => {
	const s = session();
	s.foreground({ subagent_type: "verifier", resume: "w1", prompt: "fix" }, "worker", "Done.");
	assert.deepEqual(s.push(), REFUSED);
	s.foreground({ subagent_type: "verifier", resume: "v1", prompt: "again" }, "verifier", "Verdict: pass");
	assert.equal(s.push(), undefined);
});

test("un verifier que falla, que no informa o que acaba en error no deja publicar", () => {
	const s = session();
	s.edit();
	s.agent("verifier", "**Veredicto: fail.**\n\n1. /tmp/a.md:3 pierde una regla.");
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", undefined);
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "No output.");
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass", "error");
	assert.deepEqual(s.push(), REFUSED);
	s.foreground({ subagent_type: "verifier", prompt: "review" }, "verifier", "Agent completed in 1s.\n\nNo output.");
	assert.deepEqual(s.push(), REFUSED);
	s.run("Agent", { subagent_type: "verifier", prompt: "review" }, {
		content: [{ type: "text", text: "Agent started in background.\nAgent ID: v2" }],
		details: { subagentType: "verifier", status: "background", agentId: "v2" },
	});
	assert.deepEqual(s.push(), REFUSED);
});

test("cuenta write y lsp_fix con write, no una llamada fallida ni bloqueada", () => {
	const s = session();
	s.run("write", { path: "a.ts", content: "" }, { isError: true });
	assert.equal(s.push(), undefined);
	// Otra extensión bloquea la llamada: no hay tool_result.
	s.handlers.get("tool_call")?.({ toolName: "edit", toolCallId: "blocked", input: { path: "a.ts" } }, s.ctx);
	s.handlers.get("tool_execution_end")?.({ toolName: "edit", toolCallId: "blocked" }, s.ctx);
	assert.equal(s.push(), undefined);
	s.run("lsp_fix", { path: "a.ts", write: true });
	assert.deepEqual(s.push(), REFUSED);
	const t = session();
	t.run("write", { path: "notes.md", content: "x" });
	assert.deepEqual(t.push(), REFUSED);
});

test("una edición aún en curso en paralelo impide publicar", () => {
	const s = session();
	s.handlers.get("tool_call")?.({ toolName: "edit", toolCallId: "parallel", input: { path: "a.md" } }, s.ctx);
	assert.deepEqual(s.push(), REFUSED);
});

test("las formas de publicar con -C y en cadena también se rechazan", () => {
	const s = session();
	s.edit();
	for (const command of ["git -C /tmp/repo push origin main", "npm test && git push", "git commit -m x; git push -u origin HEAD"]) {
		assert.deepEqual(s.push(command), REFUSED, command);
	}
});

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
	type: "message",
	message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: 1 },
});
const toolResult = (id: string, toolName: string) => ({
	type: "message",
	message: { role: "toolResult", toolCallId: id, toolName, content: [], isError: false, timestamp: 2 },
});
const subagent = (type: string, report: string, startedAt: number, completedAt: number) => ({
	type: "custom",
	customType: "subagents:record",
	data: { id: type, type, status: "completed", result: report, startedAt, completedAt },
});

test("al empezar o recargar la sesión rehace el estado desde sus entradas", () => {
	const edited = [toolCall("c1", "edit", { path: "a.md" }), toolResult("c1", "edit")];
	assert.deepEqual(session(edited).push(), REFUSED);
	const reviewed = [...edited, subagent("verifier", "Verdict: pass", 3, 4)];
	assert.equal(session(reviewed).push(), undefined);
	assert.deepEqual(session([...reviewed, subagent("worker", "done", 5, 6)]).push(), REFUSED);
	// Un cambio de rama con /tree también rehace el estado.
	const entries: unknown[] = [];
	const s = session(entries);
	s.edit();
	assert.deepEqual(s.push(), REFUSED);
	s.handlers.get("session_tree")?.({}, s.ctx);
	assert.equal(s.push(), undefined);
});

// pi-subagents carga en un subagente las extensiones del bucle principal salvo las de exclude_extensions.
test("ningún subagente carga la extensión", () => {
	const names = extensionCanonicalNames(join(DIRECTORY, "index.ts"));
	const agents = readdirSync(join(ROOT, "agents")).filter((file) => file.endsWith(".md"));
	assert.ok(agents.length > 0);
	for (const file of agents) {
		const text = readFileSync(join(ROOT, "agents", file), "utf8");
		const excluded = (text.match(/^exclude_extensions:(.*)$/m)?.[1] ?? "").split(",").map((name) => name.trim().toLowerCase());
		assert.ok(names.some((name) => excluded.includes(name)), `${file} excluye review-guard`);
		assert.doesNotMatch(text, /^extensions:/m, `${file} no fija su propia lista de extensiones`);
	}
	assert.equal(JSON.parse(readFileSync(join(ROOT, "subagents.json"), "utf8")).disableDefaultAgents, true);
});
