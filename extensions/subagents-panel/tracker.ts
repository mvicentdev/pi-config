import type { AgentRecord } from "../../vendor/pi-subagents/src/types.ts";
import type { Roster } from "./roster.ts";

export function agentRecord(id: string): AgentRecord | undefined {
	const registry = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents:manager")] as
		{ getRecord(id: string): AgentRecord | undefined } | undefined;
	return registry?.getRecord(id);
}

/** Copia a cada fila en marcha los contadores del registro de pi-subagents y la suscribe a su sesión una sola vez. */
export function createSessionTracker(roster: () => Roster, onChange: () => void) {
	const subscriptions = new Map<string, () => void>();
	return {
		attach() {
			for (const row of roster().all()) {
				if (row.status !== "running") continue;
				const agent = agentRecord(row.id);
				if (!agent) continue;
				row.startedAt = agent.startedAt;
				row.toolUses = agent.toolUses;
				const usage = agent.lifetimeUsage;
				row.tokens = usage.input + usage.output + usage.cacheWrite;
				const session = agent.session;
				if (!session || subscriptions.has(row.id)) continue;
				subscriptions.set(row.id, session.subscribe((event) => {
					if (roster().apply(row.id, event)) onChange();
				}));
			}
		},
		release(id: string) {
			subscriptions.get(id)?.();
			subscriptions.delete(id);
		},
		releaseAll() {
			for (const unsubscribe of subscriptions.values()) unsubscribe();
			subscriptions.clear();
		},
	};
}
