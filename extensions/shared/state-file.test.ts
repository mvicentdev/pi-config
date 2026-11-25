// node --test extensions/shared/state-file.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readJson, stateFile, writeJson } from "./state-file.ts";

const withAgentDir = (run: (dir: string) => void) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-file-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		run(dir);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

test("el fichero de estado vive en el directorio de pi", () => {
	withAgentDir((dir) => assert.equal(stateFile("advisor.json"), path.join(dir, "advisor.json")));
	delete process.env.PI_CODING_AGENT_DIR;
	assert.equal(stateFile("advisor.json"), path.join(os.homedir(), ".pi/agent", "advisor.json"));
});

test("lee lo escrito y devuelve undefined si falta o está roto", () => {
	withAgentDir(() => {
		const file = stateFile("x.json");
		assert.equal(readJson(file), undefined);
		writeJson(file, { model: "a/b" });
		assert.deepEqual(readJson(file), { model: "a/b" });
		fs.writeFileSync(file, "{roto");
		assert.equal(readJson(file), undefined);
	});
});

test("escribe con tabuladores y salto de línea final", () => {
	withAgentDir(() => {
		const file = stateFile("x.json");
		writeJson(file, { a: 1 });
		assert.equal(fs.readFileSync(file, "utf8"), '{\n\t"a": 1\n}\n');
	});
});
