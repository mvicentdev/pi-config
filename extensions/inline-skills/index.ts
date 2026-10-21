import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { Editor, type AutocompleteItem, type AutocompleteProvider } from "@earendil-works/pi-tui";

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

// A small literal-span scanner, not a Markdown parser. Keep offsets and newlines intact.
function maskCode(text: string): string {
  const spans = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)|`+/gm;
  let masked = "";
  let copied = 0;
  for (let match; (match = spans.exec(text));) {
    if (isEscaped(text, match.index)) continue;
    let end = text.length;
    if (match[1]) {
      const fence = match[1];
      const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm");
      close.lastIndex = spans.lastIndex;
      const closing = close.exec(text);
      if (closing) end = close.lastIndex;
    } else {
      const close = /`+/g;
      close.lastIndex = spans.lastIndex;
      for (let closing; (closing = close.exec(text));) {
        if (closing[0].length === match[0].length && !isEscaped(text, closing.index)) {
          end = close.lastIndex;
          break;
        }
      }
    }
    masked += text.slice(copied, match.index) + text.slice(match.index, end).replace(/[^\n]/g, " ");
    copied = end;
    spans.lastIndex = end;
  }
  return masked + text.slice(copied);
}

function skillCommands(commands: SlashCommandInfo[]): SlashCommandInfo[] {
  return commands.filter((command) => command.source === "skill" && command.name.startsWith("skill:"));
}

function cursorPrefix(lines: string[], cursorLine: number, cursorCol: number): string | undefined {
  const beforeCursor = [...lines.slice(0, cursorLine), lines[cursorLine].slice(0, cursorCol)].join("\n");
  return /(?:^|\s)(\/skill:[\w-]*)$/.exec(maskCode(beforeCursor))?.[1];
}

export function inlineSkillProvider(current: AutocompleteProvider, getCommands: () => SlashCommandInfo[]): AutocompleteProvider {
  const owned = new WeakSet<AutocompleteItem>();
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const prefix = cursorPrefix(lines, cursorLine, cursorCol);
      // Pi's ordinary first-line command popup and fuzzy matching stay unchanged.
      if (!prefix || (cursorLine === 0 && cursorCol === prefix.length && !options.force)) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      const items = skillCommands(getCommands())
        .filter((command) => `/${command.name}`.startsWith(prefix))
        .map((command) => ({ value: command.name, label: `/${command.name}`, description: command.description }));
      if (items.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      for (const item of items) owned.add(item);
      // Pi submits on Enter when the prefix starts with "/"; leaving the slash out keeps Enter as select.
      return { items, prefix: prefix.slice(1) };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!owned.has(item)) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      const before = lines[cursorLine].slice(0, cursorCol - prefix.length);
      const after = lines[cursorLine].slice(cursorCol);
      const updated = [...lines];
      updated[cursorLine] = `${before}${item.value} ${after}`;
      return { lines: updated, cursorLine, cursorCol: before.length + item.value.length + 1 };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const prefix = cursorPrefix(lines, cursorLine, cursorCol);
      if (prefix && skillCommands(getCommands()).some((command) => `/${command.name}`.startsWith(prefix))) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

// Editor internals of pi-tui: it opens the popup by itself only for "/" at the start of the message.
type EditorInternals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  autocompleteState: unknown;
  getText(): string;
  tryTriggerAutocomplete(): void;
};
const ORIGINAL_HANDLE_INPUT = Symbol.for("inline-skills.handleInput");

// Opens the skill list when an edit leaves "/skill:" before the cursor, anywhere in the message.
// Patching the prototype covers the default editor and any custom editor; /reload rewraps the original.
export function openSkillListWhileTyping(editorClass: { prototype: object } = Editor): void {
  const prototype = editorClass.prototype as Record<symbol | string, unknown>;
  const original = (prototype[ORIGINAL_HANDLE_INPUT] ??= prototype.handleInput) as (this: EditorInternals, data: string) => void;
  prototype.handleInput = function (this: EditorInternals, data: string) {
    const before = this.getText();
    original.call(this, data);
    if (this.autocompleteState || this.getText() === before) return;
    const { lines, cursorLine, cursorCol } = this.state;
    if (cursorPrefix(lines, cursorLine, cursorCol)) this.tryTriggerAutocomplete();
  };
}

export function expandInlineSkills(text: string, commands: SlashCommandInfo[], notifyError: (message: string) => void): string {
  // Never interpret references inside previously expanded instructions.
  if (/<skill(?:\s|>)/.test(text)) return text;
  const known = new Map(skillCommands(commands).map((command) => [`/${command.name}`, command]));
  // Bare means whitespace-delimited: quotes, escapes, paths and punctuation remain literal.
  const invocations = [...maskCode(text).matchAll(/(?:^|(?<=\s))\/skill:[\w-]+(?=\s|$)/g)]
    .filter((match) => known.has(match[0]));
  if (invocations.length === 0) return text;
  // Native expansion understands a single leading, single-line invocation.
  if (invocations.length === 1 && invocations[0].index === 0 && !/[\r\n]/.test(text)
    && (text.length === invocations[0][0].length || text[invocations[0][0].length] === " ")) return text;

  const blocks = new Map<string, string | null>();
  for (const match of invocations) {
    if (blocks.has(match[0])) continue;
    const command = known.get(match[0])!;
    const path = command.sourceInfo.path;
    try {
      const body = stripFrontmatter(readFileSync(path, "utf-8")).trim();
      blocks.set(match[0], `<skill name="${command.name.slice(6)}" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${body}\n</skill>`);
    } catch (error) {
      blocks.set(match[0], null);
      notifyError(`Cannot load ${match[0]} from ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let request = "";
  let copied = 0;
  for (const match of invocations) {
    if (!blocks.get(match[0])) continue;
    request += text.slice(copied, match.index);
    copied = match.index + match[0].length;
  }
  request += text.slice(copied);
  const loaded = [...blocks.values()].filter((block): block is string => block !== null);
  return loaded.length ? `${loaded.join("\n\n")}\n\n${request}` : text;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui" && ctx.hasUI) {
      openSkillListWhileTyping();
      ctx.ui.addAutocompleteProvider((current) => inlineSkillProvider(current, () => pi.getCommands()));
    }
  });
  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    const text = expandInlineSkills(event.text, pi.getCommands(), (message) => ctx.ui.notify(message, "error"));
    return text === event.text ? { action: "continue" } : { action: "transform", text, images: event.images };
  });
}
