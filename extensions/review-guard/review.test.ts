// node --test extensions/review-guard/review.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { PUBLISH_REASON, publishes, rebuild, ReviewState, verdictPasses } from "./review.ts";

test("reconoce git push en cualquier forma", () => {
	for (const command of [
		"git push",
		"git push origin feat/x",
		"git push -u origin HEAD --force-with-lease",
		"/usr/bin/git push",
		"git -C /tmp/repo push",
		"git -C '/tmp/a repo' push origin main",
		"git -c core.sshCommand=ssh --no-pager push",
		"git --git-dir=/tmp/repo/.git push",
		"cd /tmp/repo && git push",
		"git commit -m 'fix' && git push",
		"npm test; git push",
		"npm test || git push",
		"(cd /tmp/repo && git push)",
		"GIT_SSH_COMMAND=ssh git push",
		"env GIT_TRACE=1 git push",
		"if true; then git push; fi",
		"echo done\ngit push",
		"echo $(git push)",
		"bash -c 'git push'",
		'sh -c "cd /tmp && git -C repo push"',
		"timeout 30 git push",
		"timeout -s KILL --kill-after=5 5m git push origin main",
		"nice git push",
		"nice -n 10 git push",
		"sudo git push",
		"sudo -u deploy git push",
		"sudo -u deploy timeout 30 nice -n 5 git push",
	]) {
		assert.equal(publishes(command), true, command);
	}
});

test("reconoce abrir una merge request o una pull request", () => {
	assert.equal(publishes("glab mr create --fill"), true);
	assert.equal(publishes("glab mr create -t 'feat: x' -d 'body'"), true);
	assert.equal(publishes("git push -u origin feat && glab mr create --fill"), true);
	assert.equal(publishes("gh pr create --fill"), true);
	assert.equal(publishes("gh pr new --title x"), true);
	assert.equal(publishes("gh -R o/r pr create --fill"), true);
	assert.equal(publishes("gh --repo o/r pr create"), true);
	assert.equal(publishes("glab -R o/r mr create --fill"), true);
	assert.equal(publishes("glab --repo o/r mr create"), true);
	assert.equal(publishes("timeout 60 glab -R o/r mr create"), true);
});

test("no confunde otras órdenes con publicar", () => {
	for (const command of [
		"git status",
		"git log --oneline -5",
		"git commit -m 'git push later'",
		'git commit -m "document git push and gh pr create"',
		"git stash push -m wip",
		"echo git push",
		"npm test",
		"glab mr list",
		"glab mr view 12",
		"gh pr view 3",
		"gh pr list",
		"git -C /tmp/repo status",
		"timeout 30 git status",
		"nice -n 10 npm test",
		"sudo -u deploy git fetch",
		"gh -R o/r pr list",
		"glab -R o/r mr view 12",
		"",
	]) {
		assert.equal(publishes(command), false, command);
	}
});

test("lee el veredicto que pasa solo en la primera línea", () => {
	assert.equal(verdictPasses("Verdict: pass"), true);
	assert.equal(verdictPasses("\n\nVerdict: pass\n\nSin hallazgos."), true);
	assert.equal(verdictPasses("**Verdict: pass**\n\n- Ran npm test: exit 0."), true);
	assert.equal(verdictPasses("**Verdict:** pass"), true);
	assert.equal(verdictPasses("  Verdict: pass  \nVerdict: fail"), true);
});

test("no toma por aprobado un fallo, un informe vacío ni uno sin veredicto claro", () => {
	assert.equal(verdictPasses("**Veredicto: fail.**\n\n1. /tmp/a.ts:3 rompe la regla."), false);
	assert.equal(verdictPasses("Verdict: fail"), false);
	assert.equal(verdictPasses("Veredicto: falla."), false);
	assert.equal(verdictPasses("Veredicto: no pasa."), false);
	assert.equal(verdictPasses("Verdict: does not pass"), false);
	assert.equal(verdictPasses("Verdict: not pass"), false);
	assert.equal(verdictPasses("Verdict: pass or fail, the prompt asks.\n\nVerdict: fail"), false);
	assert.equal(verdictPasses("No output."), false);
	assert.equal(verdictPasses(""), false);
	assert.equal(verdictPasses(undefined), false);
	assert.equal(verdictPasses("All checks pass."), false);
	assert.equal(verdictPasses("Verdict: the change looks fine"), false);
	assert.equal(verdictPasses("Verdict: pass with reservations"), false);
	assert.equal(verdictPasses("Verdict: pass, with conditions"), false);
	assert.equal(verdictPasses("Verdict: pass (one open blocker)"), false);
	assert.equal(verdictPasses("**Veredicto: pass.**"), false);
	assert.equal(verdictPasses("Veredicto: pasa."), false);
	assert.equal(verdictPasses("Verdict: PASS"), false);
	assert.equal(verdictPasses("## Verdict\n\npass"), false);
	assert.equal(verdictPasses("Findings: none.\n\nVerdict: pass"), false);
	assert.equal(verdictPasses("Agent completed in 2m (30 tool uses).\n\nVerdict: pass"), false);
});

test("solo una revisión que empezó después del último cambio lo cubre", () => {
	const state = new ReviewState();
	assert.equal(state.unreviewed(), false);
	state.change(10);
	assert.equal(state.unreviewed(), true);
	state.pass(5);
	assert.equal(state.unreviewed(), true);
	state.pass(11);
	assert.equal(state.unreviewed(), false);
	state.change(12);
	assert.equal(state.unreviewed(), true);
});

const call = (id: string, name: string, args: Record<string, unknown>, timestamp: number) => ({
	type: "message",
	message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp },
});
const result = (id: string, toolName: string, timestamp: number, extra: Record<string, unknown> = {}) => ({
	type: "message",
	message: { role: "toolResult", toolCallId: id, toolName, content: [{ type: "text", text: "ok" }], isError: false, timestamp, ...extra },
});
const record = (type: string, status: string, report: string | undefined, startedAt: number, completedAt: number) => ({
	type: "custom",
	customType: "subagents:record",
	data: { id: `${type}-${startedAt}`, type, status, result: report, startedAt, completedAt },
});

test("rehace el estado desde las entradas de la sesión", () => {
	assert.equal(rebuild([]).unreviewed(), false);
	const edited = [call("c1", "edit", { path: "a.md" }, 1), result("c1", "edit", 2)];
	assert.equal(rebuild(edited).unreviewed(), true);
	const reviewed = [...edited, record("verifier", "completed", "Verdict: pass", 3, 4)];
	assert.equal(rebuild(reviewed).unreviewed(), false);
	assert.equal(rebuild([...reviewed, record("worker", "completed", "done", 5, 6)]).unreviewed(), true);
	assert.equal(rebuild([...edited, record("verifier", "completed", "Verdict: fail", 3, 4)]).unreviewed(), true);
	assert.equal(rebuild([...edited, record("verifier", "error", "Verdict: pass", 3, 4)]).unreviewed(), true);
});

test("el estado rehecho cuenta lsp_fix con write y no una edición fallida", () => {
	assert.equal(rebuild([call("c1", "lsp_fix", { path: "a.ts", write: true }, 1), result("c1", "lsp_fix", 2)]).unreviewed(), true);
	assert.equal(rebuild([call("c1", "lsp_fix", { path: "a.ts" }, 1), result("c1", "lsp_fix", 2)]).unreviewed(), false);
	assert.equal(rebuild([call("c1", "write", { path: "a.ts" }, 1), result("c1", "write", 2, { isError: true })]).unreviewed(), false);
	assert.equal(rebuild([call("c1", "read", { path: "a.ts" }, 1), result("c1", "read", 2)]).unreviewed(), false);
});

test("el estado rehecho lee el resultado de un Agent en primer plano, también reanudado", () => {
	const edited = [call("c1", "edit", { path: "a.md" }, 1), result("c1", "edit", 2)];
	const verifier = (id: string, text: string, at: number) => [
		call(id, "Agent", { subagent_type: "verifier", prompt: "review" }, at),
		{
			type: "message",
			message: {
				role: "toolResult", toolCallId: id, toolName: "Agent", isError: false, timestamp: at + 10,
				content: [{ type: "text", text }],
				details: { subagentType: "verifier", status: "completed", durationMs: 5, agentId: "v1" },
			},
		},
	];
	// El Agent en primer plano antepone su cabecera y a veces una nota. El veredicto es la primera línea del informe.
	assert.equal(rebuild([...edited, ...verifier("c2", "Agent completed in 5ms (3 tool uses).\n\nVerdict: pass", 3)]).unreviewed(), false);
	assert.equal(
		rebuild([...edited, ...verifier("c2", 'Note: Unknown agent type "x".\n\nAgent completed in 5ms.\n\n**Verdict: pass**\n\nAgent completed in 1s.', 3)]).unreviewed(),
		false,
	);
	assert.equal(rebuild([...edited, ...verifier("c2", "Agent completed in 5ms.\n\nVerdict: pass with reservations", 3)]).unreviewed(), true);
	assert.equal(rebuild([...edited, ...verifier("c2", "Agent completed in 5ms.\n\nFindings.\n\nVerdict: pass", 3)]).unreviewed(), true);
	// Una reanudación ignora subagent_type: details lleva el tipo real.
	const resumedWorker = [
		call("c3", "Agent", { subagent_type: "verifier", resume: "w1", prompt: "fix" }, 20),
		{
			type: "message",
			message: {
				role: "toolResult", toolCallId: "c3", toolName: "Agent", isError: false, timestamp: 30,
				content: [{ type: "text", text: "fixed" }],
				details: { subagentType: "worker", status: "completed", durationMs: 5, agentId: "w1" },
			},
		},
	];
	assert.equal(rebuild([...edited, ...verifier("c2", "Verdict: pass", 3), ...resumedWorker]).unreviewed(), true);
});

test("el aviso pide un verifier nuevo en una o dos frases en inglés", () => {
	assert.match(PUBLISH_REASON, /fresh `verifier`/);
	assert.ok(PUBLISH_REASON.split(/(?<=\.)\s+/).length <= 2);
});
