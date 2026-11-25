# Skills

Global skills live in `skills/`, beside the `AGENTS.md` that points to this file, one directory per
skill.
The file `.sources` in that directory records the source of each skill that has one.

- Install or update a skill only when the user asks. Copy its directory from its source, unmodified,
  and record the source in `.sources`.
- A skill without a source was written by hand. Edit it in place.
- Never edit a skill that has a source, because the next update overwrites it. Write the change as a
  skill of your own instead.
- Remove a skill by deleting its directory and its line in `.sources`.
