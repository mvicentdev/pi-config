// Candidatos de corrección del diccionario de macOS (NSSpellChecker), servido por JXA: una petición
// JSON por línea en stdin, {"id":1,"words":["tambien","hola"],"languages":["es","en"]}, y una
// respuesta por línea en stdout, {"id":1,"guesses":{"tambien":["también","cambien"]}}. Solo trae
// las palabras que ningún idioma conoce y que tienen algún candidato.
ObjC.import("AppKit");

// Candidatos por idioma, para que el primero no acapare la lista.
const GUESSES_PER_LANGUAGE = 3;
const checker = $.NSSpellChecker.sharedSpellChecker;
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;

function isKnown(word, language) {
	const miss = checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount(word, 0, language, false, 0, null);
	return Number(miss.length) === 0;
}

function guessesFor(word, languages) {
	if (languages.some((language) => isKnown(word, language))) return [];
	const found = languages.flatMap(
		(language) => ObjC.deepUnwrap(checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag($.NSMakeRange(0, word.length), word, language, 0))?.slice(0, GUESSES_PER_LANGUAGE) ?? [],
	);
	return [...new Set(found)].filter((guess) => guess !== word);
}

function reply(line) {
	let answer;
	try {
		const { id, words, languages } = JSON.parse(line);
		const guesses = {};
		for (const word of words) {
			const found = guessesFor(word, languages);
			if (found.length) guesses[word] = found;
		}
		answer = { id, guesses };
	} catch (error) {
		answer = { id: null, error: String(error) };
	}
	stdout.writeData($(`${JSON.stringify(answer)}\n`).dataUsingEncoding($.NSUTF8StringEncoding));
}

let pending = "";
for (;;) {
	const data = stdin.availableData;
	if (Number(data.length) === 0) break;
	pending += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
	let end;
	while ((end = pending.indexOf("\n")) >= 0) {
		reply(pending.slice(0, end));
		pending = pending.slice(end + 1);
	}
}
