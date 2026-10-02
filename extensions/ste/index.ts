/**
 * Estilo de redacción ASD-STE100 (Simplified Technical English, el lenguaje controlado de la
 * documentación de mantenimiento aeroespacial) con intensidad ajustable. `/ste 80` lo aplica «al 80 %»,
 * `/ste off` lo quita y `/ste` muestra el valor actual; se guarda en ste.json y, sin él, arranca al
 * DEFAULT_PERCENT. Como feedback-reminder,
 * la instrucción viaja junto a cada mensaje del usuario en la copia que se envía al modelo, para que pese
 * en sesiones largas y el prefijo siga siendo idéntico entre turnos.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "ste.json");

const DEFAULT_PERCENT = 90;

const reminder = (percent: number) =>
	`<system-reminder>Write prose ${percent}% of the way to ASD-STE100 (Simplified Technical English), adapting its rules to the reply language: short sentences (at most 20 words for instructions, 25 for descriptions), one instruction per sentence, active voice, simple verb tenses, one meaning per word and the same word for the same thing, no idioms or vague words, articles kept. 100% applies every rule strictly; lower values relax them in proportion. Code, commands, identifiers and quotations stay as they are.</system-reminder>`;

export default function ste(pi: ExtensionAPI) {
	let percent = DEFAULT_PERCENT;
	try {
		const saved = JSON.parse(fs.readFileSync(FILE, "utf8")).percent;
		if (Number.isInteger(saved) && saved >= 0 && saved <= 100) percent = saved;
	} catch {}

	pi.registerCommand("ste", {
		description: "Redacción ASD-STE100 con intensidad ajustable: /ste 80, /ste off",
		handler: async (args, ctx) => {
			const value = args.trim();
			const next = value === "off" ? 0 : Number(value);
			if (!value || !Number.isInteger(next) || next < 0 || next > 100) {
				return ctx.ui.notify(`ASD-STE100: ${percent ? `${percent} %` : "desactivado"}. Uso: /ste <1-100> | off`, "info");
			}
			percent = next;
			fs.writeFileSync(FILE, `${JSON.stringify({ percent }, null, "\t")}\n`);
			ctx.ui.notify(percent ? `ASD-STE100 al ${percent} %` : "ASD-STE100 desactivado", "info");
		},
	});

	pi.on("context", (event) => {
		if (!percent) return;
		const text = reminder(percent);
		for (const message of event.messages) {
			if (message.role !== "user") continue;
			message.content =
				typeof message.content === "string"
					? `${message.content}\n\n${text}`
					: [...message.content, { type: "text", text }];
		}
		return { messages: event.messages };
	});
}
