"""Tests of the flow grader. Run: python3 -m unittest discover -s evals/flow

They read the fixture sessions beside this file, never the user's real sessions.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FIXTURES = os.path.join(HERE, "fixtures", "sessions")
GRADE = os.path.join(HERE, "grade.py")
SESSION_A = "01aaaaaa-0000-7000-8000-000000000001"
SESSION_B = "01bbbbbb-0000-7000-8000-000000000005"
PATH_A = os.path.join(FIXTURES, "--work-proj--", "2026-11-20T10-00-00-000Z_" + SESSION_A + ".jsonl")

sys.path.insert(0, HERE)
import grade  # noqa: E402


def read(path):
    with open(path) as fh:
        return fh.read()


def put(path, text, mode="w"):
    with open(path, mode) as fh:
        fh.write(text)


def run(*args):
    return subprocess.run([sys.executable, GRADE, *args], capture_output=True, text=True, cwd=REPO)


def report(*extra):
    out = os.path.join(tempfile.mkdtemp(), "report.md")
    p = run("--report", "--sessions", FIXTURES, "--since", "2026-01-01", "--out", out, *extra)
    text = read(out) if os.path.exists(out) else ""
    return p, text


def rubric():
    return {e["id"]: e for e in grade.load_rubric()}


# ---------------------------------------------------------------- 1. Home

class Home(unittest.TestCase):
    def test_npm_test_runs_these_tests(self):
        script = json.loads(read(os.path.join(REPO, "package.json")))["scripts"]["test"]
        self.assertIn("evals/flow", script)

    def test_no_absolute_path_of_one_machine(self):
        src = read(GRADE)
        self.assertIsNone(re.search(r"/Users/|/home/|/opt/", src))
        self.assertEqual(grade.DEFAULT_SESSIONS, os.path.expanduser("~/.pi/agent/sessions"))

    def test_report_reads_the_sessions_directory_option(self):
        p, text = report()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn(SESSION_A, text)

    def test_report_refuses_an_output_inside_the_repository(self):
        out = os.path.join(HERE, "report.md")
        p = run("--report", "--sessions", FIXTURES, "--since", "2026-01-01", "--out", out)
        self.assertEqual(p.returncode, 2)
        self.assertFalse(os.path.exists(out))


# ---------------------------------------------------------------- 2. Rubric as data

class Rubric(unittest.TestCase):
    def test_every_rule_line_has_an_entry_and_every_entry_a_rule(self):
        missing, orphans = grade.coverage(REPO, grade.load_rubric())
        self.assertEqual(missing, [], "rule lines without a rubric entry")
        self.assertEqual(orphans, [], "rubric entries without a rule line")

    def test_coverage_finds_a_new_rule_and_a_removed_rule(self):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "docs"))
        for name, body in (("AGENTS.md", "# A\n\n- Keep one.\n- Add two,\n  over two lines.\n"),
                           ("docs/WORKFLOW.md", "# W\n"), ("docs/ORCHESTRATION.md", "# O\n")):
            put(os.path.join(d, name), body)
        entries = [dict(id="A1", doc="AGENTS.md", text="Keep one.", tag="unmeasured"),
                   dict(id="A2", doc="AGENTS.md", text="Gone.", tag="unmeasured")]
        missing, orphans = grade.coverage(d, entries)
        self.assertEqual(missing, [("AGENTS.md", "Add two, over two lines.")])
        self.assertEqual([e["id"] for e in orphans], ["A2"])

    def test_each_entry_has_its_fields_and_one_known_tag(self):
        ids = set()
        for e in grade.load_rubric():
            self.assertTrue(e["id"] and e["doc"] and e["text"], e)
            self.assertIn(e["tag"], {"hook", "script", "judge", "unmeasured"}, e)
            if e["tag"] in ("script", "judge"):
                self.assertTrue(e.get("question"), e)
            self.assertNotIn(e["id"], ids)
            ids.add(e["id"])

    def test_tags_the_brief_settled(self):
        r = rubric()
        for i in ("W31", "W32", "W21"):
            self.assertEqual(r[i]["tag"], "judge", i)
        # A rule is a hook only when main-loop-guard or review-guard imposes its whole line.
        self.assertEqual({e["id"] for e in grade.load_rubric() if e["tag"] == "hook"}, {"O6", "O14", "W50"})
        # A pattern over free prompt text cannot tell whether criteria are listed, so a reviewer answers these.
        for i in ("W34", "W37", "O1", "O5", "W27", "W14"):
            self.assertEqual(r[i]["tag"], "judge", i)
        for i in ("O7", "O19"):
            self.assertEqual(r[i]["tag"], "script", i)
        self.assertEqual({e["id"] for e in grade.load_rubric() if e["tag"] == "script"}, set(grade.SCRIPT_RULES))

    def test_each_script_method_is_labelled_truthfully(self):
        # Only O7 reads a field. Every other script answer rests on patterns, so it is heuristic.
        self.assertEqual({i for i, m in grade.SCRIPT_RULES.items() if m == "exact"}, {"O7"})
        self.assertEqual(set(grade.SCRIPT_RULES.values()), {"exact", "heuristic"})

    def test_script_questions_measure_their_own_rule_line(self):
        r = rubric()
        self.assertIn("criterion by criterion", r["W27"]["question"])
        self.assertIn("parent branch", r["W27"]["question"])
        self.assertIn("five", r["O19"]["question"])
        self.assertIn("three calls", r["O5"]["question"])


# ---------------------------------------------------------------- 3. Script questions and measures

class Measures(unittest.TestCase):
    def setUp(self):
        self.children = grade.child_index(FIXTURES)
        self.a = grade.grade_session(PATH_A, self.children)

    def test_costs_read_the_child_session_files(self):
        m = self.a["measures"]
        self.assertAlmostEqual(m["cost_main"], 2.0)
        self.assertAlmostEqual(m["cost_sub"], 5.0)   # not 1.0 of details.cost, not the fork's 100

    def test_failed_or_stopped_subagents(self):
        self.assertEqual(self.a["measures"]["failed"], 2)

    def test_corrections_the_user_asked_for(self):
        self.assertEqual(self.a["measures"]["corrections"], 1)

    def test_script_answers_cite_entries(self):
        ans = self.a["answers"]
        self.assertEqual(ans["O7"]["answer"], "no")
        self.assertEqual(ans["O7"]["entries"], ["a0000003"])
        self.assertNotIn("W27", ans)
        self.assertNotIn("W14", ans)
        self.assertEqual(ans["O19"]["answer"], "yes")
        self.assertEqual(ans["W28"]["answer"], "yes")
        self.assertEqual(ans["W1"]["answer"], "yes")
        self.assertEqual(ans["A14"]["answer"], "no")
        self.assertEqual(ans["A15"]["answer"], "yes")
        self.assertEqual(ans["O9"]["answer"], "n.a.")
        self.assertEqual(set(ans), set(grade.SCRIPT_RULES))

    def test_rules_version_is_the_last_commit_before_the_start_that_touched_the_rules(self):
        d = tempfile.mkdtemp()
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t",
                   GIT_COMMITTER_EMAIL="t@t")

        def commit(path, date):
            os.makedirs(os.path.dirname(os.path.join(d, path)) or d, exist_ok=True)
            put(os.path.join(d, path), date + "\n", "a")
            subprocess.run(["git", "-C", d, "add", "-A"], check=True, env=env)
            subprocess.run(["git", "-C", d, "commit", "-qm", date], check=True,
                           env=dict(env, GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date))
            return subprocess.run(["git", "-C", d, "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                                  check=True).stdout.strip()
        subprocess.run(["git", "init", "-q", d], check=True)
        first = commit("AGENTS.md", "2026-11-01T00:00:00Z")
        commit("extensions/x.ts", "2026-11-10T00:00:00Z")
        second = commit("docs/WORKFLOW.md", "2026-11-21T00:00:00Z")
        versions = grade.rules_commits(d)
        self.assertEqual(grade.rules_version("2026-11-20T10:00:00.000Z", versions), first)
        self.assertEqual(grade.rules_version("2026-11-22T10:00:00.000Z", versions), second)

    def test_report_opens_with_measures_per_version_and_week(self):
        p, text = report()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertLess(text.index("## Outcome measures"), text.index("## Script rules"))
        measures = text[text.index("## Outcome measures"):text.index("## Script rules")]
        self.assertIn("| Rules version | Sessions |", measures)
        self.assertIn("| Week | Sessions |", measures)
        self.assertIn("2026-W47", measures)
        self.assertIn("2026-W48", measures)
        self.assertNotIn("01cccccc", text)          # no subagent launch, out of scope

    def test_report_gives_pass_rates_and_examples_of_each_no(self):
        p, text = report()
        rules = text[text.index("## Script rules"):]
        self.assertRegex(rules, r"\| O7 \|[^\n]*\| 1 \| 1 \| 0 \| 50% \|")
        self.assertIn(f"`{SESSION_A}` `a0000003`", rules)
        for rid in grade.SCRIPT_RULES:
            self.assertIn(f"| {rid} |", rules)

    def test_criteria_rules_have_no_script_pass_rate_and_go_to_the_judge(self):
        p, text = report()
        scripted = text[text.index("## Script rules"):text.index("## Judged rules")]
        assignment = run("--judge", SESSION_A, "--sessions", FIXTURES).stdout
        for rid in ("W27", "W14"):
            self.assertNotIn(f"| {rid} |", scripted)
            self.assertIn(f"{rid}: ", assignment)


# ---------------------------------------------------------------- 4. Judge questions

class Judge(unittest.TestCase):
    def test_assignment_is_self_contained(self):
        p = run("--judge", SESSION_A, "--sessions", FIXTURES)
        self.assertEqual(p.returncode, 0, p.stderr)
        out = p.stdout
        self.assertIn(PATH_A, out)
        self.assertIn("read-only", out)
        self.assertIn("yes", out)
        self.assertIn("n.a.", out)
        self.assertIn("20 words", out)
        for e in grade.load_rubric():
            if e["tag"] == "judge":
                self.assertIn(f"{e['id']}:", out)
        self.assertNotIn("O7:", out)

    def write_answers(self, answers):
        path = os.path.join(tempfile.mkdtemp(), "answers.json")
        put(path, json.dumps(dict(session=SESSION_A, answers=answers)))
        return path

    def test_answers_merge_into_the_report_marked_as_judged(self):
        path = self.write_answers([dict(id="W31", answer="no", entries=["a0000005"], quote="resumed w1")])
        p, text = report("--answers", path)
        self.assertEqual(p.returncode, 0, p.stderr)
        judged = text[text.index("## Judged rules"):text.index("## Retirement candidates")]
        self.assertRegex(judged, r"\| W31 \|[^\n]*\| 0 \| 1 \| 0 \| 0% \| judged \|")
        self.assertIn(f"`{SESSION_A}` `a0000005`", judged)

    def test_answers_reject_a_long_quote_and_a_script_rule(self):
        long_quote = " ".join(["word"] * 21)
        p, _ = report("--answers", self.write_answers([dict(id="W31", answer="no", entries=[], quote=long_quote)]))
        self.assertEqual(p.returncode, 2)
        p, _ = report("--answers", self.write_answers([dict(id="O7", answer="no", entries=[], quote="")]))
        self.assertEqual(p.returncode, 2)


# ---------------------------------------------------------------- 5. Retirement candidates

def fake(n, version="v1"):
    out = []
    for i in range(n):
        first_half = i < n / 2
        out.append(dict(
            session=f"s{i:02d}", path="", project="p", start="2026-11-20T10:00:00Z", week="2026-W47", rules=version,
            answers={
                "W27": dict(answer="yes" if first_half else "no", entries=["e1"], method="script"),
                "O7": dict(answer="yes" if i % 2 else "no", entries=["e1"], method="script"),
                "W28": dict(answer="yes" if i % 6 == 0 else "no", entries=["e1"], method="script"),
            },
            measures=dict(corrections=0 if first_half else 3, cost_main=1.0, cost_sub=1.0, failed=0)))
    return out


def section(text, version):
    block = text[text.index("## Retirement candidates"):]
    block = block[block.index(f"### Rules version `{version}`"):]
    nxt = block.find("\n### ", 4)
    return block if nxt < 0 else block[:nxt]


class Retirement(unittest.TestCase):
    def test_names_candidates_with_enough_sessions(self):
        block = section(grade.build_report(fake(24), grade.load_rubric(), []), "v1")
        no_effect, hook = block.split("a hook could impose")
        self.assertIn("O7", no_effect)
        self.assertNotIn("W27", no_effect)
        self.assertIn("W28", hook)

    def test_says_the_sample_is_too_small(self):
        block = section(grade.build_report(fake(5, "v0"), grade.load_rubric(), []), "v0")
        self.assertIn("sample is too small", block)
        self.assertNotIn("O7", block)


# ---------------------------------------------------------------- 6. Document

class Document(unittest.TestCase):
    def test_evaluation_document(self):
        path = os.path.join(REPO, "docs", "EVALUATION.md")
        lines = read(path).splitlines()
        self.assertLessEqual(len(lines), 60)
        text = "\n".join(lines)
        for word in ("verifier", "before and after", "delet"):
            self.assertIn(word, text)
        units, cur, fence = [], [], False
        for line in lines + [""]:
            if line.startswith("```"):
                fence = not fence
                continue
            if fence or line.startswith("#") or line.startswith("|"):
                continue
            if not line.strip() or line.startswith("- "):
                if cur:
                    units.append(" ".join(cur))
                cur = [line[2:]] if line.startswith("- ") else []
            else:
                cur.append(line.strip())
        for unit in units:
            prose = re.sub(r"`[^`]*`", "x", unit)
            self.assertNotIn(";", prose, unit)
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", prose) if s.strip()]
            self.assertLessEqual(len(sentences), 6, unit)
            for s in sentences:
                self.assertLessEqual(len(s.split()), 25, s)

    def test_entry_file_lists_it(self):
        self.assertIn("`docs/EVALUATION.md`", read(os.path.join(REPO, "AGENTS.md")))


if __name__ == "__main__":
    unittest.main()
