// node --test extensions/plain-spanish/run-test.mjs
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import plainSpanish, { createGatedWriteTool, lengthFeedback, MAX_REPLY_PROSE_WORDS, proseWordCount, type SessionState } from "./index.ts";

const LONG = "This sentence is far too long because it keeps adding one more word after another word until it holds many more than the twenty five words that the rule allows.";
const state: SessionState = { config: {}, enabled: true, ready: true, pendingWarnings: new Map() };

async function write(path: string, content: string) {
	const tool = createGatedWriteTool(process.cwd(), state);
	return tool.execute("call", { path, content }, undefined, undefined, { hasUI: false } as never);
}

// Fuera de /tmp, que la extensión no revisa.
const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function scratchFile(): Promise<string> {
	const dir = await mkdtemp(join(homedir(), ".plain-spanish-test-"));
	dirs.push(dir);
	return join(dir, "doc.md");
}

test("reescribe un fichero y conserva una frase larga que ya tenía", async () => {
	const path = await scratchFile();
	await writeFile(path, `# Doc\n\n${LONG}\n\nShort line.\n`);
	await write(path, `# Doc\n\n${LONG}\n\nAnother short line.\n`);
	assert.match(await readFile(path, "utf8"), /Another short line/);
});

test("bloquea una frase larga nueva al reescribir un fichero", async () => {
	const path = await scratchFile();
	await writeFile(path, "# Doc\n\nShort line.\n");
	await assert.rejects(write(path, `# Doc\n\nShort line.\n\n${LONG}\n`), /sentence-length/);
	assert.equal(await readFile(path, "utf8"), "# Doc\n\nShort line.\n");
});

test("bloquea una frase larga en un fichero nuevo", async () => {
	const path = await scratchFile();
	await assert.rejects(write(path, `# Doc\n\n${LONG}\n`), /sentence-length/);
});

test("cuenta solo las palabras de prosa de una respuesta", () => {
	const reply = "Hecho: el cambio está subido.\n\n```bash\ngit push origin main\n```\n\n| a | b |\n|---|---|\n| uno | dos |\n\nUsa `node --test` y mira https://example.com/x.";
	assert.equal(proseWordCount(reply), 8);
});

test("avisa cuando una respuesta pasa del tope de prosa", () => {
	const words = (count: number) => Array(count).fill("palabra").join(" ");
	assert.equal(lengthFeedback(words(MAX_REPLY_PROSE_WORDS)), undefined);
	assert.match(lengthFeedback(words(MAX_REPLY_PROSE_WORDS + 1)) ?? "", /121 palabras/);
});

// Un pi de mentira que guarda lo que la extensión registra. Así los tests recorren la extensión entera.
type Handler = (event: any, ctx: any) => any;

async function startSession(cwd: string) {
	const handlers: Record<string, Handler> = {};
	const tools: Record<string, any> = {};
	const commands: Record<string, any> = {};
	const notifications: string[] = [];
	const widgets: Record<string, string[] | undefined> = {};
	const pi = {
		registerCommand: (name: string, command: unknown) => void (commands[name] = command),
		registerTool: (tool: { name: string }) => void (tools[tool.name] = tool),
		on: (name: string, handler: Handler) => void (handlers[name] = handler),
	};
	plainSpanish(pi as never);
	const ctx = {
		cwd,
		hasUI: true,
		isProjectTrusted: () => true,
		ui: {
			notify: (message: string) => void notifications.push(message),
			setWidget: (key: string, lines: string[] | undefined) => void (widgets[key] = lines),
		},
	};
	await handlers.session_start({}, ctx);
	return { handlers, tools, commands, notifications, widgets, ctx };
}

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(homedir(), ".plain-spanish-test-"));
	dirs.push(dir);
	return dir;
}

const SEVEN_SENTENCES = "Uno aquí. Dos aquí. Tres aquí. Cuatro aquí. Cinco aquí. Seis aquí. Siete aquí.";
const noUi = { hasUI: false, sessionManager: { getSessionId: () => "sesion", getSessionFile: () => undefined } } as never;
// 41 párrafos de tres palabras: 123 palabras de prosa sin ninguna infracción de escritura.
const LONG_REPLY = Array(41).fill("palabra palabra palabra.").join("\n\n");

test("el prompt de sistema lista las cuatro reglas con su resumen", async () => {
	const { handlers } = await startSession(await scratchDir());
	const result = await handlers.before_agent_start({ systemPrompt: "BASE" }, {});
	assert.equal(
		result.systemPrompt,
		[
			"BASE",
			"",
			"## Reglas de escritura",
			"",
			"Escribe en castellano la prosa para el usuario, también las respuestas. El código, los commits y los documentos siguen la lengua que fije cada proyecto. Aplica estas reglas, derivadas de ASD-STE100, en cualquier lengua:",
			"",
			"- [bloquea] Escribe frases de 25 palabras como máximo.",
			"- [bloquea] Escribe seis frases como máximo en cada párrafo.",
			"- [bloquea] No uses punto y coma. Escribe dos frases.",
			"- [bloquea] Nombra identificadores de regla registrados en las directivas de supresión.",
			"",
			"Una infracción que bloquea detiene la escritura, la edición o el commit. Corrige el texto que indica el aviso y vuelve a intentarlo. Una infracción que avisa no detiene nada. También se revisa cada respuesta.",
			"",
			"En un fichero que ya existe solo se revisan las líneas que cambias. Cámbialo con edit y conserva tal cual las líneas que no tocas.",
		].join("\n"),
	);
});

test("el prompt de sistema no se añade con las reglas desactivadas", async () => {
	const { handlers, commands, ctx } = await startSession(await scratchDir());
	await commands.ase.handler("off", ctx);
	assert.equal(handlers.before_agent_start({ systemPrompt: "BASE" }, {}), undefined);
});

test("write devuelve cada infracción con su mensaje y su arreglo", async () => {
	const dir = await scratchDir();
	const cases: [string, string, string][] = [
		[`# Doc\n\n${LONG}\n`, "sentence-length", "La frase tiene 30 palabras. El máximo es 25. Divide la frase en frases más cortas."],
		[`# Doc\n\n${SEVEN_SENTENCES}\n`, "paragraph-length", "El párrafo tiene 7 frases. El máximo es 6. Divide el párrafo en párrafos más cortos."],
		["# Doc\n\nUno; dos.\n", "semicolon", "No uses punto y coma. Cambia el punto y coma por un punto y escribe dos frases."],
		["# Doc\n\n<!-- ste-disable-next-line -->\nUno.\n", "invalid-suppression", "Directiva de supresión no válida:"],
	];
	for (const [content, ruleId, expected] of cases) {
		const path = join(dir, `${ruleId}.md`);
		await assert.rejects(write(path, content), (error: Error) => {
			assert.ok(error.message.startsWith(`Las reglas de escritura bloquean ${path}:\n- línea `), error.message);
			assert.ok(error.message.includes(`[${ruleId}]: ${expected}`), error.message);
			return true;
		});
	}
});

test("write con una regla blanda deja pasar y guarda el aviso", async () => {
	const softState: SessionState = { config: { rules: { semicolon: "soft" } }, enabled: true, ready: true, pendingWarnings: new Map() };
	const path = await scratchFile();
	const notifications: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (message: string) => notifications.push(message) } } as never;
	await createGatedWriteTool(process.cwd(), softState).execute("call", { path, content: "# Doc\n\nUno; dos.\n" }, undefined, undefined, ctx);
	const expected = `Avisos de escritura en ${path}:\n- línea 3, columna 4 [semicolon]: No uses punto y coma. Cambia el punto y coma por un punto y escribe dos frases.`;
	assert.equal(softState.pendingWarnings.get("call"), expected);
	assert.deepEqual(notifications, [expected]);
	assert.equal(await readFile(path, "utf8"), "# Doc\n\nUno; dos.\n");
});

test("write no revisa nada con la extensión desactivada ni con la sesión sin arrancar", async () => {
	const path = await scratchFile();
	const off: SessionState = { ...state, enabled: false, pendingWarnings: new Map() };
	await createGatedWriteTool(process.cwd(), off).execute("call", { path, content: `# Doc\n\n${LONG}\n` }, undefined, undefined, noUi);
	assert.match(await readFile(path, "utf8"), /too long/);
	const notReady: SessionState = { ...state, ready: false, error: "fallo", pendingWarnings: new Map() };
	await assert.rejects(
		createGatedWriteTool(process.cwd(), notReady).execute("call", { path, content: "x" }, undefined, undefined, noUi),
		{ message: "La revisión de escritura no está disponible: fallo" },
	);
});

test("write no revisa /tmp, vendor ni ficheros sin extensión de prosa", async () => {
	const dir = await scratchDir();
	await write(join(dir, "vendor", "lib.md"), `# Doc\n\n${LONG}\n`);
	await write(join(dir, "notes"), `${LONG}\n`);
	await write("/tmp/plain-spanish-test-scratch.md", `# Doc\n\n${LONG}\n`);
	await rm("/tmp/plain-spanish-test-scratch.md");
});

test("edit bloquea una frase larga nueva y deja pasar un cambio limpio", async () => {
	const { tools, ctx } = await startSession(await scratchDir());
	const path = await scratchFile();
	await writeFile(path, `# Doc\n\n${LONG}\n\nShort line.\n`);
	await tools.edit.execute("call", { path, edits: [{ oldText: "Short line.", newText: "Another short line." }] }, undefined, undefined, ctx);
	assert.match(await readFile(path, "utf8"), /Another short line/);
	await assert.rejects(
		tools.edit.execute("call", { path, edits: [{ oldText: "Another short line.", newText: `${LONG}` }] }, undefined, undefined, ctx),
		(error: Error) => {
			assert.ok(error.message.startsWith(`Las reglas de escritura bloquean ${path}:\n`), error.message);
			assert.ok(error.message.includes("[sentence-length]: La frase tiene"), error.message);
			return true;
		},
	);
	assert.match(await readFile(path, "utf8"), /Another short line/);
});

test("bash bloquea un commit con el mensaje largo y deja pasar un comando sin commit", async () => {
	const dir = await scratchDir();
	const { tools } = await startSession(dir);
	const result = await tools.bash.execute("call", { command: "echo hola" }, undefined, undefined, noUi);
	assert.match(result.content[0].text, /hola/);
	await assert.rejects(tools.bash.execute("call", { command: `git commit -m "${LONG}"` }, undefined, undefined, noUi), (error: Error) => {
		assert.ok(error.message.startsWith("Las reglas de escritura bloquean el mensaje del commit:\n- línea "), error.message);
		assert.ok(error.message.includes("[sentence-length]: La frase tiene 30 palabras. El máximo es 25. Divide la frase"), error.message);
		return true;
	});
	await assert.rejects(tools.bash.execute("call", { command: "git commit" }, undefined, undefined, noUi), {
		message: "Las reglas de escritura no pueden revisar el mensaje del commit. Usa git commit con un argumento -m o --message fijo.",
	});
});

test("bash deja pasar un commit con el mensaje corto", async () => {
	const dir = await scratchDir();
	execSync("git init -q && git config user.name t && git config user.email t@t", { cwd: dir });
	const { tools } = await startSession(dir);
	await tools.bash.execute("call", { command: 'git commit --allow-empty -q -m "Add the thing"' }, undefined, undefined, noUi);
	assert.equal(execSync("git log -1 --format=%s", { cwd: dir, encoding: "utf8" }).trim(), "Add the thing");
});

test("bash rechaza un commit con la sesión sin arrancar", async () => {
	const dir = await scratchDir();
	const { tools, handlers, ctx } = await startSession(dir);
	await handlers.session_start({}, { ...ctx, isProjectTrusted: () => { throw new Error("sin config"); } });
	await assert.rejects(tools.bash.execute("call", { command: 'git commit -m "Add it"' }, undefined, undefined, noUi), {
		message: "La revisión de escritura no está disponible: sin config",
	});
});

test("la respuesta final larga deja un aviso de longitud para el turno siguiente", async () => {
	const { handlers, ctx, widgets } = await startSession(await scratchDir());
	await handlers.turn_end({ message: { role: "assistant", content: [{ type: "text", text: LONG_REPLY }] } }, ctx);
	const result = await handlers.context({ messages: [] }, ctx);
	assert.equal(result.messages.length, 1);
	assert.equal(result.messages[0].customType, "plain-spanish-reply-feedback");
	assert.equal(result.messages[0].display, false);
	assert.ok(result.messages[0].content.includes("Tu respuesta anterior tenía 123 palabras de prosa."));
	assert.equal(await handlers.context({ messages: [] }, ctx), undefined);
	assert.deepEqual(widgets["plain-spanish-reply"], ["Respuesta: limpia"]);
});

test("el aviso de longitud nombra los tres topes de 120, 60 y 40 palabras", () => {
	const words = Array(121).fill("palabra").join(" ");
	assert.equal(
		lengthFeedback(words),
		"Tu respuesta anterior tenía 121 palabras de prosa. El tope es 120 para un informe o un estado, 60 para trabajo terminado y 40 para una respuesta a una pregunta. Recorta la siguiente.",
	);
});

test("el texto junto a una herramienta no cuenta para el tope de palabras", async () => {
	const { handlers, ctx, widgets } = await startSession(await scratchDir());
	await handlers.turn_end({ message: { role: "assistant", content: [{ type: "text", text: LONG_REPLY }, { type: "toolCall" }] } }, ctx);
	assert.equal(await handlers.context({ messages: [] }, ctx), undefined);
	assert.deepEqual(widgets["plain-spanish-reply"], ["Respuesta: limpia"]);
});

test("la respuesta con una infracción de escritura la devuelve con su arreglo", async () => {
	const { handlers, ctx } = await startSession(await scratchDir());
	await handlers.turn_end({ message: { role: "assistant", content: [{ type: "text", text: "Uno; dos." }] } }, ctx);
	const result = await handlers.context({ messages: [] }, ctx);
	assert.equal(
		result.messages[0].content,
		"Infracciones de escritura en tu respuesta anterior:\n- línea 1, columna 4 [semicolon]: No uses punto y coma. Cambia el punto y coma por un punto y escribe dos frases.",
	);
});

test("el comando ase muestra el estado, valida el argumento y se apaga y enciende", async () => {
	const { commands, ctx, notifications, handlers } = await startSession(await scratchDir());
	await commands.ase.handler("status", ctx);
	await commands.ase.handler("otro", ctx);
	await commands.ase.handler("off", ctx);
	await commands.ase.handler("", ctx);
	assert.deepEqual(notifications, [
		"Reglas de escritura activas: sentence-length, paragraph-length, semicolon, invalid-suppression",
		"Uso: /ase [on|off|status]",
		"Reglas de escritura desactivadas.",
		"Reglas de escritura activadas.",
	]);
	assert.deepEqual(commands.ase.getArgumentCompletions("o"), [{ value: "on", label: "on" }, { value: "off", label: "off" }]);
	assert.equal(commands.ase.getArgumentCompletions("z"), null);
	assert.equal(await handlers.context({ messages: [] }, ctx), undefined);
});

test("tool_result sin aviso pendiente no cambia el resultado", async () => {
	const { handlers } = await startSession(await scratchDir());
	assert.equal(handlers.tool_result({ toolCallId: "x", content: [] }), undefined);
});
