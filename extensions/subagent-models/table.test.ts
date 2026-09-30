// node --test extensions/subagent-models/table.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { effective, withChoice } from "./table.ts";

const base = {
	anthropic: { explorer: { model: "claude-sonnet-5", thinking: "medium" }, worker: { model: "inherit", thinking: "medium" } },
};

test("el usuario pisa la base campo a campo", () => {
	const user = { anthropic: { explorer: { thinking: "high" } } };
	assert.deepEqual(effective(base, user, "anthropic", "explorer"), { model: "anthropic/claude-sonnet-5", thinking: "high" });
	assert.deepEqual(effective(base, {}, "openai-codex", "explorer"), { model: "inherit", thinking: "inherit" });
});

test("guarda solo lo que difiere de la base", () => {
	const choice = { model: "openai-codex/gpt-6.1-sol", thinking: "medium" };
	assert.deepEqual(withChoice({}, base, "anthropic", "worker", choice), {
		anthropic: { worker: { model: "openai-codex/gpt-6.1-sol" } },
	});
});

test("volver a la base borra la entrada y el proveedor vacío", () => {
	const user = { anthropic: { explorer: { model: "openai-codex/gpt-6.1-sol" } }, "opencode-go": { worker: { thinking: "low" } } };
	const choice = { model: "anthropic/claude-sonnet-5", thinking: "medium" };
	assert.deepEqual(withChoice(user, base, "anthropic", "explorer", choice), { "opencode-go": { worker: { thinking: "low" } } });
});
