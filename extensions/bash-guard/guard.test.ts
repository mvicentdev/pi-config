// node --test extensions/bash-guard/guard.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileCommand } from "./guard.ts";

test("rechaza las órdenes de ficheros al abrir un tramo", () => {
	assert.equal(fileCommand("cat src/App.php"), "cat");
	assert.equal(fileCommand("cd /repo && grep -rn Foo src"), "grep");
	assert.equal(fileCommand("ls; sed -n 1,20p a.ts"), "sed");
	assert.equal(fileCommand("for f in *.ts; do head -5 $f; done"), "head");
	assert.equal(fileCommand("LC_ALL=C /usr/bin/find . -name x"), "find");
	assert.equal(fileCommand("echo $(cat a.txt)"), "cat");
	assert.equal(fileCommand("rg Foo | sort"), "rg");
});

test("deja pasar el recorte de otra salida y los recuentos", () => {
	assert.equal(fileCommand("docker compose exec api composer test:agent | tail -5"), null);
	assert.equal(fileCommand("git log --oneline | head -20"), null);
	assert.equal(fileCommand("find src -name '*.php' | wc -l"), null);
	assert.equal(fileCommand("git grep Foo"), null);
	assert.equal(fileCommand("pi --list-models | grep sol"), null);
});

test("ignora el texto de cadenas y heredocs", () => {
	assert.equal(fileCommand('git commit -m "fix; cat the logs"'), null);
	assert.equal(fileCommand("python3 - <<'E'\nimport os\ncat = 1\nE\necho ok"), null);
});
