# T3 Code

Adapter for [T3 Code](https://github.com/pingdotgg/t3code); the rules live in `../ORCHESTRATION.md`.

- Detection: `T3_MCP_URL` or `T3_ACP_MCP_ENDPOINT` is set, or the harness exposes the `t3-code`
  MCP tools. The check passes when `orchestrator_capabilities`, called as below, returns a
  `parentThreadId`.
- Drive the workers with the `t3` CLI. One call runs one tool of the T3 Code MCP server and prints its
  JSON result:

  ```sh
  T3_ACP_MCP_ENDPOINT="${T3_ACP_MCP_ENDPOINT:-$T3_MCP_URL}" \
  T3_ACP_MCP_AUTHORIZATION="${T3_ACP_MCP_AUTHORIZATION:-Bearer $T3_MCP_BEARER_TOKEN}" \
  "${T3CODE_CLI_PATH:-t3}" acp-mcp-call <tool> '<json>'
  ```

  `t3 --help` does not list `acp-mcp-call`. A harness that exposes the tools natively
  (`mcp__t3-code__<tool>`) calls them directly with the same names and arguments, and their
  descriptions are the account of each argument.
- Every subagent is a child thread, so the user sees the delegated work. Start each pi role with
  `delegate_task` and these fields:

  ```json
  {"task":"Read ~/.pi/agent/agents/<role>.md and follow it as your role. <prompt>",
   "title":"<role>: <task>", "role":"<t3 role>", "mode":"wait",
   "target":{"providerInstanceId":"pi","model":"<model>","options":{"thinking":"<thinking>"}}}
  ```

  `<model>` and `<thinking>` come from the role's entry in `~/.pi/agent/subagent-models.json`, under
  the provider of the caller's model. `<t3 role>` is `research` for `explorer` and `researcher`,
  `implementation` for `worker` and `review` for `verifier`. T3 Code does not apply the role file's
  tool limits, so the role file's text alone keeps a reader read-only.
- Use `"mode":"wait"` when the next step needs one result; `summary` holds it. Run parallel subagents
  with `"mode":"async"`, then wait on each `childThreadId` as below.
- Before each launch, read the providers and models with `orchestrator_capabilities`. For a watched worker,
  omit `target` so it runs the caller's provider; to change the model, keep the caller's `providerInstanceId`.
- Start a watched worker with `delegate_task` and
  `{"task":"<prompt>","title":"<task>","mode":"async","clientRequestId":"<task-id>"}`; it becomes a
  child thread of the caller. Keep its `taskId` and `childThreadId`. A writer works in the checkout
  that `../ORCHESTRATION.md` has the main loop create: the prompt names its absolute path, and the
  worker reads and edits by absolute path and runs each command as `cd <checkout> && <command>`.
  Leave `isolation` out: T3 Code's own isolation names the checkout and the branch by an id
  (`t3-<id>`, `t3/<id>`).
- Wait inside the turn with `t3_thread_wait` and `{"threadId":"<childThreadId>","timeoutMs":600000}`.
  Read the answer with `task_status` and `{"taskId":"<taskId>"}`: `workState` `result_available` marks
  a settled worker, and `summary` holds its answer.
- Answer a worker's question on its `childThreadId`: `t3_pending_request_list` gives the `requestId`,
  `t3_pending_request_read` gives each question `id` and option `value`, and `t3_pending_request_respond`
  takes `{"threadId":"<childThreadId>","requestId":"<requestId>","answers":{"<id>":"<value>"}}`.
  The `value` is the full option text, such as `2. azul — Color azul.`; the bare label gives no choice.
  A question that is already answered returns `not found`; read the worker's thread to see the answer. Follow up with `t3_thread_send` and
  `{"threadId":"<childThreadId>","message":"<prompt>","mode":"queue"}`, or `"mode":"steer"` for a
  running turn. List the workers with `t3_thread_list`.
- Link each worker for the user as `[<title>](t3-thread://v1/<childThreadId>)`; the report names its
  `taskId` and `childThreadId`.
- `t3_thread_organize` with `{"threadId":"<childThreadId>","action":"archive"}` releases a settled
  worker, and `task_cancel` stops a running one. Archiving keeps the worker's checkout and branch:
  remove them with the repository's cleanup command.
- An unsupervised handoff that the user asks for is a top-level thread: start it with
  `t3_thread_launch` and an explicit `workspaceStrategy`.
