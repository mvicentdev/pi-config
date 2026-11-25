import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";
import type { Row } from "./roster.ts";

export const SHORTCUT = "ctrl+shift+r";

export interface Selection {
	/** Fila elegida, o `undefined` si el teclado sigue en el editor. */
	index: number | undefined;
	begin(): void;
	leave(): void;
	clamp(rowCount: number): void;
	handleInput(data: string): { consume: true } | undefined;
}

export function createSelection(deps: {
	rows(): Row[];
	requestRender(): void;
	editorFocused(): boolean;
	editorEmpty(): boolean;
	open(id: string): void;
}): Selection {
	const selection: Selection = {
		index: undefined,
		begin() {
			selection.index = 0;
			deps.requestRender();
		},
		leave() {
			if (selection.index === undefined) return;
			selection.index = undefined;
			deps.requestRender();
		},
		clamp(rowCount) {
			if (selection.index !== undefined) selection.index = Math.min(selection.index, Math.max(0, rowCount - 1));
		},
		handleInput(data) {
			if (isKeyRelease(data)) return;
			if (!deps.editorFocused()) { selection.leave(); return; }
			const rows = deps.rows();
			if (!rows.length) { selection.leave(); return; }
			if (selection.index === undefined) {
				if (!matchesKey(data, "down") || !deps.editorEmpty()) return;
				selection.begin();
				return { consume: true };
			}
			selection.clamp(rows.length);
			const index = selection.index;
			if (matchesKey(data, "up")) {
				if (index === 0) selection.leave();
				else selection.index = index - 1;
			} else if (matchesKey(data, "down")) selection.index = Math.min(index + 1, rows.length - 1);
			else if (matchesKey(data, "enter")) {
				selection.leave();
				deps.open(rows[index].id);
			} else if (matchesKey(data, "escape") || matchesKey(data, SHORTCUT)) selection.leave();
			else { selection.leave(); return; }
			deps.requestRender();
			return { consume: true };
		},
	};
	return selection;
}
