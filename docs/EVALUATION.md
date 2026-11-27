# EVALUATION.md

How the rules for agents earn their place. The grader in `evals/flow/grade.py` reads recent pi sessions.
It grades how the agents followed each rule, never the quality of the code.

## When to run it

A rule costs context in every session. So it stays only while it changes what the agents do.

- Run the report before you change a rule, and again after enough sessions under the new rules.
- Run it when the user asks how the agents follow their rules.
- Write the report outside the repository:
  `python3 evals/flow/grade.py --report --out /tmp/<work>/report.md`.
- Read the outcome measures first. They count corrections, main loop cost, subagent cost and failed
  subagents, per rules version and per week.

## Rubric

Each rule line has one entry in `evals/flow/rubric.json`. Its tag says who measures it.

- `hook`: an extension imposes the rule, so the report does not grade it.
- `script`: the grader answers it from the session file.
- `judge`: a reviewer answers it, because a script gives false alarms.
- `unmeasured`: no session shows whether the rule was followed.
- A test fails when a rule line has no entry or an entry has no rule line. Update the rubric with the rule.

## Judged answers

A script cannot judge intent. A reviewer in a fresh context can.

- Print the assignment of one session with `grade.py --judge <session id>`.
- Give it to a read-only `verifier`. The verifier returns yes, no or n.a., the entry ids and one
  quote of at most 20 words for each question.
- Save the answers as JSON outside the repository and pass them with `--answers <file>`.
- The report marks these answers as judged.

## Rule changes

The user pays for each rule in every session. So a change shows its effect in numbers.

- Accept a rule change only with the report before and after it, under the same period length.
- With fewer than 20 sessions under a rules version, the report says the sample is too small. Wait for
  more sessions.
- A rule whose pass rate shows no relation to any outcome is a candidate. Propose its deletion to
  the user, with the report.
- A rule that a hook could impose and that is broken in most sessions is a candidate for a hook.
  Propose the hook to the user.
