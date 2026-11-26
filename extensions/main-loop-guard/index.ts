// El bucle principal no escribe código ni pruebas: un subagente `worker` los construye en su propio contexto.
// La regla escrita no bastaba, así que edit y write la aplican sobre ficheros de un repositorio que no son markdown.
// lsp_fix también, cuando escribe el arreglo en el fichero (write: true).
// Cada agente de agents/ la excluye con exclude_extensions, así que solo actúa en el bucle principal.
// Las escrituras por bash (sed -i, cat >, tee) quedan fuera.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { toolCallReason } from "./guard.ts";

export default function mainLoopGuard(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		const reason = toolCallReason(event.toolName, event.input, ctx.cwd);
		return reason ? { block: true, reason } : undefined;
	});
}
