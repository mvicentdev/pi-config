# ORCHESTRATION.md

How the main loop hands work to subagents, in a change or in a question.

## Roles

The main loop's context holds the conversation with the user, and it degrades as it fills. A
subagent exists to protect it: it does one bounded task in its own context and hands back a report.

- A role is a label, never a specialist. It sets only what a subagent may touch and the form of its
  report.
- The behaviour of a subagent comes from the skills and documents its prompt or its definition names.
- The main loop keeps the plan, every decision, the synthesis and the conversation with the user.
- It relays each claim of a report with its scope: what was checked and how. A conclusion wider
  than that scope reaches the user as unverified.
- A `worker` may edit, and builds every change to code and its tests. The main loop writes none of it.
- `explorer` reads the code, and `researcher` reads what lives outside it.
- The `advisor` tool weighs a decision before a plan commits to it. A `verifier` reviews a written
  change or a claim.

## Reading

Each file the main loop reads stays in its context for the rest of the conversation.

- Decide or verify inline with one parallel batch of at most three calls.
- Past that, or past about five sequential lookups, one `explorer` maps it and returns path:line
  evidence.
- A `worker` also does the reading that prepares its write.

## Launch

The user follows every launch in the main conversation.

- The `main-loop-guard` extension runs each `Agent` call in the foreground.
- Leave the model and thinking of each subagent to the configuration.
- One subagent takes one question or one change. Launch the independent ones together in one message.
- The main loop creates each worktree itself. `isolation: worktree` deletes the worktree when the
  agent ends, and leaves its changes only on a branch.
- Resume a finished subagent to follow up, in its own context.

## Assignment

A subagent sees only its prompt, so the prompt carries everything the task needs.

- It carries the goal, the decisions already taken, the exact paths and lines, and what must stay
  untouched.
- Its done criterion is the command that proves the work.
- It names the paths of the project's rules and of the skills to read first, never a summary of them.
- The `main-loop-guard` extension ends each prompt with the line to stop and report a fact that
  breaks the plan.
- It copies each rule the task must follow that those paths do not hold.
