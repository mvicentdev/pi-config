// node --test extensions/review-guard/run-test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extensionCanonicalNames } from "../../vendor/pi-subagents/src/agent-runner.ts";
import { createReviewGuard } from "./index.ts";
import { GO_REASON, PUBLISH_REASON } from "./review.ts";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIRECTORY, "..", "..");
const REFUSED = { block: true, reason: PUBLISH_REASON };
const NO_GO = { block: true, reason: GO_REASON };

// El git de mentira dice que /tmp está en main, su rama por defecto, y /tmp/feature en feat/x.
const GIT = (dir: string, args: readonly string[]) => {
	const branch = ({ "/tmp": "main", "/tmp/feature": "feat/x", "/tmp/all": "feat/all" } as Record<string, string>)[dir];
	if (args.join(" ") === "symbolic-ref --short -q HEAD") return branch;
	if (args.join(" ") === "symbolic-ref --short -q refs/remotes/origin/HEAD") return branch && "origin/main";
	return args[0] === "remote" && branch ? "origin" : undefined;
};

// Un pi de mentira que guarda lo que la extensión registra, con un reloj que avanza en cada lectura.
// Sin registro, la extensión se fía solo de los eventos de pi-subagents.
function session(entries: unknown[] = [], registry?: () => unknown) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const listeners = new Map<string, (data: unknown) => void>();
	const emit = (name: string, data: unknown) => listeners.get(name)?.(data);
	let clock = 1000;
	createReviewGuard(() => ++clock, registry ?? (() => undefined), GIT)({
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
		emit,
		// Una llamada que empieza y aún no acaba.
		start: (toolName: string, input: Record<string, unknown>) => {
			const toolCallId = `call-${++id}`;
			handlers.get("tool_call")?.({ toolName, toolCallId, input }, ctx);
			return (result: Record<string, unknown> = {}) => {
				handlers.get("tool_result")?.({ toolName, toolCallId, input, content: [], isError: false, ...result }, ctx);
				handlers.get("tool_execution_end")?.({ toolName, toolCallId }, ctx);
			};
		},
		push: (command = "git push") => handlers.get("tool_call")?.({ toolName: "bash", toolCallId: `push-${++id}`, input: { command } }, ctx),
		// Un mensaje entra en la conversación como lo entrega pi: primero input con su origen y luego el mensaje con rol user.
		say: (text = "Sip", source = "interactive") => {
			handlers.get("input")?.({ text, source }, ctx);
			handlers.get("message_end")?.({ message: { role: "user", content: [{ type: "text", text }], timestamp: 0 } }, ctx);
		},
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
	s.agent("verifier", "Verdict: pass\n\nSin hallazgos.");
	s.say();
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
	s.say();
	assert.equal(s.push(), undefined);
	s.foreground({ subagent_type: "worker", prompt: "fix" }, "worker", "Agent completed in 1s.\n\nDone.");
	assert.deepEqual(s.push(), REFUSED);
});

test("un worker reanudado cuenta como cambio aunque subagent_type diga otra cosa", () => {
	const s = session();
	s.foreground({ subagent_type: "verifier", resume: "w1", prompt: "fix" }, "worker", "Done.");
	assert.deepEqual(s.push(), REFUSED);
	s.foreground({ subagent_type: "verifier", resume: "v1", prompt: "again" }, "verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
});

test("un verifier que falla, que no informa o que acaba en error no deja publicar", () => {
	const s = session();
	s.edit();
	s.agent("verifier", "Verdict: fail\n\n1. /tmp/a.md:3 pierde una regla.");
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass with reservations");
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

test("un worker en segundo plano aún en marcha impide publicar hasta que acaba", () => {
	const s = session();
	s.emit("subagents:created", { id: "w1", type: "worker", description: "fix", isBackground: true });
	assert.deepEqual(s.push(), REFUSED);
	s.emit("subagents:started", { id: "w1", type: "worker", description: "fix" });
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	assert.deepEqual(s.push(), REFUSED);
	s.emit("subagents:completed", { id: "w1", type: "worker", status: "completed", result: "done", durationMs: 0 });
	// Acabó y cambió el trabajo: un verifier nuevo lo cubre.
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
	// Un worker que pi-subagents arranca desde la cola o por RPC solo avisa con subagents:started.
	s.emit("subagents:started", { id: "w2", type: "worker", description: "queued" });
	assert.deepEqual(s.push(), REFUSED);
	s.emit("subagents:failed", { id: "w2", type: "worker", status: "stopped", durationMs: 0 });
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
	// Un verifier en segundo plano no impide publicar.
	s.emit("subagents:created", { id: "v9", type: "verifier", description: "review", isBackground: true });
	assert.equal(s.push(), undefined);
});

// Un worker en cola que se para no avisa con subagents:completed ni subagents:failed.
// Tampoco uno aislado en un worktree que se para mientras se crea su copia.
// Pudo editar ficheros antes de pararse: cuenta como cambio hasta que un verifier lo revisa.
test("un worker que pi-subagents ya no tiene en marcha deja de impedir publicar tras revisarlo", () => {
	const records = new Map<string, { status: string }>();
	const s = session([], () => ({ getRecord: (id: string) => records.get(id) }));
	records.set("w1", { status: "queued" });
	s.emit("subagents:created", { id: "w1", type: "worker", description: "fix", isBackground: true });
	assert.deepEqual(s.push(), REFUSED);
	records.set("w1", { status: "running" });
	assert.deepEqual(s.push(), REFUSED);
	records.set("w1", { status: "stopped" });
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
	// Un registro que pi-subagents ya ha borrado tampoco corre.
	s.emit("subagents:started", { id: "w2", type: "worker", description: "gone" });
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
	// Un registro sin getRecord no sirve: cuentan los eventos.
	const t = session([], () => ({}));
	t.emit("subagents:started", { id: "w3", type: "worker", description: "fix" });
	assert.deepEqual(t.push(), REFUSED);
});

// Un worker parado desde la interfaz pasa a stopped al instante, pero su subagents:failed llega después.
test("un worker parado sin aviso aún cuenta como cambio", () => {
	const records = new Map<string, { status: string }>();
	const s = session([], () => ({ getRecord: (id: string) => records.get(id) }));
	records.set("w1", { status: "running" });
	s.emit("subagents:started", { id: "w1", type: "worker", description: "fix" });
	records.set("w1", { status: "stopped" });
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
});

test("un worker reanudado en primer plano impide publicar mientras corre", () => {
	const s = session();
	s.emit("subagents:created", { id: "w1", type: "worker", description: "fix", isBackground: true });
	s.emit("subagents:completed", { id: "w1", type: "worker", status: "completed", result: "done", durationMs: 0 });
	s.emit("subagents:created", { id: "v1", type: "verifier", description: "review", isBackground: true });
	s.emit("subagents:completed", { id: "v1", type: "verifier", status: "completed", result: "Verdict: pass", durationMs: 0 });
	s.say();
	assert.equal(s.push(), undefined);
	// Reanudar ignora subagent_type: cuenta el tipo del agente reanudado.
	const end = s.start("Agent", { subagent_type: "verifier", resume: "w1", prompt: "fix", run_in_background: false });
	assert.deepEqual(s.push(), REFUSED);
	end({ content: [{ type: "text", text: "Done." }], details: { subagentType: "worker", status: "completed", durationMs: 0, agentId: "w1" } });
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	s.say();
	assert.equal(s.push(), undefined);
	const review = s.start("Agent", { subagent_type: "worker", resume: "v1", prompt: "again", run_in_background: false });
	assert.equal(s.push(), undefined);
	review();
	// Un agente que la extensión no conoce puede ser un worker.
	const unknown = s.start("Agent", { subagent_type: "verifier", resume: "x1", prompt: "go", run_in_background: false });
	assert.deepEqual(s.push(), REFUSED);
	unknown();
	assert.equal(s.push(), undefined);
	// Un worker nuevo en primer plano también impide publicar mientras corre.
	const fresh = s.start("Agent", { subagent_type: "worker", prompt: "fix", run_in_background: false });
	assert.deepEqual(s.push(), REFUSED);
	fresh();
});

test("tras recargar, reconoce el tipo de un agente que se reanuda", () => {
	const s = session([subagent("worker", "done", 1, 2), subagent("verifier", "Verdict: pass", 3, 4), user("Sip", 5)]);
	assert.equal(s.push(), undefined);
	const end = s.start("Agent", { subagent_type: "verifier", resume: "worker", prompt: "fix", run_in_background: false });
	assert.deepEqual(s.push(), REFUSED);
	end();
	const review = s.start("Agent", { subagent_type: "worker", resume: "verifier", prompt: "again", run_in_background: false });
	assert.equal(s.push(), undefined);
	review();
});

test("las formas de publicar con -C y en cadena también se rechazan", () => {
	const s = session();
	s.edit();
	for (const command of [
		"git -C /tmp/repo push origin main",
		"npm test && git push",
		"git commit -m x; git push -u origin HEAD",
		"timeout 30 git push",
		"sudo -u deploy git push",
		"gh -R o/r pr create",
		"glab -R o/r mr create",
	]) {
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
const user = (text: string, timestamp: number) => ({
	type: "message",
	message: { role: "user", content: [{ type: "text", text }], timestamp },
});

test("al empezar o recargar la sesión rehace el estado desde sus entradas", () => {
	const edited = [toolCall("c1", "edit", { path: "a.md" }), toolResult("c1", "edit")];
	assert.deepEqual(session(edited).push(), REFUSED);
	const reviewed = [...edited, subagent("verifier", "Verdict: pass", 3, 4)];
	assert.deepEqual(session(reviewed).push(), NO_GO);
	assert.equal(session([...reviewed, user("Sip", 5)]).push(), undefined);
	assert.deepEqual(session([...reviewed, subagent("worker", "done", 5, 6)]).push(), REFUSED);
	// Un cambio de rama con /tree también rehace el estado.
	const entries: unknown[] = [];
	const s = session(entries);
	s.edit();
	assert.deepEqual(s.push(), REFUSED);
	s.handlers.get("session_tree")?.({}, s.ctx);
	assert.equal(s.push(), undefined);
});

// Criterio 3: publicar pide un mensaje del usuario posterior al último cambio, que un verifier aprobó.
// Fallo medido: el agente publica tras el verifier sin ningún mensaje del usuario en medio.
test("publicar tras el verifier sin un mensaje del usuario se rechaza", () => {
	const s = session();
	s.say("Arregla el fallo.");
	s.agent("worker", "Fixed.");
	s.agent("verifier", "Verdict: pass");
	for (const command of ["git push -u origin HEAD", "glab mr create --fill", "gh pr create --fill", "git merge --ff-only feat/x", "glab mr merge 12 --yes"]) {
		assert.deepEqual(s.push(command), NO_GO, command);
	}
	s.say("Sip");
	assert.equal(s.push(), undefined);
	assert.equal(s.push("git merge --ff-only feat/x"), undefined);
	// Un cambio después del visto bueno pide otro.
	s.edit();
	s.agent("verifier", "Verdict: pass");
	assert.deepEqual(s.push(), NO_GO);
});

// Orca pega su correo en la terminal de pi, así que llega como texto tecleado. Su cabecera lo delata.
// Un mensaje de una extensión con sendUserMessage llega con source "extension".
test("un mensaje inyectado con rol user no es el visto bueno", () => {
	const s = session();
	s.say("Arregla el fallo.");
	s.agent("worker", "Done.");
	s.agent("verifier", "Verdict: pass");
	for (const [text, source] of [
		["──── From: STRUCTWORKER_B265 (structworker_b265) (worker_done) ────\nSubject: Standards review: pass", "interactive"],
		["  ──── From: DISPATCH:CTX_93BA (dispatch:ctx_93ba) (question) ────\nSubject: Question", "rpc"],
		["<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n</task-notification>", "interactive"],
		['<paseo-system version="1" kind="agent-message">done</paseo-system>', "interactive"],
		["Sip", "extension"],
	]) {
		s.say(text, source);
		assert.deepEqual(s.push(), NO_GO, `${source}: ${text}`);
	}
	s.say("Sip");
	assert.equal(s.push(), undefined);
});

// Falsa alarma (a), medida: el usuario da el visto bueno, la extensión pide otra revisión y esta pasa sin cambiar código.
test("el visto bueno anterior a una revisión que pasa sin cambios deja publicar", () => {
	const s = session();
	s.say("Los recomendados");
	s.agent("verifier", "Verdict: pass");
	s.agent("worker", "Fixed the finding.");
	s.say("Ok. Subimos");
	assert.deepEqual(s.push(), REFUSED);
	s.agent("verifier", "Verdict: pass");
	assert.equal(s.push(), undefined);
	assert.equal(s.push("glab mr create --fill"), undefined);
});

// Falsa alarma (b), medida: una fusión local con avance rápido que el usuario pidió con palabras.
test("una fusión local que pide el usuario pasa", () => {
	const s = session();
	s.agent("worker", "Done.");
	s.agent("verifier", "Verdict: pass");
	s.say("Sip, fusiona en main.");
	assert.equal(s.push("cd /tmp && git status --short && git merge --ff-only feat/x 2>&1 | tail -2"), undefined);
});

// Falsa alarma (c), medida: un commit local. Tampoco una fusión en una rama que no es la de por defecto.
test("un commit local y una fusión fuera de la rama por defecto pasan sin visto bueno", () => {
	const s = session();
	s.say("Arregla el fallo.");
	s.agent("worker", "Done.");
	assert.equal(s.push("git add -A && git commit -q -m 'fix: x'"), undefined);
	assert.equal(s.push("cd /tmp/feature && git commit -am 'fix: y'"), undefined);
	assert.equal(s.push("git -C /tmp/all merge -q --no-edit feat/a feat/b"), undefined);
	assert.equal(s.push("git merge --ff-only origin/main"), undefined);
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
