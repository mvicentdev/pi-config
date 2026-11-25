/** Panel compacto bajo el editor. ↓ con el prompt vacío o Ctrl+Shift+R elige un agente y abre el visor de pi-subagents. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "./panel.ts";
import { LINGER_MS, Roster, type Status } from "./roster.ts";
import { SHORTCUT, createSelection } from "./selection.ts";
import { agentRecord, createSessionTracker } from "./tracker.ts";
import { REPAINT_MS, showConversation } from "./viewer.ts";
import { createWidgetComponent } from "./widget.ts";

const WIDGET_KEY = "subagents-panel";

interface LifecycleEvent {
	id: string;
	type: string;
	description: string;
	status?: Status;
	toolUses?: number;
	tokens?: { total: number };
	error?: string;
}

export default function (pi: ExtensionAPI) {
	let roster = new Roster();
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let shown = false;
	let version = 0;
	let closeViewer: (() => void) | undefined;
	let viewerOpen = false;
	let coalesce: ReturnType<typeof setTimeout> | undefined;
	let tick: ReturnType<typeof setInterval> | undefined;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const lifecycle: (() => void)[] = [];
	const requestRender = () => tui?.requestRender();

	const tracker = createSessionTracker(() => roster, () => invalidate());
	const selection = createSelection({
		rows: () => roster.visible(),
		requestRender,
		/** El editor tiene el teclado: ni un diálogo ni un overlay lo han sustituido. */
		editorFocused() {
			const focused = (tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
			return !tui?.hasOverlay() && (focused == null || focused instanceof Editor);
		},
		editorEmpty: () => ctx?.ui.getEditorText() === "",
		open: (id) => void openViewer(id),
	});

	function later(callback: () => void, delay: number) {
		const timer = setTimeout(() => {
			timers.delete(timer);
			callback();
		}, delay);
		timers.add(timer);
		return timer;
	}

	function invalidate() {
		version++;
		coalesce ??= later(() => {
			coalesce = undefined;
			tracker.attach();
			syncWidget();
			requestRender();
		}, REPAINT_MS);
	}

	function syncWidget() {
		if (!ctx || ctx.mode !== "tui") return;
		const visible = roster.visible().length > 0;
		if (visible !== shown) {
			shown = visible;
			if (visible) ctx.ui.setWidget(WIDGET_KEY, component, { placement: "belowEditor" });
			else {
				selection.leave();
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			}
		}
		if (roster.hasRunning()) {
			tick ??= setInterval(() => {
				tracker.attach();
				version++;
				requestRender();
			}, 1_000);
		} else if (tick) {
			clearInterval(tick);
			tick = undefined;
		}
	}

	function component(widgetTui: TUI, theme: Theme) {
		tui = widgetTui;
		return createWidgetComponent({
			theme,
			selection,
			rows: () => roster.visible(),
			version: () => version,
			onDispose() { if (tui === widgetTui) tui = undefined; },
		});
	}

	function finished(data: unknown) {
		const agent = data as LifecycleEvent;
		roster.finish(agent.id, agent.status ?? "completed", {
			toolUses: agent.toolUses, tokens: agent.tokens?.total, error: agent.error,
		});
		tracker.release(agent.id);
		invalidate();
		later(() => { roster.prune(); invalidate(); }, LINGER_MS);
	}

	function dispose() {
		closeViewer?.();
		selection.leave();
		for (const unsubscribe of lifecycle.splice(0)) unsubscribe();
		tracker.releaseAll();
		for (const timer of timers) clearTimeout(timer);
		timers.clear();
		if (tick) clearInterval(tick);
		tick = coalesce = undefined;
		ctx = undefined;
		tui = undefined;
	}

	async function openViewer(id: string) {
		const ui = ctx?.ui;
		const agent = agentRecord(id);
		const session = agent?.session;
		if (!ui || !agent || !session) {
			ui?.notify("La sesión de ese agente aún no está disponible.", "info");
			return;
		}
		viewerOpen = true;
		try {
			await showConversation(ui, pi.events, agent, session, (close) => { closeViewer = close; });
		} catch (error) {
			if (ctx) ui.notify(String(error), "error");
		} finally {
			viewerOpen = false;
			closeViewer = undefined;
		}
	}

	pi.on("session_start", (_event, startCtx) => {
		dispose();
		roster = new Roster();
		if (startCtx.mode !== "tui") return;
		ctx = startCtx;
		shown = false;
		lifecycle.push(
			pi.events.on("subagents:started", (data) => {
				roster.start(data as LifecycleEvent);
				tracker.attach();
				invalidate();
			}),
			pi.events.on("subagents:completed", finished),
			pi.events.on("subagents:failed", finished),
			startCtx.ui.onTerminalInput((data) => viewerOpen ? undefined : selection.handleInput(data)),
		);
	});
	pi.on("session_shutdown", dispose);

	pi.registerShortcut(SHORTCUT, {
		description: "Abrir la conversación de un subagente",
		handler(shortcutCtx) {
			if (shortcutCtx.mode !== "tui" || viewerOpen) return;
			ctx = shortcutCtx;
			const rows = roster.visible();
			if (!rows.length) { ctx.ui.notify("No hay subagentes visibles.", "info"); return; }
			if (selection.index !== undefined) return selection.leave();
			if (rows.length === 1) return void openViewer(rows[0].id);
			selection.begin();
		},
	});
}
