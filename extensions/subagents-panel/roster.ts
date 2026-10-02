/** Estado del panel de subagentes: index.ts lo alimenta con eventos y panel.ts lo dibuja. */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type SessionEvent = AgentSessionEvent;
export type Status = "running" | "completed" | "steered" | "aborted" | "stopped" | "error";

export interface Row {
	id: string;
	type: string;
	description: string;
	status: Status;
	startedAt: number;
	completedAt?: number;
	toolUses: number;
	tokens: number;
	/** Herramientas en ejecución, por id de llamada. */
	activeTools: Map<string, string>;
	/** Vista previa de la primera línea no vacía del mensaje. */
	text: string;
	frozen: boolean;
	error?: string;
}

/** Cuánto sigue a la vista un agente terminado. */
export const LINGER_MS = 4_000;
const TOOL_LABEL: Record<string, string> = {
	read: "leyendo",
	bash: "ejecutando",
	edit: "editando",
	write: "escribiendo",
	grep: "buscando",
	find: "buscando ficheros",
	ls: "listando",
	Agent: "delegando",
	advisor: "consultando",
};

export class Roster {
	private rows = new Map<string, Row>();

	start(agent: { id: string; type: string; description: string }, now = Date.now()): Row {
		const row: Row = {
			...agent,
			status: "running",
			startedAt: now,
			toolUses: 0,
			tokens: 0,
			activeTools: new Map(),
			text: "",
			frozen: false,
		};
		this.rows.set(agent.id, row);
		return row;
	}

	finish(id: string, status: Status, detail: { toolUses?: number; tokens?: number; error?: string }, now = Date.now()) {
		const row = this.rows.get(id);
		if (!row) return;
		row.status = status;
		row.completedAt = now;
		row.activeTools.clear();
		if (detail.toolUses !== undefined) row.toolUses = detail.toolUses;
		if (detail.tokens !== undefined) row.tokens = detail.tokens;
		row.error = detail.error;
	}

	get(id: string): Row | undefined {
		return this.rows.get(id);
	}

	/** Aplica un evento de la sesión del agente; devuelve si cambió algo visible. */
	apply(id: string, event: SessionEvent): boolean {
		const row = this.rows.get(id);
		if (!row) return false;
		switch (event.type) {
			case "tool_execution_start": {
				row.activeTools.set(event.toolCallId, event.toolName);
				return true;
			}
			case "tool_execution_end": {
				row.activeTools.delete(event.toolCallId);
				row.toolUses++;
				return true;
			}
			case "message_start": {
				const changed = row.text.trim().length > 0;
				row.text = "";
				row.frozen = false;
				return changed;
			}
			case "message_update":
				if (event.assistantMessageEvent.type !== "text_delta") return false;
				return updatePreview(row, event.assistantMessageEvent.delta);
			case "message_end": {
				if (event.message.role !== "assistant") return false;
				const u = event.message.usage;
				row.tokens += (u.input ?? 0) + (u.output ?? 0) + (u.cacheWrite ?? 0);
				return true;
			}
			default:
				return false;
		}
	}

	hasRunning(): boolean {
		for (const row of this.rows.values()) if (row.status === "running") return true;
		return false;
	}

	/** En marcha primero, por orden de lanzamiento; después los terminados que aún se muestran. */
	visible(now = Date.now()): Row[] {
		const rows = [...this.rows.values()].filter(
			(row) => row.status === "running" || (row.completedAt !== undefined && now - row.completedAt < LINGER_MS),
		);
		return rows.sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || a.startedAt - b.startedAt);
	}

	/** Todos los que siguen en memoria, para elegir cuál abrir. */
	all(): Row[] {
		return [...this.rows.values()].sort((a, b) => a.startedAt - b.startedAt);
	}

	/** Olvida los terminados que ya no se muestran. */
	prune(now = Date.now()) {
		for (const [id, row] of this.rows) {
			if (row.status === "running") continue;
			if (row.completedAt !== undefined && now - row.completedAt >= LINGER_MS) this.rows.delete(id);
		}
	}
}

function updatePreview(row: Row, delta: string): boolean {
	if (row.frozen) return false;
	const before = row.text.trim();
	const text = (row.text + delta).trimStart();
	const newline = text.indexOf("\n");
	row.text = text.slice(0, newline < 0 ? 160 : Math.min(newline, 160));
	row.frozen = newline >= 0 || row.text.length === 160;
	return before !== row.text.trim();
}

export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

/** Qué hace el agente ahora: la herramienta en curso o la primera línea de lo que escribe. */
export function activity(row: Row): string {
	if (row.status !== "running") return "";
	if (row.activeTools.size > 0) {
		const labels = new Set([...row.activeTools.values()].map((name) => TOOL_LABEL[name] ?? name));
		return `${[...labels].join(", ")}…`;
	}
	return row.text.trim() || "pensando…";
}
