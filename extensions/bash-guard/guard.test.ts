// node --test extensions/bash-guard/guard.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileCommand, insideRepository } from "./guard.ts";

// Un repositorio de mentira en /repo, con /repo como directorio de trabajo.
const inRepo = (path: string) => path === "/repo" || path.startsWith("/repo/");
const check = (command: string, cwd = "/repo") => fileCommand(command, cwd, inRepo);

test("rechaza las órdenes de ficheros al abrir un tramo", () => {
	assert.equal(check("cat src/App.php"), "cat");
	assert.equal(check("cd /repo && grep -rn Foo src"), "grep");
	assert.equal(check("ls; sed -n 1,20p a.ts"), "sed");
	assert.equal(check("for f in *.ts; do head -5 $f; done"), "head");
	assert.equal(check("LC_ALL=C /usr/bin/find . -name x"), "find");
	assert.equal(check("echo $(cat a.txt)"), "cat");
	assert.equal(check("rg Foo | sort"), "rg");
});

test("deja pasar el recorte de otra salida y los recuentos", () => {
	assert.equal(check("docker compose exec api composer test:agent | tail -5"), null);
	assert.equal(check("git log --oneline | head -20"), null);
	assert.equal(check("find src -name '*.php' | wc -l"), null);
	assert.equal(check("git grep Foo"), null);
	assert.equal(check("pi --list-models | grep sol"), null);
});

test("deja pasar un cat que escribe en un fichero", () => {
	assert.equal(check("cat > /tmp/a.py <<'EOF'\nprint(1)\nEOF"), null);
	assert.equal(check("cat <<'EOF' > /tmp/a.py\nprint(1)\nEOF\npython3 /tmp/a.py"), null);
	assert.equal(check("cat a.txt b.txt >> c.txt"), null);
	assert.equal(check("cat a.txt >c.txt"), null);
});

test("rechaza un cat que imprime aunque redirija otra salida", () => {
	assert.equal(check("cat a.txt 2>/dev/null"), "cat");
	assert.equal(check("cat a.txt >&2"), "cat");
	assert.equal(check("cat a.txt > /dev/stdout"), "cat");
	assert.equal(check("cat a.txt >/dev/tty"), "cat");
	assert.equal(check("cat a.txt > >(less)"), "cat");
	assert.equal(check("cat > out.txt <<'EOF' | wc\nx\nEOF\ncat out.txt"), "cat");
});

test("ignora el texto de cadenas y heredocs", () => {
	assert.equal(check('git commit -m "fix; cat the logs"'), null);
	assert.equal(check("python3 - <<'E'\nimport os\ncat = 1\nE\necho ok"), null);
});

test("deja pasar las órdenes que leen fuera de un repositorio", () => {
	assert.equal(check("cat /tmp/notes.md"), null);
	assert.equal(check("cat ~/.pi/agent/skills/.sources", "/tmp"), null);
	assert.equal(check("grep -F -f main.txt user.tsv", "/tmp/retro"), null);
	assert.equal(check("cd /tmp/retro; grep -c x main.tsv"), null);
	assert.equal(check("cd ~/.pi/agent/sessions; for d in ./*s*; do find $d -name x; done"), null);
	assert.equal(check("head -c 1500 /tmp/a.jsonl 2>/dev/null"), null);
});

test("rechaza la lectura de un repositorio aunque se trabaje fuera", () => {
	assert.equal(check("cat /repo/src/App.php", "/tmp"), "cat");
	assert.equal(check("cd /repo && grep -rn Foo src", "/tmp"), "grep");
	assert.equal(check("grep Foo /tmp/a.txt /repo/b.txt", "/tmp"), "grep");
	assert.equal(check("cd /tmp; cd /repo; head -5 a.ts", "/tmp"), "head");
	assert.equal(check("grep Foo /tmp/a.txt b.txt"), "grep");
	assert.equal(check("cat < /repo/a", "/tmp"), "cat");
	assert.equal(check("cat </repo/a", "/tmp"), "cat");
	assert.equal(check("cd -P /repo && cat a", "/tmp"), "cat");
	assert.equal(check("cat ../repo/a", "/tmp"), "cat");
	assert.equal(check("find /tmp /repo -name x"), "find");
});

test("no toma por ruta el patrón ni la expresión de find", () => {
	assert.equal(check("grep -A 3 Foo /tmp/a.txt"), null);
	assert.equal(check("grep -e Foo /tmp/a.txt"), "grep");
	assert.equal(check("find /tmp -name x"), null);
	assert.equal(check("cd .. && cat a", "/repo"), null);
	assert.equal(check("cat a", "/repo/.."), null);
});

test("reconoce un repositorio por su directorio .git", () => {
	assert.equal(insideRepository(import.meta.dirname), true);
	assert.equal(insideRepository("/"), false);
});
