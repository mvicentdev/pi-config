// node --test extensions/autocorrect/correction.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { accentFix, applyFixes, proseWords, touchesCursor } from "./correction.ts";

const words = (text: string) => proseWords(text).map(({ word }) => word);

test("revisa las palabras de prosa con su posición", () => {
	assert.deepEqual(proseWords("revisa tambien, ¿Tambien?"), [
		{ word: "revisa", start: 0 },
		{ word: "tambien", start: 7 },
		{ word: "Tambien", start: 17 },
	]);
	assert.deepEqual(words("usa `tambien` y ```\nqeu\n``` aplicacion"), ["usa", "aplicacion"]);
});

test("deja en paz rutas, comandos, siglas e identificadores", () => {
	assert.deepEqual(words("src/tambien @tambien a.tambien snake_tambien abc1 usa HTTP camelCase de"), ["usa"]);
	assert.deepEqual(words("/model tambien"), []);
	assert.deepEqual(words("!ls tambien"), []);
});

test("aplica las correcciones y recoloca el cursor", () => {
	const fixes = [
		{ word: "tambien", start: 0, correction: "también" },
		{ word: "aver", start: 12, correction: "a ver" },
	];
	assert.deepEqual(applyFixes("tambien que aver hola", fixes, 16), { text: "también que a ver hola", offset: 17 });
	assert.deepEqual(applyFixes("tambien que aver hola", fixes, 3), { text: "también que a ver hola", offset: 3 });
});

test("la palabra pegada al cursor se está escribiendo todavía", () => {
	const word = { word: "tambien", start: 4 };
	assert.equal(touchesCursor(word, 11), true);
	assert.equal(touchesCursor(word, 12), false);
	assert.equal(touchesCursor(word, 8), false);
});

test("corrige solo la tilde o la eñe inequívoca", () => {
	assert.equal(accentFix("tambien", ["también", "cambien"]), "también");
	assert.equal(accentFix("manana", ["mañana", "mana"]), "mañana");
	assert.equal(accentFix("qeu", ["que", "leu"]), undefined);
	assert.equal(accentFix("ambos", ["ámbos", "ambós"]), undefined);
});
