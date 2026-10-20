/**
 * Ancho máximo de pi, centrado. Pi compone cada línea con `TuiMainScreen.render(ancho)`: aquí se
 * compone con el ancho máximo y se antepone el margen que lo centra en el terminal. Las ventanas
 * superpuestas se colocan dentro de esa misma columna. En pantalla completa (`TuiAltScreen`, el modo por
 * defecto desde pi 1.2) el terminal informa del ancho máximo, la salida se desplaza con el margen y los
 * clics de ratón lo descuentan. `/max-width 120` lo fija, `/max-width left`
 * pasa al 100 % del terminal alineado a la izquierda, `/max-width center` vuelve al ancho guardado y
 * `/max-width off` lo quita; se guarda en max-width.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "max-width.json");
const MIN = 40;

// El estado vive en globalThis para que un /reload no envuelva `render` dos veces.
// ponytail: en el modo regular los clics de ratón no descuentan el margen.
const state = ((globalThis as any).__piMaxWidth ??= {
	columns: 0,
	left: false,
	original: TuiMainScreen.prototype.render,
});
// Aparte, porque un estado guardado por una versión anterior no lo tiene.
state.originalLayout ??= (TuiMainScreen.prototype as any).resolveOverlayLayout;
const padOf = (width: number) => Math.floor((width - state.columns) / 2);
TuiMainScreen.prototype.render = function (width: number) {
	if (state.left || !state.columns || width <= state.columns) return state.original.call(this, width);
	const pad = " ".repeat(padOf(width));
	return state.original.call(this, state.columns).map((line: string) => pad + line);
};
// Las ventanas superpuestas (ask_user_question, /btw…) se resuelven sobre la columna y se
// desplazan con el mismo margen.
(TuiMainScreen.prototype as any).resolveOverlayLayout = function (options: unknown, height: number, width: number, rows: number) {
	if (state.left || !state.columns || width <= state.columns) return state.originalLayout.call(this, options, height, width, rows);
	const layout = state.originalLayout.call(this, options, height, state.columns, rows);
	return { ...layout, col: layout.col + padOf(width) };
};

// Pantalla completa: un proxy del terminal informa del ancho máximo y desplaza cada `CSI fila;col H`.
state.originalAltRender ??= (TuiAltScreen.prototype as any).doRender;
state.originalAltInput ??= (TuiAltScreen.prototype as any).handleTerminalInput;
const altPad = (real: number) => (state.left || !state.columns || real <= state.columns ? 0 : padOf(real));
const narrowed = (real: any) =>
	new Proxy(real, {
		get(target, key) {
			if (key === "columns") return altPad(target.columns) ? state.columns : target.columns;
			if (key === "write")
				return (data: string) => {
					const pad = altPad(target.columns);
					target.write(pad ? data.replace(/\x1b\[(\d+);(\d+)H/g, (_, row, col) => `\x1b[${row};${Number(col) + pad}H`) : data);
				};
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
(TuiAltScreen.prototype as any).doRender = function () {
	if (!this.__maxWidthReal) {
		this.__maxWidthReal = this.terminal;
		this.terminal = narrowed(this.terminal);
	}
	const pad = altPad(this.__maxWidthReal.columns);
	if (pad !== this.__maxWidthPad) {
		this.__maxWidthPad = pad;
		this.resetRenderState();
	}
	return state.originalAltRender.call(this);
};
(TuiAltScreen.prototype as any).handleTerminalInput = function (data: string) {
	const pad = this.__maxWidthReal ? altPad(this.__maxWidthReal.columns) : 0;
	const shift = (x: number) => Math.min(state.columns, Math.max(1, x - pad));
	if (pad) {
		data = data.replace(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/, (_, b, x, y, end) => `\x1b[<${b};${shift(Number(x))};${y}${end}`);
		if (data.length === 6 && data.startsWith("\x1b[M"))
			data = data.slice(0, 4) + String.fromCharCode(shift(data.charCodeAt(4) - 32) + 32) + data.slice(5);
	}
	return state.originalAltInput.call(this, data);
};

export default function maxWidth(pi: ExtensionAPI) {
	try {
		const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
		state.columns = Number(saved.columns) || 0;
		state.left = saved.align === "left";
	} catch {}
	const save = () =>
		fs.writeFileSync(FILE, `${JSON.stringify({ columns: state.columns, align: state.left ? "left" : "center" }, null, "\t")}\n`);

	pi.registerCommand("max-width", {
		description: "Ancho máximo de pi: /max-width 120 (centrado), /max-width left (100 %), /max-width center, /max-width off",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (value === "left" || value === "center") {
				state.left = value === "left";
				save();
				process.stdout.emit("resize");
				return ctx.ui.notify(
					state.left || !state.columns ? "Ancho al 100 %, alineado a la izquierda" : `Ancho máximo: ${state.columns} columnas, centrado`,
					"info",
				);
			}
			const columns = value === "off" ? 0 : Number(value);
			if (!Number.isInteger(columns) || columns < 0 || (columns > 0 && columns < MIN)) {
				const current = state.left ? "100 % a la izquierda" : state.columns ? `${state.columns}, centrado` : "sin límite";
				return ctx.ui.notify(`Ancho actual: ${current}. Uso: /max-width <${MIN} o más> | left | center | off`, "info");
			}
			state.columns = columns;
			state.left = false;
			save();
			// Un redimensionado fuerza el repintado completo.
			process.stdout.emit("resize");
			ctx.ui.notify(columns ? `Ancho máximo: ${columns} columnas` : "Ancho sin límite", "info");
		},
	});
}
