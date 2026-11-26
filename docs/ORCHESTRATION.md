# ORCHESTRATION.md

How the main loop hands work to subagents, in a change or in a question.

## Roles

The main loop's context holds the conversation with the user, and it degrades as it fills. A
subagent exists to protect it: it does one bounded task in its own context and hands back a report.

- A role is a label, never a specialist. It sets only what a subagent may touch and the form of its
  report.
- The behaviour of a subagent comes from the skills and documents its prompt or its definition names.
- The main loop keeps the plan, every decision, the synthesis and the conversation with the user.
- A `worker` may edit, and builds every change to code and its tests. The main loop writes none of it.
- `explorer` reads the code, `researcher` reads what lives outside it, and `verifier` reviews.

## Reading

Each file the main loop reads stays in its context for the rest of the conversation.

- Decide or verify inline with one parallel batch of at most three calls.
- Past that, or past about five sequential lookups, one `explorer` maps it and returns path:line
  evidence.
- A `worker` also does the reading that prepares its write.

## Launch

The user follows every launch in the main conversation.

- Launch each subagent with `run_in_background: false`, and leave its model and thinking to the
  configuration.
- One subagent takes one question or one change. Launch the independent ones together in one message.
- Resume a finished subagent to follow up, in its own context.

## Assignment

A subagent sees only its prompt, so the prompt carries everything the task needs.

- It carries the goal, the exact paths and lines, and what must stay untouched.
- Its done criterion is the command that proves the work.
- It names the paths of the project's rules and of the skills to read first, never a summary of them.
- It tells the subagent to stop and report any fact that breaks the plan.
- A `worker` prompt copies the Build section of `WORKFLOW.md`, with its done line. It lists each
  acceptance criterion and names the notes file.
- A `verifier` prompt copies the Review section, and carries what that section reviews against.
- It also carries the base of the diff and the path of the project's review criteria, when it has some.
