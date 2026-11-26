# WORKFLOW.md

How a change travels from the request to its close. The user decides what is built and whether it is
accepted. The agents decide how it is built. This file holds the steps, and `ORCHESTRATION.md` names
the tool each step uses.

## 1. Classify

- Write the route `AGENTS.md` gives the request, with its reason.
- Write the outcome the user will see and the checks that will prove it.
- A direct change goes straight to Plan. When the user vetoes it, stop, keep what is built and ask
  what the user wanted.
- When a direct change uncovers a product decision, it moves to Specify.

Done when the route, the outcome and each check are written.

## 2. Specify

Only a change with open product decisions takes this step.

- The specification adds to the outcome its acceptance criteria, the user's decisions, what stays out
  of scope and the assumptions taken.
- Each criterion is a behaviour someone can observe, with the way to check it.
- A criterion no automatic check can cover is marked as the user's manual check, with the steps to
  see it.
- Each answer of the user to a product question enters the specification as a decision.
- The specification lives where the user reads it.

Done when the user approves the specification in writing.

## 3. Plan

- Split the work into tasks. One builder takes them by default.
- Several builders, five at most, work only on tasks that share no file and no contract.
- Write one assignment per builder: its goal, its limits, its files, its done criterion and the form
  of its report.
- Open the register. Each directory, branch and process the flow creates enters it when it is created.

Done when each task has its assignment and the register exists.

## 4. Build

- Each builder works in its own directory, on its own branch.
- Each behaviour leaves a test that simulates its real use.
- With a specification, the builder first writes one test per criterion and sees it fail. Then it
  writes the code.
- Those tests stay as written. The builder reports any change to them, and that change is reviewed
  apart.
- A product decision the specification leaves open stops the builder. The main loop asks the user and
  adds the answer to the decisions. The work then goes on with no new approval.

Done when each builder has handed in its report.

## 5. Check

- The main loop runs the tests, the static analysis and the style check. The author of a change never
  checks it.
- With several builders, the checks run again on the branch that joins their work.
- The evidence is the exit code and the output of each program, never an agent's claim.

Done when every check passes on the branch to integrate. A failure goes to Correct, and Review waits.

## 6. Review

- An independent reviewer, with a fresh context and read-only access, reviews every change.
- It checks the change against each criterion. Without a specification, it checks it against the
  request and its declared outcome.
- It gives one verdict per criterion, and confirms each finding against the code before it reports it.
- The main loop checks each finding against the request. A finding that breaks the request blocks
  the change. It names each finding it discards, with the reason.

Done when the change and each criterion have a passing verdict. A failure goes to Correct.

## Correct

- A failed check or review returns to the builder that wrote the change. On a joined branch, it
  returns to the owner of the failing file.
- Two corrections follow the first attempt, and the failures of Check and Review count together.
- A correction the user asks for and a new product decision stay out of that count.
- After the second failed correction, commit the work as it stands on its branch, unpublished. Write
  the failure report beside the specification, then remove the directory and the processes.
- The user then chooses: another correction with the user's guidance, the user's own hands or discard.

Done when the failed step passes, or the user has chosen.

## 7. Integrate

- Ask the user to approve every change, with the evidence the request for go carries.
- Ask only once each criterion has its evidence or is a manual check.
- The request names the destination, which is the parent branch unless the user names another.
- An approval publishes the change to the shared repository, unless the user keeps it local.
- When the user asks for a correction, the change returns to Build with the same builder. It passes
  Check again, and Review covers only that fix.
- When the user discards the change, it goes to Close.

Done when the change is integrated where the user approved, or discarded.

## 8. Close

- Close runs by itself once the change is integrated or discarded, without asking.
- Walk the register and remove each directory, branch, process, container and temporary file in it.
- Force a process that will not stop, and report it.
- A discard removes the branch too. Until the user says discard, every branch stays.
- Keep each entry that holds unpublished work the user has not discarded.

Done when the register holds only such work, and the report names what was removed and kept.
