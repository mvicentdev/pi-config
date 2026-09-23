// Catálogo de lo que la barra puede mostrar y cómo se pinta cada pieza. Todo es puro: recibe una
// instantánea del estado y devuelve texto, así que se prueba sin pi.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface Theme {
	fg(color: string, text: string): string;
}

export interface Window {
	label: string;
	percent: number;
	resetAt: number | null;
}

export interface Snapshot {
	now: number;
	cwd: string;
	branch: string | null;
	dirty: number;
	sessionName: string | undefined;
	statuses: Array<[string, string]>;
	model: { id: string; name: string; provider: string; reasoning: boolean } | undefined;
	effort: string;
	context: { percent: number | null; tokens: number | null; window: number };
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: { session: number; lastTurn: number; subagents: number };
	subscription: boolean;
	usage: Window[];
	subagents: { running: number; queued: number; done: number; failed: number };
	times: { turnStart: number | null; lastTurn: number | null; ttft: number | null; tokensPerSecond: number | null; sessionStart: number | null };
}

export type Settings = Record<string, string>;

export interface Item {
	id: string;
	group: string;
	label: string;
	description: string;
	values: string[];
}

const ON_OFF = ["on", "off"];

// El primer valor de cada fila es el que viene por defecto.
export const ITEMS: Item[] = [
	{ id: "model", group: "Modelo", label: "Modelo", description: "Qué identifica al modelo activo", values: ["id", "nombre", "proveedor/id", "off"] },
	{ id: "effort", group: "Modelo", label: "Effort", description: "Nivel de razonamiento, si el modelo lo admite", values: ON_OFF },
	{ id: "context", group: "Contexto", label: "Contexto", description: "Ocupación de la ventana de contexto", values: ["barra+%", "%", "tokens", "barra+tokens", "off"] },
	{ id: "tokens", group: "Consumo", label: "Tokens", description: "Tokens de la sesión: ↑ entrada, ↓ salida, R/W lectura y escritura de caché", values: ["off", "↑↓", "↑↓+caché", "total"] },
	{ id: "cacheHit", group: "Consumo", label: "Acierto de caché", description: "Parte de la entrada servida desde la caché del proveedor", values: ["off", "on"] },
	{ id: "cost", group: "Consumo", label: "Coste", description: "Gasto en dólares; «sub» si va por suscripción", values: ["sesión", "sesión+turno", "sesión+subagentes", "off"] },
	{ id: "subscription", group: "Consumo", label: "Suscripción", description: "Consumo de la suscripción de Claude: 5 h, 7 días y límites semanales por modelo", values: ["barra+%", "%", "%+reinicio", "off"] },
	{ id: "subagents", group: "Subagentes", label: "Subagentes", description: "▶ en marcha · ⏸ en cola · ✓ terminados · ✗ fallidos", values: ["activos", "estado", "estado+coste", "off"] },
	{ id: "turn", group: "Tiempos", label: "Turno", description: "Duración del turno en curso o del último", values: ["off", "on"] },
	{ id: "latency", group: "Tiempos", label: "Latencia", description: "Tiempo hasta el primer token de la última respuesta", values: ["off", "on"] },
	{ id: "speed", group: "Tiempos", label: "Velocidad", description: "Tokens por segundo de la última respuesta", values: ["off", "on"] },
	{ id: "sessionTime", group: "Tiempos", label: "Sesión", description: "Tiempo desde que empezó la sesión", values: ["off", "on"] },
	{ id: "location", group: "Entorno", label: "Ubicación", description: "Ruta, rama y ficheros modificados (±)", values: ["ruta+rama", "carpeta+rama", "rama", "off"] },
	{ id: "sessionName", group: "Entorno", label: "Nombre de sesión", description: "A la derecha de la barra", values: ON_OFF },
	{ id: "statuses", group: "Entorno", label: "Estados de extensiones", description: "Lo que publican otras extensiones (tasks, ponytail…)", values: ON_OFF },
	{ id: "brand", group: "Presentación", label: "Marca π", description: "Ancla visual al inicio", values: ON_OFF },
	{ id: "lines", group: "Presentación", label: "Líneas", description: "1: una línea, que se parte en dos si no cabe. 2: siempre dos, arriba entorno y modelo; abajo consumo, subagentes y tiempos", values: ["1", "2"] },
	{ id: "separator", group: "Presentación", label: "Separador", description: "Entre segmentos", values: ["⟡", "│", "·"] },
];

export const DEFAULTS: Settings = Object.fromEntries(ITEMS.map((item) => [item.id, item.values[0]]));

const BRANCH_MAX = 15;
const CELLS = 8;

type Render = (s: Snapshot, value: string, t: Theme, compact: boolean) => string | undefined;

const RENDER: Record<string, Render> = {
	brand: (_s, _v, t) => t.fg("accent", "π"),
	location: (s, value, t, compact) => {
		let branch = s.branch;
		if (compact && branch && branch.length > BRANCH_MAX) branch = `${branch.slice(0, BRANCH_MAX - 1)}…`;
		const folder = s.cwd.split("/").filter(Boolean).pop() ?? s.cwd;
		const place = value === "rama" ? "" : t.fg("muted", value === "carpeta+rama" || compact ? folder : s.cwd);
		const parts = [place, branch ? t.fg("text", branch) : "", s.dirty ? t.fg("warning", `±${s.dirty}`) : ""].filter(Boolean);
		return parts.join(" ") || undefined;
	},
	model: (s, value, t) => {
		if (!s.model) return t.fg("text", "no-model");
		const label = value === "nombre" ? s.model.name : value === "proveedor/id" ? `${s.model.provider}/${s.model.id}` : s.model.id;
		return t.fg("text", label);
	},
	effort: (s, _v, t) => (s.model?.reasoning ? t.fg("syntaxFunction", s.effort) : undefined),
	context: (s, value, t) => {
		const { percent, tokens, window } = s.context;
		const pct = t.fg("text", percent === null ? "?%" : `${Math.round(percent)}%`);
		const count = t.fg("text", `${tokens === null ? "?" : formatTokens(tokens)}/${formatTokens(window)}`);
		const body = { "barra+%": `${gauge(percent, t)} ${pct}`, "%": pct, tokens: count, "barra+tokens": `${gauge(percent, t)} ${count}` }[value];
		return `${t.fg("muted", "ctx")} ${body}`;
	},
	tokens: (s, value, t) => {
		const { input, output, cacheRead, cacheWrite } = s.tokens;
		if (value === "total") return `${t.fg("muted", "tok")} ${t.fg("text", formatTokens(input + output + cacheRead + cacheWrite))}`;
		const io = t.fg("text", `↑${formatTokens(input)} ↓${formatTokens(output)}`);
		return value === "↑↓+caché" ? `${io} ${t.fg("muted", `R${formatTokens(cacheRead)} W${formatTokens(cacheWrite)}`)}` : io;
	},
	cacheHit: (s, _v, t) => {
		const read = s.tokens.cacheRead;
		const total = read + s.tokens.input + s.tokens.cacheWrite;
		return total ? `${t.fg("muted", "caché")} ${t.fg("text", `${Math.round((read / total) * 100)}%`)}` : undefined;
	},
	cost: (s, value, t) => {
		const session = t.fg("text", formatCost(s.cost.session + s.cost.subagents, s.subscription));
		if (value === "sesión+turno") return `${session} ${t.fg("muted", `(turno ${formatCost(s.cost.lastTurn, false)})`)}`;
		if (value === "sesión+subagentes" && s.cost.subagents) return `${session} ${t.fg("muted", `(⚙ ${formatCost(s.cost.subagents, false)})`)}`;
		return session;
	},
	subscription: (s, value, t) => {
		const [first, ...rest] = s.usage;
		if (!first) return undefined;
		const pct = (w: Window) => t.fg(w.percent >= 80 ? tone(w.percent) : "text", `${Math.round(w.percent)}%`);
		const reset = (w: Window) => (value === "%+reinicio" && w.resetAt ? ` ${t.fg("dim", `↻${formatDuration(w.resetAt - s.now, true)}`)}` : "");
		const head = `${t.fg("muted", first.label)} ${value === "barra+%" ? `${gauge(first.percent, t)} ` : ""}${pct(first)}${reset(first)}`;
		return [head, ...rest.map((w) => `${t.fg("dim", "·")} ${t.fg("muted", w.label)} ${pct(w)}${reset(w)}`)].join(" ");
	},
	subagents: (s, value, t) => {
		const { running, queued, done, failed } = s.subagents;
		if (value === "activos") return running + queued ? t.fg("accent", `⚙ ${running + queued}`) : undefined;
		if (!running && !queued && !done && !failed) return undefined;
		const parts = [
			running ? t.fg("accent", `▶${running}`) : "",
			queued ? t.fg("muted", `⏸${queued}`) : "",
			done ? t.fg("success", `✓${done}`) : "",
			failed ? t.fg("error", `✗${failed}`) : "",
			value === "estado+coste" && s.cost.subagents ? t.fg("muted", formatCost(s.cost.subagents, false)) : "",
		];
		return `${t.fg("muted", "⚙")} ${parts.filter(Boolean).join(" ")}`;
	},
	turn: (s, _v, t) => {
		if (s.times.turnStart !== null) return t.fg("accent", `⏱ ${formatDuration(s.now - s.times.turnStart)}`);
		return s.times.lastTurn === null ? undefined : t.fg("muted", `⏱ ${formatDuration(s.times.lastTurn)}`);
	},
	latency: (s, _v, t) => (s.times.ttft === null ? undefined : `${t.fg("muted", "ttft")} ${t.fg("text", formatDuration(s.times.ttft))}`),
	speed: (s, _v, t) => (s.times.tokensPerSecond === null ? undefined : t.fg("text", `${Math.round(s.times.tokensPerSecond)} tok/s`)),
	sessionTime: (s, _v, t) => (s.times.sessionStart === null ? undefined : t.fg("muted", `⌚ ${formatDuration(s.now - s.times.sessionStart, true)}`)),
	statuses: (s, _v, t) => {
		const texts = s.statuses.map(([, text]) => t.fg("muted", plain(text))).filter((text) => visibleWidth(text) > 0);
		return texts.length ? texts.join(` ${t.fg("dim", "·")} `) : undefined;
	},
};

// Orden en la barra. En 2 líneas, la segunda empieza en «tokens».
const LINE_ONE = ["brand", "location", "model", "context"];
const LINE_TWO = ["tokens", "cacheHit", "cost", "subscription", "subagents", "turn", "latency", "speed", "sessionTime", "statuses"];

function segments(ids: string[], s: Snapshot, settings: Settings, t: Theme, compact: boolean): string[] {
	return ids.flatMap((id) => {
		if (settings[id] === "off") return [];
		if (id === "model") {
			const model = RENDER.model(s, settings.model, t, compact);
			const effort = settings.effort === "on" ? RENDER.effort(s, "on", t, compact) : undefined;
			return [[model, effort].filter(Boolean).join(` ${t.fg("muted", "·")} `)];
		}
		const text = RENDER[id](s, settings[id], t, compact);
		return text ? [text] : [];
	});
}

export function render(s: Snapshot, settings: Settings, t: Theme, width: number): string[] {
	const withoutDuplicate = settings.subagents === "off" ? s : { ...s, statuses: s.statuses.filter(([key]) => key !== "subagents") };
	const right = settings.sessionName === "on" && s.sessionName ? t.fg("dim", s.sessionName) : "";
	const build = (ids: string[]) => (compact: boolean) => segments(ids, withoutDuplicate, settings, t, compact);
	const all = [...LINE_ONE, ...LINE_TWO];
	const fitsOne = visibleWidth(join(build(all)(true), settings.separator, t)) <= width;
	const lines = settings.lines === "2" || !fitsOne ? [LINE_ONE, LINE_TWO] : [all];
	return lines
		.map((ids, index) => fit(build(ids), index === 0 ? right : "", settings.separator, t, width))
		.filter((line, index) => index === 0 || visibleWidth(line) > 0);
}

function join(parts: string[], separator: string, t: Theme): string {
	return parts.join(` ${t.fg("dim", separator)} `);
}

// Si no cabe: ruta abreviada y rama recortada; después caen segmentos por la cola.
function fit(build: (compact: boolean) => string[], right: string, separator: string, t: Theme, width: number): string {
	let parts = build(false);
	let left = join(parts, separator, t);
	if (right && visibleWidth(left) + 2 + visibleWidth(right) <= width) {
		return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
	}
	if (visibleWidth(left) > width) left = join((parts = build(true)), separator, t);
	while (parts.length > 1 && visibleWidth(left) > width) left = join((parts = parts.slice(0, -1)), separator, t);
	return truncateToWidth(left, width, "…");
}

function gauge(percent: number | null, t: Theme): string {
	const value = Math.max(0, Math.min(100, percent ?? 0));
	const filled = Math.round((value / 100) * CELLS);
	return t.fg(tone(percent), "▰".repeat(filled)) + t.fg("border", "▱".repeat(CELLS - filled));
}

function tone(percent: number | null): string {
	return percent === null ? "dim" : percent >= 95 ? "error" : percent >= 80 ? "warning" : "accent";
}

export function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCost(total: number, subscription: boolean): string {
	const amount = total >= 1 ? total.toFixed(2) : total.toFixed(3);
	return subscription ? `$${amount} sub` : `$${amount}`;
}

/** 850ms · 12s · 4m05s · 1h05m; con `coarse`, sin segundos por encima del minuto. */
export function formatDuration(ms: number, coarse = false): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (ms < 1000 && !coarse) return `${Math.max(0, Math.round(ms))}ms`;
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return coarse ? `${minutes}m` : `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
	if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}h`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

// Algunas extensiones pintan su propio estado; la barra manda en la paleta.
function plain(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
}
