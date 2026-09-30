/**
 * Añade la herramienta `advisor`, al estilo del patrón asesor de Anthropic: el modelo ejecutor
 * consulta a un modelo más capaz (Fable) en los momentos que deciden el resultado — antes de elegir
 * un enfoque, cuando se atasca y antes de dar por terminada una tarea compleja — sin pagar ese modelo
 * en cada paso. El asesor recibe la conversación de la rama actual y la pregunta, nunca llama a
 * herramientas y solo responde con un plan o una corrección. Su consumo va en el `usage` del
 * resultado para que los totales de la sesión lo cuenten. El modelo se lee de advisor.json en cada
 * consulta; `/advisor anthropic/claude-fable-5-1` lo fija y `/advisor` muestra el actual.
 */
import { Type } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { advisorMessages } from "./context.ts";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "advisor.json");
const DEFAULT_MODEL = "anthropic/claude-fable-5-1";

function splitModel(name: string): [string, string] {
	const slash = name.indexOf("/");
	return slash < 0 ? [name, ""] : [name.slice(0, slash), name.slice(slash + 1)];
}

function configuredModel(): string {
	try {
		return String(JSON.parse(fs.readFileSync(FILE, "utf8")).model || DEFAULT_MODEL);
	} catch {
		return DEFAULT_MODEL;
	}
}

const SYSTEM_PROMPT =
	"You are an advisor reviewing the work of another AI agent. You see its conversation so far and its question. Give a direct, concise answer: the plan to follow or the correction to make, and why. You cannot use tools; do not ask for or describe tool calls.";

export default function advisor(pi: ExtensionAPI) {
	pi.registerCommand("advisor", {
		description: "Modelo asesor de la herramienta advisor: /advisor <proveedor/modelo>",
		handler: async (args, ctx) => {
			const value = args.trim();
			const [provider, id] = splitModel(value);
			if (!value || !id || !ctx.modelRegistry.find(provider, id)) {
				return ctx.ui.notify(`Asesor actual: ${configuredModel()}. Uso: /advisor <proveedor/modelo>`, "info");
			}
			fs.writeFileSync(FILE, `${JSON.stringify({ model: value }, null, "\t")}\n`);
			ctx.ui.notify(`Asesor: ${value}`, "info");
		},
	});

	pi.registerTool({
		name: "advisor",
		label: "Advisor",
		description:
			"Consult a stronger advisor model that sees this conversation and returns guidance. Call it before committing to an approach on non-trivial work, when stuck or after repeated failures, and before declaring a complex task done. Do not call it for trivial steps.",
		parameters: Type.Object({
			question: Type.String({ description: "What you want advice on, with the decision or doubt stated precisely" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const name = configuredModel();
			const [provider, id] = splitModel(name);
			const model = ctx.modelRegistry.find(provider, id);
			if (!model) throw new Error(`Advisor model ${name} not found`);
			const messages = advisorMessages(convertToLlm(ctx.sessionManager.buildSessionProjection().messages));
			messages.push({ role: "user", content: params.question, timestamp: Date.now() });
			const response = await ctx.modelRegistry
				.streamSimple(model, { systemPrompt: SYSTEM_PROMPT, messages }, { signal: signal ?? ctx.signal })
				.result();
			if (response.stopReason === "error" || response.stopReason === "aborted")
				throw new Error(`Advisor failed: ${response.errorMessage ?? response.stopReason}`);
			const text = response.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
			return { content: [{ type: "text", text }], details: undefined, usage: response.usage };
		},
	});
}
