import type { Message } from "@earendil-works/pi-ai";

// Deja una petición válida para el asesor. Quita los mensajes de sistema, porque el asesor trae el suyo.
// Quita las llamadas sin resultado, como la propia a `advisor`, y los mensajes del asistente que quedan vacíos.
export function advisorMessages(messages: Message[]): Message[] {
	const resolved = new Set(messages.flatMap((m) => (m.role === "toolResult" ? [m.toolCallId] : [])));
	return messages.flatMap((m): Message[] => {
		if (m.role === "system") return [];
		if (m.role !== "assistant") return [m];
		const content = m.content.filter((c) => c.type !== "toolCall" || resolved.has(c.id));
		return content.length ? [{ ...m, content }] : [];
	});
}
