import { resolve } from "node:path";

const reason = (what: string) =>
	`Blocked before running: no part of this ${what} ran. ~/.zshrc holds credentials, so it is not read. To look up one alias, run grep "^alias name=" ~/.zshrc ~/.zsh_aliases.`;

const ZSHRC = /\.zshrc(?![\w.-])/;
// Comando completo: un grep, opciones fijas, un patrón de alias entre comillas y palabras de fichero simples.
const ALIAS_LOOKUP = /^grep(?: -m ?\d+| -[hHn])*(?: -e)? (["'])\^alias [\w.-]+=?\1(?: [\w~./][\w~./-]*)+$/;

export function credentialsReason(command: string): string | null {
	return ZSHRC.test(command) && !ALIAS_LOOKUP.test(command) ? reason("command") : null;
}

export function credentialsPathReason(toolName: string, path: string | undefined, home: string, cwd: string = home): string | null {
	if (!path || (toolName !== "read" && toolName !== "grep")) return null;
	const expanded = path === "~" || path.startsWith("~/") ? home + path.slice(1) : path;
	return resolve(cwd, expanded) === resolve(home, ".zshrc") ? reason("call") : null;
}
