import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EDIT_REASON =
	"Blocked before writing: the main loop does not change code or tests in a repository. Hand this change to a `worker` subagent with a complete brief: the goal, the exact paths, what stays untouched and the command that proves it.";

const WRITE_TOOLS = new Set(["edit", "write"]);
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

// .git es un directorio en un repositorio y un fichero en un worktree enlazado o un submódulo. existsSync acepta los dos.
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

// Copia de resolveToCwd de pi (dist/core/tools/path-utils.js y dist/utils/paths.js), que su punto de entrada no exporta.
// Cambia los espacios Unicode por espacios, quita la @ inicial, expande ~ y traduce file://. Omite las rutas de shell de Windows.
function absolute(path: string, cwd: string, home: string): string {
	let bare = path.replace(UNICODE_SPACES, " ");
	if (bare.startsWith("@")) bare = bare.slice(1);
	if (bare === "~") bare = home;
	else if (bare.startsWith("~/")) bare = join(home, bare.slice(2));
	else if (bare.startsWith("file://")) bare = fileURLToPath(bare);
	return resolve(cwd, bare);
}

function judge(target: string): string | null {
	const real = realLocation(target);
	if (extname(real).toLowerCase() === ".md") return null;
	return insideWorkingTree(real) ? EDIT_REASON : null;
}

export function editReason(toolName: string, path: unknown, cwd: string, home: string = homedir()): string | null {
	if (!WRITE_TOOLS.has(toolName) || typeof path !== "string" || !path) return null;
	return judge(absolute(path, cwd, home));
}

// lsp_fix de @narumitw/pi-lsp escribe el arreglo en el fichero solo con write: true. Sin él solo lo muestra.
// Resuelve path contra root, y root contra el directorio de la sesión, sin ~, @ ni file://.
export function lspFixReason(input: Record<string, unknown>, cwd: string): string | null {
	const { path, root, write } = input;
	if (write !== true || typeof path !== "string" || !path) return null;
	const base = resolve(cwd, (typeof root === "string" && root.trim()) || ".");
	return judge(resolve(base, path));
}

export function toolCallReason(toolName: string, input: unknown, cwd: string, home: string = homedir()): string | null {
	if (!input || typeof input !== "object") return null;
	const fields = input as Record<string, unknown>;
	if (toolName === "lsp_fix") return lspFixReason(fields, cwd);
	return editReason(toolName, fields.path, cwd, home);
}
