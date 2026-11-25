import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULTS } from "./segments.ts";
import { loadSettings, saveSettings } from "./settings.ts";

const file = path.join(process.env.PI_CODING_AGENT_DIR!, "status-line.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
after(() => fs.rmSync(file, { force: true }));

const colorDefaults = { palette: "tema de pi", scope: "barra", accent: "magenta" };

test("sin fichero se cargan los valores por defecto y los de color", () => {
	fs.rmSync(file, { force: true });
	assert.deepEqual(loadSettings(), { ...DEFAULTS, ...colorDefaults });
});

test("el fichero pisa solo las claves que trae", () => {
	fs.writeFileSync(file, JSON.stringify({ model: "nombre", accent: "azul" }));
	const settings = loadSettings();
	assert.equal(settings.model, "nombre");
	assert.equal(settings.accent, "azul");
	assert.equal(settings.scope, "barra");
	assert.equal(settings.lines, DEFAULTS.lines);
});

test("un fichero ilegible devuelve los valores por defecto", () => {
	fs.writeFileSync(file, "{no es json");
	assert.deepEqual(loadSettings(), { ...DEFAULTS, ...colorDefaults });
});

test("guardar escribe JSON con tabuladores y salto final, y se recarga igual", () => {
	const settings = { ...DEFAULTS, ...colorDefaults, tokens: "total", restoreTheme: "dark" };
	saveSettings(settings);
	const text = fs.readFileSync(file, "utf8");
	assert.ok(text.startsWith("{\n\t\""));
	assert.ok(text.endsWith("}\n"));
	assert.deepEqual(loadSettings(), settings);
});
