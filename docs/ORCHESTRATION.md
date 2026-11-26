# ORCHESTRATION.md

The tools that carry out each step of `WORKFLOW.md`, and how the main loop coordinates subagents. A
project's skill that defines its own procedure outranks this file.

## Roles

The main loop's context holds the conversation with the user, and it degrades as it fills. A
subagent exists to protect it: it does one bounded task in its own context and hands back a report.

- A role is a label, never a specialist. It sets only what a subagent may touch and the form of its
  report.
- The behaviour of a subagent comes from the skills and documents its prompt or its definition names.
- The main loop keeps the plan, every decision, the synthesis and the conversation with the user.
- A `worker` may edit, and builds every change to code and its tests. The main loop writes none of it.
- `explorer` reads the code, `researcher` reads what lives outside it, and `verifier` reviews.
- A launch leaves the model and thinking to the configuration.

## Where each result lives

| Step | Result | Place |
|---|---|---|
| Classify | route, outcome and checks | the notes file |
| Specify | specification | the project's vault, through the `vault` skill |
| Plan | assignments and register | the notes file and the register file |
| Build | change | the worker's branch |
| Check | exit codes and output | the request for go |
| Review | verdict per criterion | the `verifier` report |
| Correct | failure report | a note beside the spec, or the report to the user without one |
| Integrate | evidence | the request for go |
| Close | what was removed and kept | the final report |

## Notes and register

- The work's temporary directory is a directory under `/tmp` named after the work.
- The notes file lives there. It holds the outcome, the checks, the plan and the decisions several
  subagents share. Each worker prompt points to it.
- After each write, the main loop updates the notes file. It corrects it too when a subagent reports
  a fact that breaks the plan.
- The register file lives beside it. The main loop adds one line per checkout, branch, process,
  container, volume, image and temporary file.
- Each worker reports what it started, and the main loop adds it to the register.

## Reading

- Decide or verify inline with one parallel batch of at most three calls.
- Past that, or past about five sequential lookups, one `explorer` maps it and returns path:line
  evidence.
- One subagent takes one question or one change. Launch each distinct task once, and the independent
  ones together in one message.
- A `worker` also does the reading that prepares its write.

## Assignment

- The prompt is self-contained. It carries the goal, the exact paths and lines, and what must stay
  untouched.
- Its done criterion is the command that proves the work.
- It names the paths of the project's rules and of the skills to read first, never a summary of them.
- A `worker` prompt names `WORKFLOW.md`, whose Build step it follows, and lists each acceptance
  criterion. Its report adds the failing run of each criterion test.
- A `verifier` prompt names `WORKFLOW.md`, whose Review step it follows.
- It tells the subagent to stop and report any fact that breaks the plan.
- A `verifier` prompt carries the specification, or the request with its declared outcome. It also
  carries the base of the diff and the path of the project's review criteria, when it has some.

## Checkouts

- Each `worker` runs in a worktree of its own, which the main loop creates before the launch. Use the
  repository's own worktree command when it ships one.
- Its branch forks from the branch the task left from, which is the parent branch.
- The branch and the directory take the name the repository's branch rules give, checked with its
  validator when it ships one.
- Without rules, the name is `<conventional-commit-type>/<concept>-<operation>` in kebab-case.
- Before a parallel launch, the main loop writes to the notes file the decisions the workers share:
  names, interfaces and form.
- Units that depend on one another go to one `worker`, resumed for each next unit.
- The user watches every launch in the main conversation. Launch each subagent with
  `run_in_background: false`.
- Resume a finished subagent to follow up or to correct, in its own context.

## Check and review

- A report states intent, not outcome. Read the diff and check it against the request before the
  checks.
- The main loop runs the project's check commands in the worker's checkout, and commits what passes.
- It also commits the work that fails its second correction, as it stands.
- With several workers, it merges their branches into one integration branch.
- The `verifier` reviews the diff of that branch against the parent branch.
- It also checks that each criterion's test proves its criterion and matches the failing run the
  worker reported.
- When two reports contradict each other, settle the point against the code before going on.
- The main loop ticks each verified task in the notes file.

## Integrate and close

- The request for go asks the approval of Integrate, in the form the `feedback-reminder` extension sets.
- After the go, the main loop merges the branch into the destination and pushes it, unless the user
  keeps it local. The project's merge request skill does it when the project has one.
- Close uses the repository's own cleanup command when it ships one.
