/**
 * Rechaza en bash las órdenes que buscan o imprimen ficheros (cat, sed, grep, rg, find, head, tail).
 * Sus salidas llenaban el contexto sin el límite ni la ordenación de read, grep y find, y cada
 * llamada posterior las volvía a leer de la caché. Recortar la salida de otro comando tras una
 * tubería (`docker compose … | tail`) y contar con `… | wc -l` siguen permitidos.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileCommand } from "./guard.ts";

export default function bashGuard(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return undefined;
		const name = fileCommand(String(event.input.command ?? ""));
		if (!name) return undefined;
		return {
			block: true,
			reason: `\`${name}\` is not run through bash: read files with the read tool (offset/limit for a range), search contents with grep and paths with find. Piping another command's output (\`cmd | tail\`) and exact counts (\`… | wc -l\`) are allowed.`,
		};
	});
}
