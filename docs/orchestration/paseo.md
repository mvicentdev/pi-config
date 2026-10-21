# Paseo

Adapter for [Paseo](https://github.com/getpaseo/paseo); the rules live in `../ORCHESTRATION.md`.

- Detection: `PASEO_AGENT_ID` is set. The check passes when
  `paseo inspect "$PASEO_AGENT_ID" --json` returns an `Id` equal to `PASEO_AGENT_ID`. The command exits
  with 0 even on failure, so read the JSON: a failure has an `error` field.
- Read the `paseo` skill before the first watched worker: it explains workspaces, subagent parentage,
  profiles and follow-ups. Where the skill and this file differ, this file wins.
- Drive the workers with the `paseo` CLI. `PASEO_CLI` holds the path of the binary, and
  `paseo --help` and `paseo <command> --help` are the account of its flags.
- Before each launch, read every profile and its `notes` with the MCP tool `list_profiles` through
  codemode; the CLI has no profile command. Use a profile only when its provider is `pi`, and pass it
  as `--provider pi/<model>`, `--mode` and `--thinking`; with no such profile, use `--provider pi`.
- Start a watched worker with `paseo run --no-wait --provider pi --title <task> "<prompt>"`; it becomes
  a subagent of the caller. A writer gets its own checkout with
  `--new-workspace worktree --worktree-mode branch-off --new-branch <branch> --base <ref>`.
- Wait inside the turn with `paseo wait <id>`; this replaces the skill's finish notification. Read the
  answer with `paseo logs <id>`, follow up or answer a question with `paseo send --no-wait <id> "<prompt>"`, and
  list the workers with `paseo ls`.
- `paseo archive <id>` releases a settled worker, and archiving its last workspace removes the
  worktree Paseo created.
- An unsupervised handoff that the user asks for runs the `paseo-handoff` skill.
