import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const FILE_COMMANDS = new Set(["cat", "sed", "grep", "egrep", "rg", "find", "head", "tail"]);
const KEYWORDS = new Set(["do", "then", "else", "time", "!", "{", "("]);

// Cuerpos de heredoc y cadenas entrecomilladas: texto, no comandos. Lo que sigue al delimitador
// en su línea, como una redirección, se conserva.
const stripLiterals = (command: string) =>
	command
		.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\s|$)/g, " $3")
		.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

// Un `cat` que redirige su salida a un fichero escribe sin imprimir nada.
// Un dispositivo como /dev/stdout o una sustitución `>(…)` sí imprimen.
const isFile = (target: string | undefined) => !!target && !/^[&>(]/.test(target) && !target.startsWith("/dev/");
const writesToFile = (words: readonly string[]) =>
	words.some((word, index) => {
		const redirect = word.match(/^1?>>?(.*)$/);
		return !!redirect && isFile(redirect[1] || words[index + 1]);
	});

/** Si `path` cae dentro de un repositorio git: él o un directorio padre guarda `.git`. */
export function insideRepository(path: string): boolean {
	for (let dir = path; ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".git"))) return true;
		if (dirname(dir) === dir) return false;
	}
}

const expandHome = (word: string) => (word === "~" || word.startsWith("~/") ? homedir() + word.slice(1) : word);

const PATTERN_FIRST = new Set(["grep", "egrep", "rg", "sed"]);
const PATTERN_OPTION = /^(-[a-zA-Z]*[ef]|--(regexp|file|expression))/;

/**
 * Las rutas que lee un tramo. Una redirección de entrada aporta la suya, y una de salida no aporta
 * ninguna. El primer operando de grep, rg o sed es su patrón, salvo que lo dé una opción. find solo lee
 * las rutas previas a su primera expresión. Una cadena o una variable cuentan como una ruta relativa.
 */
function operands(name: string, args: readonly string[]): string[] {
	const paths: string[] = [];
	let skipPattern = PATTERN_FIRST.has(name) && !args.some((arg) => PATTERN_OPTION.test(arg));
	const rest = [...args];
	while (rest.length) {
		const arg = rest.shift() as string;
		if (/^\d*>/.test(arg)) {
			if (/^\d*>>?&?$/.test(arg)) rest.shift();
			continue;
		}
		if (arg.startsWith("<")) {
			paths.push(arg.slice(1) || rest.shift() || "");
			continue;
		}
		if (name === "find" && /^[-(!]/.test(arg)) break;
		if (arg.startsWith("-") || /^\d+$/.test(arg)) continue;
		if (skipPattern) skipPattern = false;
		else paths.push(arg);
	}
	return paths;
}

function readsRepository(name: string, args: readonly string[], cwd: string, inRepo: (path: string) => boolean): boolean {
	const paths = operands(name, args);
	const targets = paths.length ? paths.map((path) => resolve(cwd, expandHome(path))) : [cwd];
	return targets.some(inRepo);
}

// El destino de un `cd`: su primer operando, o la carpeta personal sin él. `cd -` no cambia nada.
function changeDirectory(cwd: string, args: readonly string[]): string {
	const target = args.find((arg) => !arg.startsWith("-") || arg === "-");
	if (target === "-") return cwd;
	return resolve(cwd, expandHome(target ?? "~"));
}

/**
 * La orden de ficheros que abre un tramo de `command` y lee dentro de un repositorio, o null si no hay
 * ninguna. Dentro de un repositorio buscan fff y read. Fuera, como en /tmp o en los registros de
 * sesiones, la orden corre en bash. Un `cd` de un tramo cambia el directorio de los siguientes.
 *
 * Un tramo es lo que separan `&&`, `||`, `;`, `&`, un salto de línea o `$(`.
 * Dentro de un tramo solo cuenta la primera orden de la tubería.
 * Lo que va detrás de `|` recorta la salida de otro comando.
 * Una tubería que acaba en `wc` es un recuento exacto y pasa.
 * Un `cat` que escribe en un fichero también pasa.
 */
export function fileCommand(
	command: string,
	cwd: string = process.cwd(),
	inRepo: (path: string) => boolean = insideRepository,
): string | null {
	for (const segment of stripLiterals(command).split(/&&|\|\||;|&|\n|\$\(|`/)) {
		const pipeline = segment.split("|");
		const last = pipeline.at(-1)?.trim().split(/\s+/)[0];
		if (pipeline.length > 1 && last === "wc") continue;
		const words = pipeline[0].trim().split(/\s+/).filter((word) => !/^\w+=/.test(word) && !KEYWORDS.has(word));
		const name = words[0]?.replace(/^.*\//, "");
		if (name === "cat" && pipeline.length === 1 && writesToFile(words)) continue;
		if (name === "cd") cwd = changeDirectory(cwd, words.slice(1));
		if (name && FILE_COMMANDS.has(name) && readsRepository(name, words.slice(1), cwd, inRepo)) return name;
	}
	return null;
}
