import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const FILE_COMMANDS = new Set(["cat", "sed", "grep", "egrep", "rg", "find", "head", "tail"]);
const KEYWORDS = new Set(["do", "then", "else", "time", "!", "{", "("]);

// Heredocs y cadenas son texto. Se conserva lo que sigue al delimitador, como una redirección.
const stripLiterals = (command: string) =>
	command
		.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\s|$)/g, " $3")
		.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

// Un `cat` que redirige a un fichero escribe sin imprimir. /dev/stdout y `>(…)` sí imprimen.
const isFile = (target: string | undefined) => !!target && !/^[&>(]/.test(target) && !target.startsWith("/dev/");
const writesToFile = (words: readonly string[]) =>
	words.some((word, index) => {
		const redirect = word.match(/^1?>>?(.*)$/);
		return !!redirect && isFile(redirect[1] || words[index + 1]);
	});

export function insideRepository(path: string): boolean {
	for (let dir = path; ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".git"))) return true;
		if (dirname(dir) === dir) return false;
	}
}

const expandHome = (word: string) => (word === "~" || word.startsWith("~/") ? homedir() + word.slice(1) : word);

const PATTERN_FIRST = new Set(["grep", "egrep", "rg", "sed"]);
const PATTERN_OPTION = /^(-[a-zA-Z]*[ef]|--(regexp|file|expression))/;

// Una cadena o una variable cuentan como ruta relativa.
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

function changeDirectory(cwd: string, args: readonly string[]): string {
	const target = args.find((arg) => !arg.startsWith("-") || arg === "-");
	if (target === "-") return cwd;
	return resolve(cwd, expandHome(target ?? "~"));
}

// fff indexa por ruta absoluta cualquier copia de trabajo, sin `cd`.
export function blockReason({ name, directory }: { name: string; directory: string | null }, cwd: string): string {
	const where = directory && directory !== cwd ? ` For ${directory}, pass absolute paths under it to read, grep and find.` : "";
	return [
		`Blocked before running: no part of this command ran. \`${name}\` is not run through bash inside a repository.`,
		"Read a file with the read tool, using offset/limit for a range. For several files, call read once per file in the same block.",
		`Search contents with the grep tool and paths with the find tool.${where}`,
		"Rerun git, builds and the other parts in a bash call of their own.",
		"Piping another command's output (`cmd | tail`), exact counts (`… | wc -l`), `cat > file` writes and reads outside any repository are allowed.",
	].join(" ");
}

// Lo que sigue a `|` recorta la salida de otra orden, así que solo cuenta la primera.
export function fileCommand(
	command: string,
	cwd: string = process.cwd(),
	inRepo: (path: string) => boolean = insideRepository,
): { name: string; directory: string | null } | null {
	for (const segment of stripLiterals(command).split(/&&|\|\||;|&|\n|\$\(|`/)) {
		const pipeline = segment.split("|");
		const last = pipeline.at(-1)?.trim().split(/\s+/)[0];
		if (pipeline.length > 1 && last === "wc") continue;
		const words = pipeline[0].trim().split(/\s+/).filter((word) => !/^\w+=/.test(word) && !KEYWORDS.has(word));
		const name = words[0]?.replace(/^.*\//, "");
		if (name === "cat" && pipeline.length === 1 && writesToFile(words)) continue;
		if (name === "cd") cwd = changeDirectory(cwd, words.slice(1));
		if (name && FILE_COMMANDS.has(name) && readsRepository(name, words.slice(1), cwd, inRepo)) return { name, directory: inRepo(cwd) ? cwd : null };
	}
	return null;
}
