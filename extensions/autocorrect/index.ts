/**
 * Autocorrector del editor de pi con Jev, el modelo de decisión de TypeSafe AI. La escritura nunca
 * espera. Al cerrar una palabra, el diccionario de macOS (spellcheck.js, por JXA) mira si la conoce
 * en español o en inglés. Si no, y solo le falta una tilde o una eñe inequívoca, se corrige al
 * momento; si no, Jev elige en segundo plano, viendo el texto previo, entre dejarla o uno de los
 * candidatos del diccionario. La corrección se aplica en cuanto llega si la palabra sigue intacta
 * en su sitio, editando la línea en el sitio; en cada pausa de tecleo se revisa
 * además el resto del mensaje. La decisión se guarda
 * por palabra y contexto. Ctrl+- deshace una corrección recién hecha y esa palabra deja de
 * corregirse. Requiere TYPESAFE_API_KEY. `/autocorrect` lo activa o desactiva; el estado y las
 * palabras aceptadas se guardan en autocorrect.json.
 */
import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { accentFix, applyFixes, type Fix, type JevAnswer, pickCorrection, proseWords, type Word } from "./correction.ts";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "autocorrect.json");
const HELPER = fileURLToPath(new URL("spellcheck.js", import.meta.url));
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const MODELS_URL = "https://api.typesafe.ai/v1/models";
const LANGUAGES = ["es", "en"];
const IDLE_MS = 250; // pausa de tecleo que revisa el mensaje entero
const KEEP_ALIVE_MS = 3000; // Node cierra la conexión ociosa a los 4 s; pasado esto se reabre antes
const DICTIONARY_TIMEOUT_MS = 500;
const JEV_TIMEOUT_MS = 2000;
const CONTEXT_CHARS = 80; // texto previo a la palabra que se le enseña a Jev

// Interior del Editor de pi-tui 0.87. Su API pública solo reemplaza el texto entero con setText, que
// cancela el autocompletado, borra lo pegado y deja el cursor al final, y devolverlo a su sitio
// flecha a flecha recalcula el ajuste de línea del texto entero en cada pulsación.
type EditorInternals = {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	lastAction: string | null;
	pushUndoSnapshot(): void;
	setCursorCol(col: number): void;
};

type Settings = { enabled: boolean; ignored: string[] };
type Guesses = Record<string, string[]>;

function loadSettings(): Settings {
	try {
		const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
		return { enabled: saved.enabled !== false, ignored: Array.isArray(saved.ignored) ? saved.ignored : [] };
	} catch {
		return { enabled: true, ignored: [] };
	}
}

function saveSettings(settings: Settings): void {
	fs.writeFileSync(FILE, `${JSON.stringify(settings, null, "\t")}\n`);
}

/** Proceso osascript que vive lo que la sesión y responde por líneas JSON. */
class Dictionary {
	private child?: ChildProcessWithoutNullStreams;
	private lastId = 0;
	private readonly waiting = new Map<number, (guesses: Guesses | undefined) => void>();

	/** Candidatos de cada palabra desconocida; undefined si el diccionario no respondió a tiempo. */
	guesses(words: string[]): Promise<Guesses | undefined> {
		const child = this.start();
		const id = ++this.lastId;
		return new Promise((resolve) => {
			const timer = setTimeout(() => this.settle(id, undefined), DICTIONARY_TIMEOUT_MS);
			this.waiting.set(id, (guesses) => {
				clearTimeout(timer);
				resolve(guesses);
			});
			child.stdin.write(`${JSON.stringify({ id, words, languages: LANGUAGES })}\n`);
		});
	}

	stop(): void {
		this.child?.kill();
		this.child = undefined;
	}

	start(): ChildProcessWithoutNullStreams {
		if (this.child) return this.child;
		const child = spawn("osascript", ["-l", "JavaScript", HELPER]);
		createInterface({ input: child.stdout }).on("line", (line) => {
			try {
				const { id, guesses } = JSON.parse(line);
				this.settle(id, guesses ?? {});
			} catch {}
		});
		const forget = () => {
			if (this.child === child) this.child = undefined;
		};
		child.on("exit", forget).on("error", forget);
		child.stdin.on("error", forget);
		this.child = child;
		return child;
	}

	private settle(id: number, guesses: Guesses | undefined): void {
		this.waiting.get(id)?.(guesses);
		this.waiting.delete(id);
	}
}

// Lo que Jev ve de una palabra: el texto que la precede y ella misma. También es la clave de la
// caché, así que escribir detrás no invalida una decisión ya tomada.
function contextOf(text: string, { word, start }: Word): string {
	return text.slice(Math.max(0, start - CONTEXT_CHARS), start + word.length);
}

/** Decide cada palabra una sola vez por contexto: la corrección, o undefined para dejarla. */
class Corrector {
	// ponytail: crece con lo escrito en la sesión (una entrada por palabra cerrada); acotarlo si pesa.
	private readonly decided = new Map<string, Promise<string | undefined>>();
	private lastRequest = 0;
	private warned = false;

	constructor(
		private readonly dictionary: Dictionary,
		private readonly apiKey: string,
		private readonly warn: (message: string) => void,
	) {}

	/** Reabre la conexión con TypeSafe si lleva tiempo ociosa, para que la próxima petición no la espere. */
	warm(): void {
		if (Date.now() - this.lastRequest < KEEP_ALIVE_MS) return;
		this.lastRequest = Date.now();
		fetch(MODELS_URL, { headers: { authorization: `Bearer ${this.apiKey}` } })
			.then((response) => response.body?.cancel())
			.catch(() => {});
	}

	decide(text: string, words: Word[]): Promise<(string | undefined)[]> {
		const missing = words.filter((word) => !this.decided.has(contextOf(text, word)));
		if (missing.length) {
			const batch = this.ask(text, missing);
			missing.forEach((word, index) => {
				const key = contextOf(text, word);
				this.decided.set(key, batch.then((corrections) => corrections[index]));
				batch.catch(() => this.decided.delete(key));
			});
		}
		return Promise.all(words.map((word) => this.decided.get(contextOf(text, word))!.catch(() => undefined)));
	}

	private async ask(text: string, words: Word[]): Promise<(string | undefined)[]> {
		const guesses = await this.dictionary.guesses([...new Set(words.map(({ word }) => word))]);
		if (!guesses) throw new Error("el diccionario no respondió");
		const local = words.map(({ word }) => accentFix(word, guesses[word] ?? []));
		const doubtful = words.filter(({ word }, index) => guesses[word] && !local[index]);
		if (!doubtful.length) return local;
		this.lastRequest = Date.now();
		let answers: Record<string, JevAnswer>;
		try {
			answers = await askJev(text, doubtful, guesses, this.apiKey);
		} catch (error) {
			if (!this.warned) this.warn(`Autocorrección: ${(error as Error).message}`);
			this.warned = true;
			throw error;
		}
		return words.map((word, index) => local[index] ?? (guesses[word.word] ? pickCorrection(word.word, answers[`w${word.start}`]) : undefined));
	}
}

/** Una pregunta Choice por palabra: dejarla como está o uno de los candidatos del diccionario. */
async function askJev(text: string, words: Word[], guesses: Guesses, apiKey: string): Promise<Record<string, JevAnswer>> {
	const questions = Object.fromEntries(
		words.map((word) => [
			`w${word.start}`,
			{
				type: "choice",
				instructions: {
					question:
						"The message mixes Spanish and English with software jargon. Which spelling did the writer intend for `word`, the last word of `context`?",
					word: word.word,
					context: contextOf(text, word),
				},
				criteria: {
					[word.word]: "Keep it as typed: a name, technical jargon, an anglicism used on purpose, or already correct",
					...Object.fromEntries(guesses[word.word]!.map((guess) => [guess, null])),
				},
			},
		]),
	);
	const response = await fetch(JEV_URL, {
		method: "POST",
		headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
		body: JSON.stringify({ model: "jev-latest", state: text, questions }),
		signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Jev respondió ${response.status}`);
	return ((await response.json()) as { answers: Record<string, JevAnswer> }).answers;
}

class AutocorrectEditor extends CustomEditor {
	private timer?: ReturnType<typeof setTimeout>;
	// Texto que dejó cada corrección aún deshacible, para reconocer que un deshacer la revierte.
	private readonly corrected: { text: string; words: string[] }[] = [];

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly corrector: Corrector,
		private readonly settings: Settings,
	) {
		super(tui, theme, keybindings);
	}

	private get internals(): EditorInternals {
		return this as unknown as EditorInternals;
	}

	handleInput(data: string): void {
		clearTimeout(this.timer);
		const undoing = getKeybindings().matches(data, "tui.editor.undo") && this.corrected.at(-1)?.text === this.getText();
		const reverted = undoing ? this.corrected.pop()!.words : [];
		if (!undoing) this.corrected.length = 0;
		super.handleInput(data);
		if (reverted.length) {
			this.settings.ignored.push(...reverted);
			saveSettings(this.settings);
		}
		if (!this.settings.enabled) return;
		this.corrector.warm();
		this.correctClosedWord();
		this.timer = setTimeout(() => this.review(), IDLE_MS);
	}

	// Si la tecla cerró una palabra, se corrige ya, en segundo plano.
	private correctClosedWord(): void {
		const { lines, cursorLine, cursorCol } = this.internals.state;
		const closer = cursorCol > 0 ? lines[cursorLine]![cursorCol - 1]! : cursorLine > 0 ? "\n" : "";
		if (!closer || /[\p{L}\p{M}]/u.test(closer)) return;
		const text = this.getText();
		const cursor = this.cursorOffset();
		const word = proseWords(text).find(({ word, start }) => start + word.length === cursor - 1);
		if (word && this.eligible(word)) void this.correct(text, [word]);
	}

	// En la pausa, el resto del mensaje: lo pegado, lo editado en medio o lo que no se pudo aplicar.
	private review(): void {
		const text = this.getText();
		const cursor = this.cursorOffset();
		// La palabra pegada al cursor se está escribiendo todavía.
		const words = proseWords(text).filter((word) => word.start + word.word.length !== cursor && this.eligible(word));
		if (words.length) void this.correct(text, words);
	}

	// Aplica las decisiones sobre el texto de ahora, solo a las palabras que siguen intactas en su sitio.
	private async correct(text: string, words: Word[]): Promise<void> {
		const corrections = await this.corrector.decide(text, words);
		const current = this.getText();
		const cursor = this.cursorOffset();
		const present = new Set(proseWords(current).map(({ start, word }) => `${start}:${word}`));
		const fixes = words.flatMap((word, index) => {
			const correction = corrections[index];
			const intact = present.has(`${word.start}:${word.word}`);
			return correction && intact && word.start + word.word.length !== cursor && this.eligible(word) ? [{ ...word, correction }] : [];
		});
		if (fixes.length) this.replace(applyFixes(current, fixes, cursor), fixes);
	}

	private eligible({ word }: Word): boolean {
		return !this.settings.ignored.includes(word.toLowerCase());
	}

	private cursorOffset(): number {
		const { line, col } = this.getCursor();
		return this.getLines().slice(0, line).reduce((offset, text) => offset + text.length + 1, col);
	}

	// Una entrada de deshacer por corrección, el cursor en su sitio y lo pegado intacto.
	private replace(result: { text: string; offset: number }, fixes: Fix[]): void {
		const editor = this.internals;
		editor.pushUndoSnapshot();
		const lines = result.text.split("\n");
		let line = 0;
		let col = result.offset;
		while (col > lines[line]!.length) col -= lines[line++]!.length + 1;
		editor.state.lines = lines;
		editor.state.cursorLine = line;
		editor.setCursorCol(col);
		editor.lastAction = null; // lo que se teclee después abre su propia entrada de deshacer
		this.onChange?.(result.text);
		this.corrected.push({ text: result.text, words: fixes.map(({ word }) => word.toLowerCase()) });
		this.tui.requestRender();
	}
}

export default function autocorrect(pi: ExtensionAPI) {
	if (process.platform !== "darwin") return;
	const settings = loadSettings();
	const dictionary = new Dictionary();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (!apiKey) return ctx.ui.notify("Autocorrección inactiva: falta TYPESAFE_API_KEY", "warning");
		const corrector = new Corrector(dictionary, apiKey, (message) => ctx.ui.notify(message, "warning"));
		// Arrancar ahora el diccionario y cargar fetch (unos 130 ms) evita ese parón en la primera tecla.
		dictionary.start();
		corrector.warm();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new AutocorrectEditor(tui, theme, keybindings, corrector, settings));
	});

	pi.on("session_shutdown", () => dictionary.stop());

	pi.registerCommand("autocorrect", {
		description: "Activa o desactiva la corrección ortográfica automática del editor",
		handler: async (_args, ctx) => {
			settings.enabled = !settings.enabled;
			saveSettings(settings);
			ctx.ui.notify(settings.enabled ? "Autocorrección activada" : "Autocorrección desactivada", "info");
		},
	});
}
