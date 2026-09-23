// Vista previa de la barra con datos simulados, sin pi ni llamadas al modelo:
//   node --no-warnings extensions/status-line/preview.ts [ancho] ["tema de Ghostty"]
// Pinta la barra por defecto y con todo activo, en 1 y 2 líneas, y comprueba que los temas de
// Ghostty instalados se leen. pi solo carga index.ts, así que este fichero no le afecta.
import { execSync } from "node:child_process";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// segments.ts usa pi-tui, que vive dentro de la instalación global de pi.
const tui = `${execSync("npm root -g").toString().trim()}/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js`;
registerHooks({ resolve: (specifier, context, next) => (specifier === "@earendil-works/pi-tui" ? { url: pathToFileURL(tui).href, shortCircuit: true } : next(specifier, context)) });
const { DEFAULTS, formatDuration, render } = await import("./segments.ts");
const { activeThemeName, listThemes, loadTheme, painter } = await import("./ghostty.ts");

const width = Number(process.argv[2]) || process.stdout.columns || 120;
const now = Date.now();
const snapshot = {
	now,
	cwd: "~/apps/work/ad-studio/backend",
	branch: "feature/status-line-selector",
	dirty: 3,
	sessionName: "mi-sesion",
	statuses: [["subagents", "2 running agents"], ["tasks", "tasks 1/3"]] as Array<[string, string]>,
	model: { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic", reasoning: true },
	effort: "high",
	context: { percent: 87, tokens: 174_000, window: 200_000 },
	tokens: { input: 12_000, output: 45_000, cacheRead: 880_000, cacheWrite: 60_000 },
	cost: { session: 1.234, lastTurn: 0.12, subagents: 0.4 },
	subscription: true,
	usage: [{ label: "5h", percent: 30, resetAt: now + 7_800_000 }, { label: "7d", percent: 96, resetAt: now + 3 * 86_400_000 }],
	subagents: { running: 2, queued: 1, done: 5, failed: 1 },
	times: { turnStart: now - 75_000, lastTurn: 42_000, ttft: 850, tokensPerSecond: 64.2, sessionStart: now - 3_900_000 },
};
const everything = { ...DEFAULTS, tokens: "↑↓+caché", cacheHit: "on", cost: "sesión+subagentes", subscription: "%+reinicio", subagents: "estado+coste", turn: "on", latency: "on", speed: "on", sessionTime: "on" };

const name = process.argv[3] ?? activeThemeName();
const ghostty = name ? loadTheme(name) : undefined;
const theme = ghostty ? painter(ghostty, "magenta") : { fg: (_role: string, text: string) => text };
const show = (title: string, settings: Record<string, string>) => console.log(`\n${title}\n${render(snapshot, settings, theme, width).join("\n")}`);

console.log(`Paleta: ${ghostty?.name ?? "sin color"} · ancho ${width}`);
show("Por defecto", DEFAULTS);
show("Todo, 1 línea", everything);
show("Todo, 2 líneas", { ...everything, lines: "2" });

const plain = { fg: (_role: string, text: string) => text };
const line = (settings: Record<string, string>, w = 400) => render(snapshot, { ...DEFAULTS, ...settings }, plain, w);
assert.ok(line({})[0].includes("ctx ▰▰▰▰▰▰▰▱ 87%"));
assert.ok(line({ context: "tokens" })[0].includes("ctx 174k/200k"));
assert.ok(line({ subagents: "estado" })[0].includes("⚙ ▶2 ⏸1 ✓5 ✗1"));
assert.ok(!line({})[0].includes("2 running agents"), "el estado de subagents no se duplica");
assert.equal(line({ lines: "2" }).length, 2);
assert.ok(line({}, 40)[0].length <= 40);
const narrow = line({ subscription: "%" }, 90);
assert.equal(narrow.length, 2, "con una línea que no cabe, se parte en dos en vez de perder segmentos");
assert.ok(narrow[1].includes("5h 30%"), "el consumo de la suscripción sigue a la vista");
assert.equal(formatDuration(3 * 86_400_000 + 7_200_000, true), "3d02h");
assert.deepEqual(listThemes().filter((theme) => !loadTheme(theme)), [], "todos los temas de Ghostty se leen");
console.log("\nComprobaciones: OK");
