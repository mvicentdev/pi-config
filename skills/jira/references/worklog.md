# Worklogs

Logging time on Jira issues ("imputar horas") through the REST API v3. Reads run freely; every POST waits for the user's explicit go-ahead.

## Workday

Monday to Friday, 09:00-18:00, Europe/Madrid. Lunch varies from day to day: before computing gaps, ask the user for that day's lunch block, offering 15:00-16:00 as the usual one. Lunch is never logged and is shown as "Comida" in tables. A full day is 9 h minus lunch.

## Backend

The jira CLI cannot list worklogs nor set an exact start time reliably, so call `$JIRA_SERVER` (`server` in `~/.config/.jira/.config.yml`, e.g. `https://yourcompany.atlassian.net`) with basic auth `"$(jira me):$JIRA_API_TOKEN"`.

| Need | Call | Keep |
|---|---|---|
| Current user | `GET /rest/api/3/myself` | `.accountId` |
| Issues with time logged on a date | `GET /rest/api/3/search/jql` with `--data-urlencode 'jql=...' --data-urlencode 'fields=summary'` | `.issues[].key` |
| Worklogs of an issue | `GET /rest/api/3/issue/KEY/worklog` | `.worklogs[] \| {author.accountId, started, timeSpentSeconds}` |
| Create a worklog | `POST /rest/api/3/issue/KEY/worklog?notifyUsers=false` | the new worklog's `id` |

Create body, built with `jq -n --arg t "$comment"`:

```
{started:"2026-10-16T12:00:00.000+0200", timeSpentSeconds:10800,
 comment:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:$t}]}]}}
```

The `started` offset is the Europe/Madrid offset of that date (+0200 summer, +0100 winter): `TZ=Europe/Madrid date -j -f '%Y-%m-%d %H:%M' '<date> 09:00' +%z`.

## Gaps ("bloques sin imputar")

1. Find the issues: JQL `worklogAuthor = currentUser() AND worklogDate = "<YYYY-MM-DD>"`.
2. Fetch each issue's worklogs; keep those whose author `accountId` is the current user and whose `started` falls on that date.
3. Subtract them and that day's lunch block from the workday.
4. Present a table: Franja | Duración | Tarea (`KEY · summary`, "Sin imputar" or "Comida") | Comentario when relevant. A last row "Total" gives the logged hours, without lunch.

Done when every hour of the workday appears in exactly one row.

## Candidate issues ("qué tareas tenemos")

Parent issues only (no subtasks) on the CLI's default project (`project.key` in `~/.config/.jira/.config.yml`), assigned to the current user, not done:

```bash
jira issue list -q 'project = PROJ AND assignee = currentUser() AND issuetype not in subTaskIssueTypes() AND statusCategory != Done' --order-by status --plain --columns key,type,status,summary --no-truncate
```

Table: Clave | Estado | Resumen.

Subtasks only on request: when the user names a subtask or asks to see subtasks, list them with the same query with `issuetype in subTaskIssueTypes()` instead of `issuetype not in subTaskIssueTypes()`, and log on the subtask they pick. `--columns` accepts only TYPE, KEY, SUMMARY, STATUS, ASSIGNEE, REPORTER, PRIORITY, RESOLUTION, CREATED, UPDATED, LABELS: it has no `parent` column (it is silently dropped), so the parent key is not shown.

## Logging

1. Show a table of the worklogs about to be created: Franja, ticket, comentario.
2. Wait for the user's explicit go-ahead before any POST.
3. When the user describes the work done in a block, that description is the worklog comment (ADF).
4. After posting, re-read the day's worklogs and show the updated day table.

Done when the re-read shows every created worklog with the agreed start and duration.
