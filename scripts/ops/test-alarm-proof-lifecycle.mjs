import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyProofPhase, createProofIncidents, PROOF_TITLE, PROOF_NOTICE } from "./alarm-proof-lifecycle.mjs";
import { buildAlarmState, incidentIdentitiesChanged } from "./emit-alarm-state.mjs";

const real = { status: "alarm", issueTitle: "100xFenok pipeline job failure alarm", issueBody: "REAL outage",
  data_health_kpi: { status: "alarm", stopped_sets: ["real_set"] },
  workflows: [{ file: "r2-usage-report.yml", label: "Real R2 outage", status: "alarm", streak: 4,
    alarm_reasons: ["failure_streak"], firstFailingRunId: 900 }] };
const saved = structuredClone(real);
assert.equal(applyProofPhase({ health: real }).health, real, "none is an exact no-op");
const incidents = createProofIncidents();
assert.equal(incidents.length, 7);
assert.equal(new Set(incidents.map(row => row.proof_case)).size, 7);
assert.ok(incidents.every(row => row.proof === true && row.status === "alarm"));
assert.ok(incidents.find(row => row.proof_case === "a1").alarm_reasons.includes("a1_consecutive_failures"));
assert.ok(incidents.find(row => row.proof_case === "members").alarm_reasons.includes("member_ratio_low"));
const trigger = applyProofPhase({ health: real, phase: "trigger", incidents });
assert.deepEqual(real, saved, "trigger must not mutate detector input");
assert.deepEqual(trigger.health.workflows.filter(row => !row.proof), real.workflows);
assert.deepEqual(trigger.health.data_health_kpi, real.data_health_kpi);
assert.equal(trigger.health.issueTitle, PROOF_TITLE);
assert.ok(trigger.health.issueBody.includes(PROOF_NOTICE));
assert.ok(trigger.health.issueBody.includes("REAL outage"));
const state = buildAlarmState({ health: trigger.health });
assert.equal(state.open_incidents.filter(row => row.proof).length, 7, "emitter retains all proof tags");
assert.deepEqual(state.open_incidents.filter(row => !row.proof), buildAlarmState({ health: real }).open_incidents);
assert.equal(trigger.realComparison, "identical");
assert.equal(incidentIdentitiesChanged(buildAlarmState({ health: real }), state), true);
const clear = applyProofPhase({ health: real, prior: state, phase: "clear" });
assert.equal(clear.realComparison, "identical");
assert.equal(clear.health.status, "alarm", "real outage remains active after proof removal");
assert.deepEqual(clear.health.workflows, real.workflows);
const cleared = buildAlarmState({ health: clear.health, prior: state });
assert.equal(cleared.status, "open");
assert.ok(cleared.open_incidents.every(row => !row.proof));
assert.deepEqual(cleared.open_incidents, buildAlarmState({ health: real }).open_incidents);
const stripped = applyProofPhase({ health: trigger.health, prior: state, phase: "clear" });
assert.deepEqual(stripped.health.workflows, real.workflows, "clear strips proof rows only");
assert.equal(stripped.health.issueBody, real.issueBody);
const changed = structuredClone(real);
changed.workflows[0].streak = 5;
const changedClear = applyProofPhase({ health: changed, prior: state, phase: "clear" });
assert.equal(changedClear.realComparison, "changed", "never falsely report unchanged live incidents");
assert.equal(changedClear.health.workflows[0].streak, 5);
const healthy = { status: "ok", workflows: [], data_health_kpi: { status: "ok", stopped_sets: [] } };
const healthyTrigger = applyProofPhase({ health: healthy, phase: "trigger", incidents });
const healthyState = buildAlarmState({ health: healthyTrigger.health });
const healthyClear = applyProofPhase({ health: healthy, prior: healthyState, phase: "clear" });
assert.equal(buildAlarmState({ health: healthyClear.health, prior: healthyState }).status, "clear");
assert.equal(healthyClear.realComparison, "identical");
assert.throws(() => applyProofPhase({ health: real, phase: "invalid" }), /Invalid proof phase/);
// Execute the existing issue steps with a local gh stub: no GitHub mutation.
const workflow = fs.readFileSync(new URL("../../.github/workflows/pipeline-failure-alarm.yml", import.meta.url), "utf8");
function shellFor(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1].split("\n      - name:")[0];
  return step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-proof-issue-"));
try {
  fs.mkdirSync(path.join(temp, "data/admin"), { recursive: true });
  fs.mkdirSync(path.join(temp, "bin"));
  fs.writeFileSync(path.join(temp, "bin/gh"), '#!/bin/sh\nif [ "$1" = api ]; then case "$*" in *"[PROOF] 100xFenok pipeline job failure alarm"*) [ "$EXISTING" = yes ] && echo 17;; *) echo 133;; esac; exit 0; fi\nprintf "%s\\n" "$*" >> "$CALLS"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(temp, "pipeline-job-health-title.txt"), PROOF_TITLE);
  fs.writeFileSync(path.join(temp, "pipeline-job-health-issue.md"), "fixture body");
  const calls = path.join(temp, "calls");
  const env = { ...process.env, PATH: `${path.join(temp, "bin")}:${process.env.PATH}`, CALLS: calls,
    GITHUB_REPOSITORY: "fixture/repo", GITHUB_STEP_SUMMARY: path.join(temp, "summary"),
    RUN_URL: "https://example.invalid/proof", PROOF_ISSUE_TITLE: PROOF_TITLE, INCIDENT_CHANGED: "true" };
  function runStep(name, extra) {
    const result = spawnSync("bash", ["-c", shellFor(name)], { cwd: temp, env: { ...env, ...extra }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  runStep("Open or update OPS issue", { PROOF_PHASE: "trigger", EXISTING: "no" });
  assert.equal(fs.readFileSync(calls, "utf8").trim().split("\n").length, 1);
  assert.match(fs.readFileSync(calls, "utf8"), /^issue create/);
  assert.doesNotMatch(fs.readFileSync(calls, "utf8"), /issue (edit|comment|close) 133(?: |$)/);
  fs.writeFileSync(calls, "");
  runStep("Open or update OPS issue", { PROOF_PHASE: "trigger", EXISTING: "yes" });
  assert.match(fs.readFileSync(calls, "utf8"), /issue edit 17 /);
  assert.match(fs.readFileSync(calls, "utf8"), /issue comment 17 /);
  assert.doesNotMatch(fs.readFileSync(calls, "utf8"), /issue (edit|comment|close) 133(?: |$)/);
  for (const state of ["open", "clear", "unknown"]) {
    fs.writeFileSync(calls, "");
    fs.writeFileSync(path.join(temp, "data/admin/alarm-state.json"), JSON.stringify({ status: state }));
    runStep("Open or update OPS issue", { PROOF_PHASE: "clear", EXISTING: "yes" });
    runStep("Post all-clear on the OPS issue", { PROOF_PHASE: "clear", EXISTING: "yes" });
    const actions = fs.readFileSync(calls, "utf8").trim().split("\n");
    assert.equal(actions.filter(line => line.startsWith("issue comment")).length, 1);
    assert.equal(actions.filter(line => line.startsWith("issue close")).length, 1);
    assert.equal(actions.filter(line => line.startsWith("issue create")).length, 0);
    assert.ok(actions.some(line => line.includes("[all-clear]")));
    assert.ok(actions.some(line => line.includes("실제 사건은 #133 등 별도 이슈에서 계속 추적")));
    assert.doesNotMatch(actions.join("\n"), /issue (edit|comment|close) 133(?: |$)/);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("PROOF live_alarm_lifecycle open: seven tagged incidents, real incidents before/after: identical / clear: proof removed, real incidents preserved; healthy state clear");
