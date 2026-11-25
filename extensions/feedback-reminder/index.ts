/**
 * Cómo escribe el agente al usuario. FEEDBACK.md entra en el prompt de sistema.
 * Un recordatorio acompaña a cada mensaje del usuario, porque en una sesión larga el prompt queda enterrado.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const FEEDBACK = readFileSync(join(DIRECTORY, "FEEDBACK.md"), "utf8").trim().replaceAll("{dir}", DIRECTORY);

export const REMINDER =
	"<system-reminder>Reply in Castilian Spanish and apply the Feedback rules of your instructions: the answer first, each fact once, plain words, and at most 40 words of prose for an answer or a question, 60 for finished work or a request for go and 120 for any other report.</system-reminder>";

export default function feedbackReminder(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${FEEDBACK}` }));

	// `context` recibe un clon: el recordatorio no llega a la sesión guardada ni a la pantalla.
	// En todos los mensajes, no solo en el último: un prefijo idéntico entre turnos conserva la caché de prompt.
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
