/**
 * How the tools that address an existing agent find it: by id or by handle.
 * The model names agents by the handle it gave them (`name`) far more often
 * than by the id, which a foreground result never shows.
 */

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

/**
 * Handles of the top-level agents a resume could reach now: settled, with a
 * session still open. The name the model gave wins over the type handle.
 */
export function resumableHandles(manager: AgentLookup): string[] {
  const live = manager.listAgents()
    .filter(r => r.parentAgentId === undefined && r.session !== undefined)
    .filter(r => r.status !== "running" && r.status !== "queued")
    .map(r => r.alias ?? r.handle)
    .filter((h): h is string => h !== undefined);
  // Evicted agents too: their conversation reopens from the session file.
  const evicted = manager.listTombstones().map(t => t.alias ?? t.handle);
  return [...new Set([...live, ...evicted])].sort();
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
    // record holding these same names, so it cannot shadow the resume — and
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

/** The error for a resume that matched nothing, in two sentences. */
export function resumeNotFoundMessage(ref: string, handles: string[]): string {
  const offer = handles.length > 0
    ? `the agents you can resume are ${handles.join(", ")}.`
    : "no agent can be resumed now.";
  return `Agent not found: "${ref}" — ${offer} ` +
    "A finished agent no longer listed has been cleaned up, so start a new Agent and give it the branch and the notes.";
}
