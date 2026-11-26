import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

export const EDIT_REASON =
	"Blocked before writing: the main loop does not change code or tests in a repository. Hand this change to a `worker` subagent with a complete brief: the goal, the exact paths, what stays untouched and the command that proves it.";

const WRITE_TOOLS = new Set(["edit", "write"]);

export function insideWorkingTree(path: string): boolean {
	for (let dir = path; ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".git"))) return true;
		if (dirname(dir) === dir) return false;
	}
}

// Un fichero nuevo aún no existe: se resuelve el antepasado más cercano que existe y se le añade el resto.
export function realLocation(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(realLocation(parent), basename(path));
	}
}

// Igual que las herramientas de pi: quita la @ inicial y expande ~.
function absolute(path: string, cwd: string, home: string): string {
	const bare = path.startsWith("@") ? path.slice(1) : path;
	const expanded = bare === "~" || bare.startsWith("~/") ? home + bare.slice(1) : bare;
	return resolve(cwd, expanded);
}

export function editReason(toolName: string, path: unknown, cwd: string, home: string = homedir()): string | null {
	if (!WRITE_TOOLS.has(toolName) || typeof path !== "string" || !path) return null;
	const target = realLocation(absolute(path, cwd, home));
	if (extname(target).toLowerCase() === ".md") return null;
	return insideWorkingTree(target) ? EDIT_REASON : null;
}
