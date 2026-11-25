/**
 * Barra de estado configurable, con la composición de la de gentle-pi (lib/shell-bar.ts de
 * Gentleman-Programming/gentle-pi). `/statusline` elige qué se muestra y con qué colores, que pueden
 * salir de cualquier tema de Ghostty, solo para la barra o para todo pi.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import { activeThemeName, loadTheme, painter, writePiTheme } from "./ghostty.ts";
import { render, type Settings, type Snapshot, type Theme, type Window } from "./segments.ts";
import { ACTIVE_PALETTE, loadSettings, openSettings, PI_PALETTE, saveSettings } from "./settings.ts";

// El mismo endpoint que usa `/usage` de Claude Code; da las ventanas desde el arranque, sin esperar
// a la primera respuesta, e incluye los límites semanales por modelo que las cabeceras no traen.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_EVERY = 60_000;
const LIMIT_LABELS: Record<string, string> = { session: "5h", weekly_all: "7d" };

type Limit = { kind: string; percent: number; resets_at: string | null; scope?: { model?: { display_name?: string | null } } | null };
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
type Entry = { type: string; message?: { role?: string; usage?: Usage }; usage?: Usage };

interface Bar {
	settings: Settings;
	barTheme: Theme | undefined;
	requestRender: () => void;
	dirty: number;
	usage: Window[];
	usageAt: number;
	subagents: { running: Set<string>; queued: Set<string>; done: number; failed: number };
	times: Snapshot["times"];
	costAtTurnStart: number;
	ticker: ReturnType<typeof setInterval> | undefined;
	poller: ReturnType<typeof setInterval> | undefined;
	unsubscribe: Array<() => void>;
}

export default function statusLine(pi: ExtensionAPI) {
	const bar: Bar = {
		settings: loadSettings(),
		barTheme: undefined,
		requestRender: () => {},
		dirty: 0,
		usage: [],
		usageAt: 0,
		subagents: { running: new Set(), queued: new Set(), done: 0, failed: 0 },
		times: { turnStart: null, lastTurn: null, ttft: null, tokensPerSecond: null, sessionStart: null },
		costAtTurnStart: 0,
		ticker: undefined,
		poller: undefined,
		unsubscribe: [],
	};
	registerSessionEvents(pi, bar);
	registerTurnEvents(pi, bar);
	registerStatuslineCommand(pi, bar);
}

function registerSessionEvents(pi: ExtensionAPI, bar: Bar) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		bar.settings = loadSettings();
		const { subagents, times } = bar;
		subagents.running.clear();
		subagents.queued.clear();
		subagents.done = subagents.failed = 0;
		const started = Date.parse(ctx.sessionManager.getHeader()?.timestamp ?? "");
		times.sessionStart = Number.isFinite(started) ? started : Date.now();
		for (const off of bar.unsubscribe) off();
		bar.unsubscribe = trackSubagents(pi, bar);
		void refreshDirty(pi, bar, ctx);
		void refreshUsage(bar, ctx, true);
		// También repinta en reposo: tiempo de sesión y cuenta atrás de los reinicios.
		clearInterval(bar.poller);
		bar.poller = setInterval(() => {
			void refreshUsage(bar, ctx);
			bar.requestRender();
		}, USAGE_EVERY);
		installFooter(pi, bar, ctx);
		applyColors(bar, ctx);
	});

	pi.on("session_shutdown", () => {
		for (const off of bar.unsubscribe) off();
		bar.unsubscribe = [];
		clearInterval(bar.ticker);
		clearInterval(bar.poller);
	});

	pi.on("model_select", (_event, ctx) => void refreshUsage(bar, ctx, true));
	pi.on("turn_end", (_event, ctx) => void refreshUsage(bar, ctx));
}

function registerTurnEvents(pi: ExtensionAPI, bar: Bar) {
	const { times } = bar;
	let requestStart: number | null = null;
	let firstToken: number | null = null;

	pi.on("agent_start", (_event, ctx) => {
		times.turnStart = Date.now();
		const { cost } = buildSnapshot(pi, bar, ctx, new Map(), null);
		bar.costAtTurnStart = cost.session + cost.subagents;
		clearInterval(bar.ticker);
		bar.ticker = setInterval(() => bar.requestRender(), 1000);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (times.turnStart !== null) times.lastTurn = Date.now() - times.turnStart;
		times.turnStart = null;
		clearInterval(bar.ticker);
		void refreshDirty(pi, bar, ctx);
	});

	pi.on("before_provider_request", () => {
		requestStart = Date.now();
		firstToken = null;
	});

	pi.on("message_update", (event) => {
		if (firstToken !== null || requestStart === null || !event.assistantMessageEvent.type.endsWith("_delta")) return;
		firstToken = Date.now();
		times.ttft = firstToken - requestStart;
	});

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; usage?: Usage };
		if (message.role !== "assistant" || firstToken === null) return;
		const seconds = (Date.now() - firstToken) / 1000;
		// Por debajo de un segundo la respuesta llega casi de golpe y la cifra no significa nada.
		if (seconds >= 1 && message.usage?.output) times.tokensPerSecond = message.usage.output / seconds;
	});
}

function registerStatuslineCommand(pi: ExtensionAPI, bar: Bar) {
	pi.registerCommand("statusline", {
		description: "Elegir qué muestra la barra de estado y con qué colores",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await openSettings(ctx, bar.settings, (id, value, preview) => {
				if (preview) return applyColors(bar, ctx, value);
				saveSettings((bar.settings = { ...bar.settings, [id]: value }));
				if (id === "palette" || id === "scope" || id === "accent") applyColors(bar, ctx);
				bar.requestRender();
			});
		},
	});
}

function trackSubagents(pi: ExtensionAPI, bar: Bar): Array<() => void> {
	const { subagents } = bar;
	const track = (channel: string, apply: (id: string) => void) =>
		pi.events.on(`subagents:${channel}`, (data) => {
			const id = (data as { id?: string } | undefined)?.id;
			if (id) apply(id);
			bar.requestRender();
		});
	const finish = (id: string) => subagents.running.delete(id) || subagents.queued.delete(id);
	return [
		track("created", (id) => subagents.running.has(id) || subagents.queued.add(id)),
		track("started", (id) => { subagents.queued.delete(id); subagents.running.add(id); }),
		track("completed", (id) => { finish(id); subagents.done++; }),
		track("failed", (id) => { finish(id); subagents.failed++; }),
	];
}

function installFooter(pi: ExtensionAPI, bar: Bar, ctx: ExtensionContext) {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		bar.requestRender = () => tui.requestRender();
		const off = footerData.onBranchChange(() => void refreshDirty(pi, bar, ctx));
		return {
			dispose: off,
			invalidate() {},
			// ctx.ui.theme y no el tema del constructor: cambia cuando se aplica otro tema. La línea vacía
			// final separa la barra del borde inferior de la ventana (la barra de estado de Orca).
			render: (width: number) => [...render(buildSnapshot(pi, bar, ctx, footerData.getExtensionStatuses(), footerData.getGitBranch()), bar.settings, bar.barTheme ?? ctx.ui.theme, width), ""],
		};
	});
}

async function refreshDirty(pi: ExtensionAPI, bar: Bar, ctx: ExtensionContext) {
	const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
	bar.dirty = result?.code === 0 ? result.stdout.split("\n").filter(Boolean).length : 0;
	bar.requestRender();
}

async function refreshUsage(bar: Bar, ctx: ExtensionContext, force = false) {
	const model = ctx.model;
	if (model?.provider !== "anthropic" || !ctx.modelRegistry.isUsingOAuth(model)) {
		bar.usage = [];
		return bar.requestRender();
	}
	if (!force && Date.now() - bar.usageAt < USAGE_EVERY - 5_000) return;
	bar.usageAt = Date.now();
	const windows = await fetchUsageWindows(ctx);
	if (!windows) return;
	bar.usage = windows;
	bar.requestRender();
}

async function fetchUsageWindows(ctx: ExtensionContext): Promise<Window[] | undefined> {
	const token = await ctx.modelRegistry.getApiKeyForProvider("anthropic").catch(() => undefined);
	if (!token) return undefined;
	const response = await fetch(USAGE_URL, { headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" } }).catch(() => undefined);
	// Un fallo puntual (429, red) deja la última lectura en pantalla.
	if (!response?.ok) return undefined;
	const { limits = [] } = (await response.json().catch(() => ({}))) as { limits?: Limit[] };
	return limits.map((limit) => {
		const scoped = limit.scope?.model?.display_name;
		const reset = Date.parse(limit.resets_at ?? "");
		return {
			label: LIMIT_LABELS[limit.kind] ?? (scoped ? `7d ${scoped}` : limit.kind),
			percent: limit.percent,
			resetAt: Number.isFinite(reset) ? reset : null,
		};
	});
}

function applyColors(bar: Bar, ctx: ExtensionContext, palette = bar.settings.palette) {
	const name = palette === ACTIVE_PALETTE ? activeThemeName() : palette;
	const ghostty = palette === PI_PALETTE || !name ? undefined : loadTheme(name);
	if (palette !== PI_PALETTE && !ghostty) ctx.ui.notify(`No encuentro el tema de Ghostty «${name ?? "activo"}»; uso los colores de pi`, "warning");
	const current = ctx.ui.theme.name;
	if (ghostty && bar.settings.scope === "barra y pi") {
		bar.barTheme = undefined;
		const piTheme = writePiTheme(ghostty, bar.settings.accent);
		if (current !== piTheme) {
			if (current && !current.startsWith("ghostty-")) saveSettings((bar.settings = { ...bar.settings, restoreTheme: current }));
			ctx.ui.setTheme(piTheme);
		}
	} else {
		bar.barTheme = ghostty ? painter(ghostty, bar.settings.accent) : undefined;
		if (current?.startsWith("ghostty-")) ctx.ui.setTheme(bar.settings.restoreTheme ?? "dark");
	}
	bar.requestRender();
}

// Lo mismo que suma `getSessionStats()` de pi (y `/cost`): mensajes, compactaciones y resúmenes.
function sumSessionUsage(entries: Entry[]) {
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	let own = 0;
	let delegated = 0;
	for (const entry of entries) {
		const role = entry.type === "message" ? entry.message?.role : undefined;
		const usage = role === "assistant" || role === "toolResult" ? entry.message?.usage : entry.type === "message" ? undefined : entry.usage;
		if (!usage) continue;
		tokens.input += usage.input ?? 0;
		tokens.output += usage.output ?? 0;
		tokens.cacheRead += usage.cacheRead ?? 0;
		tokens.cacheWrite += usage.cacheWrite ?? 0;
		// pi-subagents (con `reportUsage`) cuelga lo que gastan los subagentes del resultado de una herramienta.
		if (role === "toolResult") delegated += usage.cost?.total ?? 0;
		else own += usage.cost?.total ?? 0;
	}
	return { tokens, own, delegated };
}

function buildSnapshot(pi: ExtensionAPI, bar: Bar, ctx: ExtensionContext, statuses: ReadonlyMap<string, string>, branch: string | null): Snapshot {
	const { tokens, own, delegated } = sumSessionUsage(ctx.sessionManager.getEntries() as Entry[]);
	const model = ctx.model;
	const context = ctx.getContextUsage();
	const home = os.homedir();
	const cwd = ctx.sessionManager.getCwd();
	const { subagents } = bar;
	return {
		now: Date.now(),
		cwd: cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd,
		branch,
		dirty: bar.dirty,
		sessionName: ctx.sessionManager.getSessionName(),
		statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)),
		model: model && { id: model.id, name: model.name, provider: model.provider, reasoning: model.reasoning },
		effort: pi.getThinkingLevel(),
		context: { percent: context?.percent ?? null, tokens: context?.tokens ?? null, window: context?.contextWindow ?? model?.contextWindow ?? 0 },
		tokens,
		cost: { session: own, lastTurn: own + delegated - bar.costAtTurnStart, subagents: delegated },
		subscription: model ? ctx.modelRegistry.isUsingOAuth(model) : false,
		usage: bar.usage,
		subagents: { running: subagents.running.size, queued: subagents.queued.size, done: subagents.done, failed: subagents.failed },
		times: bar.times,
	};
}
