#!/bin/sh
# Ejecuta npm en este clon (install, uninstall, update...) con las opciones de .npmrc, las mismas que
# aplica pi al instalar el paquete, y regenera el manifiesto "pi" de package.json con los recursos de
# cada paquete instalado. Ejemplo: ./packages.sh install pi-btw
set -e
cd "$(dirname "$0")"
npm "$@"
node <<'JS'
const fs = require("fs");
const path = require("path");
const TYPES = ["extensions", "skills", "prompts", "themes"];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const pi = Object.fromEntries(TYPES.map((type) => [type, [`./${type}`]]));
for (const name of Object.keys(pkg.dependencies ?? {})) {
  const root = path.posix.join("node_modules", name);
  const dep = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const type of TYPES) {
    const entries = dep.pi?.[type] ?? (fs.existsSync(path.join(root, type)) ? [type] : []);
    for (const entry of entries) {
      const [, prefix, rest] = entry.match(/^([!+-]?)(.*)$/);
      pi[type].push(prefix + "./" + path.posix.join(root, rest));
    }
  }
}
pkg.pi = pi;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
JS
