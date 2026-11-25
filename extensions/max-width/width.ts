export const MIN = 40;

type WidthArgument = { align: "left" | "center" } | { columns: number };

/** Lo que pide `/max-width <valor>`. Sin valor equivale a `off`. Un valor inválido da undefined. */
export function parseWidthArgument(value: string): WidthArgument | undefined {
	if (value === "left" || value === "center") return { align: value };
	const columns = value === "off" ? 0 : Number(value);
	return Number.isInteger(columns) && columns >= 0 && (columns === 0 || columns >= MIN) ? { columns } : undefined;
}

/** Margen izquierdo que centra `columns` columnas en un terminal de `width`. */
export const padOf = (width: number, columns: number) => Math.floor((width - columns) / 2);

/** Columna del terminal (desde 1) que corresponde a una de la pantalla centrada. */
export const shiftColumn = (x: number, pad: number, columns: number) => Math.min(columns, Math.max(1, x - pad));
