# Skills

Global skills live in `~/.pi/agent/skills/`, one directory per skill.
The file `.sources` in that directory records the source of each skill that has one.

- Propose an external skill only when the catalogue that lists it shows a considerable number of installs. Try it
  in a temporary directory before you install it.
- Install or update a skill only when the user asks. Copy its directory from its source, unmodified,
  and record the source in `.sources`.
- A skill without a source was written by hand. Edit it in place.
- Never edit a skill that has a source, because the next update overwrites it. Write the change as a
  skill of your own instead.
- Remove a skill by deleting its directory and its line in `.sources`.
