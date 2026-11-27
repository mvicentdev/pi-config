#!/usr/bin/env python3
"""Grade how the agents followed the rules of this repository in recent pi sessions.

It grades adherence to the rule documents, never the quality of the code.

Usage:
  grade.py --report --out FILE [--sessions DIR] [--days N | --since YYYY-MM-DD] [--answers FILE ...]
           [--rules-repo DIR] [--exclude SESSION ...]
      Grades every main session in the period that launched a subagent and writes the report to FILE.
      FILE must lie outside this repository. Each --answers file holds a reviewer's judged answers.
  grade.py --judge SESSION [--sessions DIR]
      Prints the assignment for a read-only reviewer who answers the judge questions of one session.
      SESSION is a session file, a session id or the start of one.
  grade.py --session FILE [--sessions DIR]
      Prints the JSON grade of one session file.

Rubric: rubric.json beside this file lists every rule line of AGENTS.md, docs/WORKFLOW.md and
docs/ORCHESTRATION.md with one tag: hook, script, judge or unmeasured.
"""
import argparse
import datetime
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RUBRIC = os.path.join(HERE, "rubric.json")
DEFAULT_SESSIONS = os.path.expanduser("~/.pi/agent/sessions")
RULE_DOCS = ("AGENTS.md", "docs/WORKFLOW.md", "docs/ORCHESTRATION.md")
TAGS = ("hook", "script", "judge", "unmeasured")
# The rules this script answers, with how it answers each. Exact reads a field. Heuristic matches patterns.
SCRIPT_RULES = {"A14": "heuristic", "A15": "heuristic", "W1": "heuristic", "W14": "heuristic", "W27": "heuristic",
                "W28": "heuristic", "O7": "exact", "O9": "heuristic", "O19": "heuristic"}
MIN_SESSIONS = 20      # below this, a rules version names no retirement candidate
RELATION = 0.3         # |Pearson r| from which a rule's answers count as related to an outcome measure
QUOTE_WORDS = 20
ANSWERS = ("yes", "no", "n.a.")
MEASURES = (("corrections", "Corrections the user asked for", False),
            ("cost_main", "Main loop cost", True),
            ("cost_sub", "Subagent cost", True),
            ("failed", "Failed or stopped subagents", False))


# ---------------------------------------------------------------- rubric

def norm(text):
    return " ".join(text.split())


def rule_lines(text):
    """Each rule line of a document: a list item at the left margin, joined with its indented continuation."""
    out, cur, fence = [], None, False
    for line in text.splitlines():
        if line.startswith("```"):
            fence, cur = not fence, None
            continue
        if fence:
            continue
        if line.startswith("- "):
            cur = [line[2:]]
            out.append(cur)
        elif cur is not None and line.startswith("  ") and line.strip():
            cur.append(line)
        else:
            cur = None
    return [norm(" ".join(x)) for x in out]


def load_rubric(path=RUBRIC):
    with open(path) as fh:
        return json.load(fh)


def coverage(repo, entries):
    """Rule lines with no rubric entry, as (doc, text), and rubric entries with no rule line."""
    have = {(e["doc"], norm(e["text"])) for e in entries}
    found, missing = set(), []
    for doc in RULE_DOCS:
        with open(os.path.join(repo, doc)) as fh:
            for text in rule_lines(fh.read()):
                found.add((doc, text))
                if (doc, text) not in have:
                    missing.append((doc, text))
    orphans = [e for e in entries if (e["doc"], norm(e["text"])) not in found]
    return missing, orphans


# ---------------------------------------------------------------- session files

def load(path):
    out = []
    with open(path, errors="replace") as fh:
        for line in fh:
            if line.strip():
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def header(path):
    try:
        with open(path, errors="replace") as fh:
            h = json.loads(fh.readline())
        return h if isinstance(h, dict) and h.get("type") == "session" else None
    except (OSError, ValueError):
        return None


def session_files(root):
    for folder in sorted(os.listdir(root)):
        d = os.path.join(root, folder)
        if os.path.isdir(d):
            for name in sorted(os.listdir(d)):
                if name.endswith(".jsonl"):
                    yield os.path.join(d, name)


SUBAGENT_NAME = re.compile(r"^[\w-]+#\S+$")


def child_index(root):
    """Subagent session files by the file name of their parent session.

    A subagent's session has parentSession in its header and a session_info entry named type#id near the top.
    A /fork or /clone also has parentSession but no such name, so it is left out.
    """
    index = {}
    for p in session_files(root):
        h = header(p)
        if not h or not h.get("parentSession"):
            continue
        named = False
        with open(p, errors="replace") as fh:
            fh.readline()
            for _, line in zip(range(10), fh):
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("type") == "session_info" and SUBAGENT_NAME.match(str(e.get("name") or "")):
                    named = True
                    break
        if named:
            index.setdefault(os.path.basename(h["parentSession"]), []).append(p)
    return index


def entry_cost(e):
    if e.get("type") == "message":
        m = e.get("message") or {}
        if m.get("role") != "assistant":
            return 0.0
        u = m.get("usage") or {}
    elif e.get("type") in ("compaction", "branch_summary", "usage"):
        u = e.get("usage") or {}
    else:
        return 0.0
    c = u.get("cost") if isinstance(u, dict) else None
    t = c.get("total") if isinstance(c, dict) else None
    return float(t) if isinstance(t, (int, float)) else 0.0


def cost_of(entries):
    return sum(entry_cost(e) for e in entries)


def subagent_cost(path, children, seen=None):
    seen = seen if seen is not None else set()
    total = 0.0
    for c in children.get(os.path.basename(path), []):
        if c in seen:
            continue
        seen.add(c)
        total += cost_of(load(c)) + subagent_cost(c, children, seen)
    return total


# ---------------------------------------------------------------- timeline

AUTOMATED_USER = re.compile(r"^\s*──── From: |^\s*<task-notification>")


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text")


def short_id(e):
    return (e.get("id") or "")[:8]


def timeline(entries):
    """Events of the main session in file order: call, result, report, status, user."""
    ev, calls, agent_type = [], {}, {}
    for e in entries:
        t, eid = e.get("type"), short_id(e)
        if t == "custom_message" and e.get("customType") == "subagent-notification":
            c = text_of(e.get("content"))
            for block in re.findall(r"<task-notification>(.*?)</task-notification>", c, re.S) or [c]:
                tid = re.search(r"<task-id>(.*?)</task-id>", block)
                st = re.search(r"<status>(.*?)</status>", block)
                aid = tid.group(1) if tid else ""
                ev.append(dict(kind="report", src="notify", id=eid, type=agent_type.get(aid), agent=aid,
                               status=st.group(1) if st else ""))
            d = e.get("details") if isinstance(e.get("details"), dict) else {}
            ev.append(dict(kind="status", id=eid, status=d.get("status"), agent=d.get("id")))
            continue
        if t == "custom" and e.get("customType") == "subagents:record":
            d = e.get("data") or {}
            ev.append(dict(kind="status", id=eid, status=d.get("status"), agent=d.get("id")))
            continue
        if t != "message":
            continue
        m = e.get("message") or {}
        role = m.get("role")
        if role == "assistant":
            for b in m.get("content") or []:
                if not isinstance(b, dict) or b.get("type") != "toolCall":
                    continue
                a = b.get("arguments") if isinstance(b.get("arguments"), dict) else {}
                typ = None
                if b.get("name") == "Agent":
                    typ = a.get("subagent_type")
                    if a.get("resume"):
                        typ = agent_type.get(a["resume"], typ)
                rec = dict(kind="call", id=eid, name=b.get("name"), args=a, type=typ)
                calls[b.get("id")] = rec
                ev.append(rec)
        elif role == "toolResult":
            txt = text_of(m.get("content"))
            call = calls.get(m.get("toolCallId"), {})
            d = m.get("details") if isinstance(m.get("details"), dict) else {}
            r = dict(kind="result", id=eid, name=m.get("toolName"), error=bool(m.get("isError")), text=txt, details=d)
            call["result"] = r
            ev.append(r)
            if m.get("toolName") == "Agent":
                if d.get("agentId") and (d.get("subagentType") or call.get("type")):
                    agent_type[d["agentId"]] = d.get("subagentType") or call.get("type")
                mm = re.search(r"Agent ID: (\S+)\s*\|?\s*Type: (\w+)", txt)
                if mm:
                    agent_type[mm.group(1)] = mm.group(2)
                    call["agent"] = mm.group(1)
                else:
                    call["agent"] = d.get("agentId")
                    ev.append(dict(kind="report", src="sync", id=eid, type=call.get("type"), agent=d.get("agentId"),
                                   status="error" if m.get("isError") else (d.get("status") or "")))
        elif role == "user":
            txt = text_of(m.get("content"))
            ev.append(dict(kind="user", id=eid, text=txt, automated=bool(AUTOMATED_USER.search(txt))))
    return ev


def agent_failed(call):
    r = call.get("result")
    return bool(r) and (r["error"] or r["text"].startswith(("Agent not found", "Validation failed")))


# ---------------------------------------------------------------- script questions

LOOKUP_TOOLS = {"read", "grep", "find", "ls"}
READONLY_CMDS = {
    "cat", "head", "tail", "ls", "grep", "rg", "egrep", "fgrep", "find", "fd", "wc", "awk", "jq", "yq", "stat",
    "file", "tree", "pwd", "which", "type", "echo", "printf", "sort", "uniq", "cut", "tr", "nl", "diff", "cmp",
    "basename", "dirname", "realpath", "readlink", "test", "[", "true", "date", "du", "df", "ps", "pgrep", "lsof",
    "column", "less", "more", "od", "xxd", "hexdump", "shasum", "md5", "comm", "paste", "fold", "strings", "env",
    "sed", "perl", "cd", "command", "time", "xargs", "seq", "sleep",
}
READONLY_GIT = {"status", "log", "diff", "show", "grep", "ls-files", "branch", "rev-parse", "blame", "ls-remote",
                "remote", "merge-base", "describe", "cat-file", "rev-list", "shortlog", "ls-tree", "reflog", "worktree"}
SHELL_WORDS = {"do", "done", "then", "fi", "else", "elif", "if", "for", "while", "until", "in", "{", "}", "(", ")", "!"}
WORKTREE_CREATE = re.compile(r"worktree\.sh new|git worktree add|\bwt switch (?:-c|--create)|orca worktree create")
PROMPT_WORKTREE_CREATE = re.compile(
    r"\b(?:create|crea)\b[^.\n]{0,40}\bworktree\b|git worktree add|wt switch (?:-c|--create)", re.I)
CRITERIA = re.compile(r"criteri|acceptance|done when|hecho cuando|terminado cuando|\bAC\d", re.I)
DIFF_REVIEW = re.compile(
    r"\b(?:review|re-?review|re-?check|revis[ae]|revisi[oó]n|audit[ae]?|auditor|verif(?:y|ica))\b[^.\n]{0,120}?"
    r"\b(?:diff|change|commit|branch|rama|cambio|fix|worktree|MR|merge request)\b"
    r"|\bgit (?:-C \S+ )?(?:diff|show)\b|\buncommitted\b", re.I)
DIFF_BASE = re.compile(
    r"merge-base|(?<!\w)base(?! de datos)(?! of knowledge)\b|\.\.\.?(?:HEAD|origin|develop|main|[0-9a-f]{6})"
    r"|git (?:-C \S+ )?diff [^\n`]*\b(?:develop|main|master|HEAD|origin/\S+|[0-9a-f]{7,40})\b"
    r"|against (?:the )?(?:parent|origin/)?(?:develop|main)|contra (?:origin/)?(?:develop|main)"
    r"|frente a (?:origin/)?(?:develop|main)|\bcommit `?[0-9a-f]{7,40}|\buncommitted\b|working tree|sin commit"
    r"|\bgit (?:-C \S+ )?show [^\n`]*\b(?:HEAD|[0-9a-f]{7,40})\b", re.I)
CORRECTION_WORD = re.compile(r"\b(?:correct\w*|correcci[oó]n\w*|corrig\w+|corrij\w+|fix(?:es)?|arregl\w+)\b", re.I)
TMP_MD = re.compile(r"^/(?:private/)?tmp/[^/\s]+/[^\s]*\.md$")
TMP_MD_IN_TEXT = re.compile(r"/tmp/[^/\s`'\"]+/[^\s`'\"]*\.md")
NOTES_NAME = re.compile(r"(?:notes|notas|plan|handoff)\.md$", re.I)
REDIRECT_TMP = re.compile(r"(?:cat|tee|printf|echo)[^|;&\n]*?>>?\s*['\"]?(/tmp/[^/\s'\"]+/[^\s'\"]*\.md)")


def strip_heredocs(cmd):
    return re.sub(r"<<-?\s*['\"]?(\w+)['\"]?.*?^\s*\1\s*$", " ", cmd, flags=re.S | re.M)


def bash_is_lookup(cmd):
    """Heuristic: every segment starts with a read-only command and nothing is written to a file."""
    if re.search(r"(?<![0-9&])>(?!&|\s*/dev/null)", re.sub(r"2>&1|&>/dev/null|>/dev/null|2>/dev/null", "", cmd)):
        return False
    if re.search(r"\bsed -i|\bperl -[a-z]*i", cmd):
        return False
    for seg in (s.strip() for s in re.split(r"&&|\|\||;|\||\n", strip_heredocs(cmd))):
        words = seg.split()
        while words and (words[0] in SHELL_WORDS or re.match(r"^\w+=", words[0])):
            words = words[1:]
        if not words:
            continue
        w = os.path.basename(words[0].strip("\"'"))
        if w == "git":
            rest = words[1:]
            if "-C" in rest:
                i = rest.index("-C")
                rest = rest[:i] + rest[i + 2:]
            sub = next((x for x in rest if not x.startswith("-")), "")
            if sub not in READONLY_GIT:
                return False
            if sub == "branch" and any(x in words for x in ("-D", "-d", "-m", "-M", "--delete")):
                return False
            if sub == "worktree" and "list" not in words:
                return False
        elif w not in READONLY_CMDS:
            return False
    return True


def ans(answer, entries=(), note=""):
    seen = []
    for x in entries:
        if x and x not in seen:
            seen.append(x)
    return dict(answer=answer, entries=seen[:5], method="script", note=note)


def script_answers(ev):
    calls = [x for x in ev if x["kind"] == "call"]
    agents = [x for x in calls if x["name"] == "Agent"]
    new_agents = [x for x in agents if not x["args"].get("resume")]
    workers = [x for x in agents if x["type"] == "worker"]
    new_workers = [x for x in workers if not x["args"].get("resume")]
    pos = {id(x): i for i, x in enumerate(ev)}
    first_worker_report = next((x for x in ev if x["kind"] == "report" and x.get("type") == "worker"), None)
    out = {}

    # O19: the longest run of lookups, reset by any other call or a user message.
    streak, worst, worst_start, start = 0, 0, None, None
    for x in ev:
        if x["kind"] == "user" and not x["automated"]:
            streak = 0
        elif x["kind"] == "call":
            if x["name"] in LOOKUP_TOOLS or (x["name"] == "bash" and bash_is_lookup(x["args"].get("command", "") or "")):
                if streak == 0:
                    start = x["id"]
                streak += 1
                if streak > worst:
                    worst, worst_start = streak, start
            else:
                streak = 0
    out["O19"] = ans("no" if worst > 5 else "yes", [worst_start] if worst > 5 else [], f"longest run: {worst}")

    # O7: no model and no thinking argument on any launch.
    if not agents:
        out["O7"] = ans("n.a.")
    else:
        bad = [x["id"] for x in agents if x["args"].get("model") or x["args"].get("thinking")]
        out["O7"] = ans("no" if bad else "yes", bad)

    # O9: the main loop created each worktree, never isolation: worktree.
    iso = [x["id"] for x in agents if x["args"].get("isolation") == "worktree"]
    by_prompt = [x["id"] for x in new_agents if PROMPT_WORKTREE_CREATE.search(x["args"].get("prompt", "") or "")]
    created = [x["id"] for x in calls if x["name"] == "bash"
               and WORKTREE_CREATE.search(x["args"].get("command", "") or "")]
    if iso or by_prompt:
        out["O9"] = ans("no", iso + by_prompt)
    elif created:
        out["O9"] = ans("yes", created)
    else:
        out["O9"] = ans("n.a.")

    # A14 and A15: the rule document read before the first action it governs.
    def first_touch(name, verbs):
        for x in calls:
            a = x["args"]
            if x["name"] in verbs and os.path.basename(a.get("path", "") or "") == name:
                return x
            if x["name"] == "bash":
                cmd = a.get("command", "") or ""
                if "read" in verbs and re.search(r"\b(?:cat|head|tail|nl|less|awk|sed -n)\b[^|;&\n>]*" + re.escape(name), cmd):
                    return x
                if "write" in verbs and re.search(r">>?\s*\S*" + re.escape(name), cmd):
                    return x
        return None
    for rid, name, action in (("A14", "WORKFLOW.md", new_workers[0] if new_workers else None),
                              ("A15", "ORCHESTRATION.md", agents[0] if agents else None)):
        if action is None:
            out[rid] = ans("n.a.")
            continue
        wrote = first_touch(name, ("write", "edit"))
        if wrote is not None and pos[id(wrote)] < pos[id(action)]:
            out[rid] = ans("n.a.", [wrote["id"]], "the session wrote the document before the action")
            continue
        read = first_touch(name, ("read",))
        ok = read is not None and pos[id(read)] < pos[id(action)]
        out[rid] = ans("yes" if ok else "no", [read["id"], action["id"]] if ok else [action["id"]])

    # W1: a notes file under /tmp/<work>/.
    if not workers:
        out["W1"] = ans("n.a.")
    else:
        found = []
        for x in calls:
            a = x["args"]
            p = a.get("path", "") or ""
            if x["name"] in ("write", "edit") and TMP_MD.match(p):
                found.append(x["id"])
            elif x["name"] == "read" and TMP_MD.match(p) and NOTES_NAME.search(p):
                found.append(x["id"])
            elif x["name"] == "bash" and REDIRECT_TMP.search(a.get("command", "") or ""):
                found.append(x["id"])
        out["W1"] = ans("yes" if found else "no", found or [workers[0]["id"]])

    # W14: each new worker prompt names a notes file and the criteria.
    if not new_workers:
        out["W14"] = ans("n.a.")
    else:
        bad = [x["id"] for x in new_workers
               if not (TMP_MD_IN_TEXT.search(x["args"].get("prompt", "") or "")
                       and CRITERIA.search(x["args"].get("prompt", "") or ""))]
        out["W14"] = ans("no" if bad else "yes", bad)

    # W27: a verifier after a worker report is asked to review the diff against its base, criterion by criterion.
    # W28: each such review prompt carries the base of the diff.
    reviews = []
    if first_worker_report is not None:
        reviews = [x for x in agents if x["type"] == "verifier" and pos[id(x)] > pos[id(first_worker_report)]
                   and DIFF_REVIEW.search(x["args"].get("prompt", "") or "")]
    if not workers:
        out["W27"] = ans("n.a.")
    else:
        def per_criterion(x):
            p = x["args"].get("prompt", "") or ""
            return bool(DIFF_BASE.search(p) and CRITERIA.search(p))
        if not reviews:
            out["W27"] = ans("no", [w["id"] for w in workers], "no verifier reviewed a change after a worker report")
        elif all(per_criterion(x) for x in reviews):
            out["W27"] = ans("yes", [r["id"] for r in reviews])
        else:
            out["W27"] = ans("no", [x["id"] for x in reviews if not per_criterion(x)],
                             "the review prompt lacks the base of the diff or the criteria")
    if not reviews:
        out["W28"] = ans("n.a.")
    else:
        bad = [x["id"] for x in reviews if not DIFF_BASE.search(x["args"].get("prompt", "") or "")]
        out["W28"] = ans("no" if bad else "yes", bad)
    return out


# ---------------------------------------------------------------- outcome measures

def measures(ev, path, children, entries):
    # Corrections the user asked for: a user message after a worker report. Before the next user message, a resume
    # of a worker that already reported follows it, or a new worker launch described as a correction.
    reported, pending, corrections = set(), None, 0
    for x in ev:
        if x["kind"] == "report" and x.get("type") == "worker":
            reported.add(x.get("agent"))
        elif x["kind"] == "user" and not x["automated"]:
            pending = x if reported else None
        elif pending and x["kind"] == "call" and x["name"] == "Agent" and x["type"] == "worker":
            res = x["args"].get("resume")
            if (res and res in reported) or (not res and CORRECTION_WORD.search(x["args"].get("description", "") or "")):
                corrections += 1
                pending = None
    failed = [x["id"] for x in ev if x["kind"] == "call" and x["name"] == "Agent" and agent_failed(x)]
    stopped = {}
    for x in ev:
        if x["kind"] == "result" and x["name"] == "Agent" and x["details"].get("status") in ("stopped", "error", "aborted"):
            stopped.setdefault(x["details"].get("agentId") or x["id"], x["id"])
        if x["kind"] == "status" and x.get("status") in ("stopped", "error", "aborted"):
            stopped.setdefault(x.get("agent") or x["id"], x["id"])
    return dict(corrections=corrections, cost_main=round(cost_of(entries), 4),
                cost_sub=round(subagent_cost(path, children), 4), failed=len(failed) + len(stopped))


def iso_week(start):
    d = parse_ts(start).date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def grade_session(path, children):
    entries = load(path)
    h = entries[0] if entries and entries[0].get("type") == "session" else {}
    ev = timeline(entries)
    start = h.get("timestamp") or ""
    return dict(session=h.get("id") or os.path.basename(path), path=path,
                project=os.path.basename(os.path.dirname(os.path.abspath(path))), start=start,
                week=iso_week(start) if start else "-", rules=None,
                answers=script_answers(ev), measures=measures(ev, path, children, entries))


# ---------------------------------------------------------------- rules version

def parse_ts(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(datetime.timezone.utc)


def rules_commits(repo):
    """Commits that touched AGENTS.md or docs/, oldest first, as (UTC datetime, short hash)."""
    try:
        txt = subprocess.run(["git", "-C", repo, "log", "--format=%h %cI", "--", "AGENTS.md", "docs/"],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return []
    rows = [(parse_ts(d), h) for h, d in (line.split() for line in txt.splitlines() if line.strip())]
    return sorted(rows)


def rules_version(start, versions):
    best = None
    if start:
        t = parse_ts(start)
        for d, h in versions:
            if d <= t:
                best = h
    return best


# ---------------------------------------------------------------- sessions in scope

def has_agent_call(entries):
    return any(e.get("type") == "message" and (e.get("message") or {}).get("role") == "assistant"
               and any(isinstance(b, dict) and b.get("type") == "toolCall" and b.get("name") == "Agent"
                       for b in (e["message"].get("content") or []))
               for e in entries)


def scope(root, cutoff, exclude=()):
    """Main sessions started at or after cutoff that launched a subagent, and counts of what was left out."""
    paths, skipped = [], dict(old=0, subagent_or_fork=0, no_subagent=0, excluded=0, unreadable=0)
    for p in session_files(root):
        h = header(p)
        if not h:
            skipped["unreadable"] += 1
            continue
        try:
            start = parse_ts(h.get("timestamp") or "")
        except ValueError:
            skipped["unreadable"] += 1
            continue
        if start < cutoff:
            skipped["old"] += 1
        elif h.get("parentSession"):
            skipped["subagent_or_fork"] += 1
        elif any(str(h.get("id", "")).startswith(x) for x in exclude):
            skipped["excluded"] += 1
        else:
            with open(p, errors="replace") as fh:
                raw = fh.read()
            if not re.search(r'"name":\s*"Agent"', raw) or not has_agent_call(load(p)):
                skipped["no_subagent"] += 1
            else:
                paths.append(p)
    return paths, skipped


def find_session(root, ref):
    if os.path.isfile(ref):
        return ref
    hits = [p for p in session_files(root) if (header(p) or {}).get("id", "").startswith(ref)]
    if len(hits) != 1:
        raise ValueError(f"{len(hits)} session files match {ref!r} under {root}")
    return hits[0]


# ---------------------------------------------------------------- judge questions

def judge_assignment(path, rubric, children):
    h = header(path) or {}
    sid = h.get("id", os.path.basename(path))
    kids = children.get(os.path.basename(path), [])
    lines = [f"# Judge assignment: session {sid}", "",
             "You are a read-only reviewer. Change no file. Read the session file below and answer each question.",
             "Grade how the agents followed their rules, never the quality of the code they wrote.", "",
             f"Session file: {path}"]
    if kids:
        lines.append("Subagent session files, whose header names the session file as parentSession:")
        lines += [f"- {k}" for k in kids]
    lines += ["", "## How to read the session", "",
              "- The file is JSON Lines. The first line is the header. Each other line is one entry with an `id`.",
              "- An entry with `type: \"message\"` holds `message.role`. The role `user` is the user, `assistant` is "
              "the main loop and `toolResult` is the output of a tool call.",
              "- An assistant message lists its tool calls as content blocks with `type: \"toolCall\"`, a `name` and "
              "`arguments`. A result points back to its call with `toolCallId`.",
              "- An `Agent` call launches a subagent. Its report is the `toolResult` of the call, or a `custom_message` "
              "with `customType: \"subagent-notification\"`.",
              "- A user message that starts with `──── From: ` or `<task-notification>` comes from a tool, not the user.",
              "- Search the file with grep or jq for the entries a question needs, then read them in order.", "",
              "## Questions", "",
              "Answer n.a. when the question does not apply to this session."]
    for e in rubric:
        if e["tag"] != "judge":
            continue
        lines += ["", f"{e['id']}: {e['question']}", f"  Applies when: {e.get('applies', 'always')}.",
                  f"  Rule ({e['doc']}): {e['text']}"]
    lines += ["", "## Answer form", "",
              "Return only this JSON, with one object per question above:", "",
              json.dumps(dict(session=sid, answers=[dict(id="A1", answer="yes | no | n.a.", entries=["<entry id>"],
                                                         quote="<one quote of at most 20 words>")])),
              "",
              "- `answer` is yes, no or n.a.",
              "- `entries` lists the ids of the entries that prove the answer. An n.a. may leave it empty.",
              f"- `quote` copies at most {QUOTE_WORDS} words from one of those entries. An n.a. may leave it empty.",
              "- Stop and report any fact that breaks this assignment, such as an unreadable or truncated file.", ""]
    return "\n".join(lines)


def load_answers(paths, rubric):
    """Judged answers by session id prefix. Raises ValueError on an answer that breaks the form."""
    judge = {e["id"] for e in rubric if e["tag"] == "judge"}
    out = {}
    for p in paths:
        with open(p) as fh:
            data = json.load(fh)
        for doc in data if isinstance(data, list) else [data]:
            sid = str(doc.get("session") or "")
            if len(sid) < 8:
                raise ValueError(f"{p}: the session id must hold at least 8 characters")
            for a in doc.get("answers") or []:
                rid = a.get("id")
                if rid not in judge:
                    raise ValueError(f"{p}: {rid} is not a judge question")
                if a.get("answer") not in ANSWERS:
                    raise ValueError(f"{p}: {rid} answer must be yes, no or n.a.")
                quote = str(a.get("quote") or "")
                if len(quote.split()) > QUOTE_WORDS:
                    raise ValueError(f"{p}: {rid} quote holds more than {QUOTE_WORDS} words")
                entries = a.get("entries") or []
                if not isinstance(entries, list):
                    raise ValueError(f"{p}: {rid} entries must be a list")
                out.setdefault(sid, {})[rid] = dict(answer=a["answer"], entries=[str(x) for x in entries][:5],
                                                    method="judged", note=quote)
    return out


def merge_answers(results, judged):
    merged, used = 0, set()
    for r in results:
        for sid, answers in judged.items():
            if r["session"].startswith(sid):
                used.add(sid)
                for rid, a in answers.items():
                    r["answers"][rid] = a
                    merged += 1
    return merged, sorted(set(judged) - used)


# ---------------------------------------------------------------- report

def money(v):
    return f"${v:.2f}"


def mean(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def measure_row(label, rs):
    cells = [label, str(len(rs))]
    for key, _, is_money in MEASURES:
        m = mean([r["measures"][key] for r in rs])
        cells.append("-" if m is None else money(m) if is_money else f"{m:.2f}")
    return "| " + " | ".join(cells) + " |"


def tally(rs, rid):
    cnt = {k: 0 for k in ANSWERS}
    for r in rs:
        a = r["answers"].get(rid)
        if a:
            cnt[a["answer"]] += 1
    graded = cnt["yes"] + cnt["no"]
    return cnt, (cnt["yes"] / graded if graded else None)


def pct(rate):
    return "-" if rate is None else f"{rate:.0%}"


def examples(rs, rid):
    ex = []
    for r in sorted(rs, key=lambda r: r["start"], reverse=True):
        a = r["answers"].get(rid)
        if a and a["answer"] == "no" and len(ex) < 3:
            cited = f"`{a['entries'][0]}`" if a["entries"] else "no entry"
            ex.append(f"`{r['session']}` {cited}")
    return ex


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs)
    sy = sum((y - my) ** 2 for y in ys)
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sx * sy)


def relations(rs, rid):
    """Pearson r between the rule's yes (1) or no (0) and each outcome measure, over the sessions it applies to."""
    graded = [r for r in rs if r["answers"].get(rid, {}).get("answer") in ("yes", "no")]
    xs = [1.0 if r["answers"][rid]["answer"] == "yes" else 0.0 for r in graded]
    return {key: pearson(xs, [float(r["measures"][key]) for r in graded]) for key, _, _ in MEASURES}


def rule_table(rs, entries, source):
    lines = ["| Id | Question | Yes | No | n.a. | Pass rate | " + ("Check" if source == "script" else "Source") + " |",
             "|---|---|---|---|---|---|---|"]
    notes = []
    for e in entries:
        cnt, rate = tally(rs, e["id"])
        tag = SCRIPT_RULES.get(e["id"], "-") if source == "script" else "judged"
        lines.append(f"| {e['id']} | {e['question']} | {cnt['yes']} | {cnt['no']} | {cnt['n.a.']} | {pct(rate)} | {tag} |")
        ex = examples(rs, e["id"])
        if ex:
            notes.append(f"- **{e['id']}**: " + ", ".join(ex) + ".")
    if notes:
        lines += ["", "Up to three examples of each \"no\", newest first, as session id and entry id:", ""] + notes
    return lines


def build_report(results, rubric, scope_lines):
    by_id = {e["id"]: e for e in rubric}
    lines = ["# Flow grade report", "",
             "It grades how the agents followed the rule documents, never the quality of the code.", ""]
    lines += scope_lines + ["", "## Outcome measures", "",
                            "Each cell is the mean per session. The rules version of a session is the last commit before its",
                            "start that touched `AGENTS.md` or `docs/`. Weeks are ISO weeks of the session start in UTC.",
                            "Corrections the user asked for is a heuristic without a hand check. It counts a user message",
                            "after a worker report that a resume of that worker follows, or a new worker named a correction.",
                            "Subagent cost sums the subagent session files, found by the `parentSession` of their header.", ""]
    head = "| {} | Sessions | " + " | ".join(label for _, label, _ in MEASURES) + " |"
    sep = "|---|---|" + "---|" * len(MEASURES)
    order = []
    for r in sorted(results, key=lambda r: r["start"]):
        if r["rules"] not in order:
            order.append(r["rules"])
    lines += ["### Per rules version", "", head.format("Rules version"), sep]
    for v in order:
        lines.append(measure_row(f"`{v}`" if v else "none", [r for r in results if r["rules"] == v]))
    lines += ["", "### Per week", "", head.format("Week"), sep]
    for w in sorted({r["week"] for r in results}):
        lines.append(measure_row(w, [r for r in results if r["week"] == w]))
    lines.append(measure_row("All sessions", results))

    lines += ["", "## Script rules", "",
              "Pass rate is yes over yes plus no. A heuristic check reads patterns in the session, an exact one reads a field.",
              ""]
    lines += rule_table(results, [by_id[i] for i in by_id if i in SCRIPT_RULES], "script")

    judge = [e for e in rubric if e["tag"] == "judge"]
    answered = [e for e in judge if any(r["answers"].get(e["id"], {}).get("method") == "judged" for r in results)]
    lines += ["", "## Judged rules", "",
              f"A read-only reviewer answers these from `--judge`. {len(answered)} of {len(judge)} judge rules have answers.",
              ""]
    if answered:
        lines += rule_table(results, answered, "judged")
    else:
        lines.append("No judged answers were merged.")

    graded_rules = [e for e in rubric if e["tag"] in ("script", "judge")]
    lines += ["", "## Retirement candidates", "",
              "A rule is a candidate to delete when its answers show no relation to any outcome measure.",
              f"That is |r| under {RELATION} for every measure that varies.",
              "A rule always followed or always broken has no variation, so its effect is unknown. It is listed apart.",
              "A rule that a hook could impose is listed when it is broken in more than half of the sessions it applies to.",
              f"A rules version with fewer than {MIN_SESSIONS} sessions names none.", ""]
    for v in reversed(order):
        rs = [r for r in results if r["rules"] == v]
        lines += [f"### Rules version `{v or 'none'}` ({len(rs)} session{'' if len(rs) == 1 else 's'})", ""]
        if len(rs) < MIN_SESSIONS:
            lines += [f"The sample is too small: {len(rs)} sessions, {MIN_SESSIONS} needed. No candidate is named.", ""]
            continue
        no_effect, constant, hookable = [], [], []
        for e in graded_rules:
            cnt, rate = tally(rs, e["id"])
            if rate is None:
                continue
            rel = relations(rs, e["id"])
            if rate in (0.0, 1.0):
                constant.append(f"- {e['id']} ({pct(rate)} of {cnt['yes'] + cnt['no']}): {e['question']}")
            elif all(x is None or abs(x) < RELATION for x in rel.values()):
                shown = ", ".join(f"{k} {'-' if x is None else f'{x:+.2f}'}" for k, x in rel.items())
                no_effect.append(f"- {e['id']} ({pct(rate)} of {cnt['yes'] + cnt['no']}): {e['question']} r: {shown}.")
            if e.get("hookable") and cnt["no"] * 2 > cnt["yes"] + cnt["no"]:
                hookable.append(f"- {e['id']} (broken in {cnt['no']} of {cnt['yes'] + cnt['no']}): {e['question']}")
        lines += ["No relation to any outcome measure, candidates to delete:", ""] + (no_effect or ["- none"])
        lines += ["", "No variation, effect unknown:", ""] + (constant or ["- none"])
        lines += ["", "Broken in more than half of the sessions it applies to, a hook could impose it:", ""]
        lines += (hookable or ["- none"]) + [""]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- command line

def inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report", action="store_true")
    mode.add_argument("--judge", metavar="SESSION")
    mode.add_argument("--session", metavar="FILE")
    ap.add_argument("--sessions", default=DEFAULT_SESSIONS)
    ap.add_argument("--out")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--since")
    ap.add_argument("--answers", action="append", default=[])
    ap.add_argument("--rules-repo", default=REPO)
    ap.add_argument("--exclude", action="append", default=[])
    args = ap.parse_args(argv)
    rubric = load_rubric()
    children = child_index(args.sessions)

    if args.session:
        print(json.dumps(grade_session(args.session, children), indent=1, ensure_ascii=False))
        return 0
    if args.judge:
        try:
            path = find_session(args.sessions, args.judge)
        except ValueError as err:
            print(err, file=sys.stderr)
            return 2
        print(judge_assignment(path, rubric, children))
        return 0

    if not args.out:
        print("--report needs --out FILE, outside this repository", file=sys.stderr)
        return 2
    if inside(args.out, REPO):
        print(f"--out must lie outside this repository: {args.out}", file=sys.stderr)
        return 2
    try:
        judged = load_answers(args.answers, rubric)
    except (OSError, ValueError) as err:
        print(err, file=sys.stderr)
        return 2
    if args.since:
        cutoff = parse_ts(args.since + "T00:00:00Z")
    else:
        now = datetime.datetime.now(datetime.timezone.utc)
        cutoff = (now - datetime.timedelta(days=args.days)).replace(hour=0, minute=0, second=0, microsecond=0)
    paths, skipped = scope(args.sessions, cutoff, args.exclude)
    versions = rules_commits(args.rules_repo)
    results = []
    for p in paths:
        r = grade_session(p, children)
        r["rules"] = rules_version(r["start"], versions)
        results.append(r)
    merged, unused = merge_answers(results, judged)
    scope_lines = [f"Scope: main sessions under `{args.sessions}` started on or after {cutoff:%Y-%m-%d} UTC that launched",
                   f"a subagent. Graded: {len(results)}. Left out: {skipped['subagent_or_fork']} subagent or fork sessions,",
                   f"{skipped['no_subagent']} sessions with no subagent, {skipped['excluded']} excluded, "
                   f"{skipped['unreadable']} unreadable.",
                   f"Judged answers merged: {merged}" + (f". Sessions out of scope in the answers: {', '.join(unused)}."
                                                         if unused else ".")]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        fh.write(build_report(results, rubric, scope_lines))
    print(f"graded {len(results)} sessions -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
