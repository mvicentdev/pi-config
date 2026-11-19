/**
 * Rechaza en bash las órdenes que buscan o imprimen ficheros (cat, sed, grep, rg, find, head, tail).
 * Sus salidas llenaban el contexto sin el límite ni la ordenación de read, grep y find, y cada
 * llamada posterior las volvía a leer de la caché. Recortar la salida de otro comando tras una
 * tubería (`docker compose … | tail`) y contar con `… | wc -l` siguen permitidos.
 * El aviso dice que no corrió nada de la orden, para que el agente no compruebe qué se ejecutó.
 * La línea de bash del prompt deja de citar grep y find como ejemplos.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileCommand } from "./guard.ts";

const DEFAULT_SNIPPET = "- bash: Execute bash commands (ls, grep, find, etc.)";
const GUARDED_SNIPPET =
	"- bash: Execute bash commands (git, builds, tests, scripts). Read, search and list files with read, grep and find.";

export default function bashGuard(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		if (!event.systemPrompt.includes(DEFAULT_SNIPPET)) return undefined;
		return { systemPrompt: event.systemPrompt.replace(DEFAULT_SNIPPET, GUARDED_SNIPPET) };
	});

	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return undefined;
		const name = fileCommand(String(event.input.command ?? ""));
		if (!name) return undefined;
		return {
			block: true,
			reason: `Blocked before running: no part of this command ran. Rerun the other parts on their own. \`${name}\` is not run through bash: read files with the read tool (offset/limit for a range), search contents with the grep tool and paths with the find tool. Piping another command's output (\`cmd | tail\`), exact counts (\`… | wc -l\`) and \`cat > file\` writes are allowed.`,
		};
	});
}
