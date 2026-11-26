// node --test extensions/bash-guard/credentials.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialsPathReason, credentialsReason } from "./credentials.ts";

const home = "/home/ana";
const blocked = (command: string) => credentialsReason(command) !== null;

test("1. blocks any command whose text names .zshrc", () => {
	for (const command of [
		"cat ~/.zshrc",
		'bash -c "cat ~/.zshrc"',
		"cd ~ && cat .zshrc",
		"cat ~/.zshrc>/tmp/x",
		"rg export $HOME/.zshrc",
		'grep "^alias " ~/.zshrc',
		'grep -E "^alias |export" ~/.zshrc',
		'grep -m1 "^alias gp=" ~/.zshrc; cat ~/.zshrc',
		'grep -v "^alias gp=" ~/.zshrc',
	]) {
		assert.ok(blocked(command), command);
	}
	assert.ok(!blocked("cat ~/.zshrc.bak"));
});

test("2. lets one alias-lookup grep through", () => {
	for (const command of [
		'grep -m1 "^alias gp=" ~/.zshrc ~/.zsh_aliases',
		"grep '^alias gp=' /home/ana/.zshrc",
		'grep -n -H -e "^alias gp" ~/.zshrc',
		'grep -m 2 "^alias gp=" ~/.zshrc',
		'grep -h "^alias gp=" ~/.zshrc',
	]) {
		assert.ok(!blocked(command), command);
	}
	for (const command of ['grep "^alias gp=" ~/.zshrc x${IFS}-v', 'grep "^alias gp=" ~/.zshrc {-v,}']) {
		assert.ok(blocked(command), command);
	}
});

test("3. blocks the read and grep tools on ~/.zshrc and resolves relative paths against the cwd", () => {
	for (const tool of ["read", "grep"]) {
		for (const path of ["~/.zshrc", "/home/ana/.zshrc", "/home/ana/./.zshrc"]) {
			assert.ok(credentialsPathReason(tool, path, home), `${tool} ${path}`);
		}
	}
	assert.ok(credentialsPathReason("read", ".zshrc", home, home));
	assert.equal(credentialsPathReason("read", ".zshrc", home, "/tmp/repo"), null);
	assert.equal(credentialsPathReason("read", "/home/ana/.zsh_aliases", home), null);
	assert.equal(credentialsPathReason("write", "~/.zshrc", home), null);
});

test("4. the reason says nothing ran, that the file holds credentials, and names the alias lookup", () => {
	for (const reason of [credentialsReason("cat ~/.zshrc"), credentialsPathReason("read", "~/.zshrc", home)]) {
		assert.ok(reason);
		assert.match(reason, /Blocked before running: no part of this (command|call) ran/);
		assert.match(reason, /credentials/);
		assert.match(reason, /grep "\^alias name=" ~\/\.zshrc/);
		assert.doesNotMatch(reason, /environment/);
	}
});

test("5. blocks nothing else, including commands that print the environment", () => {
	for (const command of [
		"env",
		"printenv OPENAI_KEY",
		"set",
		"export -p",
		"zsh -i",
		"sudo env",
		"python3 - <<'EOF'\nenv\nx = sorted(set(xs))\nprint(env)\nEOF",
	]) {
		assert.equal(credentialsReason(command), null, command);
	}
});
