// node --test extensions/max-width/width.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN, padOf, parseWidthArgument, shiftColumn } from "./width.ts";

test("left y center cambian la alineación", () => {
	assert.deepEqual(parseWidthArgument("left"), { align: "left" });
	assert.deepEqual(parseWidthArgument("center"), { align: "center" });
});

test("un número entero desde el mínimo fija las columnas y off o vacío las quitan", () => {
	assert.deepEqual(parseWidthArgument("120"), { columns: 120 });
	assert.deepEqual(parseWidthArgument(String(MIN)), { columns: MIN });
	assert.deepEqual(parseWidthArgument("off"), { columns: 0 });
	assert.deepEqual(parseWidthArgument("0"), { columns: 0 });
	assert.deepEqual(parseWidthArgument(""), { columns: 0 });
});

test("rechaza lo que no es un ancho válido", () => {
	for (const value of [String(MIN - 1), "-5", "80.5", "ancho", "NaN", "Infinity"]) assert.equal(parseWidthArgument(value), undefined, value);
});

test("el margen reparte el sobrante a ambos lados y redondea hacia abajo", () => {
	assert.equal(padOf(200, 120), 40);
	assert.equal(padOf(121, 120), 0);
	assert.equal(padOf(125, 120), 2);
});

test("un clic se descuenta el margen y se queda dentro de la columna", () => {
	assert.equal(shiftColumn(50, 40, 120), 10);
	assert.equal(shiftColumn(20, 40, 120), 1);
	assert.equal(shiftColumn(200, 40, 120), 120);
	assert.equal(shiftColumn(7, 0, 120), 7);
});
