// node --test extensions/main-loop-guard/guard.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { EDIT_REASON, editReason } from "./guard.ts";

// Un repositorio de verdad (con .git) y un directorio de notas fuera de él, en un temporal.
const root = realpathSync(mkdtempSync(join(tmpdir(), "main-loop-guard-")));
const repo = join(root, "repo");
const notes = join(root, "notes");
mkdirSync(join(repo, ".git"), { recursive: true });
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(notes, { recursive: true });
writeFileSync(join(repo, "src", "App.ts"), "export {};\n");
writeFileSync(join(notes, "plan.ts"), "export {};\n");
symlinkSync(join(repo, "src"), join(notes, "src-link"));
symlinkSync(join(repo, "src", "App.ts"), join(notes, "app-link.ts"));
symlinkSync(notes, join(repo, "notes-link"));
after(() => rmSync(root, { recursive: true, force: true }));

test("rechaza editar o escribir código dentro de un repositorio", () => {
	assert.equal(editReason("edit", join(repo, "src", "App.ts"), root), EDIT_REASON);
	assert.equal(editReason("write", join(repo, "src", "App.ts"), root), EDIT_REASON);
	assert.equal(editReason("write", join(repo, "src", "New.test.ts"), root), EDIT_REASON);
	assert.equal(editReason("write", join(repo, "src", "deep", "new", "file.php"), root), EDIT_REASON);
});

test("deja editar markdown dentro de un repositorio", () => {
	assert.equal(editReason("edit", join(repo, "README.md"), root), null);
	assert.equal(editReason("write", join(repo, "docs", "PLAN.md"), root), null);
	assert.equal(editReason("edit", join(repo, "NOTES.MD"), root), null);
});

test("deja editar cualquier fichero fuera de un repositorio", () => {
	assert.equal(editReason("edit", join(notes, "plan.ts"), root), null);
	assert.equal(editReason("write", join(notes, "new.py"), root), null);
});

test("resuelve una ruta relativa contra el directorio de la sesión", () => {
	assert.equal(editReason("edit", "src/App.ts", repo), EDIT_REASON);
	assert.equal(editReason("write", "../repo/src/App.ts", notes), EDIT_REASON);
	assert.equal(editReason("write", "plan.ts", notes), null);
	assert.equal(editReason("write", "README.md", repo), null);
	assert.equal(editReason("edit", "@src/App.ts", repo), EDIT_REASON);
	assert.equal(editReason("edit", "~/src/App.ts", notes, repo), EDIT_REASON);
});

test("juzga por la ubicación real una ruta que pasa por un enlace simbólico", () => {
	assert.equal(editReason("edit", join(notes, "src-link", "App.ts"), root), EDIT_REASON);
	assert.equal(editReason("write", join(notes, "src-link", "New.ts"), root), EDIT_REASON);
	assert.equal(editReason("edit", join(notes, "app-link.ts"), root), EDIT_REASON);
	assert.equal(editReason("edit", "src-link/App.ts", notes), EDIT_REASON);
	assert.equal(editReason("edit", join(repo, "notes-link", "plan.ts"), root), null);
});

test("no toca las demás herramientas ni una ruta ausente", () => {
	assert.equal(editReason("read", join(repo, "src", "App.ts"), root), null);
	assert.equal(editReason("bash", join(repo, "src", "App.ts"), root), null);
	assert.equal(editReason("edit", undefined, root), null);
});

test("el aviso manda el cambio a un worker en dos frases", () => {
	assert.match(EDIT_REASON, /`worker` subagent/);
	assert.equal(EDIT_REASON.split(/(?<=\.)\s+/).length, 2);
});
