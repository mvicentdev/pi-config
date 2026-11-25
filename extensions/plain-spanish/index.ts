/**
 * Adaptación al castellano del adaptador pi de agent-simple-english.
 * Reutiliza el motor del paquete. Solo activa las reglas que valen en cualquier idioma.
 * Importa rutas internas del paquete, así que package.json fija la versión 0.8.0 exacta.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { blankCommitMetadata, findCommitInvocations } from "agent-simple-english/src/adapter/commit-message.ts";
import { splitViolations } from "agent-simple-english/src/adapter/feedback.ts";
import { loadConfig } from "agent-simple-english/src/config/load.ts";
import type { SteConfig } from "agent-simple-english/src/config/schema.ts";
import { classifyPath, type PathClassification } from "agent-simple-english/src/engine/kinds.ts";
import { DEFAULT_MAX_SENTENCE_WORDS, lint } from "agent-simple-english/src/engine/lint.ts";
import { DEFAULT_SEVERITIES, type RuleId } from "agent-simple-english/src/engine/rules/registry.ts";
import type { LintKind, LintReport, RuleSetting, Violation } from "agent-simple-english/src/engine/types.ts";

type ActiveRuleId = "sentence-length" | "paragraph-length" | "semicolon" | "invalid-suppression";

const ENGLISH_ONLY_RULES: Partial<Record<RuleId, RuleSetting>> = {
	contraction: "off",
	"dictionary-not-approved-word": "off",
	hedging: "off",
	marketing: "off",
	"phrasal-verb": "off",
	"verb-progressive": "off",
	"verb-passive": "off",
	"verb-perfect": "off",
};

interface ActiveRule {
	summary: (maxWords: number) => string;
	message: (violation: Violation, count: string | undefined, max: string | undefined) => string;
	fix: string;
}

const ACTIVE_RULES: Readonly<Record<ActiveRuleId, ActiveRule>> = {
	"sentence-length": {
		summary: (maxWords) => `Escribe frases de ${maxWords} palabras como máximo.`,
		message: (_violation, count, max) => `La frase tiene ${count} palabras. El máximo es ${max}.`,
		fix: "Divide la frase en frases más cortas.",
	},
	"paragraph-length": {
		summary: () => "Escribe seis frases como máximo en cada párrafo.",
		message: (_violation, count, max) => `El párrafo tiene ${count} frases. El máximo es ${max}.`,
		fix: "Divide el párrafo en párrafos más cortos.",
	},
	semicolon: {
		summary: () => "No uses punto y coma. Escribe dos frases.",
		message: () => "No uses punto y coma.",
		fix: "Cambia el punto y coma por un punto y escribe dos frases.",
	},
	"invalid-suppression": {
		summary: () => "Nombra identificadores de regla registrados en las directivas de supresión.",
		message: (violation) => `Directiva de supresión no válida: ${violation.message}`,
		fix: "Nombra uno o más identificadores de regla registrados.",
	},
};

const ACTIVE_RULE_IDS = Object.keys(ACTIVE_RULES) as ActiveRuleId[];

const SEVERITY_LABELS: Readonly<Record<"hard" | "soft", string>> = { hard: "bloquea", soft: "avisa" };

// PHP no figura en la tabla del paquete: sin esto el motor revisaría el código como prosa.
const PHP: PathClassification = { kind: "slash-source", sourceDialect: "general" };
// El código de terceros (vendor) conserva sus comentarios, que no siguen estas reglas.
const SKIPPED: PathClassification = { kind: "prose-file", sourceDialect: "general", skipped: true };
// Notas temporales y artefactos: el usuario no los lee como documento.
const SCRATCH_PREFIXES = ["/tmp/", "/private/tmp/"];
// Un fichero sin extensión de prosa suele ser código y no se revisa.
const PROSE_EXTENSIONS = new Set(["md", "mdx", "markdown", "txt", "rst", "adoc"]);

export interface SessionState {
	config: SteConfig;
	enabled: boolean;
	ready: boolean;
	error?: string;
	pendingReplyFeedback?: string;
	readonly pendingWarnings: Map<string, string>;
}

function ruleSetting(config: SteConfig, ruleId: RuleId): RuleSetting {
	return config.rules?.[ruleId] ?? DEFAULT_SEVERITIES[ruleId];
}

function systemPromptRules(config: SteConfig): string {
	const rules = ACTIVE_RULE_IDS.flatMap((ruleId) => {
		const setting = ruleSetting(config, ruleId);
		if (setting === "off") return [];
		return [`- [${SEVERITY_LABELS[setting]}] ${ACTIVE_RULES[ruleId].summary(config.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS)}`];
	});
	return [
		"## Reglas de escritura",
		"",
		"Escribe en castellano la prosa para el usuario, también las respuestas. El código, los commits y los documentos siguen la lengua que fije cada proyecto. Aplica estas reglas, derivadas de ASD-STE100, en cualquier lengua:",
		"",
		...rules,
		"",
		"Una infracción que bloquea detiene la escritura, la edición o el commit. Corrige el texto que indica el aviso y vuelve a intentarlo. Una infracción que avisa no detiene nada. También se revisa cada respuesta.",
		"",
		"En un fichero que ya existe solo se revisan las líneas que cambias. Cámbialo con edit y conserva tal cual las líneas que no tocas.",
	].join("\n");
}

function violationMessage(violation: Violation): string {
	const [count, max] = violation.message.match(/\d+/g) ?? [];
	return ACTIVE_RULES[violation.ruleId as ActiveRuleId]?.message(violation, count, max) ?? violation.message;
}

function formatViolations(heading: string, violations: readonly Violation[]): string {
	const details = violations.map((violation) => {
		const fix = ACTIVE_RULES[violation.ruleId as ActiveRuleId]?.fix ?? "";
		return `- línea ${violation.line}, columna ${violation.column} [${violation.ruleId}]: ${violationMessage(violation)} ${fix}`.trimEnd();
	});
	return `${heading}:\n${details.join("\n")}`;
}

function classify(path: string): PathClassification {
	if (path.split("/").includes("vendor")) return SKIPPED;
	if (SCRATCH_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.includes(".agents/artifacts/")) return SKIPPED;
	if (path.toLowerCase().endsWith(".php")) return PHP;
	const classification = classifyPath(path);
	if (classification.kind !== "prose-file" || classification.skipped) return classification;
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return path.lastIndexOf(".") > path.lastIndexOf("/") && PROSE_EXTENSIONS.has(extension) ? classification : SKIPPED;
}

function lintText(state: SessionState, kind: LintKind, text: string, extra: object = {}): LintReport {
	return lint(kind, text, { ...state.config, ...extra });
}

function ensureReady(state: SessionState): void {
	if (!state.ready) throw new Error(`La revisión de escritura no está disponible: ${state.error ?? "la sesión aún no ha terminado de arrancar"}`);
}

function lintProposedText(state: SessionState, ctx: ExtensionContext, toolCallId: string, path: string, text: string, previousText?: string): void {
	const classification = classify(path);
	if (classification.skipped) return;
	const report = lintText(state, classification.kind, text, { sourceDialect: classification.sourceDialect, previousText });
	const { hard, soft } = splitViolations(report.violations);
	if (hard.length > 0) throw new Error(formatViolations(`Las reglas de escritura bloquean ${path}`, hard));
	if (soft.length === 0) return;
	const warning = formatViolations(`Avisos de escritura en ${path}`, soft);
	state.pendingWarnings.set(toolCallId, warning);
	if (ctx.hasUI) ctx.ui.notify(warning, "warning");
}

function lintCommitCommand(state: SessionState, toolCallId: string, command: string): void {
	const invocations = findCommitInvocations(command);
	if (invocations.length === 0) return;
	ensureReady(state);
	const warnings: string[] = [];
	for (const invocation of invocations) {
		if (invocation.requiresExplicitMessage) {
			throw new Error("Las reglas de escritura no pueden revisar el mensaje del commit. Usa git commit con un argumento -m o --message fijo.");
		}
		const report = lintText(state, "commit-message", blankCommitMetadata(invocation.message));
		const { hard, soft } = splitViolations(report.violations);
		if (hard.length > 0) throw new Error(formatViolations("Las reglas de escritura bloquean el mensaje del commit", hard));
		if (soft.length > 0) warnings.push(formatViolations("Avisos de escritura en el mensaje del commit", soft));
	}
	if (warnings.length > 0) state.pendingWarnings.set(toolCallId, warnings.join("\n\n"));
}

function createGatedBashTool(cwd: string, state: SessionState) {
	const definition = createBashToolDefinition(cwd);
	const execute: typeof definition.execute = async (...args) => {
		const [toolCallId, input] = args;
		if (state.enabled) lintCommitCommand(state, toolCallId, input.command);
		return definition.execute(...args);
	};
	return { ...definition, execute };
}

export function createGatedWriteTool(cwd: string, state: SessionState) {
	const definition = createWriteToolDefinition(cwd);
	const execute: typeof definition.execute = async (...args) => {
		const [toolCallId, input, signal, _onUpdate, ctx] = args;
		const implementation = createWriteToolDefinition(cwd, {
			operations: {
				mkdir: async () => undefined,
				writeFile: async (path, content) => {
					if (state.enabled) {
						ensureReady(state);
						// Como en edit, las líneas que el fichero ya tenía no se revisan.
						const previousText = await readFile(path, "utf8").catch(() => undefined);
						lintProposedText(state, ctx, toolCallId, input.path, content, previousText);
					}
					await mkdir(dirname(path), { recursive: true });
					if (signal?.aborted) throw new Error("Operation aborted");
					await writeFile(path, content, "utf8");
				},
			},
		});
		return implementation.execute(...args);
	};
	return { ...definition, execute };
}

function createGatedEditTool(cwd: string, state: SessionState) {
	const definition = createEditToolDefinition(cwd);
	const execute: typeof definition.execute = async (...args) => {
		const [toolCallId, input, _signal, _onUpdate, ctx] = args;
		let previousText: string | undefined;
		const implementation = createEditToolDefinition(cwd, {
			operations: {
				access: (path) => access(path, constants.R_OK | constants.W_OK),
				readFile: async (path) => {
					const content = await readFile(path);
					previousText = content.toString("utf8");
					return content;
				},
				writeFile: async (path, content) => {
					if (state.enabled) {
						ensureReady(state);
						lintProposedText(state, ctx, toolCallId, input.path, content, previousText);
					}
					await writeFile(path, content, "utf8");
				},
			},
		});
		return implementation.execute(...args);
	};
	return { ...definition, execute };
}

// Tope de un informe o un estado. Los demás topes (60 y 40) están en feedback-reminder/FEEDBACK.md y en lengthFeedback.
export const MAX_REPLY_PROSE_WORDS = 120;

/** Las palabras de prosa de una respuesta. No cuentan el código, las tablas, el código en línea ni los enlaces. */
export function proseWordCount(text: string): number {
	return text
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("|"))
		.join("\n")
		.replace(/`[^`\n]*`/g, " ")
		.replace(/https?:\S+/g, " ")
		.split(/\s+/)
		.filter((word) => /\p{L}/u.test(word)).length;
}

export function lengthFeedback(text: string): string | undefined {
	const words = proseWordCount(text);
	if (words <= MAX_REPLY_PROSE_WORDS) return undefined;
	return `Tu respuesta anterior tenía ${words} palabras de prosa. El tope es ${MAX_REPLY_PROSE_WORDS} para un informe o un estado, 60 para trabajo terminado y 40 para una respuesta a una pregunta. Recorta la siguiente.`;
}

function updateReplyState(state: SessionState, ctx: ExtensionContext, text?: string, final = false): void {
	state.pendingReplyFeedback = undefined;
	if (text === undefined || !state.ready) {
		if (ctx.hasUI) ctx.ui.setWidget("plain-spanish-reply", undefined);
		return;
	}
	const report = lintText(state, "prose-file", text);
	const { hard } = splitViolations(report.violations);
	const feedback = [
		hard.length > 0 ? formatViolations("Infracciones de escritura en tu respuesta anterior", hard) : undefined,
		final ? lengthFeedback(text) : undefined,
	].filter((part) => part !== undefined);
	if (feedback.length > 0) state.pendingReplyFeedback = feedback.join("\n\n");
	if (!ctx.hasUI) return;
	const soft = report.summary.total - report.summary.hard;
	const status = report.summary.total === 0 ? "Respuesta: limpia" : `Respuesta: ${report.summary.hard} bloquean, ${soft} avisan`;
	ctx.ui.setWidget("plain-spanish-reply", [status]);
}

function registerAseCommand(pi: ExtensionAPI, state: SessionState): void {
	pi.registerCommand("ase", {
		description: "Activa o desactiva las reglas de escritura, o muestra su estado.",
		getArgumentCompletions: (prefix) => {
			const items = ["on", "off", "status"].filter((value) => value.startsWith(prefix));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command === "status") {
				const active = ACTIVE_RULE_IDS.filter((ruleId) => ruleSetting(state.config, ruleId) !== "off");
				const mode = state.enabled ? "activas" : "desactivadas";
				const readiness = state.ready ? "" : `\nError: ${state.error ?? "sin cargar"}`;
				ctx.ui.notify(`Reglas de escritura ${mode}: ${active.join(", ")}${readiness}`, "info");
				return;
			}
			if (command !== "" && command !== "on" && command !== "off") {
				ctx.ui.notify("Uso: /ase [on|off|status]", "warning");
				return;
			}
			state.enabled = command === "on" || (command === "" && !state.enabled);
			if (!state.enabled) {
				state.pendingReplyFeedback = undefined;
				state.pendingWarnings.clear();
				if (ctx.hasUI) ctx.ui.setWidget("plain-spanish-reply", undefined);
			}
			ctx.ui.notify(`Reglas de escritura ${state.enabled ? "activadas" : "desactivadas"}.`, "info");
		},
	});
}

function registerSessionStart(pi: ExtensionAPI, state: SessionState): void {
	pi.on("session_start", async (_event, ctx) => {
		state.ready = false;
		state.error = undefined;
		state.pendingWarnings.clear();
		updateReplyState(state, ctx);
		pi.registerTool(createGatedBashTool(ctx.cwd, state));
		pi.registerTool(createGatedWriteTool(ctx.cwd, state));
		pi.registerTool(createGatedEditTool(ctx.cwd, state));
		try {
			const config = await Effect.runPromise(loadConfig(undefined, ctx.cwd, ctx.isProjectTrusted()));
			state.config = { ...config, rules: { ...config.rules, ...ENGLISH_ONLY_RULES } };
			state.ready = true;
		} catch (error) {
			state.error = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(`Las reglas de escritura no arrancan: ${state.error}`, "error");
		}
	});
}

export default function plainSpanish(pi: ExtensionAPI) {
	const state: SessionState = { config: {}, enabled: true, ready: false, pendingWarnings: new Map() };
	registerAseCommand(pi, state);
	registerSessionStart(pi, state);

	pi.on("before_agent_start", (event) => {
		if (!state.enabled || !state.ready) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${systemPromptRules(state.config)}` };
	});

	pi.on("turn_end", (event, ctx) => {
		if (!state.enabled || event.message.role !== "assistant") return;
		const textBlocks = event.message.content.filter((block) => block.type === "text");
		if (textBlocks.length === 0) return;
		// El tope de palabras solo mide la respuesta que cierra el turno. El texto junto a una herramienta es narración.
		const final = !event.message.content.some((block) => block.type === "toolCall");
		updateReplyState(state, ctx, textBlocks.map((block) => block.text).join("\n"), final);
	});

	pi.on("context", (event) => {
		const feedback = state.pendingReplyFeedback;
		if (!state.enabled || feedback === undefined) return undefined;
		state.pendingReplyFeedback = undefined;
		return {
			messages: [
				...event.messages,
				{ role: "custom" as const, customType: "plain-spanish-reply-feedback", content: feedback, display: false, timestamp: Date.now() },
			],
		};
	});

	pi.on("tool_result", (event) => {
		const warning = state.pendingWarnings.get(event.toolCallId);
		if (warning === undefined) return undefined;
		state.pendingWarnings.delete(event.toolCallId);
		return { content: [...event.content, { type: "text" as const, text: warning }] };
	});
}
