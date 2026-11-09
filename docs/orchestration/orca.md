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
- Every subagent is a supervised Orca worker, so the user traces it in Orca. The
  `orca-deny-agent` extension of this package refuses the harness's own subagent tool here. Start each
  worker with `orchestration worker-start --spec … --agent claude --model <the role's model in
  subagent-models.json> --effort <its thinking>`. Its spec opens with
  `Read ~/.pi/agent/agents/<role>.md and follow it as your role.` Read its messages with
  `orchestration check --run <run_id>`, and acknowledge each delivery with `--ack`.
- Each worker runs in its own Orca terminal. The guide the binary serves
  (`orca skills get orchestration`) is the only account of its commands; the `orca-cli` and
  `orchestration` skills apply only here.
- One Run per objective; each worker starts from a task spec and the main loop waits for every
  `worker_done`.
- A worker's question is answered with `orchestration reply` on its thread, and each delivery is
  acknowledged only once processed.
- A settled worker keeps its terminal with `worker-retain`.
- The report names the Run, Task and Dispatch IDs.
