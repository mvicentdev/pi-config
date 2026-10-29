# cmux

Adapter for [cmux](https://github.com/manaflow-ai/cmux); the rules live in `../ORCHESTRATION.md`.

- Detection: `CMUX_SURFACE_ID` is set. The check passes when
  `cmux --json --id-format uuids identify` returns a `caller.surface_id` equal to `CMUX_SURFACE_ID`.
- Read the `cmux` and `cmux-workspace` skills before the first cmux command of a run: they hold the
  handle model, the focus rules and the command list, and this file adds only what orchestration
  needs. Where a skill and this file differ, this file wins. `cmux <command> --help` is the account of
  each command's flags.
- Every visualization is a tab: a page, a preview, a log or an auxiliary terminal opens as a new
  surface in the caller's pane, beside the caller terminal. This replaces the right-side helper pane
  of `cmux-workspace`. Take `<pane_ref>` from `caller.pane_ref` of `cmux --json identify`, and keep the
  `surface_ref` each command returns.
  - An HTML page or a URL:
    `cmux new-surface --workspace "$CMUX_WORKSPACE_ID" --pane <pane_ref> --type browser --url <url> --focus false`.
    A local file takes `file://` and its absolute path.
  - A terminal: the same command with `--type terminal --command "<text>"` in place of `--type browser --url <url>`.
  - Markdown or any other file: `cmux open <path> --surface "$CMUX_SURFACE_ID" --no-focus`.
  - `cmux open` on HTML or a URL, `cmux markdown open`, `new-pane`, `new-split` and `browser open-split` split the pane, so
    the tab commands above take their place.
  - The tab stays open for the user; close it with `cmux close-surface --workspace "$CMUX_WORKSPACE_ID" --surface <surface_ref>`
    when the user asks.
- Each watched worker runs interactive pi in its own workspace. Write its prompt to a file in a
  temporary directory outside the repository, and start it with
  `CMUX_QUIET=1 cmux --json workspace create --name <task> --cwd <checkout> --focus false --group <group_ref> --group-placement end --command "pi --model <model> --thinking <thinking> @<prompt-file>"`.
  `<group_ref>` is the `ref` of the group in `cmux --json workspace-group list` whose
  `member_workspace_refs` holds the caller's `workspace_ref`; take it once per run. Every worker of
  the run joins that group. When the caller's workspace is in no group, leave out `--group` and
  `--group-placement`.
  `<model>` and `<thinking>` are the role's entry in `~/.pi/agent/subagent-models.json` under the main
  loop's provider (`PI_PROVIDER`); without them pi starts on the default model of `settings.json`.
  Keep the `workspace_ref` and `surface_ref` it returns. A writer's `<checkout>` is the worktree
  `../ORCHESTRATION.md` has the main loop create.
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
- Mandatory: the main loop closes a worker's workspace with `cmux workspace close <workspace_ref> --force`
  as soon as the worker's task ends. The task ends when the main loop accepts the result, finishes the
  task, abandons it or relaunches the worker. `--force` is needed while pi runs. The goal is a clean cmux
  ecosystem: before the final report, `cmux workspace list` shows no workspace of a finished worker of
  this run. Closing keeps the checkout and the branch: remove them with the repository's cleanup
  command, and remove the prompt file.
- The report names each worker's `workspace_ref` and `surface_ref`.
- An unsupervised handoff that the user asks for uses the same launch, without the report
  instruction and without the wait.
