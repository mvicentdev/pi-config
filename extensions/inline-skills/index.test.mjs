import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use only Pi's already installed loader and SDK; no project resolution or dependencies.
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const sdkEntry = join(globalRoot, "@earendil-works/pi-coding-agent/dist/index.js");
const requirePi = createRequire(sdkEntry);
const { createJiti } = requirePi("jiti");
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  moduleCache: false,
  alias: { "@earendil-works/pi-coding-agent": sdkEntry, "@earendil-works/pi-tui": requirePi.resolve("@earendil-works/pi-tui") },
});
const { default: install, inlineSkillProvider, expandInlineSkills, openSkillListWhileTyping } = await jiti.import("./index.ts");
const { CombinedAutocompleteProvider } = await import(pathToFileURL(requirePi.resolve("@earendil-works/pi-tui")));
const root = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), ".test-skills-"));
after(() => rmSync(root, { recursive: true, force: true }));

function skill(name, body = `Instructions for ${name}.`) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body);
  return { name: `skill:${name}`, description: `Use ${name}`, source: "skill", sourceInfo: { path, source: "local", scope: "user", origin: "top-level" } };
}
const alpha = skill("alpha");
const beta = skill("beta");
const commands = [alpha, beta];
const options = { signal: new AbortController().signal, force: true };
function native() {
  return new CombinedAutocompleteProvider(commands, root);
}
function block(command, body = `Instructions for ${command.name.slice(6)}.`) {
  return `<skill name="${command.name.slice(6)}" location="${command.sourceInfo.path}">\nReferences are relative to ${dirname(command.sourceInfo.path)}.\n\n${body}\n</skill>`;
}
function expand(text, available = commands) {
  return expandInlineSkills(text, available, (error) => assert.fail(error));
}
function handlers(available = commands) {
  const registered = new Map();
  install({ on: (name, handler) => registered.set(name, handler), getCommands: () => available });
  return registered;
}

test("Tab suggests skill commands after prose on the first line", async () => {
  const provider = inlineSkillProvider(native(), () => commands);
  const suggestions = await provider.getSuggestions(["Use /skill:al"], 0, 13, options);
  assert.deepEqual(suggestions, { prefix: "skill:al", items: [{ value: "skill:alpha", label: "/skill:alpha", description: "Use alpha" }] });
});

test("Tab suggests skills at the beginning of a later line", async () => {
  const suggestions = await inlineSkillProvider(native(), () => commands).getSuggestions(["Request", "/skill:b"], 1, 8, options);
  assert.equal(suggestions.items[0].value, "skill:beta");
});

test("An empty skill name offers all skill commands but no extension commands", async () => {
  const available = [...commands, { ...alpha, name: "skill:extension", source: "extension" }];
  const suggestions = await inlineSkillProvider(native(), () => available).getSuggestions(["Use /skill:"], 0, 11, options);
  assert.deepEqual(suggestions.items.map((item) => item.value), ["skill:alpha", "skill:beta"]);
});

test("Suggestions read the current resource commands instead of a startup snapshot", async () => {
  let available = [alpha];
  const provider = inlineSkillProvider(native(), () => available);
  await provider.getSuggestions(["Use /skill:"], 0, 11, options);
  available = [beta];
  assert.equal((await provider.getSuggestions(["Use /skill:"], 0, 11, options)).items[0].value, "skill:beta");
});

test("Applying inline completion preserves the suffix and positions the cursor after one added space", async () => {
  const provider = inlineSkillProvider(native(), () => commands);
  const lines = ["Use /skill:al afterwards", "Next line"];
  const suggestions = await provider.getSuggestions(lines, 0, 13, options);
  assert.deepEqual(provider.applyCompletion(lines, 0, 13, suggestions.items[0], suggestions.prefix), {
    lines: ["Use /skill:alpha  afterwards", "Next line"], cursorLine: 0, cursorCol: 17,
  });
});

test("Applying completion at the start of a later line never adds a second slash", async () => {
  const provider = inlineSkillProvider(native(), () => commands);
  const lines = ["Request", "/skill:b"];
  const suggestions = await provider.getSuggestions(lines, 1, 8, options);
  assert.deepEqual(provider.applyCompletion(lines, 1, 8, suggestions.items[0], suggestions.prefix), {
    lines: ["Request", "/skill:beta "], cursorLine: 1, cursorCol: 12,
  });
});

test("The prefix never starts with a slash, so Enter selects instead of submitting", async () => {
  const suggestions = await inlineSkillProvider(native(), () => commands).getSuggestions(["Use /skill:al"], 0, 13, options);
  assert.equal(suggestions.prefix.startsWith("/"), false);
});

test("Applying a completion leaves the caller's lines untouched", async () => {
  const provider = inlineSkillProvider(native(), () => commands);
  const lines = ["Use /skill:al"];
  const suggestions = await provider.getSuggestions(lines, 0, 13, options);
  provider.applyCompletion(lines, 0, 13, suggestions.items[0], suggestions.prefix);
  assert.deepEqual(lines, ["Use /skill:al"]);
});

test("Ordinary first-line skill completion delegates native suggestions and application", async () => {
  const current = native();
  const provider = inlineSkillProvider(current, () => commands);
  const lines = ["/skill:al"];
  const normalOptions = { ...options, force: false };
  const expected = await current.getSuggestions(lines, 0, 9, normalOptions);
  const actual = await provider.getSuggestions(lines, 0, 9, normalOptions);
  assert.deepEqual({ suggestions: actual, applied: provider.applyCompletion(lines, 0, 9, actual.items[0], actual.prefix) }, {
    suggestions: expected, applied: current.applyCompletion(lines, 0, 9, expected.items[0], expected.prefix),
  });
});

test("Unrelated completions preserve the original provider's items and application", async () => {
  const sentinel = { items: [{ value: "file", label: "file" }], prefix: "@fi" };
  const applied = { lines: ["original"], cursorLine: 0, cursorCol: 8 };
  const current = { getSuggestions: async () => sentinel, applyCompletion: () => applied };
  const provider = inlineSkillProvider(current, () => commands);
  const actual = await provider.getSuggestions(["@fi"], 0, 3, options);
  assert.deepEqual([actual === sentinel, provider.applyCompletion(["@fi"], 0, 3, actual.items[0], actual.prefix) === applied], [true, true]);
});

test("Unknown skill completions delegate to the previous provider", async () => {
  const sentinel = { items: [], prefix: "previous" };
  const provider = inlineSkillProvider({ getSuggestions: async () => sentinel }, () => commands);
  assert.equal(await provider.getSuggestions(["Use /skill:missing"], 0, 18, options), sentinel);
});

test("Known inline prefixes bypass the native forced-file Tab gate", () => {
  const provider = inlineSkillProvider({ shouldTriggerFileCompletion: () => false }, () => commands);
  assert.equal(provider.shouldTriggerFileCompletion(["Request", "/skill:al"], 1, 9), true);
});

test("Unrelated forced-file completion retains the original gate and trigger characters", () => {
  const current = { shouldTriggerFileCompletion: () => false, triggerCharacters: ["#"] };
  const provider = inlineSkillProvider(current, () => commands);
  assert.deepEqual([provider.shouldTriggerFileCompletion(["unrelated"], 0, 9), provider.triggerCharacters], [false, ["#"]]);
});

test("Inline code completion delegates instead of offering skill commands", async () => {
  const sentinel = { items: [], prefix: "previous" };
  const provider = inlineSkillProvider({ getSuggestions: async () => sentinel }, () => commands);
  assert.equal(await provider.getSuggestions(["Use `/skill:al"], 0, 14, options), sentinel);
});

test("Fenced code completion delegates instead of offering skill commands", async () => {
  const sentinel = { items: [], prefix: "previous" };
  const provider = inlineSkillProvider({ getSuggestions: async () => sentinel }, () => commands);
  assert.equal(await provider.getSuggestions(["```md", "/skill:al"], 1, 9, options), sentinel);
});

test("Non-skill commands never load instructions", () => {
  assert.equal(expand("Use /skill:alpha", [{ ...alpha, source: "extension" }]), "Use /skill:alpha");
});

test("One inline invocation loads instructions and removes only the token", () => {
  assert.equal(expand("Please /skill:alpha now."), `${block(alpha)}\n\nPlease  now.`);
});

test("Multiline invocations retain every original newline and all surrounding whitespace", () => {
  assert.equal(expand("/skill:alpha\n\nDo this\n  /skill:beta\n"), `${block(alpha)}\n\n${block(beta)}\n\n\n\nDo this\n  \n`);
});

test("Repeated known invocations insert each skill block once in first-use order", () => {
  assert.equal(expand("Use /skill:beta /skill:alpha /skill:beta"), `${block(beta)}\n\n${block(alpha)}\n\nUse   `);
});

test("Unknown tokens are preserved alongside known invocations", () => {
  assert.equal(expand("Use /skill:missing /skill:alpha"), `${block(alpha)}\n\nUse /skill:missing `);
});

test("Escaped and non-bare tokens remain literal", () => {
  const text = 'Use \\/skill:alpha \\\\/skill:beta (/skill:alpha) "/skill:alpha" x/skill:alpha /skill:alpha/path /skill:alpha. /skill:alphabet';
  assert.equal(expand(text), text);
});

test("Backtick inline spans of different lengths remain literal", () => {
  const text = "Use `/skill:alpha` and ``/skill:beta ` text`` then /skill:alpha";
  assert.equal(expand(text), `${block(alpha)}\n\nUse \`/skill:alpha\` and \`\`/skill:beta \` text\`\` then `);
});

test("Fenced backtick instructions remain literal while following prose expands", () => {
  const text = "```md\n/skill:alpha\n```\nUse /skill:beta";
  assert.equal(expand(text), `${block(beta)}\n\n\`\`\`md\n/skill:alpha\n\`\`\`\nUse `);
});

test("Tilde fences remain literal", () => {
  const text = "~~~md\n/skill:alpha\n~~~";
  assert.equal(expand(text), text);
});

test("Unclosed code spans stay literal", () => {
  const text = "Use `code /skill:alpha\n/skill:beta";
  assert.equal(expand(text), text);
});

test("Escaped backticks do not hide a bare invocation", () => {
  assert.equal(expand("Use \\` /skill:alpha"), block(alpha) + "\n\nUse \\` ");
});

test("Frontmatter is stripped with the SDK and references use the file directory", () => {
  const command = skill("frontmatter", "\uFEFF---\r\nname: frontmatter\r\ndescription: Instructions\r\n---\r\n\r\n  Body here.  \r\n");
  assert.equal(expand("Use /skill:frontmatter", [command]), `${block(command, "Body here.")}\n\nUse `);
});

test("Loaded instructions are not rescanned for additional skill references", () => {
  const command = skill("nested", "Do not expand /skill:beta here.");
  assert.equal(expand("Use /skill:nested", [command, beta]), `${block(command, "Do not expand /skill:beta here.")}\n\nUse `);
});

test("Already native-expanded text is left untouched including later skill tokens", () => {
  const text = `${block(alpha)}\n\nUse /skill:beta`;
  assert.equal(expand(text), text);
});

test("Read failures preserve the failed intent while successful skills still load", () => {
  const missing = { ...alpha, name: "skill:missing-file", sourceInfo: { ...alpha.sourceInfo, path: join(root, "absent", "SKILL.md") } };
  const errors = [];
  const text = expandInlineSkills("Use /skill:missing-file /skill:beta /skill:missing-file", [missing, beta], (error) => errors.push(error));
  assert.deepEqual({ text, errors: errors.map((error) => error.includes("ENOENT") && error.includes(missing.sourceInfo.path)) }, {
    text: `${block(beta)}\n\nUse /skill:missing-file  /skill:missing-file`, errors: [true],
  });
});

test("A request with only failed reads remains unchanged", () => {
  const missing = { ...alpha, sourceInfo: { ...alpha.sourceInfo, path: join(root, "absent", "SKILL.md") } };
  assert.equal(expandInlineSkills("Use /skill:alpha", [missing], () => {}), "Use /skill:alpha");
});

test("A single leading invocation on one line delegates unchanged to native expansion", () => {
  assert.equal(expand("/skill:alpha Please help."), "/skill:alpha Please help.");
});

test("A bare leading invocation delegates unchanged to native expansion", () => {
  assert.equal(expand("/skill:alpha"), "/skill:alpha");
});

test("A leading invocation followed by a newline expands without native parsing", () => {
  assert.equal(expand("/skill:alpha\nPlease help."), `${block(alpha)}\n\n\nPlease help.`);
});

test("A leading invocation followed by a tab expands instead of using native space-only parsing", () => {
  assert.equal(expand("/skill:alpha\tPlease help."), `${block(alpha)}\n\n\tPlease help.`);
});

test("Instruction files are read again for each submission", () => {
  const command = skill("fresh", "Old instructions.");
  expand("Use /skill:fresh", [command]);
  writeFileSync(command.sourceInfo.path, "New instructions.");
  assert.equal(expand("Use /skill:fresh", [command]), `${block(command, "New instructions.")}\n\nUse `);
});

test("Input reads resource commands again for each submission", () => {
  const registered = new Map();
  let available = [alpha];
  install({ on: (name, handler) => registered.set(name, handler), getCommands: () => available });
  const event = { text: "Use /skill:beta", source: "interactive" };
  registered.get("input")(event, { ui: { notify: assert.fail } });
  available = [beta];
  assert.equal(registered.get("input")(event, { ui: { notify: assert.fail } }).text, `${block(beta)}\n\nUse `);
});

test("Input transforms preserve the exact image attachment array", () => {
  const images = [{ type: "image", data: "image", mimeType: "image/png" }];
  const result = handlers().get("input")({ text: "Use /skill:alpha", images, source: "interactive" }, { ui: { notify: assert.fail } });
  assert.deepEqual({ action: result.action, sameImages: result.images === images }, { action: "transform", sameImages: true });
});

test("Extension-sourced input is not expanded", () => {
  assert.deepEqual(handlers().get("input")({ text: "Use /skill:alpha", source: "extension" }, {}), { action: "continue" });
});

test("Steering input uses the input transform without sending a replacement message", () => {
  assert.deepEqual(handlers().get("input")({ text: "Use /skill:alpha", source: "interactive", streamingBehavior: "steer" }, { ui: { notify: assert.fail } }), {
    action: "transform", text: `${block(alpha)}\n\nUse `, images: undefined,
  });
});

test("RPC follow-up input uses the input transform", () => {
  assert.deepEqual(handlers().get("input")({ text: "Use /skill:beta", source: "rpc", streamingBehavior: "followUp" }, { ui: { notify: assert.fail } }), {
    action: "transform", text: `${block(beta)}\n\nUse `, images: undefined,
  });
});

test("Input read failures notify the UI as errors and leave input unchanged", () => {
  const missing = { ...alpha, sourceInfo: { ...alpha.sourceInfo, path: join(root, "absent", "SKILL.md") } };
  const notifications = [];
  const result = handlers([missing]).get("input")({ text: "Use /skill:alpha", source: "interactive" }, { ui: { notify: (message, level) => notifications.push({ message, level }) } });
  assert.deepEqual({ result, notifications: notifications.map(({ message, level }) => ({ enoent: message.includes("ENOENT"), level })) }, {
    result: { action: "continue" }, notifications: [{ enoent: true, level: "error" }],
  });
});

test("Session startup installs autocomplete only for TUI sessions with UI", () => {
  const installed = [];
  const sessionStart = handlers().get("session_start");
  for (const [mode, hasUI] of [["rpc", true], ["print", false], ["tui", false], ["tui", true]]) {
    sessionStart({}, { mode, hasUI, ui: { addAutocompleteProvider: (factory) => installed.push(factory) } });
  }
  assert.equal(installed.length, 1);
});

// Minimal stand-in for pi-tui's Editor: inserts typed text, ignores keys that do not edit it.
class TypingEditor {
  state = { lines: [""], cursorLine: 0, cursorCol: 0 };
  autocompleteState = null;
  triggers = 0;
  handleInput(data) {
    if (data === "\x1b") return;
    const { lines, cursorLine, cursorCol } = this.state;
    lines[cursorLine] = lines[cursorLine].slice(0, cursorCol) + data + lines[cursorLine].slice(cursorCol);
    this.state.cursorCol += data.length;
  }
  getText() { return this.state.lines.join("\n"); }
  tryTriggerAutocomplete() { this.triggers++; }
}
function typed(text, editorClass = class extends TypingEditor {}) {
  openSkillListWhileTyping(editorClass);
  const editor = new editorClass();
  for (const key of text) editor.handleInput(key);
  return editor;
}

test("Typing /skill: after prose opens the skill list without Tab", () => {
  assert.equal(typed("Use /skill:").triggers, 1);
});

test("Typing letters after /skill: keeps the skill list open", () => {
  assert.equal(typed("Use /skill:al").triggers, 3);
});

test("Typing prose or code does not open the skill list", () => {
  assert.equal(typed("Use path/skill: and `/skill:`").triggers, 0);
});

test("A key that does not edit the text does not reopen a closed skill list", () => {
  const editor = typed("Use /skill:");
  editor.handleInput("\x1b");
  assert.equal(editor.triggers, 1);
});

test("An open popup is updated by the editor, not triggered again", () => {
  const editorClass = class extends TypingEditor { autocompleteState = {}; };
  assert.equal(typed("Use /skill:al", editorClass).triggers, 0);
});

test("Installing the hook twice wraps the original input handler once", () => {
  const editorClass = class extends TypingEditor {};
  openSkillListWhileTyping(editorClass);
  assert.equal(typed("Use /skill:", editorClass).triggers, 1);
});
