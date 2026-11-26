// node --test extensions/bash-guard/credentials.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialsPathReason, credentialsReason } from "./credentials.ts";

const home = "/home/ana";
const blocked = (command: string) => credentialsReason(command, home) !== null;

test("1. rechaza leer ~/.zshrc entero con cualquier lector y cualquier forma de ruta", () => {
	for (const reader of ["cat", "head", "tail", "less", "more", "source", ".", "sed -n 1,5p", "awk 1", "grep alias"]) {
		for (const path of ["~/.zshrc", "$HOME/.zshrc", "/home/ana/.zshrc"]) {
			assert.ok(blocked(`${reader} ${path}`), `${reader} ${path}`);
		}
	}
	assert.ok(blocked("ls && echo ok; cat ~/.zshrc"));
	assert.ok(blocked("echo $(cat ~/.zshrc)"));
	assert.ok(blocked("cat ~/.zshrc | head -5"));
	assert.ok(blocked('cat "$HOME/.zshrc"'));
});

test("2. deja pasar grep sobre ~/.zshrc solo si el patrón empieza por ^alias ", () => {
	assert.ok(!blocked('grep -m1 "^alias gp=" ~/.zshrc ~/.zsh_aliases'));
	assert.ok(!blocked("grep '^alias gp=' $HOME/.zshrc"));
	assert.ok(blocked('grep "export" ~/.zshrc'));
	assert.ok(blocked('grep "alias gp" ~/.zshrc'));
	assert.ok(blocked('grep -v "^alias " ~/.zshrc'));
	assert.ok(blocked('grep -A 50 "^alias gp=" ~/.zshrc'));
	assert.ok(blocked('grep -m1 "^alias gp=" ~/.zshrc; cat ~/.zshrc'));
});

test("3. rechaza imprimir el entorno", () => {
	for (const command of ["zsh -i", "zsh -ic alias", "zsh -l", "env", "printenv", "set", "env | grep KEY", "ls; set"]) {
		assert.ok(blocked(command), command);
	}
	for (const command of ["env FOO=1 node x.js", "set -e", "zsh script.sh", "git status", "echo settings"]) {
		assert.ok(!blocked(command), command);
	}
});

test("4. rechaza las herramientas read y grep sobre ~/.zshrc", () => {
	for (const tool of ["read", "grep"]) {
		for (const path of ["~/.zshrc", "/home/ana/.zshrc", "/home/ana/./.zshrc"]) {
			assert.ok(credentialsPathReason(tool, path, home), `${tool} ${path}`);
		}
	}
	assert.equal(credentialsPathReason("read", "/home/ana/.zsh_aliases", home), null);
	assert.equal(credentialsPathReason("read", undefined, home), null);
	assert.equal(credentialsPathReason("write", "~/.zshrc", home), null);
});

test("5. cada rechazo dice que nada corrió, que hay credenciales y la búsqueda de alias", () => {
	const reasons = [
		credentialsReason("cat ~/.zshrc", home),
		credentialsReason("env", home),
		credentialsPathReason("read", "~/.zshrc", home),
	];
	for (const reason of reasons) {
		assert.ok(reason);
		assert.match(reason, /Blocked before running: no part of this (command|call) ran/);
		assert.match(reason, /credentials/);
		assert.match(reason, /grep "\^alias name=" ~\/\.zshrc/);
	}
});

test("7. rechaza cualquier orden con ~/.zshrc como argumento salvo la búsqueda de alias", () => {
	for (const command of ["rg export ~/.zshrc", "egrep KEY ~/.zshrc", "cp ~/.zshrc /tmp/x", "echo ~/.zshrc"]) {
		assert.ok(blocked(command), command);
	}
	for (const command of ['grep -m1 "^alias gp=" ~/.zshrc ~/.zsh_aliases', "ls ~"]) {
		assert.ok(!blocked(command), command);
	}
});

test("6. no toca las órdenes ajenas", () => {
	for (const command of ["ls", "cat /tmp/a.txt", "cat ~/.zshrc.bak", "git log | head -5", "echo hello", "grep foo ~/.zsh_aliases"]) {
		assert.equal(credentialsReason(command, home), null, command);
	}
});

test("8. zshrc por texto crudo, impresores de entorno recursivos y ruta relativa contra el cwd", () => {
	const blockedCommands = [
		'bash -c "cat ~/.zshrc"',
		"zsh -c 'source ~/.zshrc'",
		"cat ~/.zshrc>/tmp/x",
		"cd ~ && cat .zshrc",
		'grep -E "^alias |export" ~/.zshrc',
		'grep -m1 "^alias gp=" ~/.zshrc; cat ~/.zshrc',
		"bash -c env",
		"sudo env",
		"command env",
		"exec env",
		"printenv OPENAI_KEY",
		"export -p",
		"declare -x",
	];
	for (const command of blockedCommands) assert.ok(blocked(command), command);
	const allowedCommands = [
		'grep -m1 "^alias gp=" ~/.zshrc ~/.zsh_aliases',
		"cat ~/.zshrc.bak",
		"set -e",
		"env FOO=1 node x.js",
		"export FOO=1",
		'bash -c "echo hi"',
		'echo "a; set"',
	];
	for (const command of allowedCommands) assert.ok(!blocked(command), command);
	assert.equal(credentialsPathReason("read", ".zshrc", home, "/tmp/repo"), null);
	assert.ok(credentialsPathReason("read", ".zshrc", home, home));
});
