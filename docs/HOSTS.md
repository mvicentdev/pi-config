# Hosts

The host is the agentic IDE that runs the main loop. Orca is the supported host, and its adapter is
`orchestration/orca.md`, relative to this file's directory.

## Watched worker

- A watched worker is a `worker` that Orca runs in its own pane, so the user follows it there. It runs
  only when the user asks for one.
- The main loop hands work off without waiting only when the user asks for that.

## Steps

1. Before the first subagent of a session, run the adapter's Detection check.
2. When the check fails, every subagent runs in the session. Tell the user when they ask for a
   watched worker.
3. When the check passes, read the rest of the adapter before the first subagent.
4. Wait for each watched worker until it has settled or the user needs to decide something.
5. Answer a watched worker's question in its own thread. An answer that changes the agreed design goes into
   its prompt in the same step.
6. Verify each settled watched worker as `ORCHESTRATION.md` says. Then report one line per task with its
   outcome and its evidence.
7. Once a watched worker's result is merged or its answer taken, release it at once. Clean up
   what was built for it in the same step, as Clean up in `ORCHESTRATION.md` says.
8. A follow-up goes to the same watched worker when Orca can reopen it, and to a new one otherwise.
