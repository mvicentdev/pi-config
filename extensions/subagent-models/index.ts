/**
 * Modelo y esfuerzo de razonamiento de cada subagente según el proveedor de la sesión:
 * `{ "<proveedor>": { "<agente>": { "model": "<id>", "thinking": "<nivel>" } } }`.
 * La base común es el subagent-models.json de este paquete; el del usuario en su
 * ~/.pi/agent, si existe, tiene la misma forma y solo lleva lo que cambia: cada campo que declare
 * pisa al de la base para ese proveedor y agente, y el resto se hereda de ella.
 * Niveles: off, minimal, low, medium, high, xhigh, max (pi rebaja los que el modelo no admite).
 * Un `model` sin proveedor se busca en el de la sesión; uno como "openai-codex/gpt-6-sol" fija el suyo,
 * así cada subagente puede ir a un proveedor distinto (que necesita sus credenciales en auth.json).
 * Cuando el orquestador lanza un agente con la herramienta `Agent`, cada campo que la llamada no
 * indique se completa con la tabla. Un campo ausente o "inherit" hereda el de la sesión, y lo fijado
 * en el fichero del agente sigue mandando. Se lee en cada llamada: los cambios valen sin reiniciar.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Entry = { model?: string; thinking?: string };

const BASE = fileURLToPath(new URL("../../subagent-models.json", import.meta.url));
const USER = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "subagent-models.json");
const set = (value?: string) => value && value !== "inherit";
const entryOf = (file: string, provider: string, agent: string): Entry | undefined =>
	fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8"))[provider]?.[agent] : undefined;

export default function subagentModels(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "Agent" || !ctx.model) return;
		const input = event.input as { subagent_type?: string; model?: string; thinking?: string };
		const { provider } = ctx.model;
		const agent = input.subagent_type ?? "";
		const entry: Entry = { ...entryOf(BASE, provider, agent), ...entryOf(USER, provider, agent) };
		if (set(entry.model) && !input.model) input.model = entry.model!.includes("/") ? entry.model : `${provider}/${entry.model}`;
		if (set(entry.thinking) && !input.thinking) input.thinking = entry.thinking;
	});
}
