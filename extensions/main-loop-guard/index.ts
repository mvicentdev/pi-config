// El bucle principal no escribe código ni pruebas: un subagente `worker` los construye en su propio contexto.
// La regla escrita no bastaba, así que edit y write la aplican sobre ficheros de un repositorio que no son markdown.
// Cada agente de agents/ la excluye con exclude_extensions, así que solo actúa en el bucle principal.
// Las escrituras por bash (sed -i, cat >, tee) quedan fuera.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { editReason } from "./guard.ts";

export default function mainLoopGuard(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		const reason = editReason(event.toolName, event.input.path, ctx.cwd);
		return reason ? { block: true, reason } : undefined;
	});
}
