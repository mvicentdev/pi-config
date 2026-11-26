// node --test vendor/pi-subagents/test/run-test.mjs
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { AgentManager } from "../src/agent-manager.ts";
import {
	resolveAgentRef, resumableHandles, resumedResultText, resumeHint, resumeNotFoundMessage, resumeTombstone,
	type TombstoneResumeDeps,
} from "../src/resume-target.ts";
import type { AgentRecord, AgentTombstone } from "../src/types.ts";

const manager = new AgentManager();
const evicted = new AgentManager();
after(() => { manager.dispose(); evicted.dispose(); });

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
function finished(id: string, handle: string, alias?: string, extra: Partial<AgentRecord> = {}): AgentRecord {
	const record = {
		id, type: "worker", handle, alias, description: `Task ${id}`, status: "completed", result: "first answer",
		resultConsumed: true, isBackground: false, startedAt: 1, completedAt: 2, toolUses: 0, compactionCount: 0,
		lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		session: fakeSession("second answer"), ...extra,
	} as unknown as AgentRecord;
	(manager as unknown as { agents: Map<string, AgentRecord> }).agents.set(id, record);
	return record;
}

finished("a1b2c3", "worker", "contract-worker");
finished("d4e5f6", "explore");
finished("n1", "nested", undefined, { parentAgentId: "a1b2c3" } as Partial<AgentRecord>);

test("resume by the name of a finished foreground agent reaches its record", async () => {
	const record = resolveAgentRef(manager, "contract-worker");
	assert.ok(record);
	assert.equal(record.id, "a1b2c3");
	const resumed = await manager.resume(record.id, "go on");
	assert.equal(resumed?.status, "completed");
	assert.equal(resumed?.result, "second answer");
});

test("the id still resolves first", () => {
	assert.equal(resolveAgentRef(manager, "d4e5f6")?.handle, "explore");
});

test("the handles offered for resume are the top-level agents with a session", () => {
	assert.deepEqual(resumableHandles(manager), ["contract-worker", "explore"]);
});

test("an unknown handle names the agents that can be resumed", () => {
	assert.equal(resolveAgentRef(manager, "ghost"), undefined);
	assert.equal(
		resumeNotFoundMessage("ghost", resumableHandles(manager)),
		`Agent not found: "ghost" — the agents you can resume are contract-worker, explore. ` +
		`A finished agent no longer listed has been cleaned up, so start a new Agent and give it the branch and the notes.`,
	);
});

// An evicted agent: its record is gone, its tombstone holds the names and the session file.
const sessionFile = "/tmp/sessions/contract-worker.jsonl";
function tombstone(m: AgentManager): AgentTombstone {
	const entry: AgentTombstone = {
		handle: "worker", alias: "contract-worker", id: "old-id", type: "worker",
		description: "Contract work", sessionFile, completedAt: 2,
	};
	(m as unknown as { tombstones: Map<string, AgentTombstone> }).tombstones.set(entry.handle, entry);
	return entry;
}

// Deps whose `start` stands in for a foreground spawn: it returns once the run has finished.
function deps(overrides: Partial<TombstoneResumeDeps> = {}) {
	const starts: { type: string; options: Record<string, unknown> }[] = [];
	const d: TombstoneResumeDeps = {
		sessionExists: file => file === sessionFile,
		dropTombstone: handle => evicted.dropTombstone(handle),
		resolveType: type => ({ ok: true, type }),
		start: async (type, options) => {
			starts.push({ type, options: options as unknown as Record<string, unknown> });
			const id = "new-id";
			const record = {
				id, type, handle: options.reclaim.handle, alias: options.reclaim.alias, description: options.description,
				status: "completed", result: "second answer", isBackground: false, startedAt: 3, completedAt: 4,
				toolUses: 0, compactionCount: 0, lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			} as unknown as AgentRecord;
			(evicted as unknown as { agents: Map<string, AgentRecord> }).agents.set(id, record);
			return id;
		},
		...overrides,
	};
	return { d, starts };
}

test("resume of an evicted agent by name in foreground returns its result", async () => {
	tombstone(evicted);
	assert.equal(resolveAgentRef(evicted, "contract-worker"), undefined);
	const resolved = evicted.resolveMention("contract-worker");
	assert.equal(resolved?.kind, "tombstone");
	if (resolved?.kind !== "tombstone") return;
	const { d, starts } = deps();
	const outcome = await resumeTombstone(resolved.entry, d);
	assert.deepEqual(outcome, { ok: true, id: "new-id", target: "@contract-worker" });
	assert.equal(starts[0].type, "worker");
	assert.deepEqual(starts[0].options.reclaim, { handle: "worker", alias: "contract-worker" });
	assert.equal(starts[0].options.resumeSessionFile, sessionFile);
	const text = resumedResultText(evicted.getRecord("new-id")!);
	assert.match(text, /second answer/);
	assert.match(text, /"contract-worker"/);
	(evicted as unknown as { agents: Map<string, AgentRecord> }).agents.clear();
});

test("an evicted agent counts among the agents that can be resumed", () => {
	assert.deepEqual(resumableHandles(evicted), ["contract-worker"]);
});

test("an evicted agent whose session file is gone gives an error and is forgotten", async () => {
	const entry = tombstone(evicted);
	const { d, starts } = deps({ sessionExists: () => false });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker", message: "Could not resume @contract-worker — its session is gone.",
	});
	assert.equal(starts.length, 0);
	assert.equal(evicted.resolveMention("contract-worker"), undefined);
});

test("an evicted agent whose type is no longer available gives an error and stays", async () => {
	const entry = tombstone(evicted);
	const { d, starts } = deps({ resolveType: () => ({ ok: true, type: "general-purpose", fellBackFrom: "worker" }) });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker",
		message: "Could not resume @contract-worker — the worker agent is no longer available.",
	});
	assert.equal(starts.length, 0);
	assert.equal(evicted.resolveMention("contract-worker")?.kind, "tombstone");
});

test("a start that throws gives an error", async () => {
	const entry = tombstone(evicted);
	const { d } = deps({ start: async () => { throw new Error("no cwd"); } });
	assert.deepEqual(await resumeTombstone(entry, d), {
		ok: false, target: "@contract-worker", message: "Could not resume @contract-worker: no cwd",
	});
});

test("the foreground result names the handle to resume by", () => {
	const record = manager.getRecord("a1b2c3")!;
	assert.equal(resumeHint(record), 'Resume it with resume: "contract-worker".');
	assert.equal(resumeHint(manager.getRecord("d4e5f6")!), 'Resume it with resume: "explore".');
	assert.equal(resumeHint({ id: "x" } as AgentRecord), 'Resume it with resume: "x".');
});

test("a failed resume names the error and the handle", () => {
	const text = resumedResultText({ ...manager.getRecord("d4e5f6")!, status: "error", error: "boom" } as AgentRecord);
	assert.match(text, /^Agent failed: boom/);
	assert.match(text, /"explore"/);
});

test("with nothing to resume the message says so", () => {
	assert.equal(
		resumeNotFoundMessage("ghost", []),
		`Agent not found: "ghost" — no agent can be resumed now. ` +
		`A finished agent no longer listed has been cleaned up, so start a new Agent and give it the branch and the notes.`,
	);
});
