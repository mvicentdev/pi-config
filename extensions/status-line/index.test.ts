import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import statusLine from "./index.ts";

const settingsFile = path.join(process.env.PI_CODING_AGENT_DIR!, "status-line.json");
fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
after(() => fs.rmSync(settingsFile, { force: true }));

type Handler = (event: any, ctx: any) => unknown;

// Una pi falsa que guarda lo que la extensión registra, para dispararlo a mano.
function harness(options: { settings?: Record<string, string>; entries?: unknown[]; dirtyFiles?: string; provider?: string } = {}) {
	fs.writeFileSync(settingsFile, JSON.stringify({ lines: "2", ...options.settings }));
	const handlers = new Map<string, Handler>();
	const channels = new Map<string, (data: unknown) => void>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const pi: any = {
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		events: { on: (name: string, handler: (data: unknown) => void) => (channels.set(name, handler), () => channels.delete(name)) },
		exec: async () => ({ code: 0, stdout: options.dirtyFiles ?? "" }),
		getThinkingLevel: () => "high",
		registerCommand: (name: string, command: any) => commands.set(name, command),
	};
	let footer: any;
	let renders = 0;
	const ctx: any = {
		hasUI: true,
		cwd: "/work/app",
		model: { id: "claude-opus", name: "Claude Opus", provider: options.provider ?? "openai", reasoning: true, contextWindow: 200_000 },
		modelRegistry: { isUsingOAuth: () => false, getApiKeyForProvider: async () => undefined },
		sessionManager: {
			getEntries: () => options.entries ?? [],
			getCwd: () => "/work/app",
			getSessionName: () => "sesion",
			getHeader: () => ({ timestamp: new Date(Date.now() - 125_000).toISOString() }),
		},
		getContextUsage: () => ({ percent: 50, tokens: 100_000, contextWindow: 200_000 }),
		ui: {
			theme: { name: "dark", fg: (_color: string, text: string) => text },
			notify() {},
			setTheme() {},
			setFooter: (factory: any) => {
				footer = factory({ requestRender: () => renders++ }, undefined, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map(), getGitBranch: () => "main" });
			},
		},
	};
	statusLine(pi);
	const fire = async (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
	const lines = () => footer.render(400) as string[];
	return { fire, lines, channels, commands, ctx, renders: () => renders, footer: () => footer };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("registra el comando /statusline y los eventos de pi", () => {
	const { commands } = harness();
	assert.ok(commands.has("statusline"));
});

test("sin interfaz no instala el pie", async () => {
	const h = harness();
	h.ctx.hasUI = false;
	await h.fire("session_start");
	assert.equal(h.footer(), undefined);
});

test("el pie termina con una línea vacía y muestra la ubicación y el modelo", async () => {
	const h = harness({ dirtyFiles: " M a.ts\n?? b.ts\n" });
	await h.fire("session_start");
	await tick();
	const lines = h.lines();
	await h.fire("session_shutdown");
	assert.equal(lines.at(-1), "");
	assert.ok(lines[0].includes("/work/app main ±2"));
	assert.ok(lines[0].includes("claude-opus"));
	assert.ok(lines[0].endsWith("sesion"));
});

test("suma tokens y costes de mensajes, resultados de herramientas y compactaciones", async () => {
	const usage = (input: number, output: number, total: number) => ({ input, output, cacheRead: 0, cacheWrite: 0, cost: { total } });
	const entries = [
		{ type: "message", message: { role: "assistant", usage: usage(1000, 500, 0.5) } },
		{ type: "message", message: { role: "toolResult", usage: usage(200, 100, 0.25) } },
		{ type: "message", message: { role: "user", usage: usage(9999, 9999, 9) } },
		{ type: "compaction", usage: usage(10, 5, 0.1) },
		{ type: "label" },
	];
	const h = harness({ entries, settings: { tokens: "↑↓", cost: "sesión+subagentes" } });
	await h.fire("session_start");
	const second = h.lines()[1];
	await h.fire("session_shutdown");
	assert.equal(second, "↑1.2k ↓605 ⟡ $0.850 (⚙ $0.250)");
});

test("cuenta los subagentes según los eventos que publican", async () => {
	const h = harness({ settings: { subagents: "estado" } });
	await h.fire("session_start");
	const publish = (channel: string, id?: string) => h.channels.get(`subagents:${channel}`)!(id ? { id } : undefined);
	publish("created", "a");
	publish("created", "b");
	publish("started", "a");
	assert.ok(h.lines()[1].includes("⚙ ▶1 ⏸1"));
	publish("completed", "a");
	publish("failed", "b");
	publish("created");
	assert.ok(h.lines()[1].includes("⚙ ✓1 ✗1"));
	assert.ok(h.renders() > 0);
	await h.fire("session_shutdown");
	assert.equal(h.channels.size, 0);
});

test("un nuevo session_start reinicia los contadores de subagentes", async () => {
	const h = harness({ settings: { subagents: "estado" } });
	await h.fire("session_start");
	h.channels.get("subagents:completed")!({ id: "a" });
	await h.fire("session_start");
	assert.ok(!h.lines()[1]?.includes("✓"));
	await h.fire("session_shutdown");
});

test("mide el turno, la latencia y la velocidad", async () => {
	const h = harness({ settings: { turn: "on", latency: "on", speed: "on", sessionTime: "on" } });
	await h.fire("session_start");
	await h.fire("agent_start");
	assert.match(h.lines()[1], /⏱ \d+ms/);
	await h.fire("before_provider_request");
	await h.fire("message_update", { assistantMessageEvent: { type: "start" } });
	await h.fire("message_update", { assistantMessageEvent: { type: "text_delta" } });
	await h.fire("message_end", { message: { role: "assistant", usage: { output: 100 } } });
	await h.fire("agent_end");
	const second = h.lines()[1];
	await h.fire("session_shutdown");
	assert.match(second, /⏱ \d+ms/);
	assert.match(second, /ttft \d+ms/);
	assert.match(second, /⌚ 2m/);
	assert.ok(!second.includes("tok/s"), "por debajo de un segundo no hay velocidad");
});

test("el comando /statusline sin interfaz no abre nada", async () => {
	const h = harness();
	h.ctx.hasUI = false;
	await h.commands.get("statusline")!.handler("", h.ctx);
});
