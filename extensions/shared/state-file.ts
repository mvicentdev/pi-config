import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Ruta de un fichero JSON de preferencias en el directorio de pi, que `PI_CODING_AGENT_DIR` puede mover. */
export const stateFile = (name: string) => path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), name);

/** Lo guardado en `file`, o undefined si falta o no es JSON válido. */
export function readJson(file: string): any {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

export function writeJson(file: string, value: unknown): void {
	fs.writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
}
