/**
 * How the tools that address an existing agent find it: by id or by handle.
 * The model names agents by the handle it gave them (`name`) far more often
 * than by the id, which a foreground result never shows.
 */

import { isTopLevelAgent } from "./agent-manager.js";
import type { SpawnTypeResolution } from "./agent-types.js";
import { partialOutputSuffix } from "./status-note.js";
import type { AgentRecord, AgentTombstone, MentionResolution } from "./types.js";

/** The part of AgentManager these lookups need. */
export interface AgentLookup {
  getRecord(id: string): AgentRecord | undefined;
  resolveMention(name: string): MentionResolution | undefined;
  listAgents(): AgentRecord[];
  listTombstones(): AgentTombstone[];
}

/**
 * Resolve a tool's agent reference as an id OR a handle, so the model addresses
 * agents by the same names the user types. Ids are tried first, keeping the
 * existing behaviour exact — a handle is only consulted when the string is
 * not an id at all. Only live records: a tombstone has nothing to steer and
 * no result to read. Callers still enforce the nested-ownership rejection.
 */
export function resolveAgentRef(manager: AgentLookup, ref: string): AgentRecord | undefined {
  const byId = manager.getRecord(ref);
  if (byId) return byId;
  const resolved = manager.resolveMention(ref);
  return resolved?.kind === "live" ? resolved.record : undefined;
}

/** Where the Agent tool's `resume` leads: a live record, a tombstone to reopen, or nothing. */
export type ResumeTarget =
  | { kind: "live"; record: AgentRecord }
  | { kind: "tombstone"; entry: AgentTombstone }
  | { kind: "missing"; message: string };

/**
 * Resolve the Agent tool's `resume`. A live top-level record wins. A nested
 * one is refused like an unknown one, since only its owner may resume it.
 * Otherwise an evicted agent's tombstone, through the same `resolveMention`
 * as the `@handle` mention: it already prefers the live record that
 * reclaimed the tombstone's names, so neither path forks a session.
 */
export function resolveResumeTarget(manager: AgentLookup, ref: string): ResumeTarget {
  const record = resolveAgentRef(manager, ref);
  if (record && isTopLevelAgent(record)) return { kind: "live", record };
  if (!record) {
    const resolved = manager.resolveMention(ref);
    if (resolved?.kind === "tombstone") return { kind: "tombstone", entry: resolved.entry };
  }
  return { kind: "missing", message: resumeNotFoundMessage(ref, resumableHandles(manager)) };
}

/**
 * The top-level agents a resume could name, each once with its state:
 * `explore (completed)`, `worker (running)`, or `(saved)` for an evicted
 * agent whose conversation reopens from disk. The name the model gave wins
 * over the type handle. Each name is described by what `resolveMention`
 * finds for it, so a tombstone whose names a live record holds reads as
 * that record.
 */
export function resumableHandles(manager: AgentLookup): string[] {
  const names = [
    ...manager.listAgents()
      .filter(r => r.parentAgentId === undefined && r.session !== undefined)
      .map(r => r.alias ?? r.handle),
    ...manager.listTombstones().map(t => t.alias ?? t.handle),
  ].filter((h): h is string => h !== undefined);
  const labels = [...new Set(names)].map(name => {
    const resolved = manager.resolveMention(name);
    if (!resolved) return undefined;
    return `${name} (${resolved.kind === "live" ? resolved.record.status : "saved"})`;
  });
  return labels.filter((l): l is string => l !== undefined).sort();
}

/** The few words a foreground result adds so the model can resume the agent later. */
export function resumeHint(record: Pick<AgentRecord, "id" | "handle" | "alias">): string {
  return `Resume it with resume: "${record.alias ?? record.handle ?? record.id}".`;
}

/** The tool text of a foreground resume once its run has settled. */
export function resumedResultText(record: AgentRecord): string {
  if (record.status === "error") {
    // A failed resume surfaces the error, plus any partial output THIS
    // resume produced (never the previous turn's answer, #144).
    return `Agent failed: ${record.error}${partialOutputSuffix(record)}\n\n${resumeHint(record)}`;
  }
  return `${resumeHint(record)}\n\n${record.result?.trim() || "No output."}`;
}

/** What a tombstone resume hands its spawn. Both values come from a tombstone this extension wrote. */
export interface TombstoneSpawnOptions {
  description: string;
  reclaim: { handle: string; alias?: string };
  resumeSessionFile: string;
}

/** What `resumeTombstone` needs from the extension, so each caller picks how the run starts. */
export interface TombstoneResumeDeps {
  sessionExists(file: string): boolean;
  dropTombstone(handle: string): void;
  /** Reload the agent files and resolve the type, reporting any fallback. */
  resolveType(type: string): SpawnTypeResolution;
  /**
   * Start the run and return its id. A background caller resolves once the
   * agent has started, a foreground caller once its run has finished. A
   * startup failure must reject.
   */
  start(type: string, options: TombstoneSpawnOptions): Promise<string>;
}

export type TombstoneResumeOutcome =
  | { ok: true; id: string; target: string }
  | { ok: false; target: string; message: string };

/**
 * Reopen an evicted agent's conversation from its session file. Shared by the
 * `@handle` prompt mention and the Agent tool's `resume`. This is an ordinary
 * spawn carrying a session file, so the new record picks up the widget, fleet
 * row, transcript and completion notification unchanged — and `reclaim` hands
 * it back the names the tombstone was holding.
 */
export async function resumeTombstone(entry: AgentTombstone, deps: TombstoneResumeDeps): Promise<TombstoneResumeOutcome> {
  const target = `@${entry.alias ?? entry.handle}`;

  // Checked here rather than left to SessionManager.open: that runs inside
  // runAgent, whose rejection lands on the record as an agent error, not in
  // the catch below. A `/new` in another pi window or a manual delete makes
  // the conversation unrecoverable (Claude Code's `not_reachable`), so drop
  // the entry — a row that can only ever fail is worse than none — and say
  // so rather than quietly sending this message to an unrelated agent.
  if (!deps.sessionExists(entry.sessionFile)) {
    deps.dropTombstone(entry.handle);
    return { ok: false, target, message: `Could not resume ${target} — its session is gone.` };
  }

  // The Agent tool deliberately falls back to general-purpose for a type it
  // cannot resolve (#183), which covers a deleted file AND a merely
  // disabled one. A resume must not inherit that: reopening this
  // conversation under a different agent's prompt and tools is not
  // continuing it, and the new record would re-tombstone under the
  // substitute, so the handle would never find its way back. The tombstone
  // stays: re-enabling the agent makes the handle work again.
  const dispatch = deps.resolveType(entry.type);
  if (!dispatch.ok || dispatch.fellBackFrom !== undefined) {
    return { ok: false, target, message: `Could not resume ${target} — the ${entry.type} agent is no longer available.` };
  }

  try {
    const id = await deps.start(dispatch.type, {
      description: entry.description,
      reclaim: { handle: entry.handle, alias: entry.alias },
      resumeSessionFile: entry.sessionFile,
    });
    // The tombstone deliberately stays. `resolveMention` prefers the live
    // record holding these same names, also for a lookup by the old id, so
    // it cannot shadow the resume — and
    // if this run dies before establishing its own session, the original
    // transcript is still the right thing for the next resume to reopen.
    // Once the resumed record is evicted it overwrites this entry in place,
    // keyed by the same handle, so nothing accumulates.
    return { ok: true, id, target };
  } catch (err) {
    // The type is already settled above, so what is left is a spawn-time
    // failure: a strict worktree-isolation error, an unusable cwd.
    return { ok: false, target, message: `Could not resume ${target}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The error for a resume that matched nothing. */
export function resumeNotFoundMessage(ref: string, handles: string[]): string {
  const offer = handles.length > 0
    ? `Known agents: ${handles.join(", ")}.`
    : "No agent can be resumed now.";
  return `Agent not found: "${ref}". ${offer} ` +
    "An agent that is not listed has been cleaned up. Start a new Agent with the context it needs.";
}

/** The steps of a detached start, so each caller wires its own record. */
export interface DetachedStart {
  spawn(): string;
  /** Synchronous wiring before the run can finish: tool call id, join mode. */
  wire?(id: string): void;
  awaitStartup(id: string): Promise<void>;
  /** Runs only once the agent has started, as a background spawn joins its batch. */
  onStarted?(id: string): void;
}

/**
 * Spawn, wire, wait for startup, then report the start. A startup failure
 * rejects before `onStarted`, so a failed agent never joins a batch.
 */
export async function startDetached(steps: DetachedStart): Promise<string> {
  const id = steps.spawn();
  steps.wire?.(id);
  await steps.awaitStartup(id);
  steps.onStarted?.(id);
  return id;
}
