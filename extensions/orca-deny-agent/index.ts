// pi extension: inside Orca, refuses the native Agent tool for the `worker` role. Every writer then
// runs as a supervised Orca worker that the user can follow, and readers stay native. Detection
// follows ~/.pi/agent/docs/orchestration/orca.md.
import { spawnSync } from "node:child_process";

/** The fields of a tool call that this extension reads. */
interface ToolCall {
  readonly toolName: unknown;
  readonly input?: { readonly subagent_type?: unknown };
}

/** The part of pi's extension API that this extension uses. */
interface Pi {
  on(event: "tool_call", handler: (call: ToolCall) => { block: true; reason: string } | undefined): void;
}

const cli = process.env.ORCA_CLI_COMMAND || "orca";

function orcaHostsThisSession(): boolean {
  const handle = process.env.ORCA_TERMINAL_HANDLE;
  const args = handle
    ? ["terminal", "show", "--terminal", handle, "--json"]
    : process.env.ORCA_STRUCTURED_SESSION === "1"
      ? ["status", "--json"]
      : undefined;
  if (!args) return false;
  const r = spawnSync(cli, args, { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return false;
  try {
    const out = JSON.parse(r.stdout);
    return handle ? out.ok === true && out.result?.terminal?.handle === handle : out.result?.caller?.live === true;
  } catch {
    return false;
  }
}

const reason =
  "Inside Orca every writer is a supervised Orca worker: start it with `orca orchestration worker-start`, " +
  "as ~/.pi/agent/docs/orchestration/orca.md says. The native Agent tool runs only the reading roles here.";

export default function (pi: Pi) {
  let inOrca: boolean | undefined;
  pi.on("tool_call", (event) => {
    if (String(event.toolName).toLowerCase() !== "agent") return;
    if (String(event.input?.subagent_type).toLowerCase() !== "worker") return;
    inOrca ??= orcaHostsThisSession();
    if (inOrca) return { block: true, reason };
  });
}
