// Qué palabras del mensaje se revisan, qué respuesta de Jev se acepta y cómo se aplica, sin
// dependencias para poder probarlo aparte.

export type Word = { word: string; start: number };
export type Fix = Word & { correction: string };
export type JevAnswer = { type: string; choice?: string; probabilities?: Record<string, number> };

// Probabilidad mínima que Jev debe dar a un candidato para sustituir la palabra escrita.
export const MIN_PROBABILITY = 0.8;

// Palabra delimitada por espacios o puntuación a ambos lados: así quedan fuera rutas, menciones,
// dominios, correos e identificadores con guion bajo, punto, barra o dígitos.
const WORD = /(?<=^|[\s(¿¡"«])[\p{L}\p{M}]+(?=$|[\s.,;:!?)\]}»"])/gu;

/** Palabras de prosa del mensaje: fuera de `código`, bloques ```, comandos, siglas y camelCase. */
export function proseWords(text: string): Word[] {
	if (/^\s*[/!]/.test(text)) return []; // comando de pi o bash
	const words: Word[] = [];
	let offset = 0;
	text.split("`").forEach((segment, index) => {
		if (index % 2 === 0) {
			for (const match of segment.matchAll(WORD)) {
				const word = match[0];
				if (word.length >= 3 && !/\p{Lu}/u.test(word.slice(1))) words.push({ word, start: offset + match.index });
			}
		}
		offset += segment.length + 1;
	});
	return words;
}

/** La corrección que Jev elige con probabilidad suficiente, si no es dejar la palabra como está. */
export function pickCorrection(word: string, answer: JevAnswer | undefined): string | undefined {
	const choice = answer?.type === "choice" ? answer.choice : undefined;
	if (!choice || choice === word || (answer?.probabilities?.[choice] ?? 0) < MIN_PROBABILITY) return;
	return choice;
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/** El único candidato que solo cambia tildes o eñes: se corrige sin preguntar a Jev. */
export function accentFix(word: string, guesses: string[]): string | undefined {
	const same = guesses.filter((guess) => guess !== word && fold(guess) === fold(word));
	return same.length === 1 ? same[0] : undefined;
}

/** Texto con las correcciones aplicadas, y dónde queda un desplazamiento del texto original. */
export function applyFixes(text: string, fixes: Fix[], offset: number): { text: string; offset: number } {
	let shift = 0;
	for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
		text = text.slice(0, fix.start) + fix.correction + text.slice(fix.start + fix.word.length);
		if (fix.start + fix.word.length <= offset) shift += fix.correction.length - fix.word.length;
	}
	return { text, offset: offset + shift };
}
