// Temas de Ghostty: localiza los instalados, resuelve el activo en la configuración de Ghostty y los
// traduce a los colores de pi, sea para pintar solo la barra o para generar un tema de pi completo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GhosttyTheme {
	name: string;
	palette: string[];
	background: string;
	foreground: string;
}

export const ACCENTS = ["magenta", "azul", "cian", "verde", "amarillo", "rojo"] as const;
const ACCENT_SLOT: Record<string, number> = { magenta: 5, azul: 4, cian: 6, verde: 2, amarillo: 3, rojo: 1 };

const home = os.homedir();
const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
const macSupport = path.join(home, "Library/Application Support/com.mitchellh.ghostty");
const CONFIG_FILES = [
	path.join(xdg, "ghostty/config"),
	path.join(xdg, "ghostty/config.ghostty"),
	path.join(macSupport, "config"),
	path.join(macSupport, "config.ghostty"),
];
// Los del usuario primero: a igual nombre, el suyo manda, como en Ghostty.
const THEME_DIRS = [
	path.join(xdg, "ghostty/themes"),
	...(process.env.GHOSTTY_RESOURCES_DIR ? [path.join(process.env.GHOSTTY_RESOURCES_DIR, "themes")] : []),
	"/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
	"/usr/share/ghostty/themes",
];

let listed: string[] | undefined;
export function listThemes(): string[] {
	listed ??= [...new Set(THEME_DIRS.flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])))]
		.filter((name) => !name.startsWith("."))
		.sort((a, b) => a.localeCompare(b));
	return listed;
}

function readLines(file: string): Array<[string, string]> {
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, "utf8").split("\n").flatMap((line) => {
		const match = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
		return match ? [[match[1], match[2].replace(/^"(.*)"$/, "$1")] as [string, string]] : [];
	});
}

// Ghostty lee cada fichero y, al acabarlo, los `config-file` que incluye; gana el último `theme`.
function themeIn(file: string, seen: Set<string>): string | undefined {
	if (seen.has(file)) return undefined;
	seen.add(file);
	let theme: string | undefined;
	const includes: string[] = [];
	for (const [key, value] of readLines(file)) {
		if (key === "theme") theme = value;
		if (key === "config-file") includes.push(path.resolve(path.dirname(file), value.replace(/^\?/, "")));
	}
	for (const include of includes) theme = themeIn(include, seen) ?? theme;
	return theme;
}

/** Nombre del tema que Ghostty tiene activo; con `light:X,dark:Y` toma el oscuro. */
export function activeThemeName(): string | undefined {
	const seen = new Set<string>();
	let theme: string | undefined;
	for (const file of CONFIG_FILES) theme = themeIn(file, seen) ?? theme;
	const dark = theme?.split(",").find((part) => part.trim().startsWith("dark:"));
	return (dark ?? theme)?.replace(/^\s*(light|dark):/, "").trim() || undefined;
}

export function loadTheme(name: string): GhosttyTheme | undefined {
	const file = path.isAbsolute(name) ? name : THEME_DIRS.map((dir) => path.join(dir, name)).find((f) => fs.existsSync(f));
	if (!file || !fs.existsSync(file)) return undefined;
	const palette: string[] = [];
	let background = "#000000";
	let foreground = "#ffffff";
	for (const [key, value] of readLines(file)) {
		const slot = key === "palette" ? value.match(/^(\d+)\s*=\s*(#?[0-9a-fA-F]{6})$/) : null;
		if (slot) palette[Number(slot[1])] = hex(slot[2]);
		if (key === "background") background = hex(value);
		if (key === "foreground") foreground = hex(value);
	}
	if (palette.filter(Boolean).length < 16) return undefined;
	return { name: path.basename(file), palette, background, foreground };
}

function hex(value: string): string {
	return `#${value.replace("#", "").toLowerCase()}`;
}

function mix(a: string, b: string, amount: number): string {
	const channel = (color: string, i: number) => Number.parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
	return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Tema de pi completo derivado de 16 colores ANSI más fondo y texto. */
export function toPiTheme(theme: GhosttyTheme, accent: string, name: string) {
	const p = theme.palette;
	const vars = {
		bg: theme.background,
		fg: theme.foreground,
		red: p[1],
		green: p[2],
		yellow: p[3],
		blue: p[4],
		magenta: p[5],
		cyan: p[6],
		gray: p[8],
		brightMagenta: p[13],
		dimGray: mix(theme.background, p[8], 0.6),
		accent: p[ACCENT_SLOT[accent] ?? 5],
	};
	const tint = (color: string, amount: number) => mix(theme.background, color, amount);
	return {
		name,
		vars,
		colors: {
			accent: "accent", border: "gray", borderAccent: "accent", borderMuted: "dimGray",
			success: "green", error: "red", warning: "yellow", muted: "gray", dim: "dimGray",
			text: "", thinkingText: "gray",
			selectedBg: tint(theme.foreground, 0.14), userMessageBg: tint(theme.foreground, 0.07), userMessageText: "",
			customMessageBg: tint(p[5], 0.1), customMessageText: "", customMessageLabel: "accent",
			toolPendingBg: tint(theme.foreground, 0.04), toolSuccessBg: tint(p[2], 0.1), toolErrorBg: tint(p[1], 0.1),
			toolTitle: "", toolOutput: "gray",
			mdHeading: "yellow", mdLink: "cyan", mdLinkUrl: "dimGray", mdCode: "accent", mdCodeBlock: "green",
			mdCodeBlockBorder: "gray", mdQuote: "gray", mdQuoteBorder: "gray", mdHr: "gray", mdListBullet: "accent",
			toolDiffAdded: "green", toolDiffRemoved: "red", toolDiffContext: "gray",
			syntaxComment: "gray", syntaxKeyword: "magenta", syntaxFunction: "blue", syntaxVariable: "fg",
			syntaxString: "green", syntaxNumber: "yellow", syntaxType: "cyan", syntaxOperator: "fg", syntaxPunctuation: "gray",
			thinkingOff: "dimGray", thinkingMinimal: "gray", thinkingLow: "blue", thinkingMedium: "cyan",
			thinkingHigh: "magenta", thinkingXhigh: "brightMagenta", thinkingMax: "red", bashMode: "green",
		},
	};
}

/** Pintor para la barra con los colores de un tema de Ghostty, sin tocar el tema de pi. */
export function painter(theme: GhosttyTheme, accent: string) {
	const { vars, colors } = toPiTheme(theme, accent, "barra");
	const resolve = (value: string): string => (value.startsWith("#") ? value : value ? resolve((vars as Record<string, string>)[value] ?? "") : vars.fg);
	return {
		fg(role: string, text: string) {
			const color = resolve((colors as Record<string, string>)[role] ?? "");
			const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
			return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
		},
	};
}

// ponytail: un fichero por tema y acento en ~/.pi/agent/themes; pi los guarda en caché al
// descubrirlos, así que un nombre nuevo es lo único que garantiza que se lee el contenido nuevo.
/** Escribe el tema de pi generado y devuelve su nombre, listo para `ctx.ui.setTheme(nombre)`. */
export function writePiTheme(theme: GhosttyTheme, accent: string): string {
	const slug = theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	const name = `ghostty-${slug}-${accent}`;
	const dir = path.join(process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi/agent"), "themes");
	fs.mkdirSync(dir, { recursive: true });
	for (const file of fs.readdirSync(dir)) {
		if (file.startsWith("ghostty-") && file !== `${name}.json`) fs.rmSync(path.join(dir, file));
	}
	fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(toPiTheme(theme, accent, name), null, "\t")}\n`);
	return name;
}
