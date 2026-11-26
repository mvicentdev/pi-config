// node --test docs/independence.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const docsDir = dirname(fileURLToPath(import.meta.url));
const documents = readdirSync(docsDir).filter((name) => name.endsWith(".md"));

for (const document of documents) {
	// Cada documento no nombra a otro documento ni a AGENTS.md.
	test(`${document} no nombra a otro documento`, () => {
		const text = readFileSync(join(docsDir, document), "utf8");
		const forbidden = [...documents.filter((name) => name !== document), "AGENTS.md"];
		const found = forbidden.find((name) => text.includes(name));
		assert.equal(found, undefined, `${document} nombra a ${found}`);
	});
}
