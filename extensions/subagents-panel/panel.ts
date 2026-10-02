/**
 * Dibujo del panel: una línea por agente, con lo que hace a la derecha, y una línea de ayuda.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type Row, activity, formatElapsed, formatTokens } from "./roster.ts";

export interface Theme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** Filas como máximo; el resto se resume en una línea. */
export const MAX_ROWS = 6;
/** Fotogramas del indicador de marcha, uno por segundo. */
const SPINNER = ["◐", "◓", "◑", "◒"];

function icon(row: Row, theme: Theme, frame: number): string {
	switch (row.status) {
		case "running":
			return theme.fg("accent", SPINNER[frame % SPINNER.length]);
		case "completed":
			return theme.fg("success", "✓");
		case "steered":
			return theme.fg("warning", "✓");
		case "stopped":
		case "aborted":
			return theme.fg("dim", "■");
		default:
			return theme.fg("error", "✗");
	}
}

function clean(text: string): string {
	return text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

function rightAlign(left: string, right: string, width: number): string {
	if (width < 48) return truncateToWidth(left, width);
	const rightClamped = truncateToWidth(right, Math.max(0, Math.floor(width * 0.45) - 1));
	const rightW = visibleWidth(rightClamped);
	const leftClamped = truncateToWidth(left, Math.max(0, width - rightW - 1));
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW);
	return truncateToWidth(leftClamped + " ".repeat(gap) + rightClamped, width);
}

function line(row: Row, theme: Theme, width: number, now: number, marked: boolean): string {
	const running = row.status === "running";
	const name = running ? theme.bold(clean(row.type)) : theme.fg("muted", clean(row.type));
	const description = running ? clean(row.description) : theme.fg("dim", clean(row.description));
	const marker = marked ? theme.fg("accent", "▸") : " ";
	const left = `${marker} ${icon(row, theme, Math.floor(now / 1000))} ${name}  ${description}`;
	const stats = [
		row.toolUses ? `${row.toolUses} herr.` : "",
		row.tokens ? formatTokens(row.tokens) : "",
		formatElapsed((row.completedAt ?? now) - row.startedAt),
	].filter(Boolean);
	const doing = clean(activity(row));
	const error = row.status === "error" ? theme.fg("error", ` error${row.error ? `: ${truncateToWidth(clean(row.error), 40)}` : ""}`) : "";
	const right =
		(doing ? theme.fg("muted", truncateToWidth(doing, 40)) + theme.fg("dim", " · ") : "") +
		theme.fg("dim", stats.join(" · ")) +
		error;
	return rightAlign(left, right, width);
}

/** Líneas del panel; vacío cuando no hay nada que mostrar. */
export function render(rows: Row[], theme: Theme, width: number, now: number, selected: number | undefined, hint: string): string[] {
	if (rows.length === 0) return [];
	const offset = Math.floor((selected ?? 0) / MAX_ROWS) * MAX_ROWS;
	const shown = rows.slice(offset, offset + MAX_ROWS);
	const lines = shown.map((row, i) => line(row, theme, width, now, offset + i === selected));
	if (rows.length > shown.length) lines.push(truncateToWidth(theme.fg("dim", `    +${rows.length - shown.length} fuera de vista`), width));
	lines.push(truncateToWidth(theme.fg("dim", `  ${hint}`), width));
	return lines;
}
