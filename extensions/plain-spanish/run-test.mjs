// node --test extensions/plain-spanish/run-test.mjs
// La extensión importa pi y TypeScript de node_modules, que node no carga solo. jiti sí, como hace pi.
import { execSync } from "node:child_process";
import { join } from "node:path";

const pi = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const { createJiti } = await import(join(pi, "node_modules/jiti/lib/jiti.mjs"));
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": join(pi, "dist/index.js") } });
await jiti.import("./index.test.ts");
