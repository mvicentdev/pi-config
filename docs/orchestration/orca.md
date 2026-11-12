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
- Every subagent, writer or reader, runs in the session on the harness's own subagent tool, in the
  foreground (`run_in_background: false`). Orca's chat draws a live row only for a foreground
  subagent, and a background one leaves no trace in the conversation.
- Launch the independent subagents of a batch in one message, so they run in parallel. The tool
  returns every full report when the slowest one ends, and a running subagent takes no steer.
- Orca folds those rows once the turn settles, so the reply names each subagent in one line with its
  role, its task and its outcome.
- A watched worker is an Orca worker, and it runs only when the user asks for one. The guide the
  binary serves (`orca skills get orchestration`) is then the only account of its commands, and the
  `orca-cli` and `orchestration` skills apply only there.
- Start a watched worker with `orchestration worker-start --spec … --agent claude --keep-open --model
  <the role's model in subagent-models.json> --effort <its thinking>`. Its spec opens with
  `Read ~/.pi/agent/agents/<role>.md and follow it as your role.`
- A worker's `worker_done` carries its three-sentence summary as the body and its report file as
  `--report-path`.
- The report names the Run, Task and Dispatch IDs.
