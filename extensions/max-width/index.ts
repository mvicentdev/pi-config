/**
 * Ancho máximo de pi, centrado. Pi compone cada línea con `TuiMainScreen.render(ancho)`: aquí se
 * compone con el ancho máximo y se antepone el margen que lo centra en el terminal. Las ventanas
 * superpuestas siguen centradas sobre el terminal entero. `/max-width 120` lo fija y
 * `/max-width off` lo quita; se guarda en max-width.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen } from "@earendil-works/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "max-width.json");
const MIN = 40;

// El estado vive en globalThis para que un /reload no envuelva `render` dos veces.
// ponytail: solo el modo regular; con `tuiMode: fullscreen` (TuiAltScreen) no se limita, y los
// clics de ratón no descuentan el margen.
const state = ((globalThis as any).__piMaxWidth ??= { columns: 0, original: TuiMainScreen.prototype.render });
TuiMainScreen.prototype.render = function (width: number) {
	if (!state.columns || width <= state.columns) return state.original.call(this, width);
	const pad = " ".repeat(Math.floor((width - state.columns) / 2));
	return state.original.call(this, state.columns).map((line: string) => pad + line);
};

export default function maxWidth(pi: ExtensionAPI) {
	try {
		state.columns = Number(JSON.parse(fs.readFileSync(FILE, "utf8")).columns) || 0;
	} catch {}

	pi.registerCommand("max-width", {
		description: "Ancho máximo de pi en columnas, centrado: /max-width 120, /max-width off",
		handler: async (args, ctx) => {
			const value = args.trim();
			const columns = value === "off" ? 0 : Number(value);
			if (!Number.isInteger(columns) || columns < 0 || (columns > 0 && columns < MIN)) {
				return ctx.ui.notify(`Ancho actual: ${state.columns || "sin límite"}. Uso: /max-width <${MIN} o más> | off`, "info");
			}
			state.columns = columns;
			fs.writeFileSync(FILE, `${JSON.stringify({ columns }, null, "\t")}\n`);
			// Un redimensionado fuerza el repintado completo.
			process.stdout.emit("resize");
			ctx.ui.notify(columns ? `Ancho máximo: ${columns} columnas` : "Ancho sin límite", "info");
		},
	});
}
