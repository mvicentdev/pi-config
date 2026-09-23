// Preferencias de la barra (una por usuario) y el selector de `/statusline`.
import { getSelectListTheme, getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Input, SelectList, SettingsList, type Component, type SettingItem } from "@earendil-works/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACCENTS, activeThemeName, listThemes } from "./ghostty.ts";
import { DEFAULTS, ITEMS, type Settings } from "./segments.ts";

export const PI_PALETTE = "tema de pi";
export const ACTIVE_PALETTE = "Ghostty activo";
export const SCOPES = ["barra", "barra y pi"];

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "status-line.json");
const COLOR_DEFAULTS: Settings = { palette: PI_PALETTE, scope: SCOPES[0], accent: ACCENTS[0] };

export function loadSettings(): Settings {
	try {
		return { ...DEFAULTS, ...COLOR_DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
	} catch {
		return { ...DEFAULTS, ...COLOR_DEFAULTS };
	}
}

export function saveSettings(settings: Settings): void {
	fs.writeFileSync(FILE, `${JSON.stringify(settings, null, "\t")}\n`);
}

const GROUP_WIDTH = 13;

/**
 * Abre el selector. Cada cambio llega a `onChange` al momento, que guarda y repinta: el pie real
 * hace de vista previa. En el submenú de paleta, moverse por la lista ya previsualiza el tema.
 */
export async function openSettings(ctx: ExtensionContext, settings: Settings, onChange: (id: string, value: string, preview?: boolean) => void) {
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		const row = (group: string, label: string) => `${theme.fg("dim", group.padEnd(GROUP_WIDTH))}${label}`;
		const items: SettingItem[] = [
			...ITEMS.map((item) => ({
				id: item.id,
				label: row(item.group, item.label),
				description: item.description,
				currentValue: settings[item.id],
				values: item.values,
			})),
			{
				id: "palette",
				label: row("Colores", "Paleta"),
				description: `Colores de la barra: los del tema de pi, los del tema que Ghostty tiene activo (${activeThemeName() ?? "ninguno"}) o cualquiera de los ${listThemes().length} instalados`,
				currentValue: settings.palette,
				submenu: (current, close) => themePicker(current, (value) => onChange("palette", value, true), close, () => tui.requestRender()),
			},
			{ id: "scope", label: row("Colores", "Aplicar a"), description: "«barra y pi» genera un tema de pi con esa paleta y lo activa", currentValue: settings.scope, values: SCOPES },
			{ id: "accent", label: row("Colores", "Acento"), description: "Color de la paleta que hace de acento", currentValue: settings.accent, values: [...ACCENTS] },
		];
		const list = new SettingsList(items, Math.min(items.length, 14), getSettingsListTheme(), (id, value) => {
			onChange(id, value);
			tui.requestRender();
		}, () => done(), { enableSearch: true });
		return {
			render: (width: number) => [theme.fg("accent", theme.bold("Barra de estado")), "", ...list.render(width)],
			invalidate: () => list.invalidate(),
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

const NAVIGATION = ["tui.select.up", "tui.select.down", "tui.select.pageUp", "tui.select.pageDown", "tui.select.confirm", "tui.select.cancel"] as const;

// Lista de paletas con búsqueda por subcadena. Al salir con Esc se deshace la vista previa.
function themePicker(current: string, preview: (value: string) => void, close: (value?: string) => void, requestRender: () => void): Component {
	const all = [PI_PALETTE, ACTIVE_PALETTE, ...listThemes()];
	const input = new Input({ prompt: "Buscar: " });
	let list = build("");
	function build(filter: string) {
		const needle = filter.toLowerCase();
		const next = new SelectList(
			all.filter((name) => name.toLowerCase().includes(needle)).map((name) => ({ value: name, label: name === ACTIVE_PALETTE ? `${name} (${activeThemeName() ?? "ninguno"})` : name })),
			12,
			getSelectListTheme(),
		);
		if (!filter) next.setSelectedIndex(Math.max(0, all.indexOf(current)));
		next.onSelectionChange = (item) => preview(item.value);
		next.onSelect = (item) => close(item.value);
		next.onCancel = () => {
			preview(current);
			close();
		};
		return next;
	}
	return {
		render: (width: number) => [...input.render(width), ...list.render(width)],
		invalidate: () => list.invalidate(),
		handleInput(data: string) {
			const before = input.getValue();
			const kb = getKeybindings();
			const navigation = NAVIGATION.some((action) => kb.matches(data, action));
			if (navigation) list.handleInput(data);
			else {
				input.handleInput(data);
				if (input.getValue() !== before) {
					list = build(input.getValue());
					const first = list.getSelectedItem();
					if (first) preview(first.value);
				}
			}
			requestRender();
		},
	};
}
