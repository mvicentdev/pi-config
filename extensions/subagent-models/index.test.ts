// node --test extensions/subagent-models/run-test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import subagentModels from "./index.ts";

initTheme("dark");

const USER = path.join(process.env.PI_CODING_AGENT_DIR!, "subagent-models.json");
const MODELS = [
	{ provider: "openai-codex", id: "gpt-6-sol", name: "Sol", reasoning: false },
	{ provider: "anthropic", id: "claude-sonnet-5", name: "Sonnet", reasoning: true, thinkingLevelMap: {} },
];

// `ui.custom` abre cada selector: la prueba responde con el valor elegido, o null para cancelar.
function runCommand(answers: (string | null)[], overrides: Record<string, unknown> = {}) {
	const notices: string[] = [];
	const asked: string[] = [];
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	subagentModels({ on() {}, registerCommand: (name: string, command: never) => commands.set(name, command) } as never);
	const ctx = {
		mode: "tui",
		model: { provider: "anthropic" },
		modelRegistry: { getAvailable: () => MODELS },
		ui: {
			notify: (message: string) => notices.push(message),
			custom: async (factory: Function) => {
				const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
				asked.push(factory({ requestRender() {} }, theme, undefined, () => {}).render(120).join("\n").replace(/\x1b\[[\d;]*m/g, ""));
				return answers.shift() ?? null;
			},
		},
		...overrides,
	};
	return commands.get("subagent-models")!.handler("", ctx).then(() => ({ notices, asked }));
}

const saved = () => JSON.parse(fs.readFileSync(USER, "utf8"));

beforeEach(() => fs.rmSync(USER, { force: true }));

test("guarda el modelo y el razonamiento elegidos para el proveedor de la sesión", async () => {
	const { notices, asked } = await runCommand(["explorer", "openai-codex/gpt-6-sol", "high"]);
	assert.equal(asked.length, 3);
	assert.deepEqual(saved(), { anthropic: { explorer: { model: "openai-codex/gpt-6-sol", thinking: "high" } } });
	assert.deepEqual(notices, ["explorer, con la sesión en anthropic: openai-codex/gpt-6-sol · high"]);
});

test("elegir lo común no deja nada en el fichero del usuario", async () => {
	await runCommand(["explorer", "anthropic/claude-sonnet-5", "medium"]);
	assert.equal(fs.existsSync(USER), false);
});

test("heredar de la sesión guarda solo lo que difiere de la base", async () => {
	const { notices } = await runCommand(["worker", "inherit", "inherit"]);
	assert.deepEqual(saved(), { anthropic: { worker: { thinking: "inherit" } } });
	assert.deepEqual(notices, ["worker, con la sesión en anthropic: modelo de la sesión · razonamiento de la sesión"]);
});

test("cada selector ofrece sus opciones y marca lo común", async () => {
	const { asked } = await runCommand(["explorer", "anthropic/claude-sonnet-5", "high"]);
	const [agents, models, levels] = asked;
	assert.match(agents, /Subagente \(sesión en anthropic\)/);
	assert.match(agents, /explorer.*anthropic\/claude-sonnet-5 · medium/);
	assert.match(agents, /worker.*modelo de la sesión · medium/);
	assert.ok(agents.indexOf("explorer") < agents.indexOf("researcher") && agents.indexOf("researcher") < agents.indexOf("worker"));
	assert.match(models, /Modelo de explorer/);
	assert.match(models, /anthropic\/claude-sonnet-5\s+común/);
	assert.match(models, /openai-codex\/gpt-6-sol\s+Sol/);
	assert.ok(models.indexOf("modelo de la sesión") < models.indexOf("anthropic/claude-sonnet-5"));
	assert.ok(models.indexOf("anthropic/claude-sonnet-5") < models.indexOf("openai-codex/gpt-6-sol"));
	assert.match(levels, /Razonamiento de explorer/);
	assert.doesNotMatch(levels, /xhigh/);
	assert.match(levels, /medium\s+común/);
});

test("con un modelo sin razonamiento solo ofrece off", async () => {
	const { asked } = await runCommand(["explorer", "openai-codex/gpt-6-sol", null]);
	assert.match(asked[2], /\boff\b/);
	assert.doesNotMatch(asked[2], /\bhigh\b/);
});

test("cancelar en cualquier selector no guarda ni avisa", async () => {
	for (const answers of [[null], ["explorer", null], ["explorer", "openai-codex/gpt-6-sol", null]]) {
		const steps = answers.length;
		const { notices, asked } = await runCommand(answers);
		assert.equal(asked.length, steps);
		assert.deepEqual(notices, []);
		assert.equal(fs.existsSync(USER), false);
	}
});

test("sin modelo de sesión avisa y no abre ningún selector", async () => {
	const { notices, asked } = await runCommand([], { model: undefined });
	assert.deepEqual(notices, ["Sin modelo de sesión: elige uno con /model primero."]);
	assert.equal(asked.length, 0);
});

test("fuera de la interfaz interactiva avisa y no abre ningún selector", async () => {
	const { notices, asked } = await runCommand([], { mode: "print" });
	assert.deepEqual(notices, ["/subagent-models necesita la interfaz interactiva."]);
	assert.equal(asked.length, 0);
});
