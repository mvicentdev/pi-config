import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PUBLISH_REASON =
	"Blocked before publishing: the work changed after the last passing review. A fresh `verifier` subagent must pass the latest change before you push or open a merge request.";

export const GO_REASON =
	"Blocked before publishing: no message of the user came after the last change. Ask the user for the go, and publish only after the answer.";

// Un worker que acaba, bien o mal, pudo dejar cambios. Un verifier solo aprueba si acabó bien.
const FINISHED = new Set(["completed", "steered", "error", "stopped", "aborted"]);
const SUCCEEDED = new Set(["completed", "steered"]);

// Una revisión cubre los cambios hechos antes de que empezara. Un empate cuenta como sin revisar.
export class ReviewState {
	changedAt: number | undefined;
	reviewedFrom: number | undefined;

	change(at: number): void {
		this.changedAt = Math.max(this.changedAt ?? at, at);
	}

	pass(startedAt: number): void {
		this.reviewedFrom = Math.max(this.reviewedFrom ?? startedAt, startedAt);
	}

	// El último mensaje del usuario. Los avisos de pi-subagents y de las extensiones no son del usuario.
	spokenAt: number | undefined;

	speak(at: number): void {
		this.spokenAt = Math.max(this.spokenAt ?? at, at);
	}

	// El visto bueno cuenta si llega después del último cambio, aunque llegue antes de la revisión que lo aprueba.
	// Así vale el visto bueno tras el que la extensión pide otra revisión y esta pasa sin cambiar nada.
	awaitingGo(): boolean {
		if (this.changedAt === undefined) return false;
		return this.spokenAt === undefined || this.spokenAt <= this.changedAt;
	}

	unreviewed(): boolean {
		if (this.changedAt === undefined) return false;
		return this.reviewedFrom === undefined || this.reviewedFrom <= this.changedAt;
	}
}

// agents/verifier.md fija que el informe abre con la línea «Verdict: pass» o «Verdict: fail».
// Solo aprueba esa primera línea no vacía con pass, también en negrita. Cualquier otra cosa, como «pass with reservations», no.
export function verdictPasses(report: unknown): boolean {
	if (typeof report !== "string") return false;
	const first = report.split("\n").find((line) => line.trim()) ?? "";
	return /^\s*(\*\*)?Verdict:(\*\*)? pass(\*\*)?\s*$/.test(first) && (first.match(/\*\*/g)?.length ?? 0) % 2 === 0;
}

export type AgentOutcome = { type: string; status: string; report: unknown; startedAt: number; completedAt: number };

export function applyAgent(state: ReviewState, outcome: AgentOutcome): void {
	const type = outcome.type.toLowerCase();
	if (type === "worker" && FINISHED.has(outcome.status)) state.change(outcome.completedAt);
	if (type === "verifier" && SUCCEEDED.has(outcome.status) && verdictPasses(outcome.report)) state.pass(outcome.startedAt);
}

// edit y write cambian siempre un fichero. lsp_fix solo con write: true.
export function changesFiles(toolName: string, input: unknown): boolean {
	if (toolName === "edit" || toolName === "write") return true;
	return toolName === "lsp_fix" && (input as Record<string, unknown> | undefined)?.write === true;
}

const textOf = (content: unknown) =>
	Array.isArray(content)
		? content
				.filter((block) => block?.type === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n")
		: "";

// El Agent en primer plano devuelve el informe y details con el tipo real, también al reanudar, donde subagent_type no cuenta.
// Antes del informe puede ir una nota y la cabecera «Agent completed in …», seguida de una línea en blanco.
// En segundo plano devuelve status "background": el final llega después como subagents:completed.
export function agentFromToolResult(details: unknown, content: unknown, at: number): AgentOutcome | null {
	const fields = (details ?? {}) as Record<string, unknown>;
	if (typeof fields.subagentType !== "string" || typeof fields.status !== "string") return null;
	const duration = typeof fields.durationMs === "number" ? fields.durationMs : 0;
	// Solo al principio del texto: un agente reanudado no lleva cabecera y su informe puede repetirla en otra línea.
	const report = textOf(content).replace(/^(?:Note: [^\n]*\n\n)?Agent completed in [^\n]*\n\n/, "");
	return { type: fields.subagentType, status: fields.status, report, startedAt: at - duration, completedAt: at };
}

// pi-subagents guarda cada agente acabado como entrada subagents:record.
export function agentFromRecord(data: unknown): AgentOutcome | null {
	const fields = (data ?? {}) as Record<string, unknown>;
	const { type, status, result, startedAt, completedAt } = fields;
	if (typeof type !== "string" || typeof status !== "string" || typeof startedAt !== "number") return null;
	return { type, status, report: result, startedAt, completedAt: typeof completedAt === "number" ? completedAt : startedAt };
}

type Entry = { type?: string; customType?: string; data?: unknown; message?: Record<string, unknown> };

// El tipo de cada agente por su id, para saber qué reanuda un Agent con resume.
export function agentTypes(entries: readonly unknown[]): Map<string, string> {
	const types = new Map<string, string>();
	for (const raw of entries) {
		const entry = (raw ?? {}) as Entry;
		const fields = (entry.type === "custom" && entry.customType === "subagents:record" ? entry.data : entry.message?.details) as
			| Record<string, unknown>
			| undefined;
		const id = fields?.id ?? fields?.agentId;
		const type = fields?.type ?? fields?.subagentType;
		if (typeof id === "string" && typeof type === "string") types.set(id, type);
	}
	return types;
}

export function rebuild(entries: readonly unknown[]): ReviewState {
	const state = new ReviewState();
	const inputs = new Map<string, unknown>();
	for (const raw of entries) {
		const entry = (raw ?? {}) as Entry;
		if (entry.type === "custom" && entry.customType === "subagents:record") {
			const outcome = agentFromRecord(entry.data);
			if (outcome) applyAgent(state, outcome);
			continue;
		}
		const message = entry.type === "message" ? entry.message : undefined;
		if (message?.role === "user" && typeof message.timestamp === "number") state.speak(message.timestamp);
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) if (block?.type === "toolCall") inputs.set(block.id, block.arguments);
		}
		if (message?.role !== "toolResult" || message.isError === true) continue;
		const toolName = String(message.toolName);
		const at = typeof message.timestamp === "number" ? message.timestamp : 0;
		if (changesFiles(toolName, inputs.get(String(message.toolCallId)))) state.change(at);
		if (toolName === "Agent") {
			const outcome = agentFromToolResult(message.details, message.content, at);
			if (outcome) applyAgent(state, outcome);
		}
	}
	return state;
}

const NESTED_SHELL = /(?:\b(?:ba|z|da|k)?sh\s+(?:-\w+\s+)*-\w*c\w*|\beval)\s+(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const STRIP_LITERALS = (command: string) =>
	command
		.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\s|$)/g, " $3")
		.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
const SEGMENTS = /&&|\|\||[;&|\n(){}`]|\$\(/;
const LEADING = new Set(["!", "then", "do", "else", "elif", "if", "while", "until", "time", "command", "builtin", "exec", "env", "nohup", "xargs"]);
// Prefijos que lanzan otra orden. Sus opciones con valor llevan el valor en la palabra siguiente.
// Un Map y no un objeto: una palabra como toString no debe dar con el prototipo.
const WRAPPERS = new Map<string, { values: ReadonlySet<string>; operand: boolean }>([
	["timeout", { values: new Set(["-s", "--signal", "-k", "--kill-after"]), operand: true }],
	["nice", { values: new Set(["-n", "--adjustment"]), operand: false }],
	["sudo", { values: new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-D", "--chdir", "-r", "--role", "-t", "--type", "-U", "--other-user", "-T", "--command-timeout"]), operand: false }],
]);
// Opciones globales de git que llevan el valor en la palabra siguiente.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--exec-path"]);
// gh y glab eligen el repositorio con -R o --repo.
const REPO_OPTIONS = new Set(["-R", "--repo"]);

function subcommands(words: readonly string[], valueOptions: ReadonlySet<string>): string[] {
	const found: string[] = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (valueOptions.has(word)) index++;
		else if (!word.startsWith("-")) found.push(word);
	}
	return found;
}

// Las palabras de una orden sin los prefijos que lanzan otra. Quita también las redirecciones como 2>.
function commandWords(segment: string): string[] {
	const words = segment
		.trim()
		.split(/\s+/)
		.filter((word) => word && !/[<>]/.test(word));
	for (;;) {
		while (words.length && (LEADING.has(words[0]) || /^\w+=/.test(words[0]) || words[0].startsWith("-"))) words.shift();
		const wrapper = WRAPPERS.get(words[0]?.replace(/^.*\//, "") ?? "");
		if (!wrapper) break;
		words.shift();
		while (words[0]?.startsWith("-")) if (wrapper.values.has(words.shift() as string)) words.shift();
		if (wrapper.operand) words.shift();
	}
	return words;
}

function segmentPublishes(segment: string): boolean {
	const words = commandWords(segment);
	const name = words[0]?.replace(/^.*\//, "");
	const rest = words.slice(1);
	if (name === "git") return subcommands(rest, GIT_VALUE_OPTIONS)[0] === "push";
	const [object, action] = subcommands(rest, REPO_OPTIONS);
	if (name === "glab") return object === "mr" && (action === "create" || action === "new");
	if (name === "gh") return object === "pr" && (action === "create" || action === "new");
	return false;
}

// git push en cualquier forma, glab mr create y gh pr create. Mira también dentro de `sh -c '…'` y `eval '…'`.
export function publishes(command: string): boolean {
	for (const nested of command.matchAll(NESTED_SHELL)) if (publishes(nested[2])) return true;
	return STRIP_LITERALS(command).split(SEGMENTS).some(segmentPublishes);
}

// Responde a git en un directorio. Da undefined si git falla o no escribe nada.
export type GitLookup = (dir: string, args: readonly string[]) => string | undefined;

export const runGit: GitLookup = (dir, args) => {
	try {
		const output = execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
		return output.trim() || undefined;
	} catch {
		return undefined;
	}
};

// La rama por defecto es la que apunta origin/HEAD. Sin ella cuentan main y master.
function isDefaultBranch(branch: string, dir: string, git: GitLookup): boolean {
	const remoteHead = git(dir, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
	if (remoteHead) return branch === remoteHead.replace(/^origin\//, "");
	return branch === "main" || branch === "master";
}

// Opciones de git merge que llevan el valor en la palabra siguiente.
const MERGE_VALUE_OPTIONS = new Set(["-m", "-s", "-X", "-F", "--strategy", "--strategy-option", "--file", "--into-name"]);
const MERGE_CONTROL = new Set(["--abort", "--continue", "--quit", "-h", "--help"]);

// Traer su propio remoto, como git merge --ff-only origin/main, pone la rama al día y no publica.
function syncsUpstream(ref: string, dir: string, git: GitLookup): boolean {
	if (ref === "FETCH_HEAD" || ref.endsWith(UPSTREAM)) return true;
	const remotes = (git(dir, ["remote"]) ?? "").split("\n").filter(Boolean);
	return remotes.some((remote) => ref.startsWith(`${remote}/`));
}

// Las llaves de @{u} cortan la orden en trozos. Se cambian antes por una marca.
const UPSTREAM = "@upstream";
const markUpstream = (command: string) => command.replace(/@\{(?:u|upstream)\}/g, UPSTREAM);

const atPath = (dir: string | undefined, target: string) =>
	target.startsWith("~") ? join(homedir(), target.slice(1)) : dir === undefined ? undefined : resolve(dir, target);

// Una fusión en la rama por defecto: git merge de otra rama local en ella, gh pr merge o glab mr merge.
// Sigue cd, git -C y git checkout o switch en la misma orden. Un commit nunca cuenta.
export function mergesIntoDefault(command: string, cwd: string, git: GitLookup = runGit): boolean {
	for (const nested of command.matchAll(NESTED_SHELL)) if (mergesIntoDefault(nested[2], cwd, git)) return true;
	let dir: string | undefined = cwd;
	// La rama a la que pasa cada directorio con checkout o switch antes de fusionar.
	const switched = new Map<string, string>();
	for (const segment of STRIP_LITERALS(markUpstream(command)).split(SEGMENTS)) {
		const words = commandWords(segment);
		const name = words[0]?.replace(/^.*\//, "");
		const rest = words.slice(1);
		if (name === "cd") {
			dir = rest[0] === "-" ? undefined : atPath(dir, rest[0] ?? "~");
			continue;
		}
		if (name === "gh" || name === "glab") {
			const [object, action] = subcommands(rest, REPO_OPTIONS);
			const help = rest.includes("--help") || rest.includes("-h");
			if (object === (name === "gh" ? "pr" : "mr") && action === "merge" && !help) return true;
			continue;
		}
		if (name !== "git") continue;
		let repo = dir;
		let index = 0;
		for (; index < rest.length && rest[index].startsWith("-"); index++) {
			if (rest[index] === "-C") repo = atPath(repo, rest[++index] ?? "");
			else if (GIT_VALUE_OPTIONS.has(rest[index])) index++;
		}
		if (repo === undefined) continue;
		const action = rest[index];
		const args = rest.slice(index + 1);
		if (action === "checkout" || action === "switch") {
			const end = args.indexOf("--");
			const target = (end < 0 ? args : args.slice(0, end)).find((word) => !word.startsWith("-"));
			if (target) switched.set(repo, target);
			continue;
		}
		if (action !== "merge" || args.some((word) => MERGE_CONTROL.has(word))) continue;
		const refs = subcommands(args, MERGE_VALUE_OPTIONS);
		const here = repo;
		if (!refs.length || refs.every((ref) => syncsUpstream(ref, here, git))) continue;
		const branch = switched.get(repo) ?? git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
		if (branch && isDefaultBranch(branch, repo, git)) return true;
	}
	return false;
}
