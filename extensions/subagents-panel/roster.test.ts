// node --test extensions/subagents-panel/roster.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LINGER_MS, Roster, activity, formatElapsed, formatTokens } from "./roster.ts";

const agent = { id: "a1", type: "worker", description: "Renombrar el módulo" };

test("sigue la herramienta en curso y cuenta las terminadas", () => {
	const roster = new Roster();
	roster.start(agent, 1000);
	assert.equal(roster.apply("a1", { type: "tool_execution_start", toolCallId: "t1", toolName: "read" }), true);
	assert.equal(activity(roster.get("a1")!), "leyendo…");
	assert.equal(roster.apply("a1", { type: "tool_execution_end", toolCallId: "t1", toolName: "read" }), true);
	assert.equal(roster.get("a1")!.toolUses, 1);
	assert.equal(activity(roster.get("a1")!), "pensando…");
});

test("solo repinta el texto cuando cambia su primera línea", () => {
	const roster = new Roster();
	roster.start(agent, 1000);
	const delta = (text: string) => roster.apply("a1", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
	assert.equal(delta("Voy a"), true);
	assert.equal(delta(" leer"), true);
	assert.equal(delta("\nsegunda línea"), false);
	assert.equal(activity(roster.get("a1")!), "Voy a leer");
	assert.equal(roster.apply("a1", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } }), false);
});

test("limita la vista previa a 160 caracteres incluso con deltas grandes", () => {
	const roster = new Roster();
	roster.start(agent);
	const delta = (text: string) => roster.apply("a1", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
	assert.equal(delta("  \n\t\n" + "a".repeat(1_000_000)), true);
	assert.equal(roster.get("a1")!.text, "a".repeat(160));
	assert.equal(delta("b".repeat(1_000_000)), false);
	assert.equal(roster.get("a1")!.text, "a".repeat(160));
});

test("el comienzo de otro mensaje borra la vista previa y permite mostrar la siguiente", () => {
	const roster = new Roster();
	roster.start(agent);
	const delta = (text: string) => roster.apply("a1", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
	assert.equal(roster.apply("a1", { type: "message_start" }), false);
	assert.equal(delta("Primera\nignoradas"), true);
	assert.equal(delta("más texto"), false);
	assert.equal(roster.apply("a1", { type: "message_start" }), true);
	assert.equal(activity(roster.get("a1")!), "pensando…");
	assert.equal(delta("Segunda"), true);
	assert.equal(activity(roster.get("a1")!), "Segunda");
});

test("acumula los tokens de cada mensaje del asistente", () => {
	const roster = new Roster();
	roster.start(agent, 1000);
	roster.apply("a1", { type: "message_end", message: { role: "assistant", usage: { input: 1000, output: 200, cacheWrite: 300 } } });
	roster.apply("a1", { type: "message_end", message: { role: "user" } });
	assert.equal(roster.get("a1")!.tokens, 1500);
});

test("muestra los terminados un rato y luego los olvida", () => {
	const roster = new Roster();
	roster.start(agent, 1000);
	roster.start({ id: "a2", type: "explorer", description: "Buscar usos" }, 2000);
	roster.finish("a1", "completed", { toolUses: 7, tokens: 12_000 }, 5000);
	assert.deepEqual(roster.visible(5000).map((row) => row.id), ["a2", "a1"]);
	assert.equal(roster.get("a1")!.toolUses, 7);
	assert.deepEqual(roster.visible(5000 + LINGER_MS).map((row) => row.id), ["a2"]);
	roster.prune(5000 + LINGER_MS);
	assert.equal(roster.get("a1"), undefined);
	assert.equal(roster.hasRunning(), true);
});

test("formatea tiempos y tokens", () => {
	assert.equal(formatElapsed(45_000), "45s");
	assert.equal(formatElapsed(80_000), "1m20s");
	assert.equal(formatElapsed(3_660_000), "1h01m");
	assert.equal(formatTokens(950), "950");
	assert.equal(formatTokens(34_500), "34.5k");
	assert.equal(formatTokens(2_100_000), "2.1M");
});
