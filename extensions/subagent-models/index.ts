/**
 * Modelo y razonamiento de cada subagente según el proveedor de la sesión:
 * `{ "<proveedor>": { "<agente>": { "model": "<id>", "thinking": "<nivel>" } } }`.
 * La base es el subagent-models.json de este paquete. El de ~/.pi/agent, si existe, pisa la base campo a campo.
 * Un `model` sin proveedor usa el de la sesión. Uno como "openai-codex/gpt-6-sol" fija el suyo y necesita sus credenciales en auth.json.
 * Cada campo que fija la tabla sustituye al de la llamada a `Agent`. Un campo ausente o "inherit" deja el de la llamada o, sin él, el de la sesión.
 * Los ficheros de agents/ no llevan `model` ni `thinking`: pi-subagents los antepone a la llamada y anularían la tabla.
 * Se lee en cada llamada, sin reiniciar. pi rebaja los niveles que el modelo no admite.
 */
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { stateFile } from "../shared/state-file.ts";
import { effective, type Entry, INHERIT, type Table, withChoice } from "./table.ts";

const BASE = fileURLToPath(new URL("../../subagent-models.json", import.meta.url));
const USER = stateFile("subagent-models.json");
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

type Choosing = { ctx: ExtensionCommandContext; provider: string; agent: string; current: Required<Entry>; common: Required<Entry> };

const pickAgent = (ctx: ExtensionCommandContext, provider: string, base: Table, user: Table) =>
	pick(
		ctx,
		`Subagente (sesión en ${provider})`,
		[...new Set(Object.values(base).flatMap(Object.keys))]
			.sort()
			.map((name) => ({ value: name, label: name, description: describe(effective(base, user, provider, name)) })),
		"",
	);

function pickModel({ ctx, provider, agent, current, common }: Choosing, models: Model<Api>[]) {
	return pick(
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
}

function pickThinking({ ctx, agent, current, common }: Choosing, levels: string[]) {
	return pick(
		ctx,
		`Razonamiento de ${agent}`,
		[INHERIT, ...levels].map((level) => ({
			value: level,
			label: level === INHERIT ? "razonamiento de la sesión" : level,
			description: level === common.thinking ? "común" : undefined,
		})),
		current.thinking,
	);
}

async function choose(ctx: ExtensionCommandContext) {
	if (!ctx.model) return ctx.ui.notify("Sin modelo de sesión: elige uno con /model primero.", "warning");
	const { provider } = ctx.model;
	const base = read(BASE);
	const user = read(USER);

	const agent = await pickAgent(ctx, provider, base, user);
	if (!agent) return;
	const choosing = { ctx, provider, agent, current: effective(base, user, provider, agent), common: effective(base, {}, provider, agent) };

	const models = [...ctx.modelRegistry.getAvailable()].sort((a, b) => Number(b.provider === provider) - Number(a.provider === provider));
	const model = await pickModel(choosing, models);
	if (!model) return;

	const chosen = model === INHERIT ? undefined : models.find((m) => `${m.provider}/${m.id}` === model);
	const thinking = await pickThinking(choosing, chosen ? getSupportedThinkingLevels(chosen) : LEVELS);
	if (!thinking) return;

	write(withChoice(user, base, provider, agent, { model, thinking }));
	ctx.ui.notify(`${agent}, con la sesión en ${provider}: ${describe({ model, thinking })}`, "info");
}

export default function subagentModels(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "Agent" || !ctx.model) return;
		const input = event.input as { subagent_type?: string; model?: string; thinking?: string };
		const { model, thinking } = effective(read(BASE), read(USER), ctx.model.provider, input.subagent_type ?? "");
		if (model !== INHERIT) input.model = model;
		if (thinking !== INHERIT) input.thinking = thinking;
	});

	pi.registerCommand("subagent-models", {
		description: "Elige el modelo y el razonamiento de cada subagente para el proveedor de la sesión",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return ctx.ui.notify("/subagent-models necesita la interfaz interactiva.", "warning");
			await choose(ctx);
		},
	});
}
