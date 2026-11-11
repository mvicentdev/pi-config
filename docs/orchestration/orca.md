# Orca

Adapter for [Orca](https://github.com/stablyai/orca); the rules live in `../ORCHESTRATION.md`.

- Detection: `ORCA_TERMINAL_HANDLE` is set; other `ORCA_*` variables, such as `ORCA_PI_STATUS_OWNED`,
  also appear outside Orca. The check passes when
  `"${ORCA_CLI_COMMAND:-orca}" terminal show --terminal "$ORCA_TERMINAL_HANDLE" --json` returns
  `"ok": true` and a `result.terminal.handle` equal to `ORCA_TERMINAL_HANDLE`. Without `--terminal`
  the command fails inside Orca, and with an empty handle it returns another terminal.
  A structured Orca session has no `ORCA_TERMINAL_HANDLE`; there the check passes when
  `ORCA_STRUCTURED_SESSION=1` and `"${ORCA_CLI_COMMAND:-orca}" status --json` returns
  `result.caller.live: true`.
- Every writer is a supervised Orca worker, so the user traces it in Orca. The `explorer`,
  `researcher` and `verifier` roles run on the harness's own subagent tool, which enforces their tool
  limits and returns their full report. The `orca-deny-agent` extension of this package refuses that
  tool for the `worker` role here. Start each worker with `orchestration worker-start --spec … --agent claude --model <the role's model in
  subagent-models.json> --effort <its thinking>`. Its spec opens with
  `Read ~/.pi/agent/agents/<role>.md and follow it as your role.` Each worker message arrives as its
  own chat message. Run `orchestration check` only when a wake names it.
- Each worker runs in its own Orca terminal. The guide the binary serves
  (`orca skills get orchestration`) is the only account of its commands; the `orca-cli` and
  `orchestration` skills apply only here.
- One Run per objective, and each worker starts from a task spec.
- A unit that depends on another is a Task created with `task-create --deps`. On every wake, start the
  Tasks that `task-list --ready` shows.
- A failed worker is retried on its own Task with `worker-start --task <task_id> --retry-of
  <dispatch_id>`, with the same placement and agent. After three failed starts Orca refuses the chain,
  and the decision goes to the user.
- Once every independent worker has started, end the turn. Orca wakes the main loop with each
  `worker_done`, `question` or `escalation`, so the main loop runs no wait command and no watch script.
- A worker's `worker_done` carries its three-sentence summary as the body and its report file as
  `--report-path`.
- A worker's question is answered with `orchestration reply` on its thread.
- A settled worker closes on its own about two minutes after its `worker_done`. Start it with
  `--keep-open` when the user will follow it or talk to it.
- A follow-up goes to the same worker with `orchestration send --to dispatch:<dispatch_id>`, which
  reopens it.
- The report names the Run, Task and Dispatch IDs.
