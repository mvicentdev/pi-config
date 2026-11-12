/**
 * Orca apaga un pi que lleva 30 minutos sin actividad, tras preguntar a este registro si le queda trabajo.
 * Sin un proveedor, un subagente en segundo plano no cuenta como trabajo y muere con el proceso.
 * Fuera de Orca el registro no existe y la extensión no hace nada.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REGISTRY = Symbol.for("@agegr/pi-web/session-liveness/v1");
const MANAGER = Symbol.for("pi-subagents:manager");

type Registry = { register(provider: { name: string; sessionId: string; isActive(): boolean }): () => void };
type Manager = { hasRunning(): boolean };

export default function orcaLiveness(pi: ExtensionAPI) {
	let release: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		release?.();
		const globals = globalThis as Record<symbol, unknown>;
		release = (globals[REGISTRY] as Registry | undefined)?.register({
			name: "pi-subagents",
			sessionId: ctx.sessionManager.getSessionId(),
			isActive: () => (globals[MANAGER] as Manager | undefined)?.hasRunning() === true,
		});
	});
	pi.on("session_shutdown", () => {
		release?.();
		release = undefined;
	});
}
