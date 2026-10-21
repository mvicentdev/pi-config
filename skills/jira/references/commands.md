# Commands Reference

Complete reference for the `jira` CLI.

---

## Viewing Issues

```bash
# View single issue
jira issue view ISSUE-KEY

# View with more comments
jira issue view ISSUE-KEY --comments 5

# Get raw JSON
jira issue view ISSUE-KEY --raw
```

---

## Listing Issues

```bash
# List all issues in project
jira issue list

# List my issues
jira issue list -a$(jira me)

# Filter by status (use quotes for multi-word statuses)
jira issue list -s"In Progress"
jira issue list -s"To Do"
jira issue list -sDone

# Filter by type
jira issue list -tBug
jira issue list -tStory
jira issue list -tTask
jira issue list -tEpic

# Filter by priority
jira issue list -yHigh
jira issue list -yCritical

# Filter by label
jira issue list -lurgent -lbug

# Combine filters
jira issue list -a$(jira me) -s"In Progress" -yHigh

# Search with text
jira issue list "login error"

# Recently accessed
jira issue list --history

# Issues I'm watching
jira issue list -w

# Created/updated filters
jira issue list --created today
jira issue list --created week
jira issue list --updated -2d

# Plain output for scripting
jira issue list --plain --no-headers

# Specific columns
jira issue list --plain --columns key,summary,status,assignee

# Raw JQL query (-q rejects ORDER BY: use --order-by)
jira issue list -q"status = 'In Progress' AND assignee = currentUser()" --order-by status

# Paginate results
jira issue list --paginate 20
jira issue list --paginate 10:50 # start:limit
```

---

## Creating Issues

```bash
# Interactive creation
jira issue create

# Non-interactive with all fields
jira issue create \
    -tBug \
    -s"Login button not working" \
    -b"Users cannot click the login button on Safari" \
    -yHigh \
    -lbug -lurgent

# Create and assign to self
jira issue create -tTask -s"Summary" -a$(jira me)

# Create subtask (requires parent)
jira issue create -tSub-task -P"PROJ-123" -s"Subtask summary"

# Create with custom fields
jira issue create -tStory -s"Summary" --custom story-points=3

# Original estimate on create (--custom original-estimate=... is silently ignored)
jira issue create -tTask -s"Summary" -e3h

# Original estimate on an existing issue: `jira issue edit` has no estimate flag, use REST
curl -s -u "$(jira me):$JIRA_API_TOKEN" -X PUT -H "Content-Type: application/json" \
  "$JIRA_SERVER"/rest/api/3/issue/KEY \
  -d '{"update":{"timetracking":[{"edit":{"originalEstimate":"3h"}}]}}'
# Check: jira issue view KEY --raw → fields.timeoriginalestimate (seconds)

# Paragraphs: a blank line inside -b starts a new ADF paragraph.
# --plain hides blank lines; check with --raw → fields.description.content[].type

# Skip prompts for optional fields
jira issue create -tTask -s"Quick task" --no-input

# Open in browser after creation
jira issue create -tBug -s"Bug title" --web

# Read description from file
jira issue create -tStory -s"Summary" --template /path/to/template.md

# Read description from stdin
echo "Description here" | jira issue create -tTask -s"Summary"
```

**Multi-line content:** The CLI chokes on multi-line strings. Write to `/tmp` first:

```bash
cat > /tmp/jira_body.md <<'EOF'
## Description
User needs ability to export data...

## Acceptance Criteria
- Export works for CSV
- Export works for JSON
EOF

jira issue create --no-input \
  -tStory \
  -pPROJ \
  -s"Add export functionality" \
  -b"$(cat /tmp/jira_body.md)"
```

---

## Transitioning Issues

```bash
# Move to a state
jira issue move ISSUE-KEY "In Progress"
jira issue move ISSUE-KEY "Done"
jira issue move ISSUE-KEY "To Do"

# Move with comment
jira issue move ISSUE-KEY "Done" --comment "Completed the implementation"

# Move and set resolution
jira issue move ISSUE-KEY "Done" -R"Fixed"

# Move and reassign
jira issue move ISSUE-KEY "In Review" -a"reviewer@example.com"

# Open in browser after transition
jira issue move ISSUE-KEY "Done" --web
```

---

## Assigning Issues

```bash
# Assign to specific user
jira issue assign ISSUE-KEY "user@example.com"
jira issue assign ISSUE-KEY "John Doe"

# Assign to self
jira issue assign ISSUE-KEY $(jira me)

# Assign to default assignee
jira issue assign ISSUE-KEY default

# Unassign
jira issue assign ISSUE-KEY x
```

---

## Comments

```bash
# Add comment
jira issue comment add ISSUE-KEY -b"This is my comment"

# Add comment from file
jira issue comment add ISSUE-KEY --template /path/to/comment.md
```

---

## Sprints

```bash
# List sprints
jira sprint list

# Active sprint only
jira sprint list --state active

# Add issue to sprint
jira sprint add SPRINT-ID ISSUE-KEY

# Close sprint
jira sprint close SPRINT-ID
```

---

## Linking Issues

| Relationship | Meaning |
|--------------|---------|
| `Blocks` | First ticket blocks second |
| `Relates` | General relationship |
| `Duplicate` | Same work |
| `Epic-Story` | Story belongs to Epic |

```bash
# Basic link
jira issue link PROJ-123 PROJ-456 "Relates"

# Blocker (blocker comes first)
jira issue link PROJ-100 PROJ-200 "Blocks"
# Meaning: PROJ-100 blocks PROJ-200

# Link to epic
jira issue link PROJ-EPIC PROJ-STORY "Epic-Story"
```

---

## Other Commands

```bash
# Open issue in browser
jira open ISSUE-KEY

# Show current user
jira me

# Server info
jira serverinfo

# List projects
jira project list

# List boards (no --plain flag)
jira board list
```

---

## Gotchas

- `-q` rejects `ORDER BY`; sort with `--order-by`.
- `jira board list` has no `--plain` flag.
- The CLI cannot list worklogs or set an exact start time reliably: use the REST API (`references/worklog.md`).

## Example project notes (PROJ)

- Issue types are in Spanish: `Historia`, `Tarea`, `Subtarea` (`-tSubtarea -P PROJ-123`).
- A backend story that answers a frontend story links to it with `jira issue link BACK-KEY FRONT-KEY "Relates"`.
