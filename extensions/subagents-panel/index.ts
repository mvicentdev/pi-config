/** Panel compacto bajo el editor; ↓ con el prompt vacío o Ctrl+Shift+R elige un agente y abre el visor de pi-subagents. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, isKeyRelease, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import { ConversationViewer } from "@tintinweb/pi-subagents/src/ui/conversation-viewer.ts";
import type { AgentRecord } from "@tintinweb/pi-subagents/src/types.ts";
import { type Theme, render } from "./panel.ts";
import { LINGER_MS, Roster, type Status } from "./roster.ts";

const WIDGET_KEY = "subagents-panel";
const SHORTCUT = "ctrl+shift+r";
const COALESCE_MS = 150;

interface LifecycleEvent {
	id: string;
	type: string;
	description: string;
	status?: Status;
	toolUses?: number;
	tokens?: { total: number };
	error?: string;
}

function record(id: string): AgentRecord | undefined {
	const registry = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents:manager")] as
		{ getRecord(id: string): AgentRecord | undefined } | undefined;
	return registry?.getRecord(id);
}

export default function (pi: ExtensionAPI) {
	let roster = new Roster();
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let shown = false;
	let version = 0;
	let selected: number | undefined;
	let closeViewer: (() => void) | undefined;
	let viewerOpen = false;
	let coalesce: ReturnType<typeof setTimeout> | undefined;
	let tick: ReturnType<typeof setInterval> | undefined;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const subscriptions = new Map<string, () => void>();
	const lifecycle: (() => void)[] = [];

	function later(callback: () => void, delay: number) {
		const timer = setTimeout(() => {
			timers.delete(timer);
			callback();
		}, delay);
		timers.add(timer);
		return timer;
	}

	function attachSessions() {
		for (const row of roster.all()) {
			if (row.status !== "running") continue;
			const agent = record(row.id);
			if (!agent) continue;
			row.startedAt = agent.startedAt;
			row.toolUses = agent.toolUses;
			const usage = agent.lifetimeUsage;
			row.tokens = usage.input + usage.output + usage.cacheWrite;
			const session = agent.session;
			if (!session || subscriptions.has(row.id)) continue;
			subscriptions.set(row.id, session.subscribe((event) => {
				if (roster.apply(row.id, event)) invalidate();
			}));
		}
	}

	function invalidate() {
		version++;
		coalesce ??= later(() => {
			coalesce = undefined;
			attachSessions();
			syncWidget();
			tui?.requestRender();
		}, COALESCE_MS);
	}

	function syncWidget() {
		if (!ctx || ctx.mode !== "tui") return;
		const visible = roster.visible().length > 0;
		if (visible !== shown) {
			shown = visible;
			if (visible) ctx.ui.setWidget(WIDGET_KEY, component, { placement: "belowEditor" });
			else {
				leaveSelection();
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			}
		}
		if (roster.hasRunning()) {
			tick ??= setInterval(() => {
				attachSessions();
				version++;
				tui?.requestRender();
			}, 1_000);
		} else if (tick) {
			clearInterval(tick);
			tick = undefined;
		}
	}

	function component(widgetTui: TUI, theme: Theme): Component & { dispose(): void } {
		tui = widgetTui;
		let cache = { version: -1, width: -1, selected, lines: [] as string[] };
		return {
			render(width) {
				if (cache.version === version && cache.width === width && cache.selected === selected) return cache.lines;
				const rows = roster.visible();
				if (selected !== undefined) selected = Math.min(selected, Math.max(0, rows.length - 1));
				const hint = selected === undefined ? `↓ o ${SHORTCUT} ver conversación` : "↑/↓ elegir · Enter abrir · Esc salir";
				const lines = render(rows, theme, width, Date.now(), selected, hint);
				cache = { version, width, selected, lines };
				return lines;
			},
			invalidate() { cache.version = -1; },
			dispose() { if (tui === widgetTui) tui = undefined; },
		};
	}

	function finished(data: unknown) {
		const agent = data as LifecycleEvent;
		roster.finish(agent.id, agent.status ?? "completed", {
			toolUses: agent.toolUses, tokens: agent.tokens?.total, error: agent.error,
		});
		subscriptions.get(agent.id)?.();
		subscriptions.delete(agent.id);
		invalidate();
		later(() => { roster.prune(); invalidate(); }, LINGER_MS);
	}

	function dispose() {
		closeViewer?.();
		leaveSelection();
		for (const unsubscribe of lifecycle.splice(0)) unsubscribe();
		for (const unsubscribe of subscriptions.values()) unsubscribe();
		subscriptions.clear();
		for (const timer of timers) clearTimeout(timer);
		timers.clear();
		if (tick) clearInterval(tick);
		tick = coalesce = undefined;
		ctx = undefined;
		tui = undefined;
	}

	pi.on("session_start", (_event, startCtx) => {
		dispose();
		roster = new Roster();
		if (startCtx.mode !== "tui") return;
		ctx = startCtx;
		shown = false;
		lifecycle.push(
			pi.events.on("subagents:started", (data) => {
				const agent = data as LifecycleEvent;
				roster.start(agent);
				attachSessions();
				invalidate();
			}),
			pi.events.on("subagents:completed", finished),
			pi.events.on("subagents:failed", finished),
			startCtx.ui.onTerminalInput(handleInput),
		);
	});
	pi.on("session_shutdown", dispose);

	function leaveSelection() {
		if (selected === undefined) return;
		selected = undefined;
		tui?.requestRender();
	}

	/** El editor tiene el teclado: ni un diálogo ni un overlay lo han sustituido. */
	function editorFocused(): boolean {
		const focused = (tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
		return !tui?.hasOverlay() && (focused == null || focused instanceof Editor);
	}

	function handleInput(data: string) {
		if (viewerOpen || isKeyRelease(data)) return;
		if (!editorFocused()) { leaveSelection(); return; }
		const rows = roster.visible();
		if (!rows.length) { leaveSelection(); return; }
		if (selected === undefined) {
			// Como en Claude Code: ↓ con el prompt vacío entra en la lista.
			if (!matchesKey(data, "down") || ctx?.ui.getEditorText() !== "") return;
			selected = 0;
			tui?.requestRender();
			return { consume: true };
		}
		selected = Math.min(selected, rows.length - 1);
		if (matchesKey(data, "up")) {
			if (selected === 0) leaveSelection();
			else selected--;
		} else if (matchesKey(data, "down")) selected = Math.min(selected + 1, rows.length - 1);
		else if (matchesKey(data, "enter")) {
			const id = rows[selected].id;
			leaveSelection();
			void openViewer(id);
		} else if (matchesKey(data, "escape") || matchesKey(data, SHORTCUT)) leaveSelection();
		else { leaveSelection(); return; }
		tui?.requestRender();
		return { consume: true };
	}

	async function openViewer(id: string) {
		const ui = ctx?.ui;
		const agent = record(id);
		const session = agent?.session;
		if (!ui || !agent || !session) {
			ui?.notify("La sesión de ese agente aún no está disponible.", "info");
			return;
		}
		viewerOpen = true;
		try {
			await ui.custom<undefined>((viewerTui, theme, keybindings, done) => {
				let repaint: ReturnType<typeof setTimeout> | undefined;
				// El visor conserva su caché Markdown; agrupamos sus repintados de streaming.
				const batchedTui = new Proxy(viewerTui, {
					get(target, key) {
						if (key !== "requestRender") return Reflect.get(target, key);
						return () => { repaint ??= setTimeout(() => { repaint = undefined; viewerTui.requestRender(); }, COALESCE_MS); };
					},
				});
				closeViewer = () => done(undefined);
				const viewer = new ConversationViewer(batchedTui, session, agent, undefined, theme, done,
					() => pi.events.emit("subagents:rpc:stop", { requestId: `panel-${Date.now()}`, agentId: id }),
					keybindings, (message) => void session.steer(message).catch((error) => ui.notify(String(error), "error")));
				return {
					render: (width) => viewer.render(width),
					invalidate: () => viewer.invalidate(),
					handleInput(data) { viewer.handleInput(data); viewerTui.requestRender(); },
					dispose() { if (repaint) clearTimeout(repaint); viewer.dispose(); },
				};
			}, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } });
		} catch (error) {
			if (ctx) ui.notify(String(error), "error");
		} finally {
			viewerOpen = false;
			closeViewer = undefined;
		}
	}

	pi.registerShortcut(SHORTCUT, {
		description: "Abrir la conversación de un subagente",
		handler(shortcutCtx) {
			if (shortcutCtx.mode !== "tui" || viewerOpen) return;
			ctx = shortcutCtx;
			const rows = roster.visible();
			if (!rows.length) { ctx.ui.notify("No hay subagentes visibles.", "info"); return; }
			if (selected !== undefined) return leaveSelection();
			if (rows.length === 1) return void openViewer(rows[0].id);
			selected = 0;
			tui?.requestRender();
		},
	});
}
