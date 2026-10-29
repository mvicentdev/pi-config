# ORCHESTRATION.md

How the main loop hands work to subagents, whatever the harness. Each harness's own instructions or
configuration name its tools and models; this file names none.

## Delegate or work inline

- The main loop orchestrates: it keeps the plan, every decision, the synthesis and the conversation with
  the user, and hands each subagent a self-contained prompt with an exact boundary.
- Work inline by default, and when in doubt; a task's size, file count or the price of the main loop's
  model never justifies a delegation alone.
- Delegate what would fill the main context without need, and work inline otherwise: deciding or
  verifying inline takes one parallel batch of at most three calls and about 10k tokens; past that, or
  past about five sequential lookups, one read-only explorer maps it and returns about 2k tokens with
  path:line evidence. When workers will build on that map, the explorer also saves it as a markdown notes
  file in a temporary directory outside the repository, and each worker prompt points to that file
  instead of repeating its content.
- One subagent, one question or one change: split broader work across several runs, launch each
  distinct task once, and launch the independent ones together.
- The main loop writes inline, with or without an agreed plan, and a unit of about 100 changed lines or
  fewer always stays inline, because writing it costs less than starting a worker. It delegates a writer
  only for independent units of more than that on disjoint files launched together, or when its own
  context runs short, and that writer also does the reading that prepares its write.

## The prompt

- It carries what is already known, so the subagent never searches for it again: the exact paths and
  lines, what changes and what must not, the paths of the instructions and skills to read before
  working — the paths, never a summary of them —, the command that proves the work and the report
  format.

## In parallel

- Readers run in parallel and in the background; writers run in parallel only on disjoint files, or each
  in its own checkout once the user has approved it.
- A writer's checkout is a worktree the main loop creates before the launch, with the repository's own
  worktree command when it ships one. Its branch and directory must carry a name that says what the
  work is: the name the repository's branch rules give it, checked with the repository's validator when
  it ships one; without rules, `<conventional-commit-type>/<concept>-<operation>` in kebab-case.
- A worker isolated in its own checkout or in an agentic IDE runs the same harness as the main loop that
  launches it.
- Five subagents at most at a time; launch the next ready task as soon as one finishes, without waiting
  for the rest of the batch. A task is ready once every task it depends on has landed.
- Wait for the completion notice instead of polling: steer a running subagent only when its boundary
  changes or it needs a fact just learned, resume a finished one to follow up in its own context, and
  never launch a second one for the same task.
- Once the work lands or is discarded, and before reporting it done, remove every checkout, branch,
  notes file, container, volume and image built for it, with the repository's own cleanup command when it ships
  one; only what still holds unshipped work stays, and the report names it.

## Agentic IDE

A watched worker is one the user wants to follow in its own pane; it runs in the agentic IDE that hosts
the main loop. Every other subagent runs in the session, unless the host adapter runs every subagent as
a visible child thread, as T3 Code does, or as a supervised worker, as Orca does. Delegation to a watched worker is supervised;
an unsupervised handoff happens only when the user asks for one. Each supported IDE — Orca, Paseo, cmux
and T3 Code — has an adapter in `~/.pi/agent/docs/orchestration/`.

1. Detect the host IDE: run the Detection check of each adapter in `~/.pi/agent/docs/orchestration/`.
   The adapter whose check passes is the host. An IDE started from another IDE's terminal inherits
   its variables, so more than one check can pass; then ask the user which IDE hosts the watched
   worker. When no check passes, the work goes to in-session subagents.
2. Read the rest of that adapter before the first watched worker; it alone names the IDE's commands.
3. Start each watched worker with a self-contained prompt.
4. Wait inside the turn until every worker has settled or the user needs to decide something; a
   timed-out or empty wait is a checkpoint, so wait again at once.
5. Answer a worker's question in its own thread; an answer that changes the agreed design goes into
   its prompt or spec in the same step.
6. Verify each settled worker as the Verifying section below says, then report one line per task with
   its outcome, its evidence and the IDs the IDE gives it.
7. Once a worker's result is accepted — merged, or its answer taken — release it at once: close its pane,
   remove its checkout, branch, stack and prompt file. A follow-up goes to a new worker, never to a
   released one.

## Verifying

- A subagent's report states intent, not outcome: before reporting, read its diff and check it against
  the request.
- Verification follows risk: documentation needs a read-back; an ordinary behaviour change needs the
  writer to run the commands named in its prompt and report each with its result; security,
  credentials, data loss, migrations, public contracts or anything unclear also need a fresh verifier
  without the writer's context, run as the `code-review` skill says once the change is committed locally. Whatever the tier, re-run at least one reported command yourself.
- A writer that runs on a small model or at low effort raises its verification tier by one.
- Verifier blockers get one correction batch that fixes them all, then one recheck limited to those
  blockers; blockers still open go to the user as a decision, never into another correction loop.
