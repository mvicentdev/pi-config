import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, ITEMS, render, type Settings, type Snapshot, type Theme } from "./segments.ts";

const plain: Theme = { fg: (_color, text) => text };
const tagged: Theme = { fg: (color, text) => `<${color}>${text}</${color}>` };

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
	now: 10_000_000,
	cwd: "~/projects/my-app",
	branch: "main",
	dirty: 0,
	sessionName: undefined,
	statuses: [],
	model: { id: "claude-opus", name: "Claude Opus", provider: "anthropic", reasoning: true },
	effort: "high",
	context: { percent: 50, tokens: 100_000, window: 200_000 },
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	cost: { session: 0, lastTurn: 0, subagents: 0 },
	subscription: false,
	usage: [],
	subagents: { running: 0, queued: 0, done: 0, failed: 0 },
	times: { turnStart: null, lastTurn: null, ttft: null, tokensPerSecond: null, sessionStart: null },
	...overrides,
});

// Una sola pieza visible: el resto apagado, para leer lo que pinta cada una.
const only = (id: string, value: string, s: Snapshot, theme: Theme = plain, extra: Settings = {}) => {
	const settings: Settings = { ...DEFAULTS, ...Object.fromEntries(ITEMS.map((item) => [item.id, "off"])), separator: "│", lines: "1", [id]: value, ...extra };
	return render(s, settings, theme, 400)[0] || undefined;
};

test("los valores por defecto son el primero de cada fila", () => {
	for (const item of ITEMS) assert.equal(DEFAULTS[item.id], item.values[0]);
	assert.equal(DEFAULTS.model, "id");
	assert.equal(DEFAULTS.tokens, "off");
	assert.equal(DEFAULTS.lines, "1");
	assert.equal(DEFAULTS.separator, "⟡");
});

test("la marca pinta π con el acento", () => {
	assert.equal(only("brand", "on", snapshot(), tagged), "<accent>π</accent>");
});

test("el modelo se muestra por id, nombre o proveedor/id", () => {
	assert.equal(only("model", "id", snapshot()), "claude-opus");
	assert.equal(only("model", "nombre", snapshot()), "Claude Opus");
	assert.equal(only("model", "proveedor/id", snapshot()), "anthropic/claude-opus");
});

test("sin modelo se escribe no-model", () => {
	assert.equal(only("model", "id", snapshot({ model: undefined })), "no-model");
});

test("el effort se une al modelo solo si el modelo razona", () => {
	assert.equal(only("model", "id", snapshot(), plain, { effort: "on" }), "claude-opus · high");
	const noReasoning = snapshot({ model: { id: "m", name: "M", provider: "p", reasoning: false } });
	assert.equal(only("model", "id", noReasoning, plain, { effort: "on" }), "m");
});

test("el contexto dibuja la barra y el porcentaje", () => {
	assert.equal(only("context", "barra+%", snapshot()), "ctx ▰▰▰▰▱▱▱▱ 50%");
	assert.equal(only("context", "%", snapshot()), "ctx 50%");
	assert.equal(only("context", "%", snapshot({ context: { percent: null, tokens: null, window: 0 } })), "ctx ?%");
});

test("el contexto en tokens abrevia cifras", () => {
	assert.equal(only("context", "tokens", snapshot()), "ctx 100k/200k");
	assert.equal(only("context", "barra+tokens", snapshot()), "ctx ▰▰▰▰▱▱▱▱ 100k/200k");
	assert.equal(only("context", "tokens", snapshot({ context: { percent: null, tokens: null, window: 1_000_000 } })), "ctx ?/1.0M");
});

test("la barra cambia de color al 80 % y al 95 %", () => {
	const gaugeColor = (percent: number) => only("context", "barra+%", snapshot({ context: { percent, tokens: 1, window: 2 } }), tagged).match(/<(\w+)>▰/)?.[1];
	assert.equal(gaugeColor(79), "accent");
	assert.equal(gaugeColor(80), "warning");
	assert.equal(gaugeColor(95), "error");
});

test("los tokens se formatean por tramos", () => {
	const tokens = (input: number) => only("tokens", "↑↓", snapshot({ tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 } }));
	assert.equal(tokens(999), "↑999 ↓0");
	assert.equal(tokens(1000), "↑1.0k ↓0");
	assert.equal(tokens(9_900), "↑9.9k ↓0");
	assert.equal(tokens(10_000), "↑10k ↓0");
	assert.equal(tokens(174_400), "↑174k ↓0");
	assert.equal(tokens(1_500_000), "↑1.5M ↓0");
});

test("los tokens admiten caché y total", () => {
	const s = snapshot({ tokens: { input: 12_000, output: 45_000, cacheRead: 880_000, cacheWrite: 60_000 } });
	assert.equal(only("tokens", "↑↓+caché", s), "↑12k ↓45k R880k W60k");
	assert.equal(only("tokens", "total", s), "tok 997k");
});

test("el acierto de caché es la lectura sobre la entrada total", () => {
	assert.equal(only("cacheHit", "on", snapshot({ tokens: { input: 10, output: 5, cacheRead: 80, cacheWrite: 10 } })), "caché 80%");
	assert.equal(only("cacheHit", "on", snapshot()), undefined);
});

test("el coste usa dos decimales desde un dólar y tres por debajo", () => {
	const cost = (session: number, subscription = false) => only("cost", "sesión", snapshot({ cost: { session, lastTurn: 0, subagents: 0 }, subscription }));
	assert.equal(cost(1.234), "$1.23");
	assert.equal(cost(0.12), "$0.120");
	assert.equal(cost(0.12, true), "$0.120 sub");
});

test("el coste suma subagentes y añade turno o subagentes según el valor", () => {
	const s = snapshot({ cost: { session: 1, lastTurn: 0.25, subagents: 0.5 } });
	assert.equal(only("cost", "sesión", s), "$1.50");
	assert.equal(only("cost", "sesión+turno", s), "$1.50 (turno $0.250)");
	assert.equal(only("cost", "sesión+subagentes", s), "$1.50 (⚙ $0.500)");
	assert.equal(only("cost", "sesión+subagentes", snapshot()), "$0.000");
});

test("la suscripción muestra ventanas con barra, porcentaje y reinicio", () => {
	const usage = [{ label: "5h", percent: 30, resetAt: 10_000_000 + 7_800_000 }, { label: "7d", percent: 96, resetAt: null }];
	const s = snapshot({ usage });
	assert.equal(only("subscription", "%", s), "5h 30% · 7d 96%");
	assert.equal(only("subscription", "barra+%", s), "5h ▰▰▱▱▱▱▱▱ 30% · 7d 96%");
	assert.equal(only("subscription", "%+reinicio", s), "5h 30% ↻2h10m · 7d 96%");
	assert.equal(only("subscription", "off", s), undefined);
	assert.equal(only("subscription", "%", snapshot()), undefined);
});

test("el reinicio de la suscripción no muestra segundos", () => {
	const s = snapshot({ usage: [{ label: "5h", percent: 10, resetAt: 10_000_000 + 7_800_000 }] });
	assert.equal(only("subscription", "%+reinicio", s), "5h 10% ↻2h10m");
});

test("la suscripción colorea el porcentaje desde el 80 %", () => {
	const s = snapshot({ usage: [{ label: "5h", percent: 85, resetAt: null }] });
	assert.ok(only("subscription", "%", s, tagged).includes("<warning>85%</warning>"));
});

test("los subagentes: activos suma en marcha y en cola", () => {
	assert.equal(only("subagents", "activos", snapshot({ subagents: { running: 2, queued: 1, done: 5, failed: 1 } })), "⚙ 3");
	assert.equal(only("subagents", "activos", snapshot({ subagents: { running: 0, queued: 0, done: 5, failed: 1 } })), undefined);
});

test("los subagentes: estado y coste", () => {
	const s = snapshot({ subagents: { running: 2, queued: 1, done: 5, failed: 1 }, cost: { session: 0, lastTurn: 0, subagents: 0.4 } });
	assert.equal(only("subagents", "estado", s), "⚙ ▶2 ⏸1 ✓5 ✗1");
	assert.equal(only("subagents", "estado+coste", s), "⚙ ▶2 ⏸1 ✓5 ✗1 $0.400");
	assert.equal(only("subagents", "estado", snapshot()), undefined);
});

test("el turno cuenta el en curso y, si no hay, el último", () => {
	const times = { turnStart: null, lastTurn: null, ttft: null, tokensPerSecond: null, sessionStart: null };
	assert.equal(only("turn", "on", snapshot({ times: { ...times, turnStart: 10_000_000 - 75_000 } }), tagged), "<accent>⏱ 1m15s</accent>");
	assert.equal(only("turn", "on", snapshot({ times: { ...times, lastTurn: 42_000 } }), tagged), "<muted>⏱ 42s</muted>");
	assert.equal(only("turn", "on", snapshot()), undefined);
});

test("la duración usa ms, s, m, h y d", () => {
	const lastTurn = (ms: number) => only("turn", "on", snapshot({ times: { turnStart: null, lastTurn: ms, ttft: null, tokensPerSecond: null, sessionStart: null } }));
	assert.equal(lastTurn(850), "⏱ 850ms");
	assert.equal(lastTurn(12_000), "⏱ 12s");
	assert.equal(lastTurn(245_000), "⏱ 4m05s");
	assert.equal(lastTurn(3_900_000), "⏱ 1h05m");
	assert.equal(lastTurn(3 * 86_400_000 + 7_200_000), "⏱ 3d02h");
});

test("el tiempo de sesión es grueso: sin segundos desde el minuto", () => {
	const since = (ms: number) => only("sessionTime", "on", snapshot({ times: { turnStart: null, lastTurn: null, ttft: null, tokensPerSecond: null, sessionStart: 10_000_000 - ms } }));
	assert.equal(since(500), "⌚ 0s");
	assert.equal(since(245_000), "⌚ 4m");
	assert.equal(since(3_900_000), "⌚ 1h05m");
});

test("latencia y velocidad", () => {
	const times = { turnStart: null, lastTurn: null, ttft: 850, tokensPerSecond: 64.2, sessionStart: null };
	assert.equal(only("latency", "on", snapshot({ times })), "ttft 850ms");
	assert.equal(only("speed", "on", snapshot({ times })), "64 tok/s");
	assert.equal(only("latency", "on", snapshot()), undefined);
	assert.equal(only("speed", "on", snapshot()), undefined);
});

test("la ubicación combina ruta, rama y ficheros modificados", () => {
	const s = snapshot({ dirty: 3 });
	assert.equal(only("location", "ruta+rama", s), "~/projects/my-app main ±3");
	assert.equal(only("location", "carpeta+rama", s), "my-app main ±3");
	assert.equal(only("location", "rama", s), "main ±3");
	assert.equal(only("location", "rama", snapshot({ branch: null })), undefined);
});

test("los estados de extensiones pierden el color propio y se unen", () => {
	const s = snapshot({ statuses: [["tasks", "\x1b[31mtasks   1/3\x1b[0m"], ["empty", "  "]] });
	assert.equal(only("statuses", "on", s), "tasks 1/3");
	assert.equal(only("statuses", "on", snapshot({ statuses: [["a", "uno"], ["b", "dos"]] })), "uno · dos");
});

test("el estado de subagents no se duplica salvo que la pieza esté apagada", () => {
	const s = snapshot({ statuses: [["subagents", "2 running"], ["tasks", "t"]], subagents: { running: 2, queued: 0, done: 0, failed: 0 } });
	assert.ok(!only("statuses", "on", s, plain, { subagents: "activos" })?.includes("2 running"));
	assert.equal(only("statuses", "on", s, plain, { subagents: "off" }), "2 running · t");
});

test("el nombre de sesión va a la derecha de la primera línea", () => {
	const s = snapshot({ sessionName: "mi-sesion" });
	const [line] = render(s, { ...DEFAULTS, sessionName: "on" }, plain, 100);
	assert.equal(line.length, 100);
	assert.ok(line.endsWith("mi-sesion"));
	assert.ok(!render(s, { ...DEFAULTS, sessionName: "off" }, plain, 100)[0].includes("mi-sesion"));
});

test("una línea que no cabe se parte en dos con lines=1", () => {
	const s = snapshot({ tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } });
	const settings = { ...DEFAULTS, tokens: "↑↓+caché", cost: "sesión+turno", subscription: "%" };
	assert.equal(render(s, settings, plain, 400).length, 1);
	const narrow = render(s, settings, plain, 60);
	assert.equal(narrow.length, 2);
	assert.ok(narrow[1].startsWith("↑1 ↓1"));
});

test("lines=2 separa entorno y consumo", () => {
	const s = snapshot({ tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
	const lines = render(s, { ...DEFAULTS, tokens: "↑↓", lines: "2" }, plain, 400);
	assert.equal(lines.length, 2);
	assert.ok(lines[0].startsWith("π"));
	assert.equal(lines[1], "↑1 ↓1 ⟡ $0.000");
});

test("la segunda línea vacía se descarta", () => {
	assert.equal(render(snapshot(), { ...DEFAULTS, cost: "off", lines: "2" }, plain, 400).length, 1);
});

test("con poco ancho caen piezas por la cola y la ruta se abrevia a la carpeta", () => {
	assert.equal(render(snapshot(), { ...DEFAULTS, lines: "1" }, plain, 4)[0], "π");
	assert.equal(render(snapshot(), { ...DEFAULTS, lines: "1" }, plain, 24)[0], "π ⟡ my-app main");
});

test("si ni la primera pieza cabe se trunca con elipsis", () => {
	const settings = { ...DEFAULTS, brand: "off", model: "off", context: "off", cost: "off", lines: "1" };
	assert.equal(render(snapshot(), settings, plain, 10)[0].replace(/\x1b\[0m/g, ""), "my-app ma…");
});
