import type { Message } from "@earendil-works/pi-ai";

// Deja la conversación del ejecutor en una petición válida para el asesor: fuera los mensajes de
// sistema (el asesor trae el suyo) y las llamadas a herramientas que aún no tienen resultado, entre
// ellas la propia llamada a `advisor`. Un mensaje del asistente que se queda vacío desaparece.
export function advisorMessages(messages: Message[]): Message[] {
	const resolved = new Set(messages.flatMap((m) => (m.role === "toolResult" ? [m.toolCallId] : [])));
	return messages.flatMap((m): Message[] => {
		if (m.role === "system") return [];
		if (m.role !== "assistant") return [m];
		const content = m.content.filter((c) => c.type !== "toolCall" || resolved.has(c.id));
		return content.length ? [{ ...m, content }] : [];
	});
}
