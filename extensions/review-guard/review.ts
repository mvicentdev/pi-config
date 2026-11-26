export const PUBLISH_REASON =
	"Blocked before publishing: the work changed after the last passing review. A fresh `verifier` subagent must pass the latest change before you push or open a merge request.";

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
	const report = textOf(content).replace(/^[\s\S]*?^Agent completed in [^\n]*\n\n/m, "");
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
const WRAPPERS: Record<string, { values: ReadonlySet<string>; operand: boolean }> = {
	timeout: { values: new Set(["-s", "--signal", "-k", "--kill-after"]), operand: true },
	nice: { values: new Set(["-n", "--adjustment"]), operand: false },
	sudo: { values: new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-D", "--chdir", "-r", "--role", "-t", "--type", "-U", "--other-user", "-T", "--command-timeout"]), operand: false },
};
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

function segmentPublishes(segment: string): boolean {
	const words = segment.trim().split(/\s+/).filter(Boolean);
	for (;;) {
		while (words.length && (LEADING.has(words[0]) || /^\w+=/.test(words[0]) || words[0].startsWith("-"))) words.shift();
		const wrapper = WRAPPERS[words[0]?.replace(/^.*\//, "")];
		if (!wrapper) break;
		words.shift();
		while (words[0]?.startsWith("-")) if (wrapper.values.has(words.shift() as string)) words.shift();
		if (wrapper.operand) words.shift();
	}
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
