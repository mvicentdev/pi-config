// node --test extensions/advisor/context.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { advisorMessages } from "./context.ts";

const assistant = (content: AssistantMessage["content"]) => ({ role: "assistant", content }) as AssistantMessage;
const call = (id: string) => ({ type: "toolCall" as const, id, name: "bash", arguments: {} });
const result = (toolCallId: string) =>
	({ role: "toolResult", toolCallId, toolName: "bash", content: [], isError: false, timestamp: 0 }) as Message;

test("quita las llamadas sin resultado y conserva las resueltas", () => {
	const user: Message = { role: "user", content: "hola", timestamp: 0 };
	const text = { type: "text" as const, text: "miro" };
	assert.deepEqual(
		advisorMessages([user, assistant([call("a")]), result("a"), assistant([text, call("b"), call("advisor")])]),
		[user, assistant([call("a")]), result("a"), assistant([text])],
	);
});

test("descarta el mensaje del asistente que se queda vacío y los mensajes de sistema", () => {
	const system = { role: "system", content: "prompt" } as Message;
	assert.deepEqual(advisorMessages([system, assistant([call("advisor")])]), []);
});
