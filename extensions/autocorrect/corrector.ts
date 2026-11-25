import { accentFix, type Word } from "./correction.ts";

export type Guesses = Record<string, string[]>;

export interface Guesser {
	/** Candidatos de cada palabra desconocida. undefined si el diccionario no respondió a tiempo. */
	guesses(words: string[]): Promise<Guesses | undefined>;
}

/** Guarda la decisión de cada palabra: la corrección, o undefined para dejarla. */
export class Corrector {
	private readonly decided = new Map<string, Promise<string | undefined>>();

	private readonly dictionary: Guesser;

	constructor(dictionary: Guesser) {
		this.dictionary = dictionary;
	}

	decide(words: Word[]): Promise<(string | undefined)[]> {
		const missing = [...new Set(words.map(({ word }) => word))].filter((word) => !this.decided.has(word));
		if (missing.length) {
			const batch = this.dictionary.guesses(missing);
			for (const word of missing) {
				const decision = batch.then((guesses) => {
					if (!guesses) throw new Error("el diccionario no respondió");
					return accentFix(word, guesses[word] ?? []);
				});
				this.decided.set(word, decision);
				// Un fallo no se guarda: la palabra se vuelve a consultar en la siguiente revisión.
				decision.catch(() => this.decided.delete(word));
			}
		}
		return Promise.all(words.map(({ word }) => this.decided.get(word)!.catch(() => undefined)));
	}
}
