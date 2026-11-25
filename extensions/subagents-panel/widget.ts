import type { Component } from "@earendil-works/pi-tui";
import { type Theme, render } from "./panel.ts";
import type { Row } from "./roster.ts";
import { SHORTCUT, type Selection } from "./selection.ts";

/** El componente reutiliza las líneas mientras no cambien la versión, el ancho ni la fila elegida. */
export function createWidgetComponent(deps: {
	theme: Theme;
	rows(): Row[];
	selection: Selection;
	version(): number;
	onDispose(): void;
}): Component & { dispose(): void } {
	const { selection } = deps;
	let cache = { version: -1, width: -1, selected: selection.index, lines: [] as string[] };
	return {
		render(width) {
			const version = deps.version();
			if (cache.version === version && cache.width === width && cache.selected === selection.index) return cache.lines;
			const rows = deps.rows();
			selection.clamp(rows.length);
			const hint = selection.index === undefined ? `↓ o ${SHORTCUT} ver conversación` : "↑/↓ elegir · Enter abrir · Esc salir";
			const lines = render(rows, deps.theme, width, Date.now(), selection.index, hint);
			cache = { version, width, selected: selection.index, lines };
			return lines;
		},
		invalidate() { cache.version = -1; },
		dispose: deps.onDispose,
	};
}
