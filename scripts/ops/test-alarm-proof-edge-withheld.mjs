#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveWorkflowWatchPolicy, evaluateWorkflow, buildIssueBody } from "./check-pipeline-job-health.mjs";
import { buildAlarmState } from "./emit-alarm-state.mjs";

// Exercise the shipped final verdict shell, then the existing alarm output and
// recovery path. These scheduled records are isolated fixtures, never dispatches.
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const workflowText = fs.readFileSync(path.join(repoRoot, ".github/workflows/fenok-edge-daily.yml"), "utf8");
  const finalStep = workflowText.split("      - name: Require publication or expose the failed lane to the workflow alarm\n")[1];
  assert.ok(finalStep, "the production final verdict step must exist");
  const runBody = finalStep.split("        run: |\n")[1];
  assert.ok(runBody, "the production final verdict must have a shell body");
  const shell = runBody.split("\n").filter((line) => line.trim()).map((line) => {
    assert.ok(line.startsWith("          "), "only the final step shell belongs in this fixture");
    return line.slice(10);
  }).join("\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edge-withheld-alarm-"));
  try {
    const failed = spawnSync("bash", ["-e", "-c", shell], {
      cwd: root, encoding: "utf8",
      env: { PATH: process.env.PATH, FINRA_OUTCOME: "failure", OCC_OUTCOME: "success",
        FINRA_PUBLICATION: "skipped", OCC_PUBLICATION: "skipped" },
    });
    assert.equal(failed.status, 1, failed.stderr);
    for (const outcome of ["FINRA collection:failure", "FINRA publication:skipped", "OCC publication:skipped"]) {
      assert.ok(failed.stdout.includes(`::error::${outcome}; existing workflow-failure alarm must retain this incident`), failed.stdout);
    }
    const workflow = deriveWorkflowWatchPolicy().watched.find((row) => row.file === "fenok-edge-daily.yml");
    assert.ok(workflow);
    assert.equal(workflow.failure_streak_threshold, 2);
    const automaticRun = (id, day, conclusion) => ({ id, event: "schedule", status: "completed", conclusion,
      created_at: `2026-10-${day}T00:30:00.000Z`, run_started_at: `2026-10-${day}T00:30:00.000Z`,
      html_url: `https://example.invalid/edge-fixture/runs/${id}` });
    const failures = [automaticRun(2, "22", "failure"), automaticRun(1, "21", "failure")];
    const openAt = "2026-10-22T00:31:00.000Z";
    const alarm = evaluateWorkflow(workflow, failures, { now: Date.parse(openAt) });
    assert.equal(alarm.status, "alarm");
    assert.equal(alarm.streak, 2);
    assert.ok(alarm.alarm_reasons.includes("failure_streak"));
    const issueBody = buildIssueBody([alarm]);
    assert.match(issueBody, /fenok-edge-daily\.yml/);
    assert.match(issueBody, /Consecutive failures: 2/);
    assert.match(issueBody, /Paging threshold: 2/);
    const open = buildAlarmState({ health: { status: "alarm", workflows: [alarm] }, now: new Date(openAt) });
    assert.equal(open.status, "open");
    assert.equal(open.open_incident_count, 1);
    assert.equal(open.open_incidents[0].workflow, workflow.file);
    assert.equal(open.open_incidents[0].first_failing_run_id, 1);
    console.log(`PROOF edge-withheld open: ${JSON.stringify({ shell_exit: failed.status, shell_output: failed.stdout.trim(), issue_body: issueBody, state: open })}`);

    const healthy = spawnSync("bash", ["-e", "-c", shell], {
      cwd: root, encoding: "utf8",
      env: { PATH: process.env.PATH, FINRA_OUTCOME: "success", OCC_OUTCOME: "success",
        FINRA_PUBLICATION: "success", OCC_PUBLICATION: "success" },
    });
    assert.equal(healthy.status, 0, healthy.stderr);
    const clearAt = "2026-10-23T00:31:00.000Z";
    const recovered = evaluateWorkflow(workflow, [automaticRun(3, "23", "success"), ...failures], { now: Date.parse(clearAt) });
    assert.equal(recovered.status, "ok");
    assert.equal(recovered.streak, 0);
    assert.equal(recovered.failure_streak_recovered, true);
    const clear = buildAlarmState({ health: { status: "ok", workflows: [recovered] }, prior: open, now: new Date(clearAt) });
    assert.equal(clear.status, "clear");
    assert.equal(clear.open_incident_count, 0);
    assert.deepEqual(clear.open_incidents, []);
    assert.equal(clear.last_resolved_at, clearAt);
    console.log(`PROOF edge-withheld clear: ${JSON.stringify({ shell_exit: healthy.status, state: clear })}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

