// node --test extensions/main-loop-guard/guard.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { EDIT_REASON, editReason, prepareLaunch, STOP_LINE, toolCallReason } from "./guard.ts";

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
// Un worktree enlazado o un submódulo: .git es un fichero que apunta al repositorio.
const linked = join(root, "linked");
mkdirSync(join(linked, "src"), { recursive: true });
writeFileSync(join(linked, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "linked")}\n`);
// Un repositorio con un espacio en el nombre.
const spaced = join(root, "spaced repo");
mkdirSync(join(spaced, ".git"), { recursive: true });
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
	assert.equal(editReason("write", "~", notes, join(repo, "src")), EDIT_REASON);
	assert.equal(editReason("write", "~", repo, notes), null);
});

test("traduce una URL file:// como pi", () => {
	assert.equal(editReason("write", pathToFileURL(join(repo, "src", "App.ts")).href, notes), EDIT_REASON);
	assert.equal(editReason("write", `file://${join(repo, "src", "New.ts")}`, notes), EDIT_REASON);
	assert.equal(editReason("write", pathToFileURL(join(repo, "README.md")).href, notes), null);
	assert.equal(editReason("write", pathToFileURL(join(notes, "plan.ts")).href, repo), null);
});

test("cambia los espacios Unicode por espacios normales como pi", () => {
	assert.equal(editReason("write", "spaced\u00A0repo/src/App.ts", root), EDIT_REASON);
	assert.equal(editReason("write", "spaced\u202Frepo/src/App.ts", root), EDIT_REASON);
});

test("reconoce un worktree enlazado o un submódulo, donde .git es un fichero", () => {
	assert.equal(editReason("write", join(linked, "src", "App.ts"), root), EDIT_REASON);
	assert.equal(editReason("edit", "src/App.ts", linked), EDIT_REASON);
	assert.equal(editReason("write", join(linked, "README.md"), root), null);
});

test("rechaza lsp_fix cuando escribe el arreglo en el fichero", () => {
	assert.equal(toolCallReason("lsp_fix", { path: "src/App.ts", write: true }, repo), EDIT_REASON);
	assert.equal(toolCallReason("lsp_fix", { path: "src/App.ts", root: "repo", write: true }, root), EDIT_REASON);
	assert.equal(toolCallReason("lsp_fix", { path: join(repo, "src", "App.ts"), write: true }, notes), EDIT_REASON);
	assert.equal(toolCallReason("lsp_fix", { path: "README.md", write: true }, repo), null);
	assert.equal(toolCallReason("lsp_fix", { path: "plan.ts", write: true }, notes), null);
});

test("deja lsp_fix cuando solo muestra el arreglo", () => {
	assert.equal(toolCallReason("lsp_fix", { path: "src/App.ts" }, repo), null);
	assert.equal(toolCallReason("lsp_fix", { path: "src/App.ts", write: false }, repo), null);
	assert.equal(toolCallReason("lsp_fix", { path: "src/App.ts", write: "true" }, repo), null);
});

test("toolCallReason juzga edit y write por su path", () => {
	assert.equal(toolCallReason("edit", { path: "src/App.ts" }, repo), EDIT_REASON);
	assert.equal(toolCallReason("write", { path: "README.md" }, repo), null);
	assert.equal(toolCallReason("read", { path: "src/App.ts" }, repo), null);
	assert.equal(toolCallReason("edit", undefined, repo), null);
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

test("un Agent sin run_in_background: false pasa a primer plano", () => {
	for (const input of [
		{ subagent_type: "worker", prompt: "fix" } as Record<string, unknown>,
		{ subagent_type: "worker", prompt: "fix", run_in_background: true },
		{ subagent_type: "worker", prompt: "fix", run_in_background: "false" },
		{ resume: "w1", prompt: "again" },
		{ subagent_type: "verifier", prompt: "review", run_in_background: false },
	]) {
		prepareLaunch("Agent", input);
		assert.equal(input.run_in_background, false, JSON.stringify(input));
	}
});

test("cada Agent acaba con la orden de parar e informar, una sola vez", () => {
	const launch: Record<string, unknown> = { subagent_type: "worker", prompt: "Fix the bug.\n" };
	prepareLaunch("Agent", launch);
	assert.equal(launch.prompt, `Fix the bug.\n\n${STOP_LINE}`);
	prepareLaunch("Agent", launch);
	assert.equal(launch.prompt, `Fix the bug.\n\n${STOP_LINE}`);
	const resume: Record<string, unknown> = { resume: "w1", prompt: "Go on." };
	prepareLaunch("Agent", resume);
	assert.ok(String(resume.prompt).endsWith(`\n\n${STOP_LINE}`));
	const ready: Record<string, unknown> = { subagent_type: "worker", prompt: `Do it.\n${STOP_LINE}  \n` };
	prepareLaunch("Agent", ready);
	assert.equal(ready.prompt, `Do it.\n${STOP_LINE}  \n`);
});

test("prepareLaunch no toca las demás herramientas ni una entrada rara", () => {
	const bash: Record<string, unknown> = { command: "ls" };
	prepareLaunch("bash", bash);
	assert.deepEqual(bash, { command: "ls" });
	assert.doesNotThrow(() => prepareLaunch("Agent", undefined));
	const noPrompt: Record<string, unknown> = { subagent_type: "worker" };
	prepareLaunch("Agent", noPrompt);
	assert.equal(noPrompt.prompt, undefined);
});

test("la orden de parar es una frase en inglés", () => {
	assert.match(STOP_LINE, /^Stop and report any fact that breaks/);
	assert.equal(STOP_LINE.split(/(?<=\.)\s+/).length, 1);
});

test("el aviso manda el cambio a un worker en dos frases", () => {
	assert.match(EDIT_REASON, /`worker` subagent/);
	assert.equal(EDIT_REASON.split(/(?<=\.)\s+/).length, 2);
});
