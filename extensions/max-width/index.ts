// Ancho máximo centrado: `TuiMainScreen.render(ancho)` se llama con el máximo y se antepone el margen.
// En pantalla completa (`TuiAltScreen`, por defecto desde pi 1.2) el terminal informa del máximo,
// la salida se desplaza con el margen y los clics lo descuentan.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { readJson, stateFile, writeJson } from "../shared/state-file.ts";
import { MIN, padOf, parseWidthArgument, shiftColumn } from "./width.ts";

const FILE = stateFile("max-width.json");

// El estado vive en globalThis para que un /reload no envuelva `render` dos veces.
// ponytail: en el modo regular los clics de ratón no descuentan el margen.
const state = ((globalThis as any).__piMaxWidth ??= {
	columns: 0,
	left: false,
	original: TuiMainScreen.prototype.render,
});
// Aparte, porque un estado guardado por una versión anterior no lo tiene.
state.originalLayout ??= (TuiMainScreen.prototype as any).resolveOverlayLayout;
TuiMainScreen.prototype.render = function (width: number) {
	if (state.left || !state.columns || width <= state.columns) return state.original.call(this, width);
	const pad = " ".repeat(padOf(width, state.columns));
	return state.original.call(this, state.columns).map((line: string) => pad + line);
};
// Las ventanas superpuestas se resuelven sobre la columna y se desplazan con el mismo margen.
(TuiMainScreen.prototype as any).resolveOverlayLayout = function (options: unknown, height: number, width: number, rows: number) {
	if (state.left || !state.columns || width <= state.columns) return state.originalLayout.call(this, options, height, width, rows);
	const layout = state.originalLayout.call(this, options, height, state.columns, rows);
	return { ...layout, col: layout.col + padOf(width, state.columns) };
};

// Pantalla completa: un proxy del terminal informa del ancho máximo y desplaza cada `CSI fila;col H`.
state.originalAltRender ??= (TuiAltScreen.prototype as any).doRender;
state.originalAltInput ??= (TuiAltScreen.prototype as any).handleTerminalInput;
const altPad = (real: number) => (state.left || !state.columns || real <= state.columns ? 0 : padOf(real, state.columns));
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
	const shift = (x: number) => shiftColumn(x, pad, state.columns);
	if (pad) {
		data = data.replace(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/, (_, b, x, y, end) => `\x1b[<${b};${shift(Number(x))};${y}${end}`);
		if (data.length === 6 && data.startsWith("\x1b[M"))
			data = data.slice(0, 4) + String.fromCharCode(shift(data.charCodeAt(4) - 32) + 32) + data.slice(5);
	}
	return state.originalAltInput.call(this, data);
};

export default function maxWidth(pi: ExtensionAPI) {
	const saved = readJson(FILE);
	if (saved) {
		state.columns = Number(saved.columns) || 0;
		state.left = saved.align === "left";
	}
	const save = () => writeJson(FILE, { columns: state.columns, align: state.left ? "left" : "center" });

	pi.registerCommand("max-width", {
		description: "Ancho máximo de pi: /max-width 120 (centrado), /max-width left (100 %), /max-width center, /max-width off",
		handler: async (args, ctx) => {
			const request = parseWidthArgument(args.trim());
			if (request && "align" in request) {
				state.left = request.align === "left";
				save();
				process.stdout.emit("resize");
				return ctx.ui.notify(
					state.left || !state.columns ? "Ancho al 100 %, alineado a la izquierda" : `Ancho máximo: ${state.columns} columnas, centrado`,
					"info",
				);
			}
			if (!request) {
				const current = state.left ? "100 % a la izquierda" : state.columns ? `${state.columns}, centrado` : "sin límite";
				return ctx.ui.notify(`Ancho actual: ${current}. Uso: /max-width <${MIN} o más> | left | center | off`, "info");
			}
			const { columns } = request;
			state.columns = columns;
			state.left = false;
			save();
			// Un redimensionado fuerza el repintado completo.
			process.stdout.emit("resize");
			ctx.ui.notify(columns ? `Ancho máximo: ${columns} columnas` : "Ancho sin límite", "info");
		},
	});
}
