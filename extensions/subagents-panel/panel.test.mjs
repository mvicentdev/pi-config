// node --test extensions/subagents-panel/panel.test.mjs (requiere pi instalado con npm)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const host = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")));
const { createEventBus } = await import(pathToFileURL(join(host, "dist/core/event-bus.js")));
const { visibleWidth } = await import(pathToFileURL(join(host, "node_modules/@earendil-works/pi-tui/dist/index.js")));
const theme = { fg: (_color, text) => text, bold: (text) => text };

test("panel: carga, ancho, caché, navegación, rendimiento y limpieza", async (t) => {
	const events = createEventBus();
	const path = fileURLToPath(new URL("./index.ts", import.meta.url));
	const loaded = await loadExtensions([path], process.cwd(), events);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	assert.deepEqual([...extension.shortcuts.keys()], ["ctrl+shift+r"]);
	const records = new Map();
	const emitters = new Map();
	const key = Symbol.for("pi-subagents:manager");
	const previous = globalThis[key];
	globalThis[key] = { getRecord: (id) => records.get(id) };
	let component, input, overlay, done;
	let requests = 0;
	let editorText = "";
	const tui = { terminal: { rows: 40 }, requestRender() { requests++; }, hasOverlay: () => Boolean(overlay) };
	const ctx = {
		mode: "tui", hasUI: true,
		ui: {
			setWidget(_key, factory) {
				component?.dispose();
				component = factory?.(tui, theme);
			},
			onTerminalInput(handler) { input = handler; return () => { input = undefined; }; },
			getEditorText: () => editorText,
			custom(factory) {
				return new Promise((resolve) => {
					done = () => { overlay?.dispose(); overlay = undefined; resolve(); };
					overlay = factory(tui, theme, undefined, done);
				});
			},
			notify() {},
		},
	};
	const fire = async (event, context = ctx) => {
		for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event }, context);
	};
	const start = (id, description = "Cambiar el módulo", available = true) => {
		const listeners = new Set();
		const session = {
			messages: [],
			subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
			steer: async () => {},
		};
		const record = {
			id, type: "worker", description, status: "running", startedAt: Date.now(), toolUses: 0,
			lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, session: available ? session : undefined,
		};
		records.set(id, record);
		events.emit("subagents:started", record);
		const agent = { record, session, listeners, emit: (event) => { for (const fn of listeners) fn(event); } };
		emitters.set(id, agent);
		return agent;
	};
	const fixture = mkdtempSync(join(tmpdir(), "panel-baseline-"));
	const dependency = fileURLToPath(new URL("../../node_modules/@tintinweb/pi-subagents/src/ui/", import.meta.url));
	const bridge = join(fixture, "index.ts");
	writeFileSync(bridge, `import { AgentWidget } from ${JSON.stringify(join(dependency, "agent-widget.ts"))};
import { FleetList } from ${JSON.stringify(join(dependency, "fleet-list.ts"))};
export default function() { globalThis.__panelBaseline = { AgentWidget, FleetList }; }`);
	const baselineLoaded = await loadExtensions([bridge], process.cwd());
	assert.deepEqual(baselineLoaded.errors, []);
	const { AgentWidget, FleetList } = globalThis.__panelBaseline;
	delete globalThis.__panelBaseline;
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000 });
	try {
		const manager = { listAgents: () => Array.from({ length: 3 }, (_, n) => ({
			id: `old${n}`, type: "worker", status: "running", startedAt: 1000,
			description: "Tarea", toolUses: 0, isBackground: true, session: {},
		})) };
		const oldUI = { setStatus() {}, setWidget(_key, factory) { factory?.(tui, theme); }, onTerminalInput: () => () => {} };
		const widget = new AgentWidget(manager, new Map());
		const fleet = new FleetList(manager, new Map());
		widget.setUICtx(oldUI);
		fleet.setUICtx(oldUI);
		widget.ensureTimer();
		widget.update();
		fleet.update();
		requests = 0;
		for (let i = 0; i < 50; i++) t.mock.timers.tick(20);
		const baselineRequests = requests;
		assert.equal(baselineRequests, 17);
		widget.dispose();
		fleet.dispose();
		await fire("session_start");
		const agents = [start("a", "Editar 一 🧑‍💻\nsegunda línea"), start("b"), start("c")];
		t.mock.timers.tick(150);
		assert.ok(component);
		for (const width of [0, 1, 10, 30, 48, 80, 120]) {
			for (const line of component.render(width)) {
				assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
				assert.ok(!line.includes("\n"));
			}
		}
		assert.match(component.render(30)[0], /worker/);
		const cached = component.render(80);
		assert.equal(component.render(80), cached);
		component.invalidate();
		assert.notEqual(component.render(80), cached);

		requests = 0;
		for (let i = 0; i < 50; i++) {
			for (const agent of agents) agent.emit({ type: "tool_execution_start", toolCallId: `t${i}`, toolName: "read" });
			t.mock.timers.tick(20);
		}
		assert.ok(requests <= 8, `${requests} repintados/s`);
		t.diagnostic(`Tres agentes y 150 eventos/s: ${requests} solicitudes de repintado/s`);
		t.mock.timers.tick(150);
		requests = 0;
		for (let i = 0; i < 50; i++) t.mock.timers.tick(20);
		assert.equal(requests, 1);
		t.diagnostic(`Tres agentes sin eventos: ${baselineRequests} → ${requests} solicitudes de repintado/s`);

		assert.ok(component.render(120).some((line) => line.includes("↓ o ctrl+shift+r ver conversación")));
		// ↓ solo entra en la lista con el prompt vacío; ↑ en la primera fila sale.
		editorText = "hola";
		assert.equal(input("\u001b[B"), undefined);
		assert.ok(!component.render(80)[0].startsWith("▸"));
		editorText = "";
		assert.equal(input("\u001b[B").consume, true);
		assert.match(component.render(80)[0], /^▸/);
		assert.equal(input("\u001b[A").consume, true);
		assert.ok(!component.render(80)[0].startsWith("▸"));
		assert.equal(input("x"), undefined);
		const shortcut = extension.shortcuts.get("ctrl+shift+r").handler;
		shortcut(ctx);
		assert.equal(input("\u001b[B").consume, true);
		assert.match(component.render(80)[1], /^▸/);
		assert.equal(input("\u001b").consume, true);
		assert.ok(!component.render(80)[1].startsWith("▸"));
		shortcut(ctx);
		overlay = {};
		assert.equal(input("\u001b[B"), undefined);
		assert.ok(!component.render(80)[0].startsWith("▸"));
		overlay = undefined;
		for (let n = 0; n < 5; n++) start(`extra${n}`, `Tarea ${n}`);
		t.mock.timers.tick(150);
		shortcut(ctx);
		for (let n = 0; n < 7; n++) input("\u001b[B");
		assert.ok(component.render(80).some((line) => line.startsWith("▸") && line.includes("Tarea 4")));
		input("\r");
		assert.ok(overlay);
		assert.equal(input("\u001b[B"), undefined);
		requests = 0;
		// La suscripción del visor agrupa los eventos sin retrasar las teclas.
		for (let i = 0; i < 100; i++) emitters.get("extra4").emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } });
		assert.equal(requests, 0);
		t.mock.timers.tick(150);
		assert.equal(requests, 1);
		overlay.handleInput("m");
		assert.equal(requests, 2);
		done();
		await Promise.resolve();
		assert.equal(overlay, undefined);
		const delayed = start("delayed", "Sesión tardía", false);
		t.mock.timers.tick(150);
		assert.equal(delayed.listeners.size, 0);
		delayed.record.session = delayed.session;
		t.mock.timers.tick(1_000);
		assert.equal(delayed.listeners.size, 1);

		for (const [id, agent] of records) {
			agent.status = "completed";
			events.emit("subagents:completed", { ...agent, tokens: { total: 1000 } });
		}
		t.mock.timers.tick(150);
		for (let i = 0; i < 28; i++) t.mock.timers.tick(150);
		assert.equal(component, undefined);
		await fire("session_shutdown");
		assert.equal(input, undefined);
		requests = 0;
		t.mock.timers.tick(60_000);
		assert.equal(requests, 0);
		for (const agent of agents) assert.equal(agent.listeners.size, 0);
		await fire("session_start", { mode: "rpc", hasUI: true });
		start("rpc");
		t.mock.timers.tick(5_000);
		assert.equal(component, undefined);
	} finally {
		await fire("session_shutdown");
		t.mock.timers.reset();
		rmSync(fixture, { recursive: true, force: true });
		globalThis[key] = previous;
	}
});
