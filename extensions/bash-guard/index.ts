// Bloquea en bash leer ficheros de un repositorio: llenaba el contexto sin límite y cada llamada lo releía de la caché.
// Fuera de un repositorio fff no indexa y la orden corre. El aviso dice que nada corrió, para que el agente no lo compruebe.
// El prompt pide rutas absolutas porque los `cd` a otra copia causaban la mayoría de los bloqueos.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { credentialsPathReason, credentialsReason } from "./credentials.ts";
import { blockReason, fileCommand } from "./guard.ts";

const DEFAULT_SNIPPET = "- bash: Execute bash commands (ls, grep, find, etc.)";
const GUARDED_SNIPPET =
	"- bash: Execute bash commands (git, builds, tests, scripts). Read, search and list files with read, grep and find, with absolute paths for another directory.";

export default function bashGuard(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		if (!event.systemPrompt.includes(DEFAULT_SNIPPET)) return undefined;
		return { systemPrompt: event.systemPrompt.replace(DEFAULT_SNIPPET, GUARDED_SNIPPET) };
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "bash") {
			const path = typeof event.input.path === "string" ? event.input.path : undefined;
			const reason = credentialsPathReason(event.toolName, path, homedir(), ctx.cwd);
			return reason ? { block: true, reason } : undefined;
		}
		const credentials = credentialsReason(String(event.input.command ?? ""));
		if (credentials) return { block: true, reason: credentials };
		const blocked = fileCommand(String(event.input.command ?? ""), ctx.cwd);
		if (!blocked) return undefined;
		return { block: true, reason: blockReason(blocked, ctx.cwd) };
	});
}
