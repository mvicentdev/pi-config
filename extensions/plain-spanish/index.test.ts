// node --test extensions/plain-spanish/run-test.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createGatedWriteTool, lengthFeedback, MAX_REPLY_PROSE_WORDS, proseWordCount, type SessionState } from "./index.ts";

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
