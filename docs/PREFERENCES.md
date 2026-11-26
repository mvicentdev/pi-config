# PREFERENCES.md

What the user keeps constant in everything the agents write, in every project. The
`feedback-reminder` extension sets how a message to the user reads.

## Rules for agents

A setting applies every time. A written rule applies only when an agent reads it.

- Impose a behaviour with a setting, a hook or an extension when one can. Write a rule only for what
  no configuration can impose.
- Each document holds one responsibility, within 120 lines. A project's entry file holds 60, or the
  ceiling the project sets.
- The entry file is always in context. It points to each document, and no document points back to it.
- Each document is one step away from the entry file, and names another only where its own rule
  needs it.
- Each section opens with the human reason for its rules.
- Each concept keeps one name, and each cited file, section and name exists. After an edit, grep the
  documents for what it renamed or removed.
- A line enters a document only after an agent failed without it.

## Markdown

The user reads these documents to supervise the agents.

- Headings are short noun phrases in a professional register.
- Prose is plain and literal, in the third person.
- A table holds what compares several items. A list holds what is parallel. Prose holds the rest.

## HTML

The user opens each page in a browser of his own, outside any host application.

- Preview content in a plain HTML file. An artifact or a host application's visual is never the way.
- One file holds the page, with its styles and scripts inside.
- Geist Mono sets the interface, and IBM Plex Sans sets the text to read.
- Colours are pastel and flat, with crisp borders, rounded corners and a dotted background.
- Light and dark themes both work, and motion respects the reduced-motion setting.
- The code is short and minimal.
- Give the path of the page. The user opens and reloads it.
