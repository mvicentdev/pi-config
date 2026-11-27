// Nada se publica hasta que un verifier en contexto limpio aprueba el último cambio.
// La regla escrita no bastaba: el bucle principal publicaba o pedía el visto bueno tras un arreglo que nadie revisó.
// Cambian el trabajo edit, write, lsp_fix con write: true y un worker que acaba. Lo revisa un verifier cuyo informe dice pass.
// Mientras quede un cambio sin revisar o un worker en marcha, rechaza en bash git push, glab mr create y gh pr create.
// Cada agente de agents/ la excluye con exclude_extensions, así que solo actúa en el bucle principal.

// Tampoco bastaba escribir que se publica solo con el visto bueno del usuario.
// Tras el último cambio debe llegar un mensaje del usuario, y la fusión en la rama por defecto también publica.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	agentFromToolResult,
	agentTypes,
	applyAgent,
	changesFiles,
	type GitLookup,
	GO_REASON,
	mergesIntoDefault,
	PUBLISH_REASON,
	publishes,
	rebuild,
	ReviewState,
	runGit,
} from "./review.ts";

// pi-subagents publica su gestor en este registro global. getRecord da el estado vivo de un agente del bucle principal.
const SUBAGENTS = Symbol.for("pi-subagents:manager");
type Subagents = { getRecord?: (id: string) => { status?: unknown } | undefined };
const subagentsRegistry = () => (globalThis as Record<symbol, unknown>)[SUBAGENTS];

export function createReviewGuard(now: () => number = Date.now, registry: () => unknown = subagentsRegistry, git: GitLookup = runGit) {
	return function reviewGuard(pi: ExtensionAPI) {
		let state = new ReviewState();
		// Una llamada que cambia ficheros y aún corre, en paralelo con el push.
		const running = new Set<string>();
		// Los ids de los workers lanzados por pi-subagents que aún no han acabado.
		const workers = new Set<string>();
		// El tipo de cada agente por su id. Un Agent con resume reanuda ese tipo, no el de subagent_type.
		let types = new Map<string, string>();
		const isWorker = (type: unknown) => String(type).toLowerCase() === "worker";
		// Un worker en cola que se para, o uno que se para al crear su worktree, no avisa al acabar.
		// Al publicar, pi-subagents dice cuáles siguen en cola o en marcha. Sin registro cuentan solo los eventos.
		// Un worker que ya no corre pudo editar ficheros. Su subagents:failed llega tarde, así que cuenta ya como cambio.
		const workersRunning = () => {
			const subagents = registry() as Subagents | undefined;
			if (typeof subagents?.getRecord !== "function") return workers.size > 0;
			for (const id of workers) {
				const status = subagents.getRecord(id)?.status;
				if (status === "running" || status === "queued") continue;
				workers.delete(id);
				state.change(now());
			}
			return workers.size > 0;
		};

		// Al empezar, recargar o cambiar de rama, el estado sale de las entradas de la rama actual.
		// Los workers en marcha siguen en marcha: solo su final los quita.
		const reconstruct = (_event: unknown, ctx: ExtensionContext) => {
			const branch = ctx.sessionManager.getBranch();
			state = rebuild(branch);
			types = new Map([...types, ...agentTypes(branch)]);
			running.clear();
		};
		pi.on("session_start", reconstruct);
		pi.on("session_tree", reconstruct);

		// Solo cuenta un mensaje del usuario. pi-subagents avisa con mensajes custom.
		pi.on("message_end", (event) => {
			if (event.message.role === "user") state.speak(now());
		});

		pi.on("tool_call", (event, ctx) => {
			const input = (event.input ?? {}) as Record<string, unknown>;
			// Un agente reanudado de tipo desconocido puede ser un worker.
			const resumed = typeof input.resume === "string" && input.resume ? (types.get(input.resume) ?? "worker") : undefined;
			const worker = event.toolName === "Agent" && isWorker(resumed ?? input.subagent_type);
			if (changesFiles(event.toolName, input) || worker) running.add(event.toolCallId);
			if (event.toolName !== "bash") return undefined;
			const command = String(input.command ?? "");
			if (!publishes(command) && !mergesIntoDefault(command, ctx.cwd, git)) return undefined;
			// workersRunning va primero: puede anotar un cambio que state.unreviewed debe ver.
			if (workersRunning() || running.size > 0 || state.unreviewed()) return { block: true, reason: PUBLISH_REASON };
			return state.awaitingGo() ? { block: true, reason: GO_REASON } : undefined;
		});

		pi.on("tool_result", (event) => {
			if (event.isError) return undefined;
			if (changesFiles(event.toolName, event.input)) state.change(now());
			if (event.toolName === "Agent") {
				const { agentId, subagentType } = (event.details ?? {}) as Record<string, unknown>;
				if (typeof agentId === "string" && typeof subagentType === "string") types.set(agentId, subagentType);
				const outcome = agentFromToolResult(event.details, event.content, now());
				if (outcome) applyAgent(state, outcome);
			}
			return undefined;
		});

		// Una llamada bloqueada no llega a tool_result, pero sí a tool_execution_end.
		pi.on("tool_execution_end", (event) => {
			running.delete(event.toolCallId);
		});

		// pi-subagents avisa con subagents:created al lanzar o reanudar en segundo plano.
		// Avisa con subagents:started cuando un agente empieza a correr, también desde la cola o por RPC. Ambos llevan el tipo real.
		const started = (data: unknown) => {
			const { id, type } = (data ?? {}) as Record<string, unknown>;
			if (typeof id !== "string" || typeof type !== "string") return;
			types.set(id, type);
			if (isWorker(type)) workers.add(id);
		};
		pi.events.on("subagents:created", started);
		pi.events.on("subagents:started", started);

		// Un agente avisa al acabar con estos eventos de pi-subagents.
		const finished = (data: unknown) => {
			const { id, type, status, result, durationMs } = (data ?? {}) as Record<string, unknown>;
			if (typeof id === "string") workers.delete(id);
			if (typeof type !== "string" || typeof status !== "string") return;
			const at = now();
			applyAgent(state, { type, status, report: result, startedAt: at - (typeof durationMs === "number" ? durationMs : 0), completedAt: at });
		};
		pi.events.on("subagents:completed", finished);
		pi.events.on("subagents:failed", finished);
	};
}

export default createReviewGuard();
