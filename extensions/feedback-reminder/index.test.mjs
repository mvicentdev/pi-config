// node --test extensions/feedback-reminder/index.test.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import feedbackReminder, { FEEDBACK, REMINDER } from "./index.ts";

// Un pi de mentira que guarda lo que la extensión registra.
function loadExtension() {
	const handlers = new Map();
	feedbackReminder({ on: (name, handler) => handlers.set(name, handler) });
	return handlers;
}

test("añade FEEDBACK.md al prompt de sistema sin perder el original", () => {
	const result = loadExtension().get("before_agent_start")({ systemPrompt: "Prompt base" });
	assert.equal(result.systemPrompt, `Prompt base\n\n${FEEDBACK}`);
});

test("resuelve {dir} a un directorio real que contiene CODE-ANSWERS.md", () => {
	assert.ok(!FEEDBACK.includes("{dir}"));
	const [, directory] = FEEDBACK.match(/`([^`]+)\/CODE-ANSWERS\.md`/) ?? [];
	assert.ok(directory, "FEEDBACK.md cita CODE-ANSWERS.md");
	assert.ok(existsSync(join(directory, "CODE-ANSWERS.md")));
});

test("añade el recordatorio una vez a cada mensaje del usuario", () => {
	const messages = [
		{ role: "user", content: "hola" },
		{ role: "assistant", content: [{ type: "text", text: "respuesta" }] },
		{ role: "user", content: [{ type: "text", text: "otra cosa" }] },
	];
	const result = loadExtension().get("context")({ messages });
	assert.equal(result.messages[0].content, `hola\n\n${REMINDER}`);
	assert.deepEqual(result.messages[1].content, [{ type: "text", text: "respuesta" }]);
	assert.deepEqual(result.messages[2].content, [
		{ type: "text", text: "otra cosa" },
		{ type: "text", text: REMINDER },
	]);
});

test("mantiene idéntico el prefijo de los mensajes anteriores entre turnos", () => {
	const context = loadExtension().get("context");
	const turn = (messages) => structuredClone(context({ messages: structuredClone(messages) }).messages);
	const first = [{ role: "user", content: "uno" }];
	const second = [...first, { role: "assistant", content: "dos" }, { role: "user", content: "tres" }];
	assert.deepEqual(turn(second).slice(0, 1), turn(first));
});
