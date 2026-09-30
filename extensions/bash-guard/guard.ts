const FILE_COMMANDS = new Set(["cat", "sed", "grep", "egrep", "rg", "find", "head", "tail"]);
const KEYWORDS = new Set(["do", "then", "else", "time", "!", "{", "("]);

// Cuerpos de heredoc y cadenas entrecomilladas: texto, no comandos.
const stripLiterals = (command: string) =>
	command
		.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, " ")
		.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

/**
 * La orden de ficheros que abre un tramo de `command`, o null si no hay ninguna. Un tramo es lo que
 * separan `&&`, `||`, `;`, `&`, un salto de línea o `$(`; dentro de él, solo cuenta la primera orden
 * de la tubería, porque lo que va detrás de `|` recorta la salida de otro comando. Una tubería que
 * acaba en `wc` es un recuento exacto y pasa.
 */
export function fileCommand(command: string): string | null {
	for (const segment of stripLiterals(command).split(/&&|\|\||;|&|\n|\$\(|`/)) {
		const pipeline = segment.split("|");
		const last = pipeline.at(-1)?.trim().split(/\s+/)[0];
		if (pipeline.length > 1 && last === "wc") continue;
		const words = pipeline[0].trim().split(/\s+/).filter((word) => !/^\w+=/.test(word) && !KEYWORDS.has(word));
		const name = words[0]?.replace(/^.*\//, "");
		if (name && FILE_COMMANDS.has(name)) return name;
	}
	return null;
}
