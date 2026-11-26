import { resolve } from "node:path";

const KEYWORDS = new Set(["do", "then", "else", "time", "!", "{"]);

const reason = (what: string) =>
	[
		`Blocked before running: no part of this ${what} ran.`,
		"~/.zshrc and the shell environment hold credentials, so they are not printed.",
		'To look up one alias, run grep "^alias name=" ~/.zshrc ~/.zsh_aliases.',
	].join(" ");

// Parte la orden en tramos de palabras. Las comillas agrupan y se quitan, y los separadores solo cuentan fuera de ellas.
function segments(command: string): string[][] {
	const result: string[][] = [[]];
	let word = "";
	let quote = "";
	let open = false;
	const endWord = () => {
		if (open) result[result.length - 1].push(word);
		word = "";
		open = false;
	};
	const endSegment = () => {
		endWord();
		if (result[result.length - 1].length) result.push([]);
	};
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = "";
			else if (char === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			open = true;
		} else if (/\s/.test(char) && char !== "\n") endWord();
		else if (/[;&|\n`()]/.test(char)) endSegment();
		else if (char === "$" && command[i + 1] === "(") {
			i++;
			endSegment();
		} else {
			word += char;
			open = true;
		}
	}
	endWord();
	return result.filter((words) => words.length);
}

const WRAPPERS = new Set(["sudo", "command", "exec", "builtin", "nohup"]);
const ZSHRC = /\.zshrc(?![\w.-])/;
const ALIAS_PATTERN = /^\^alias [\w.-]*=?$/;

// Solo la búsqueda de una línea de alias: la orden entera es un grep con opciones fijas y ese patrón.
function aliasLookup(command: string): boolean {
	const parts = segments(command);
	if (parts.length !== 1) return false;
	const [name, ...args] = parts[0];
	if (name !== "grep") return false;
	const patterns: string[] = [];
	const files: string[] = [];
	let explicit = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-m") {
			if (!/^\d+$/.test(args[++i] ?? "")) return false;
		} else if (/^-m\d+$/.test(arg) || arg === "-h" || arg === "-H" || arg === "-n") continue;
		else if (arg === "-e") {
			explicit = true;
			if (args[++i] === undefined) return false;
			patterns.push(args[i]);
		} else if (arg.startsWith("-")) return false;
		else if (!explicit && !patterns.length) patterns.push(arg);
		else files.push(arg);
	}
	return patterns.length === 1 && ALIAS_PATTERN.test(patterns[0]) && files.length > 0;
}

function printsEnvironment(name: string, args: readonly string[]): boolean {
	if (name === "zsh" && args.some((arg) => /^-[a-z]*[il]/.test(arg) || /^--(login|interactive)$/.test(arg))) return true;
	if (name === "printenv") return true;
	if (name === "set") return args.length === 0;
	if (name === "export") return args.includes("-p");
	if (name === "declare") return args.some((arg) => arg === "-x" || arg === "-p");
	if (name === "typeset") return args.includes("-x");
	if (name !== "env") return false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "-u" || args[i] === "-C") i++;
		else if (!args[i].startsWith("-") && !/^\w+=/.test(args[i])) return false;
	}
	return true;
}

// Revisa cada tramo y, en `bash -c "..."`, el texto que sigue a -c.
function printsEnvironmentIn(command: string): boolean {
	for (const segment of segments(command)) {
		const words = segment.filter((word) => !/^\w+=/.test(word) && !KEYWORDS.has(word));
		while (words.length && WRAPPERS.has(words[0].replace(/^.*\//, ""))) words.shift();
		const name = words[0]?.replace(/^.*\//, "") ?? "";
		const args = words.slice(1);
		if (printsEnvironment(name, args)) return true;
		if (name !== "bash" && name !== "sh" && name !== "zsh") continue;
		const flag = args.findIndex((arg) => /^-[a-z]*c$/.test(arg));
		if (flag >= 0 && args[flag + 1] !== undefined && printsEnvironmentIn(args[flag + 1])) return true;
	}
	return false;
}

export function credentialsReason(command: string, _home: string): string | null {
	if (ZSHRC.test(command) && !aliasLookup(command)) return reason("command");
	return printsEnvironmentIn(command) ? reason("command") : null;
}

export function credentialsPathReason(toolName: string, path: string | undefined, home: string, cwd: string = home): string | null {
	if (!path || (toolName !== "read" && toolName !== "grep")) return null;
	const expanded = path === "~" || path.startsWith("~/") ? home + path.slice(1) : path;
	return resolve(cwd, expanded) === resolve(home, ".zshrc") ? reason("call") : null;
}
