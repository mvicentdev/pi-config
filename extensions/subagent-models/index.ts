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
 * `/subagent-models` elige agente, modelo (entre los que tienen credenciales) y razonamiento para el
 * proveedor de la sesión, y guarda en el fichero del usuario solo lo que difiere de la base.
 */
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { effective, INHERIT, type Table, withChoice } from "./table.ts";

const BASE = fileURLToPath(new URL("../../subagent-models.json", import.meta.url));
const USER = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "subagent-models.json");
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const VISIBLE = 12;

const read = (file: string): Table => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});

function write(table: Table) {
	if (Object.keys(table).length) fs.writeFileSync(USER, `${JSON.stringify(table, null, 2)}\n`);
	else fs.rmSync(USER, { force: true });
}

const describe = ({ model, thinking }: { model: string; thinking: string }) =>
	`${model === INHERIT ? "modelo de la sesión" : model} · ${thinking === INHERIT ? "razonamiento de la sesión" : thinking}`;

// ui.select pinta todas las opciones sin desplazarse; SelectList se desplaza en listas largas.
function pick(ctx: ExtensionCommandContext, title: string, items: SelectItem[], current: string) {
	return ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const list = new SelectList(items, Math.min(items.length, VISIBLE), getSelectListTheme(), {
			minPrimaryColumnWidth: 32,
			maxPrimaryColumnWidth: 48, // los ids largos de opencode-go no caben en las 32 por defecto
		});
		list.setSelectedIndex(Math.max(0, items.findIndex((item) => item.value === current)));
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ navegar · enter elegir · esc cancelar"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function choose(ctx: ExtensionCommandContext) {
	if (!ctx.model) return ctx.ui.notify("Sin modelo de sesión: elige uno con /model primero.", "warning");
	const { provider } = ctx.model;
	const base = read(BASE);
	const user = read(USER);
	const agents = [...new Set(Object.values(base).flatMap(Object.keys))].sort();

	const agent = await pick(
		ctx,
		`Subagente (sesión en ${provider})`,
		agents.map((name) => ({ value: name, label: name, description: describe(effective(base, user, provider, name)) })),
		"",
	);
	if (!agent) return;
	const current = effective(base, user, provider, agent);
	const common = effective(base, {}, provider, agent);

	const models = [...ctx.modelRegistry.getAvailable()].sort(
		(a, b) => Number(b.provider === provider) - Number(a.provider === provider),
	);
	const model = await pick(
		ctx,
		`Modelo de ${agent}`,
		[
			{ value: INHERIT, label: "modelo de la sesión", description: common.model === INHERIT ? "común" : undefined },
			...models.map((m) => {
				const value = `${m.provider}/${m.id}`;
				return { value, label: value, description: value === common.model ? "común" : m.name };
			}),
		],
		current.model,
	);
	if (!model) return;

	const chosen = model === INHERIT ? undefined : models.find((m) => `${m.provider}/${m.id}` === model);
	const levels = chosen ? getSupportedThinkingLevels(chosen) : LEVELS;
	const thinking = await pick(
		ctx,
		`Razonamiento de ${agent}`,
		[INHERIT, ...levels].map((level) => ({
			value: level,
			label: level === INHERIT ? "razonamiento de la sesión" : level,
			description: level === common.thinking ? "común" : undefined,
		})),
		current.thinking,
	);
	if (!thinking) return;

	write(withChoice(user, base, provider, agent, { model, thinking }));
	ctx.ui.notify(`${agent}, con la sesión en ${provider}: ${describe({ model, thinking })}`, "info");
}

export default function subagentModels(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "Agent" || !ctx.model) return;
		const input = event.input as { subagent_type?: string; model?: string; thinking?: string };
		const { model, thinking } = effective(read(BASE), read(USER), ctx.model.provider, input.subagent_type ?? "");
		if (model !== INHERIT && !input.model) input.model = model;
		if (thinking !== INHERIT && !input.thinking) input.thinking = thinking;
	});

	pi.registerCommand("subagent-models", {
		description: "Elige el modelo y el razonamiento de cada subagente para el proveedor de la sesión",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return ctx.ui.notify("/subagent-models necesita la interfaz interactiva.", "warning");
			await choose(ctx);
		},
	});
}
