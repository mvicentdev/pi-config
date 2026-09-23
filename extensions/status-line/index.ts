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

export default function statusLine(pi: ExtensionAPI) {
	let settings = loadSettings();
	let barTheme: Theme | undefined;
	let requestRender = () => {};
	let ticker: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: Array<() => void> = [];

	let dirty = 0;
	let usage: Window[] = [];
	let usageAt = 0;
	let poller: ReturnType<typeof setInterval> | undefined;
	const subagents = { running: new Set<string>(), queued: new Set<string>(), done: 0, failed: 0 };
	const times: Snapshot["times"] = { turnStart: null, lastTurn: null, ttft: null, tokensPerSecond: null, sessionStart: null };
	let requestStart: number | null = null;
	let firstToken: number | null = null;
	let costAtTurnStart = 0;

	const refreshDirty = async (ctx: ExtensionContext) => {
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
		dirty = result?.code === 0 ? result.stdout.split("\n").filter(Boolean).length : 0;
		requestRender();
	};

	const refreshUsage = async (ctx: ExtensionContext, force = false) => {
		const model = ctx.model;
		if (model?.provider !== "anthropic" || !ctx.modelRegistry.isUsingOAuth(model)) {
			usage = [];
			return requestRender();
		}
		if (!force && Date.now() - usageAt < USAGE_EVERY - 5_000) return;
		usageAt = Date.now();
		const token = await ctx.modelRegistry.getApiKeyForProvider("anthropic").catch(() => undefined);
		if (!token) return;
		const response = await fetch(USAGE_URL, { headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" } }).catch(() => undefined);
		// Un fallo puntual (429, red) deja la última lectura en pantalla.
		if (!response?.ok) return;
		const { limits = [] } = (await response.json().catch(() => ({}))) as { limits?: Limit[] };
		usage = limits.map((limit) => {
			const scoped = limit.scope?.model?.display_name;
			const reset = Date.parse(limit.resets_at ?? "");
			return {
				label: LIMIT_LABELS[limit.kind] ?? (scoped ? `7d ${scoped}` : limit.kind),
				percent: limit.percent,
				resetAt: Number.isFinite(reset) ? reset : null,
			};
		});
		requestRender();
	};

	// Colores: la barra pinta con la paleta de Ghostty elegida o con el tema de pi, y con
	// «barra y pi» esa paleta se convierte en el tema de pi.
	const applyColors = (ctx: ExtensionContext, palette = settings.palette) => {
		const name = palette === ACTIVE_PALETTE ? activeThemeName() : palette;
		const ghostty = palette === PI_PALETTE || !name ? undefined : loadTheme(name);
		if (palette !== PI_PALETTE && !ghostty) ctx.ui.notify(`No encuentro el tema de Ghostty «${name ?? "activo"}»; uso los colores de pi`, "warning");
		const current = ctx.ui.theme.name;
		if (ghostty && settings.scope === "barra y pi") {
			barTheme = undefined;
			const piTheme = writePiTheme(ghostty, settings.accent);
			if (current !== piTheme) {
				if (current && !current.startsWith("ghostty-")) saveSettings((settings = { ...settings, restoreTheme: current }));
				ctx.ui.setTheme(piTheme);
			}
		} else {
			barTheme = ghostty ? painter(ghostty, settings.accent) : undefined;
			if (current?.startsWith("ghostty-")) ctx.ui.setTheme(settings.restoreTheme ?? "dark");
		}
		requestRender();
	};

	const snapshot = (ctx: ExtensionContext, statuses: ReadonlyMap<string, string>, branch: string | null): Snapshot => {
		const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		let own = 0;
		let delegated = 0;
		// Lo mismo que suma `getSessionStats()` de pi (y `/cost`): mensajes, compactaciones y resúmenes.
		for (const entry of ctx.sessionManager.getEntries() as Entry[]) {
			const role = entry.type === "message" ? entry.message?.role : undefined;
			const u = role === "assistant" || role === "toolResult" ? entry.message?.usage : entry.type === "message" ? undefined : entry.usage;
			if (!u) continue;
			tokens.input += u.input ?? 0;
			tokens.output += u.output ?? 0;
			tokens.cacheRead += u.cacheRead ?? 0;
			tokens.cacheWrite += u.cacheWrite ?? 0;
			// pi-subagents (con `reportUsage`) cuelga lo que gastan los subagentes del resultado de una herramienta.
			if (role === "toolResult") delegated += u.cost?.total ?? 0;
			else own += u.cost?.total ?? 0;
		}
		const model = ctx.model;
		const context = ctx.getContextUsage();
		const home = os.homedir();
		const cwd = ctx.sessionManager.getCwd();
		return {
			now: Date.now(),
			cwd: cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd,
			branch,
			dirty,
			sessionName: ctx.sessionManager.getSessionName(),
			statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)),
			model: model && { id: model.id, name: model.name, provider: model.provider, reasoning: model.reasoning },
			effort: pi.getThinkingLevel(),
			context: { percent: context?.percent ?? null, tokens: context?.tokens ?? null, window: context?.contextWindow ?? model?.contextWindow ?? 0 },
			tokens,
			cost: { session: own, lastTurn: own + delegated - costAtTurnStart, subagents: delegated },
			subscription: model ? ctx.modelRegistry.isUsingOAuth(model) : false,
			usage,
			subagents: { running: subagents.running.size, queued: subagents.queued.size, done: subagents.done, failed: subagents.failed },
			times,
		};
	};

	const totalCost = (ctx: ExtensionContext) => {
		const s = snapshot(ctx, new Map(), null);
		return s.cost.session + s.cost.subagents;
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		settings = loadSettings();
		subagents.running.clear();
		subagents.queued.clear();
		subagents.done = subagents.failed = 0;
		const started = Date.parse(ctx.sessionManager.getHeader()?.timestamp ?? "");
		times.sessionStart = Number.isFinite(started) ? started : Date.now();
		for (const off of unsubscribe) off();
		const track = (channel: string, apply: (id: string) => void) =>
			pi.events.on(`subagents:${channel}`, (data) => {
				const id = (data as { id?: string } | undefined)?.id;
				if (id) apply(id);
				requestRender();
			});
		const finish = (id: string) => subagents.running.delete(id) || subagents.queued.delete(id);
		unsubscribe = [
			track("created", (id) => subagents.running.has(id) || subagents.queued.add(id)),
			track("started", (id) => { subagents.queued.delete(id); subagents.running.add(id); }),
			track("completed", (id) => { finish(id); subagents.done++; }),
			track("failed", (id) => { finish(id); subagents.failed++; }),
		];
		void refreshDirty(ctx);
		void refreshUsage(ctx, true);
		// También repinta en reposo: tiempo de sesión y cuenta atrás de los reinicios.
		clearInterval(poller);
		poller = setInterval(() => {
			void refreshUsage(ctx);
			requestRender();
		}, USAGE_EVERY);
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			const off = footerData.onBranchChange(() => void refreshDirty(ctx));
			return {
				dispose: off,
				invalidate() {},
				// ctx.ui.theme y no el tema del constructor: cambia cuando se aplica otro tema.
				render: (width: number) => render(snapshot(ctx, footerData.getExtensionStatuses(), footerData.getGitBranch()), settings, barTheme ?? ctx.ui.theme, width),
			};
		});
		applyColors(ctx);
	});

	pi.on("session_shutdown", () => {
		for (const off of unsubscribe) off();
		unsubscribe = [];
		clearInterval(ticker);
		clearInterval(poller);
	});

	pi.on("model_select", (_event, ctx) => void refreshUsage(ctx, true));
	pi.on("turn_end", (_event, ctx) => void refreshUsage(ctx));

	pi.on("agent_start", (_event, ctx) => {
		times.turnStart = Date.now();
		costAtTurnStart = totalCost(ctx);
		clearInterval(ticker);
		ticker = setInterval(() => requestRender(), 1000);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (times.turnStart !== null) times.lastTurn = Date.now() - times.turnStart;
		times.turnStart = null;
		clearInterval(ticker);
		void refreshDirty(ctx);
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

	pi.registerCommand("statusline", {
		description: "Elegir qué muestra la barra de estado y con qué colores",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await openSettings(ctx, settings, (id, value, preview) => {
				if (preview) return applyColors(ctx, value);
				saveSettings((settings = { ...settings, [id]: value }));
				if (id === "palette" || id === "scope" || id === "accent") applyColors(ctx);
				requestRender();
			});
		},
	});
}
