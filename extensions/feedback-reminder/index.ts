/**
 * Recuerda las reglas de `## Feedback` de AGENTS.md en cada mensaje del usuario. AGENTS.md va en el
 * system prompt y, en una sesión larga, queda enterrado bajo la conversación; el recordatorio viaja
 * junto al mensaje más reciente, que es el que más pesa. Se añade solo a la copia que se envía al
 * modelo (el evento `context` recibe un clon), así que no aparece en la sesión guardada ni en la
 * pantalla. Va en todos los mensajes del usuario, no solo en el último, para que el prefijo enviado
 * sea idéntico de un turno a otro y la caché de prompt siga sirviendo.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REMINDER =
	"<system-reminder>Reply in Castilian Spanish and apply the Feedback rules in AGENTS.md: the first word is the answer, never the subject of the question; no sentence repeats another; at most 40 words of prose for a question and three lines otherwise, plain words over inline code.</system-reminder>";

export default function feedbackReminder(pi: ExtensionAPI) {
	pi.on("context", (event) => {
		for (const message of event.messages) {
			if (message.role !== "user") continue;
			message.content =
				typeof message.content === "string"
					? `${message.content}\n\n${REMINDER}`
					: [...message.content, { type: "text", text: REMINDER }];
		}
		return { messages: event.messages };
	});
}
