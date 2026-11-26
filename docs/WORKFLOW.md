# WORKFLOW.md

How a change travels from the request to its close. The user specifies, approves and discards.

## 1. Classify

A change built on a wrong reading of the request wastes the user's review.

- Write the route of the request, the outcome the user will see and the checks that will prove it.
- A direct change goes to Plan. When the user vetoes it, stop, keep what is built and ask.
- A direct change that uncovers a product decision moves to Specify.

Done when the route, the outcome and each check are written.

## 2. Specify

Only the user knows what the product must do. Only a change with open product decisions takes this step.

- The specification adds the acceptance criteria, the user's decisions, the scope left out and the assumptions.
- Each criterion is a behaviour someone can observe, with the way to check it.
- A criterion no automatic check covers is marked as the user's manual check, with its steps.

Done when the user approves the specification in writing, where the user reads it.

## 3. Plan

A builder sees only its assignment, so the assignment carries everything it needs.

- One builder takes the work by default. Up to five work on tasks that share no file and no contract.
- Each assignment holds the goal, the limits, the files, the done criterion and the form of the report.
- Open the register. Each directory, branch and process the flow creates enters it.

Done when each task has its assignment and the register exists.

## 4. Build

A test written after the code proves only what the code already does.

- Each builder works in its own directory, on its own branch.
- Each behaviour leaves a test that simulates its real use.
- With a specification, the builder writes one test per criterion and sees it fail before the code.
- Those tests stay as written. The builder reports any change to them, and it is reviewed apart.
- An open product decision stops the builder. The user's answer joins the decisions, and work goes on.

Done when each builder has handed in its report.

## 5. Check

An author tends to confirm its own work, so someone else runs the checks.

- The main loop runs the tests, the static analysis and the style check, and again on a joined branch.
- The evidence is the exit code and the output of each program, never an agent's claim.

Done when every check passes on the branch to integrate. A failure goes to Correct, and Review waits.

## 6. Review

The user approves on the reviewer's word, so the reviewer starts without the builder's context.

- An independent reviewer, read-only, reviews every change against each criterion.
- Without a specification, it reviews the change against the request and its declared outcome.
- It gives one verdict per criterion with the test that proves it, and one for the change.
- It confirms each finding against the code. A test that does not prove its criterion is a finding.
- The main loop names each finding it discards, with the reason. One that breaks the request blocks.

Done when the change and each criterion have a passing verdict. A failure goes to Correct.

## Correct

Repeated attempts cost more than the user's guidance, so they have a limit.

- A failure returns to its builder. On a joined branch, it returns to the owner of the failing file.
- Two corrections follow the first attempt. The failures of Check and Review count together.
- A correction the user asks for and a new product decision stay out of that count.
- After the second failed correction, commit the work as it stands on its branch, unpublished.
- Write the failure report beside the specification, then remove the directory and the processes.
- The user chooses: another correction with guidance, the user's own hands or discard.

Done when the failed step passes, or the user has chosen.

## 7. Integrate

The user answers for what is published, so nothing is published without the user's approval.

- Ask the user to approve every change, once each criterion has its evidence or is a manual check.
- The request names the destination: the parent branch, unless the user names another.
- An approval publishes the change to the shared repository, unless the user keeps it local.
- A correction the user asks for returns to the same builder. Check runs again, and Review covers the fix.

Done when the change is integrated where the user approved, or discarded.

## 8. Close

Leftover directories and processes confuse the next task, so Close runs by itself, without asking.

- Walk the register and remove each directory, branch, process, container and temporary file.
- Force a process that will not stop, and report it.
- Until the user says discard, every branch and every entry that holds unpublished work stays.

Done when the register holds only such work, and the report names what was removed and kept.
