export type Entry = { model?: string; thinking?: string };
export type Table = Record<string, Record<string, Entry>>;

export const INHERIT = "inherit";

/** `model` con su proveedor; un modelo ausente o "inherit" queda como "inherit". */
export const qualified = (provider: string, model?: string) =>
	!model || model === INHERIT ? INHERIT : model.includes("/") ? model : `${provider}/${model}`;

/** Lo que rige para un agente con la sesión en `provider`: la base, pisada campo a campo por el usuario. */
export const effective = (base: Table, user: Table, provider: string, agent: string): Required<Entry> => {
	const entry = { ...base[provider]?.[agent], ...user[provider]?.[agent] };
	return { model: qualified(provider, entry.model), thinking: entry.thinking ?? INHERIT };
};

/**
 * La tabla del usuario con `choice` para ese proveedor y agente, guardando solo los campos que difieren
 * de la base; el agente y el proveedor que se quedan sin nada desaparecen.
 */
export function withChoice(user: Table, base: Table, provider: string, agent: string, choice: Required<Entry>): Table {
	const common = effective(base, {}, provider, agent);
	const entry: Entry = {};
	if (qualified(provider, choice.model) !== common.model) entry.model = choice.model;
	if (choice.thinking !== common.thinking) entry.thinking = choice.thinking;
	const agents = { ...user[provider], [agent]: entry };
	if (!Object.keys(entry).length) delete agents[agent];
	const next = { ...user, [provider]: agents };
	if (!Object.keys(agents).length) delete next[provider];
	return next;
}
