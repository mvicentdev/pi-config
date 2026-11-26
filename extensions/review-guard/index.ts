// Nada se publica hasta que un verifier en contexto limpio aprueba el último cambio.
// La regla escrita no bastaba: el bucle principal publicaba o pedía el visto bueno tras un arreglo que nadie revisó.
// Cambian el trabajo edit, write, lsp_fix con write: true y un worker que acaba. Lo revisa un verifier cuyo informe dice pass.
// Mientras quede un cambio sin revisar, rechaza en bash git push, glab mr create y gh pr create.
// Cada agente de agents/ la excluye con exclude_extensions, así que solo actúa en el bucle principal.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { agentFromToolResult, applyAgent, changesFiles, PUBLISH_REASON, publishes, rebuild, ReviewState } from "./review.ts";

export function createReviewGuard(now: () => number = Date.now) {
	return function reviewGuard(pi: ExtensionAPI) {
		let state = new ReviewState();
		// Una llamada que cambia ficheros y aún corre, en paralelo con el push.
		const running = new Set<string>();

		// Al empezar, recargar o cambiar de rama, el estado sale de las entradas de la rama actual.
		const reconstruct = (_event: unknown, ctx: ExtensionContext) => {
			state = rebuild(ctx.sessionManager.getBranch());
			running.clear();
		};
		pi.on("session_start", reconstruct);
		pi.on("session_tree", reconstruct);

		pi.on("tool_call", (event) => {
			const input = (event.input ?? {}) as Record<string, unknown>;
			const worker = event.toolName === "Agent" && String(input.subagent_type).toLowerCase() === "worker";
			if (changesFiles(event.toolName, input) || worker) running.add(event.toolCallId);
			if (event.toolName !== "bash" || !publishes(String(input.command ?? ""))) return undefined;
			return state.unreviewed() || running.size > 0 ? { block: true, reason: PUBLISH_REASON } : undefined;
		});

		pi.on("tool_result", (event) => {
			if (event.isError) return undefined;
			if (changesFiles(event.toolName, event.input)) state.change(now());
			if (event.toolName === "Agent") {
				const outcome = agentFromToolResult(event.details, event.content, now());
				if (outcome) applyAgent(state, outcome);
			}
			return undefined;
		});

		// Una llamada bloqueada no llega a tool_result, pero sí a tool_execution_end.
		pi.on("tool_execution_end", (event) => {
			running.delete(event.toolCallId);
		});

		// Un agente en segundo plano avisa al acabar con estos eventos de pi-subagents.
		const finished = (data: unknown) => {
			const { type, status, result, durationMs } = (data ?? {}) as Record<string, unknown>;
			if (typeof type !== "string" || typeof status !== "string") return;
			const at = now();
			applyAgent(state, { type, status, report: result, startedAt: at - (typeof durationMs === "number" ? durationMs : 0), completedAt: at });
		};
		pi.events.on("subagents:completed", finished);
		pi.events.on("subagents:failed", finished);
	};
}

export default createReviewGuard();
