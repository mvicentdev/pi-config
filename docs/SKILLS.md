# Skills

Global skills live in `~/.agents/skills/` and are managed with the [skills.sh](https://skills.sh)
CLI through `npx`. `~/.agents/.skill-lock.json` records the source of each one.

- `npx skills ls -g` lists every global skill with its source. A skill marked `local` was written by
  hand; the CLI never updates it.
- `npx skills update <name> -g -y` updates one skill from its source; `npx skills update -g -y`
  updates all of them.
- `npx skills add <owner/repo> -g -s <name> -y` installs one skill from a repository.
- `npx skills remove <name> -g -y` removes it and its links in every agent.
- Always pass `-g`: without it the CLI works on the project in the current directory.
- Never edit a skill that has a source: the next update overwrites it. Write the change as a
  `local` skill instead.
- After an update, report each skill updated with its source; a skill that failed, with the
  CLI's output.
