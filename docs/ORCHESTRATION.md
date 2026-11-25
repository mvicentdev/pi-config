# ORCHESTRATION.md

How the main loop coordinates subagents, whatever the harness. Skills hold the workflows. Each path
below is relative to this file's directory.

## Roles

- The main loop keeps the plan, every decision, the synthesis and the conversation with the user.
- `explorer` reads the code and `researcher` reads what lives outside it.
- `worker` edits and tests, and `verifier` reviews with a fresh context.
- A subagent does one bounded task in its own context and hands back a report.
- A launch leaves the model and thinking to the configuration.

## Skills

- A skill defines the procedure: its steps, the file each step writes and where it stops for the user.
- A skill with phases hands each one over through a file. The user reviews the research and the plan
  before the implementation starts.
- When a skill asks for a subagent of its own, the matching role runs it with the skill's instructions
  in its prompt. Code reading goes to `explorer`, web reading to `researcher`, writing to `worker` and
  review to `verifier`.
- Without a skill, the work follows Delegate and Verify directly, and no phase file is written.

## Delegate

- Work inline by default, and when in doubt.
- Deciding or verifying inline takes one parallel batch of at most three calls.
- Past that, or past about five sequential lookups, one `explorer` maps it and returns path:line
  evidence.
- One subagent takes one question or one change. Launch each distinct task once, and the independent
  ones together in one message.
- The main loop writes inline a task of one unit that fits in its context with room to spare.
- It coordinates a task of several units, or one that would fill more than about half of its context.
  It plans the units, hands each independent one to its own `worker` and verifies each result.
- Units that depend on one another go to one `worker`, resumed for each next unit.
- A `worker` also does the reading that prepares its write.

## Notes

- The work's temporary directory is a directory under `/tmp` named after the work.
- The notes file lives there and holds what several subagents share: the map, the agreed decisions
  and the plan's phases. Each worker prompt points to it.
- After each write, the main loop updates the notes file or drops it before the next launch.
- When a subagent reports a fact that breaks the plan, the main loop corrects the notes file before the
  next launch.

## Prompt

- It is self-contained and sets an exact boundary: what changes and what must not.
- It carries what is already known: the exact paths and lines and the command that proves the work.
- It names what the task adds to the role's report format.
- It names the paths of the instructions and skills to read before working, never a summary of them.
- It tells the subagent to stop and report any fact that breaks the plan.
- A `verifier` prompt carries the plan's phase or the request, and the base of the diff.

## Parallel

- Independent subagents run in parallel. Open `CHECKOUTS.md` before you launch workers in parallel or
  a `worker` in its own checkout.
- Five subagents at most run at a time. Launch a task once every task it depends on has landed.
- The user watches every launch and its supervision in the main conversation, never in a terminal
  view. Launch each subagent with `run_in_background: false`, so its progress and result show in the
  conversation.
- Resume a finished subagent to follow up in its own context.

## Verify

- A report states intent, not outcome. Read the diff and check it against the request before
  reporting.
- A `verifier` reviews every change: after each implementation phase of a plan or, without a plan,
  once the change is complete. It checks it against what the phase promised or against the request.
- When the project has review criteria of its own, the `verifier` prompt names their path. That review
  is the one the project asks for before a go, and it holds for the review of a later fix too.
- Re-run at least one reported command yourself.
- The main loop ticks each verified phase in the task's spec, or in the notes file without one.
- When two reports contradict each other, settle the point against the code before going on.
- Check each verifier finding against the request and the code. A finding that breaks the request is
  a blocker, and the report names each discarded finding with its reason.
- Blockers get one correction batch from the `worker` that wrote the change, then one recheck limited to those blockers.
  Blockers still open go to the user as a decision, never into another correction batch.
- When a role fails its task twice, give it a check it can run, such as a test. If it still fails,
  tell the user.

## Clean up

- Once the work lands or is discarded, and before reporting it done, remove what it built or started.
- That covers every process, checkout, branch, notes file, prompt file, stack, container,
  volume and image. Use the repository's own cleanup command when it ships one.
- Only what still holds unshipped work stays, and the report names it.
