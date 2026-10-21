# cmux

Adapter for [cmux](https://github.com/manaflow-ai/cmux); the rules live in `../ORCHESTRATION.md`.

- Detection: `CMUX_SURFACE_ID` is set. The check passes when
  `cmux --json --id-format uuids identify` returns a `caller.surface_id` equal to `CMUX_SURFACE_ID`.
- Read the `cmux-workspace` skill before the first watched worker: it explains workspaces, surfaces,
  refs and the rules that keep the user's focus. Where the skill and this file differ, this file wins.
  `cmux <command> --help` is the account of each command's flags.
- Each watched worker runs interactive pi in its own workspace. Write its prompt to a file in a
  temporary directory outside the repository, and start it with
  `CMUX_QUIET=1 cmux --json workspace create --name <task> --cwd <checkout> --focus false --command "pi @<prompt-file>"`.
  Keep the `workspace_ref` and `surface_ref` it returns. A writer's checkout is a worktree the main
  loop creates before the launch, with the repository's own worktree command when it ships one.
- pi under cmux sends no turn-end event and never receives `cmux agent message`, so the worker reports
  through the main loop's inbox. End every prompt with this instruction: send the final answer, and
  each question, with `cmux agent message <main CMUX_SURFACE_ID> --from <task> -` and the text on
  stdin, then wait for a reply in the terminal.
- Before each launch or reply, keep `latest_seq` from `cmux events --snapshot`. Wait inside the turn
  with `cmux events --after <seq> --name agent.message.queued --no-heartbeat --no-ack --limit 1 --timeout 600`.
  Read the messages with `cmux agent inbox --surface "$CMUX_SURFACE_ID" --state queued --json`;
  `sender_surface_id` names the worker. An empty inbox means the event was for another agent: wait
  again. Run the same inbox command with `--mark-read` once every listed message is processed.
- Answer a question or follow up with `cmux send --surface <surface_ref> "<text>"`, then
  `cmux send-key --surface <surface_ref> enter`. This types into the worker's prompt, so send only
  after the worker has reported, and only to a worker of this run.
- `cmux workspace close <workspace_ref> --force` releases a settled worker; `--force` is needed while
  pi runs. Closing keeps the checkout and the branch: remove them with the repository's cleanup
  command, and remove the prompt file.
- The report names each worker's `workspace_ref` and `surface_ref`.
- An unsupervised handoff that the user asks for uses the same launch, without the report
  instruction and without the wait.
