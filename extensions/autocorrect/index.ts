// Corrige tildes y eñes inequívocas con el diccionario de macOS. La escritura nunca espera: se decide
// en segundo plano y se aplica si la palabra sigue intacta. Ctrl+- tras una corrección la deshace y
// la palabra se ignora. El estado y las palabras ignoradas van en autocorrect.json.
import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { accentFix, applyFixes, type Fix, proseWords, type Word } from "./correction.ts";

const FILE = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent"), "autocorrect.json");
const HELPER = fileURLToPath(new URL("spellcheck.js", import.meta.url));
const LANGUAGES = ["es", "en"];
const IDLE_MS = 250;
const DICTIONARY_TIMEOUT_MS = 500;

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

/** Guarda la decisión de cada palabra: la corrección, o undefined para dejarla. */
class Corrector {
	private readonly decided = new Map<string, Promise<string | undefined>>();

	constructor(private readonly dictionary: Dictionary) {}

	decide(words: Word[]): Promise<(string | undefined)[]> {
		const missing = [...new Set(words.map(({ word }) => word))].filter((word) => !this.decided.has(word));
		if (missing.length) {
			const batch = this.dictionary.guesses(missing);
			for (const word of missing) {
				const decision = batch.then((guesses) => {
					if (!guesses) throw new Error("el diccionario no respondió");
					return accentFix(word, guesses[word] ?? []);
				});
				this.decided.set(word, decision);
				// Un fallo no se guarda: la palabra se vuelve a consultar en la siguiente revisión.
				decision.catch(() => this.decided.delete(word));
			}
		}
		return Promise.all(words.map(({ word }) => this.decided.get(word)!.catch(() => undefined)));
	}
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
		this.correctClosedWord();
		this.timer = setTimeout(() => this.review(), IDLE_MS);
	}

	private correctClosedWord(): void {
		const { lines, cursorLine, cursorCol } = this.internals.state;
		const closer = cursorCol > 0 ? lines[cursorLine]![cursorCol - 1]! : cursorLine > 0 ? "\n" : "";
		if (!closer || /[\p{L}\p{M}]/u.test(closer)) return;
		const text = this.getText();
		const cursor = this.cursorOffset();
		const word = proseWords(text).find(({ word, start }) => start + word.length === cursor - 1);
		if (word && this.eligible(word)) void this.correct([word]);
	}

	// En la pausa, el resto del mensaje: lo pegado, lo editado en medio o lo que no se pudo aplicar.
	private review(): void {
		const text = this.getText();
		const cursor = this.cursorOffset();
		// La palabra pegada al cursor se está escribiendo todavía.
		const words = proseWords(text).filter((word) => word.start + word.word.length !== cursor && this.eligible(word));
		if (words.length) void this.correct(words);
	}

	private async correct(words: Word[]): Promise<void> {
		const corrections = await this.corrector.decide(words);
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
	const corrector = new Corrector(dictionary);

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		// Arrancar ahora el diccionario evita su parón en la primera tecla.
		dictionary.start();
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
