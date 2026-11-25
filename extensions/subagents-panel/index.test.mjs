// node --test extensions/subagents-panel/index.test.mjs (requiere pi instalado con npm)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const host = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")));
const { createEventBus } = await import(pathToFileURL(join(host, "dist/core/event-bus.js")));
const theme = { fg: (_color, text) => text, bold: (text) => text };
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, { customOverride } = {}) {
	const events = createEventBus();
	const loaded = await loadExtensions([fileURLToPath(new URL("./index.ts", import.meta.url))], process.cwd(), events);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	const records = new Map();
	const key = Symbol.for("pi-subagents:manager");
	const previous = globalThis[key];
	globalThis[key] = { getRecord: (id) => records.get(id) };
	const state = { component: undefined, overlay: undefined, done: undefined, notices: [], customCalls: [], stops: [] };
	const tui = { terminal: { rows: 40 }, requestRender() {}, hasOverlay: () => Boolean(state.overlay) };
	const ctx = {
		mode: "tui", hasUI: true,
		ui: {
			setWidget(_key, factory) {
				state.component?.dispose();
				state.component = factory?.(tui, theme);
			},
			onTerminalInput(handler) { state.input = handler; return () => { state.input = undefined; }; },
			getEditorText: () => "",
			custom(factory, options) {
				state.customCalls.push(options);
				if (customOverride) return customOverride(factory);
				return new Promise((resolve) => {
					state.done = () => { state.overlay?.dispose(); state.overlay = undefined; resolve(); };
					state.overlay = factory(tui, theme, undefined, state.done);
				});
			},
			notify(message, level) { state.notices.push([message, level]); },
		},
	};
	events.on("subagents:rpc:stop", (data) => state.stops.push(data));
	const fire = async (event, context = ctx) => {
		for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event }, context);
	};
	const start = (id, { session = true, steer = async () => {} } = {}) => {
		const listeners = new Set();
		const agentSession = {
			messages: [],
			subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
			steer: async (message) => steer(message),
		};
		const record = {
			id, type: "worker", description: `Tarea ${id}`, status: "running", startedAt: Date.now(), toolUses: 0,
			lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, session: session ? agentSession : undefined,
		};
		records.set(id, record);
		events.emit("subagents:started", record);
		return { record, listeners, emit: (event) => { for (const fn of listeners) fn(event); } };
	};
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000 });
	t.after(async () => {
		await fire("session_shutdown");
		t.mock.timers.reset();
		globalThis[key] = previous;
	});
	await fire("session_start");
	const shortcut = () => extension.shortcuts.get("ctrl+shift+r").handler(ctx);
	return { events, extension, state, ctx, fire, start, shortcut, tick: (ms) => t.mock.timers.tick(ms) };
}

test("el widget muestra herramientas, tokens y actividad de un agente en marcha", async (t) => {
	const { state, start, tick } = await setup(t);
	const agent = start("a");
	agent.record.toolUses = 3;
	agent.record.lifetimeUsage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0 };
	tick(150);
	const [row] = state.component.render(120);
	assert.match(row, /worker {2}Tarea a/);
	assert.match(row, /pensando…/);
	assert.match(row, /3 herr\. · 1\.5k · \d+s/);
	agent.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" });
	tick(150);
	assert.match(state.component.render(120)[0], /leyendo…/);
	assert.match(state.component.render(120).at(-1), /↓ o ctrl\+shift\+r ver conversación/);
});

test("el widget conserva un agente terminado un rato y luego se retira", async (t) => {
	const { events, state, start, tick } = await setup(t);
	const agent = start("a");
	tick(150);
	events.emit("subagents:completed", { id: "a", type: "worker", description: "Tarea a", toolUses: 5, tokens: { total: 34_500 } });
	tick(150);
	assert.equal(agent.listeners.size, 0);
	assert.match(state.component.render(120)[0], /✓.*34\.5k/);
	assert.match(state.component.render(120)[0], /5 herr\./);
	tick(4_000);
	tick(150);
	assert.equal(state.component, undefined);
});

test("un agente fallido enseña su error", async (t) => {
	const { events, state, start, tick } = await setup(t);
	start("a");
	tick(150);
	events.emit("subagents:failed", { id: "a", status: "error", error: "boom\nsegunda línea" });
	tick(150);
	const [row] = state.component.render(120);
	assert.match(row, /✗/);
	assert.match(row, /error: boom segunda línea/);
});

test("el agente se suscribe a su sesión una sola vez y solo cuando existe", async (t) => {
	const { state, start, tick } = await setup(t);
	const late = start("late", { session: false });
	tick(150);
	assert.equal(late.listeners.size, 0);
	late.record.session = { subscribe: (fn) => { late.listeners.add(fn); return () => {}; } };
	tick(3_000);
	assert.equal(late.listeners.size, 1);
	assert.ok(state.component);
});

test("el atajo avisa si no hay subagentes visibles", async (t) => {
	const { state, shortcut } = await setup(t);
	shortcut();
	assert.deepEqual(state.notices, [["No hay subagentes visibles.", "info"]]);
	assert.equal(state.customCalls.length, 0);
});

test("el atajo con un solo agente abre su visor en un overlay centrado", async (t) => {
	const { state, start, shortcut, tick } = await setup(t);
	start("a");
	tick(150);
	shortcut();
	assert.ok(state.overlay);
	assert.deepEqual(state.customCalls, [{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } }]);
	assert.ok(state.overlay.render(80).length > 0);
	shortcut();
	assert.equal(state.customCalls.length, 1);
});

test("el atajo avisa si la sesión del agente aún no existe", async (t) => {
	const { state, start, shortcut, tick } = await setup(t);
	start("a", { session: false });
	tick(150);
	shortcut();
	assert.deepEqual(state.notices, [["La sesión de ese agente aún no está disponible.", "info"]]);
	assert.equal(state.overlay, undefined);
});

test("Enter abre el visor del agente elegido y la doble x lo detiene", async (t) => {
	const { state, start, shortcut, tick } = await setup(t);
	start("a");
	start("b");
	tick(150);
	shortcut();
	state.input("\u001b[B");
	state.input("\r");
	assert.ok(state.overlay);
	state.overlay.handleInput("x");
	assert.deepEqual(state.stops, []);
	state.overlay.handleInput("x");
	assert.equal(state.stops.length, 1);
	assert.equal(state.stops[0].agentId, "b");
	assert.match(state.stops[0].requestId, /^panel-/);
});

test("el visor envía el mensaje escrito como dirección al agente", async (t) => {
	const sent = [];
	const { state, start, shortcut, tick } = await setup(t);
	start("a", { steer: (message) => sent.push(message) });
	tick(150);
	shortcut();
	state.overlay.handleInput("\r");
	for (const character of "hola") state.overlay.handleInput(character);
	state.overlay.handleInput("\r");
	await flush();
	assert.deepEqual(sent, ["hola"]);
});

test("el visor avisa si la dirección del agente falla", async (t) => {
	const { state, start, shortcut, tick } = await setup(t);
	start("a", { steer: async () => { throw new Error("fallo"); } });
	tick(150);
	shortcut();
	state.overlay.handleInput("\r");
	state.overlay.handleInput("a");
	state.overlay.handleInput("\r");
	await flush();
	assert.deepEqual(state.notices, [["Error: fallo", "error"]]);
});

test("Escape cierra el visor y devuelve el teclado al panel", async (t) => {
	const { state, start, shortcut, tick } = await setup(t);
	start("a");
	start("b");
	tick(150);
	shortcut();
	state.input("\r");
	assert.ok(state.overlay);
	state.overlay.handleInput("\u001b");
	await flush();
	assert.equal(state.overlay, undefined);
	shortcut();
	assert.equal(state.customCalls.length, 1);
	assert.match(state.component.render(80)[0], /^▸/);
});

test("cerrar la sesión cierra el visor abierto", async (t) => {
	const { state, fire, start, shortcut, tick } = await setup(t);
	start("a");
	tick(150);
	shortcut();
	assert.ok(state.overlay);
	await fire("session_shutdown");
	await flush();
	assert.equal(state.overlay, undefined);
	assert.equal(state.input, undefined);
});

test("un fallo al abrir el visor se notifica", async (t) => {
	const { state, start, shortcut, tick } = await setup(t, { customOverride: () => Promise.reject(new Error("sin overlay")) });
	start("a");
	tick(150);
	shortcut();
	await flush();
	assert.deepEqual(state.notices, [["Error: sin overlay", "error"]]);
	shortcut();
	assert.equal(state.customCalls.length, 2);
});

test("un fallo tardío del visor tras cerrar la sesión no se notifica", async (t) => {
	let reject;
	const { state, fire, start, shortcut, tick } = await setup(t, { customOverride: () => new Promise((_resolve, fail) => { reject = fail; }) });
	start("a");
	tick(150);
	shortcut();
	await fire("session_shutdown");
	reject(new Error("tarde"));
	await flush();
	assert.deepEqual(state.notices, []);
});

test("una sesión nueva descarta los agentes y las suscripciones anteriores", async (t) => {
	const { state, fire, start, tick } = await setup(t);
	const agent = start("a");
	tick(150);
	assert.equal(agent.listeners.size, 1);
	await fire("session_start");
	assert.equal(agent.listeners.size, 0);
	assert.equal(typeof state.input, "function");
	start("b");
	tick(150);
	const lines = state.component.render(120);
	assert.equal(lines.length, 2);
	assert.match(lines[0], /Tarea b/);
});
