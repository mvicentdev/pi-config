# WORKFLOW.md

How a change travels from the request to its close, with the tool each step uses. The user specifies,
approves and discards. A project's skill that defines its own procedure outranks this file.

## 1. Classify

A change built on a wrong reading of the request wastes the user's review.

- Open the notes file in a directory under `/tmp` named after the work.
- Write there the route, the outcome the user will see and the checks that will prove it.
- A direct change goes to Plan. When the user vetoes it, stop, keep what is built and ask.
- A direct change that uncovers a product decision moves to Specify.

Done when the notes file holds the route, the outcome and each check.

## 2. Specify

Only the user knows what the product must do. Only a change with open product decisions takes this step.

- The `vault` skill writes it, with the criteria, the user's decisions, the scope left out and the assumptions.
- Each criterion is a behaviour someone can observe, with the way to check it.
- A criterion no automatic check covers is marked as the user's manual check, with its steps.

Done when the user approves the specification in writing.

## 3. Plan

Two workers that share a file undo each other's work, so each one gets its own worktree.

- One `worker` takes the work by default. Up to five take tasks that share no file and no contract.
- Tasks that depend on one another go to one worker, resumed for each next task.
- Create one worktree per worker, on a branch forked from the parent branch, where the task started.
- Use the repository's own worktree command and branch rules when it ships them.
- Otherwise the `worktrunk` skill manages worktrees. Run each of its `wt` commands as `git wt`,
  because `wt` alone is another program here.
- Without rules, the branch is `<conventional-commit-type>/<concept>-<operation>` in kebab-case.
- Before a parallel launch, write to the notes file the names, interfaces and form the workers share.
- Open the register beside the notes file: one line per worktree, branch, process, container, volume,
  image and temporary file.

Done when each task has its written assignment, and the register lists each worktree and branch.

## 4. Build

A test written after the code proves only what the code already does.

- The worker's prompt copies this section, lists each acceptance criterion and names the notes file.
- Each behaviour leaves a test that simulates its real use.
- The worktree takes its dependencies with `git wt step copy-ignored`, which uses no extra disk.
- Each process starts with `git wt step tether`, so it dies when its worktree is removed.
- With a specification, the worker writes one test per criterion and sees it fail before the code.
- Those tests stay as written. The worker reports any change to them, and it is reviewed apart.
- An open product decision stops the worker. The user's answer joins the decisions, and work goes on.

Done when each report gives the failing run of each criterion test and what the worker started.

## 5. Check

An author tends to confirm its own work, so the main loop runs the checks.

- Read the diff against the request first, and add to the register what the worker started.
- Run the project's tests, static analysis and style check in the worktree, and commit what passes.
- With several workers, merge their branches into one integration branch and run the checks there.
- Keep the exit code and the output of each command as the evidence.

Done when every check exits 0 on the branch to integrate. A failure goes to Correct, and Review waits.

## 6. Review

The user gives the go on the reviewer's word, so a `verifier` starts without the worker's context.

- Its prompt copies this section, and carries the specification and the base of the diff.
- It reviews the diff of the branch against the parent branch, criterion by criterion.
- Without a specification, it reviews the diff against the request and its declared outcome.
- It gives one verdict per criterion with the test that proves it, and one for the change.
- It confirms each finding against the code. A finding is also a test that does not prove its
  criterion, or one that does not match the failing run the worker reported.
- The main loop names each finding it discards, with the reason. One that breaks the request blocks.

Done when the change and each criterion have a passing verdict. A failure goes to Correct.

## Correct

Repeated attempts cost more than the user's guidance, so they have a limit.

- Resume the worker that wrote the change. On an integration branch, resume the owner of the failing file.
- Two corrections follow the first attempt. The failures of Check and Review count together.
- A correction the user asks for and a new product decision stay out of that count.
- After the second failed correction, commit the work as it stands on its branch, unpublished.
- Write the failure report in a note beside the specification, or in the report to the user. Then
  remove the worktree and the processes.
- The user chooses: another correction with guidance, the user's own hands or discard.

Done when the failed step passes, or the user has chosen.

## 7. Integrate

The user answers for what is published, so nothing is published without the user's go.

- Ask for the go in the form the `feedback-reminder` extension sets. The destination is the parent
  branch, unless the user names another.
- Ask only once each criterion has its evidence or is a manual check.
- After the go, merge the branch into the destination and push it, unless the user keeps it local.
  The project's merge request skill does it when the project has one.
- A correction the user asks for resumes the same worker. Check runs again, and Review covers the fix.

Done when the change is integrated where the user said, or discarded.

## 8. Close

Leftover worktrees and processes confuse the next task, so Close runs by itself, without asking.

- Walk the register and remove each entry, with the repository's own cleanup command when it ships one.
- Force a process that will not stop, and report it.
- Run `git wt step prune` to remove each merged or orphaned worktree left behind.
- Until the user says discard, every branch and every entry that holds unpublished work stays.

Done when the register holds only such work, and the report names what was removed and kept.
