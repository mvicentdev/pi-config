// node --test vendor/pi-subagents/test/run-test.mjs
// Each test builds its own managers, so the tests run in any order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentManager } from "../src/agent-manager.ts";
import * as resumeTarget from "../src/resume-target.ts";
import type { TombstoneResumeDeps } from "../src/resume-target.ts";
import type { AgentRecord, AgentTombstone } from "../src/types.ts";

const { resolveAgentRef, resumableHandles, resumedResultText, resumeHint, resumeNotFoundMessage, resumeTombstone } = resumeTarget;

const NOT_LISTED = "An agent that is not listed has been cleaned up. Start a new Agent with the context it needs.";

// A manager that is disposed once the test ends.
function newManager(t: { after(fn: () => void): void }): AgentManager {
	const m = new AgentManager();
	t.after(() => m.dispose());
	return m;
}

function agentsOf(m: AgentManager): Map<string, AgentRecord> {
	return (m as unknown as { agents: Map<string, AgentRecord> }).agents;
}

// A fake session that answers each prompt with one assistant message.
function fakeSession(answer: string) {
	const messages: unknown[] = [];
	return {
		messages,
		subscribe: () => () => {},
		abort: () => {},
		prompt: async () => {
			messages.push({ role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop" });
		},
	};
}

// A record as a finished foreground spawn leaves it: settled, result consumed, session kept.
function addRecord(m: AgentManager, id: string, handle: string, alias?: string, extra: Partial<AgentRecord> = {}): AgentRecord {
	const record = {
		id, type: "worker", handle, alias, description: `Task ${id}`, status: "completed", result: "first answer",
		resultConsumed: true, isBackground: false, startedAt: 1, completedAt: 2, toolUses: 0, compactionCount: 0,
		lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		session: fakeSession("second answer"), ...extra,
	} as unknown as AgentRecord;
	agentsOf(m).set(id, record);
	return record;
}

// The live agents most tests start from: two top-level agents and one nested child.
function withLiveAgents(m: AgentManager): AgentManager {
	addRecord(m, "a1b2c3", "worker", "contract-worker");
	addRecord(m, "d4e5f6", "explore");
	addRecord(m, "n1", "nested", undefined, { parentAgentId: "a1b2c3" } as Partial<AgentRecord>);
	return m;
}

// An evicted agent: its record is gone, its tombstone holds the names and the session file.
const sessionFile = "/tmp/sessions/contract-worker.jsonl";
function addTombstone(m: AgentManager): AgentTombstone {
	const entry: AgentTombstone = {
		handle: "worker", alias: "contract-worker", id: "old-id", type: "worker",
		description: "Contract work", sessionFile, completedAt: 2,
	};
	(m as unknown as { tombstones: Map<string, AgentTombstone> }).tombstones.set(entry.handle, entry);
	return entry;
}

// Deps whose `start` stands in for a spawn with `reclaim`: the new record takes the tombstone's names.
function deps(m: AgentManager, overrides: Partial<TombstoneResumeDeps> = {}) {
	const starts: { type: string; options: Record<string, unknown> }[] = [];
	let next = 0;
	const d: TombstoneResumeDeps = {
		sessionExists: file => file === sessionFile,
		dropTombstone: handle => m.dropTombstone(handle),
		resolveType: type => ({ ok: true, type }),
		start: async (type, options) => {
			starts.push({ type, options: options as unknown as Record<string, unknown> });
			const id = `new-id-${++next}`;
			addRecord(m, id, options.reclaim.handle, options.reclaim.alias, {
				type, description: options.description, status: "running", result: undefined, startedAt: 3, completedAt: undefined,
			} as Partial<AgentRecord>);
			return id;
		},
		...overrides,
	};
	return { d, starts };
}

test("resume by the name of a finished foreground agent reaches its record", async (t) => {
	const m = withLiveAgents(newManager(t));
	const record = resolveAgentRef(m, "contract-worker");
	assert.ok(record);
	assert.equal(record.id, "a1b2c3");
	const resumed = await m.resume(record.id, "go on");
	assert.equal(resumed?.status, "completed");
	assert.equal(resumed?.result, "second answer");
});

test("the id still resolves first", (t) => {
	const m = withLiveAgents(newManager(t));
	assert.equal(resolveAgentRef(m, "d4e5f6")?.handle, "explore");
});

test("the tool's resume target: a live agent by id or handle", (t) => {
	const m = withLiveAgents(newManager(t));
	const byHandle = resumeTarget.resolveResumeTarget(m, "contract-worker");
	assert.equal(byHandle.kind, "live");
	assert.equal(byHandle.kind === "live" && byHandle.record.id, "a1b2c3");
	const byId = resumeTarget.resolveResumeTarget(m, "d4e5f6");
	assert.equal(byId.kind === "live" && byId.record.id, "d4e5f6");
});

test("the tool's resume target: a nested agent is refused like an unknown one", (t) => {
	const m = withLiveAgents(newManager(t));
	const target = resumeTarget.resolveResumeTarget(m, "n1");
	assert.equal(target.kind, "missing");
	assert.equal(target.kind === "missing" && target.message, resumeNotFoundMessage("n1", resumableHandles(m)));
	assert.equal(resumeTarget.resolveResumeTarget(m, "nested").kind, "missing");
});

test("the tool's resume target: an evicted agent by name or id leads to its tombstone", (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	for (const ref of ["contract-worker", "worker", "old-id"]) {
		const target = resumeTarget.resolveResumeTarget(m, ref);
		assert.equal(target.kind, "tombstone", ref);
		assert.equal(target.kind === "tombstone" && target.entry, entry);
	}
});

test("the handles offered for resume are the top-level agents with a session", (t) => {
	const m = withLiveAgents(newManager(t));
	assert.deepEqual(resumableHandles(m), ["contract-worker (completed)", "explore (completed)"]);
});

test("an unknown handle names the agents that can be resumed", (t) => {
	const m = withLiveAgents(newManager(t));
	assert.equal(resolveAgentRef(m, "ghost"), undefined);
	assert.equal(
		resumeNotFoundMessage("ghost", resumableHandles(m)),
		`Agent not found: "ghost". Known agents: contract-worker (completed), explore (completed). ${NOT_LISTED}`,
	);
});

test("with nothing to resume the message says so", () => {
	assert.equal(resumeNotFoundMessage("ghost", []), `Agent not found: "ghost". No agent can be resumed now. ${NOT_LISTED}`);
});

test("resume of an evicted agent by name returns its result", async (t) => {
	const m = newManager(t);
	addTombstone(m);
	assert.equal(resolveAgentRef(m, "contract-worker"), undefined);
	const resolved = m.resolveMention("contract-worker");
	assert.equal(resolved?.kind, "tombstone");
	if (resolved?.kind !== "tombstone") return;
	const { d, starts } = deps(m);
	const outcome = await resumeTombstone(resolved.entry, d);
	assert.deepEqual(outcome, { ok: true, id: "new-id-1", target: "@contract-worker" });
	assert.equal(starts[0].type, "worker");
	assert.deepEqual(starts[0].options.reclaim, { handle: "worker", alias: "contract-worker" });
	assert.equal(starts[0].options.resumeSessionFile, sessionFile);
	const settled = { ...m.getRecord("new-id-1")!, status: "completed", result: "second answer" } as AgentRecord;
	const text = resumedResultText(settled);
	assert.match(text, /second answer/);
	assert.match(text, /"contract-worker"/);
});

// Finding 1: the tombstone stays after a resume, keyed by the old id. A second
// lookup by that id must reach the live record that reclaimed the names,
// never reopen the same session file a second time.
for (const ref of ["old-id", "worker", "contract-worker"]) {
	test(`after a tombstone resume, the mention "${ref}" reaches the resumed record`, async (t) => {
		const m = newManager(t);
		const entry = addTombstone(m);
		const { d } = deps(m);
		const first = await resumeTombstone(entry, d);
		assert.equal(first.ok, true);
		const again = m.resolveMention(ref);
		assert.equal(again?.kind, "live");
		assert.equal(again?.kind === "live" && again.record.id, "new-id-1");
	});

	test(`after a tombstone resume, the tool's resume "${ref}" reaches the resumed record`, async (t) => {
		const m = newManager(t);
		const entry = addTombstone(m);
		const { d, starts } = deps(m);
		await resumeTombstone(entry, d);
		assert.equal(resolveAgentRef(m, ref)?.id, "new-id-1");
		const target = resumeTarget.resolveResumeTarget(m, ref);
		assert.equal(target.kind === "live" && target.record.id, "new-id-1");
		assert.equal(starts.length, 1);
	});
}

test("after the resumed record finishes, the old id still reaches it", async (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	const { d } = deps(m);
	await resumeTombstone(entry, d);
	const record = m.getRecord("new-id-1")!;
	record.status = "completed";
	assert.equal(resumeTarget.resolveResumeTarget(m, "old-id").kind, "live");
});

test("an evicted agent counts among the agents that can be resumed", (t) => {
	const m = newManager(t);
	addTombstone(m);
	assert.deepEqual(resumableHandles(m), ["contract-worker (saved)"]);
});

// Finding 2: a handle whose live record runs is listed once, with that record's state.
test("a resumed agent that runs is listed once, as running", async (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	await resumeTombstone(entry, deps(m).d);
	assert.deepEqual(resumableHandles(m), ["contract-worker (running)"]);
});

test("an evicted agent whose session file is gone gives an error and is forgotten", async (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	const { d, starts } = deps(m, { sessionExists: () => false });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker", message: "Could not resume @contract-worker — its session is gone.",
	});
	assert.equal(starts.length, 0);
	assert.equal(m.resolveMention("contract-worker"), undefined);
});

test("an evicted agent whose type is no longer available gives an error and stays", async (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	const { d, starts } = deps(m, { resolveType: () => ({ ok: true, type: "general-purpose", fellBackFrom: "worker" }) });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker",
		message: "Could not resume @contract-worker — the worker agent is no longer available.",
	});
	assert.equal(starts.length, 0);
	assert.equal(m.resolveMention("contract-worker")?.kind, "tombstone");
});

test("a start that throws gives an error", async (t) => {
	const m = newManager(t);
	const entry = addTombstone(m);
	const { d } = deps(m, { start: async () => { throw new Error("no cwd"); } });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker", message: "Could not resume @contract-worker: no cwd",
	});
});

// Finding 4: a background resume joins the batch only once the agent has started.
test("a detached start wires the record, waits for startup, then joins the batch", async () => {
	const calls: string[] = [];
	const id = await resumeTarget.startDetached({
		spawn: () => { calls.push("spawn"); return "r1"; },
		wire: id => calls.push(`wire ${id}`),
		awaitStartup: async id => { calls.push(`startup ${id}`); },
		onStarted: id => calls.push(`batch ${id}`),
	});
	assert.equal(id, "r1");
	assert.deepEqual(calls, ["spawn", "wire r1", "startup r1", "batch r1"]);
});

test("a detached start that fails to start never joins the batch", async () => {
	const calls: string[] = [];
	await assert.rejects(resumeTarget.startDetached({
		spawn: () => "r1",
		wire: id => calls.push(`wire ${id}`),
		awaitStartup: async () => { throw new Error("no worktree"); },
		onStarted: id => calls.push(`batch ${id}`),
	}), /no worktree/);
	assert.deepEqual(calls, ["wire r1"]);
});

test("the foreground result names the handle to resume by", (t) => {
	const m = withLiveAgents(newManager(t));
	assert.equal(resumeHint(m.getRecord("a1b2c3")!), 'Resume it with resume: "contract-worker".');
	assert.equal(resumeHint(m.getRecord("d4e5f6")!), 'Resume it with resume: "explore".');
	assert.equal(resumeHint({ id: "x" } as AgentRecord), 'Resume it with resume: "x".');
});

test("a failed resume names the error and the handle", (t) => {
	const m = withLiveAgents(newManager(t));
	const text = resumedResultText({ ...m.getRecord("d4e5f6")!, status: "error", error: "boom" } as AgentRecord);
	assert.match(text, /^Agent failed: boom/);
	assert.match(text, /"explore"/);
});
