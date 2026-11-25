// node --test extensions/autocorrect/corrector.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Corrector, type Guesses } from "./corrector.ts";

// Un diccionario falso que apunta las consultas y responde con lo que se le pida.
function fakeDictionary(...replies: (Guesses | undefined)[]) {
	const asked: string[][] = [];
	return { asked, guesses: async (words: string[]) => (asked.push(words), replies.shift()) };
}

const word = (text: string, start = 0) => ({ word: text, start });

test("corrige la palabra con una única tilde posible", async () => {
	const corrector = new Corrector(fakeDictionary({ tambien: ["también", "cambien"], manana: ["mañana", "mana"] }));
	assert.deepEqual(await corrector.decide([word("tambien"), word("manana", 8)]), ["también", "mañana"]);
});

test("deja la palabra ambigua o sin candidatos", async () => {
	const corrector = new Corrector(fakeDictionary({ ambos: ["ámbos", "ambós"] }));
	assert.deepEqual(await corrector.decide([word("ambos"), word("xyz", 6)]), [undefined, undefined]);
});

test("consulta una vez cada palabra, repetida o ya decidida", async () => {
	const dictionary = fakeDictionary({ tambien: ["también"] });
	const corrector = new Corrector(dictionary);
	assert.deepEqual(await corrector.decide([word("tambien"), word("tambien", 8)]), ["también", "también"]);
	assert.deepEqual(await corrector.decide([word("tambien", 3)]), ["también"]);
	assert.deepEqual(dictionary.asked, [["tambien"]]);
});

test("un diccionario que no responde a tiempo no se guarda y se vuelve a consultar", async () => {
	const dictionary = fakeDictionary(undefined, { tambien: ["también"] });
	const corrector = new Corrector(dictionary);
	assert.deepEqual(await corrector.decide([word("tambien")]), [undefined]);
	assert.deepEqual(await corrector.decide([word("tambien")]), ["también"]);
	assert.deepEqual(dictionary.asked, [["tambien"], ["tambien"]]);
});

test("solo consulta las palabras que faltan", async () => {
	const dictionary = fakeDictionary({ tambien: ["también"] }, { manana: ["mañana"] });
	const corrector = new Corrector(dictionary);
	await corrector.decide([word("tambien")]);
	assert.deepEqual(await corrector.decide([word("tambien"), word("manana", 8)]), ["también", "mañana"]);
	assert.deepEqual(dictionary.asked, [["tambien"], ["manana"]]);
});
