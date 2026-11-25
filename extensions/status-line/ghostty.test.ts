import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { activeThemeName, listThemes, loadTheme, painter, writePiTheme } from "./ghostty.ts";

const sandbox = process.env.STATUS_LINE_SANDBOX!;
const configDir = path.join(process.env.XDG_CONFIG_HOME!, "ghostty");
const userThemes = path.join(configDir, "themes");
const bundledThemes = path.join(process.env.GHOSTTY_RESOURCES_DIR!, "themes");
const piThemes = path.join(process.env.PI_CODING_AGENT_DIR!, "themes");
fs.mkdirSync(userThemes, { recursive: true });
fs.mkdirSync(bundledThemes, { recursive: true });

const ansi = ["#000001", "#cc0001", "#00cc02", "#cccc03", "#0000cc", "#cc00cc", "#00cccc", "#cccccc", "#888888", "#ff0001", "#00ff02", "#ffff03", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"];
const themeText = (colors = ansi, extra = "") => `${colors.map((color, i) => `palette = ${i}=${color}`).join("\n")}\n${extra}`;
const write = (file: string, text: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
};

write(path.join(userThemes, "Mine"), themeText(ansi, "background = #101010\nforeground = #EEEEEE\n"));
write(path.join(userThemes, "Shared"), themeText());
write(path.join(bundledThemes, "Shared"), themeText());
write(path.join(bundledThemes, "Bundled"), themeText());
write(path.join(bundledThemes, ".hidden"), themeText());

test("la lista de temas une los del usuario y los de Ghostty, sin repetidos ni ocultos", () => {
	const names = listThemes();
	for (const name of ["Mine", "Shared", "Bundled"]) assert.ok(names.includes(name), name);
	assert.equal(names.filter((name) => name === "Shared").length, 1);
	assert.ok(!names.includes(".hidden"));
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("loadTheme lee paleta, fondo y texto y pone los colores en minúscula", () => {
	const theme = loadTheme("Mine");
	assert.equal(theme?.name, "Mine");
	assert.equal(theme?.background, "#101010");
	assert.equal(theme?.foreground, "#eeeeee");
	assert.equal(theme?.palette.length, 16);
	assert.equal(theme?.palette[5], "#cc00cc");
});

test("loadTheme usa negro y blanco si faltan fondo y texto", () => {
	const theme = loadTheme("Bundled");
	assert.equal(theme?.background, "#000000");
	assert.equal(theme?.foreground, "#ffffff");
});

test("loadTheme acepta una ruta absoluta y rechaza lo que no sea un tema completo", () => {
	assert.equal(loadTheme(path.join(bundledThemes, "Bundled"))?.name, "Bundled");
	write(path.join(sandbox, "short"), themeText(ansi.slice(0, 15)));
	assert.equal(loadTheme(path.join(sandbox, "short")), undefined);
	assert.equal(loadTheme("No existe"), undefined);
});

test("el tema activo es el último `theme` de la configuración, con comillas quitadas", () => {
	write(path.join(configDir, "config"), 'font-size = 12\ntheme = "Primero"\n');
	assert.equal(activeThemeName(), "Primero");
	write(path.join(configDir, "config.ghostty"), "theme = Segundo\n");
	assert.equal(activeThemeName(), "Segundo");
});

test("con light:X,dark:Y se toma el tema oscuro", () => {
	write(path.join(configDir, "config.ghostty"), "theme = light:Claro,dark:Oscuro\n");
	assert.equal(activeThemeName(), "Oscuro");
	write(path.join(configDir, "config.ghostty"), "theme = light:Solo\n");
	assert.equal(activeThemeName(), "Solo");
});

test("un config-file incluido manda sobre el tema del fichero que lo incluye", () => {
	write(path.join(configDir, "extra.conf"), "theme = Incluido\n");
	write(path.join(configDir, "config.ghostty"), "theme = Propio\nconfig-file = ?extra.conf\n");
	assert.equal(activeThemeName(), "Incluido");
});

test("una inclusión circular no se queda en bucle", () => {
	write(path.join(configDir, "config.ghostty"), "theme = Ciclo\nconfig-file = config.ghostty\n");
	assert.equal(activeThemeName(), "Ciclo");
});

test("sin ningún tema en la configuración no hay tema activo", () => {
	fs.rmSync(path.join(configDir, "config"));
	write(path.join(configDir, "config.ghostty"), "font-size = 12\n");
	assert.equal(activeThemeName(), undefined);
});

test("el pintor emite color de 24 bits con los colores de la paleta", () => {
	const theme = loadTheme("Mine")!;
	assert.equal(painter(theme, "magenta").fg("accent", "x"), "\x1b[38;2;204;0;204m" + "x" + "\x1b[39m");
	assert.equal(painter(theme, "azul").fg("accent", "x"), "\x1b[38;2;0;0;204m" + "x" + "\x1b[39m");
	assert.equal(painter(theme, "magenta").fg("success", "x"), "\x1b[38;2;0;204;2mx\x1b[39m");
	assert.equal(painter(theme, "magenta").fg("error", "x"), "\x1b[38;2;204;0;1mx\x1b[39m");
});

test("el pintor resuelve el texto al color de primer plano y un rol desconocido igual", () => {
	const painted = painter(loadTheme("Mine")!, "magenta");
	assert.equal(painted.fg("text", "x"), "\x1b[38;2;238;238;238mx\x1b[39m");
	assert.equal(painted.fg("inventado", "x"), "\x1b[38;2;238;238;238mx\x1b[39m");
});

test("un acento desconocido cae en magenta", () => {
	const theme = loadTheme("Mine")!;
	assert.equal(painter(theme, "violeta").fg("accent", "x"), painter(theme, "magenta").fg("accent", "x"));
});

test("writePiTheme escribe el tema generado y borra los ghostty- anteriores", () => {
	fs.mkdirSync(piThemes, { recursive: true });
	fs.writeFileSync(path.join(piThemes, "ghostty-viejo-rojo.json"), "{}");
	fs.writeFileSync(path.join(piThemes, "mio.json"), "{}");
	const name = writePiTheme(loadTheme("Mine")!, "verde");
	assert.equal(name, "ghostty-mine-verde");
	assert.ok(!fs.existsSync(path.join(piThemes, "ghostty-viejo-rojo.json")));
	assert.ok(fs.existsSync(path.join(piThemes, "mio.json")));
	const written = JSON.parse(fs.readFileSync(path.join(piThemes, `${name}.json`), "utf8"));
	assert.equal(written.name, name);
	assert.equal(written.vars.accent, "#00cc02");
	assert.equal(written.vars.bg, "#101010");
	assert.equal(written.vars.dimGray, "#" + [0x10, 0x10, 0x10].map((c, i) => Math.round(c + ([0x88, 0x88, 0x88][i] - c) * 0.6).toString(16).padStart(2, "0")).join(""));
	assert.equal(written.colors.success, "green");
	assert.equal(written.colors.text, "");
});
