# Checkouts

How workers run in parallel or in their own checkout. The rest of the coordination lives in
`ORCHESTRATION.md`.

- Workers run in parallel only on disjoint files, or each in its own checkout.
- Three checkouts at most hold work at a time.
- Before a parallel launch, the main loop writes to the notes file the decisions the workers share:
  names, interfaces and form.
- A worker's checkout is a worktree the main loop creates before the launch, with the repository's own
  worktree command when it ships one.
- The checkout's branch and directory take the name the repository's branch rules give, checked with
  its validator when it ships one.
- Without rules, the name is `<conventional-commit-type>/<concept>-<operation>` in kebab-case.
