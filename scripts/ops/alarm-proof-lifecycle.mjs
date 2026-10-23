#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveWorkflowWatchPolicy, evaluateWorkflow, classifyKpiGenerationStoppage, classifyComputedCoverageEvidence, buildIssueBody } from "./check-pipeline-job-health.mjs";
import { buildAlarmState } from "./emit-alarm-state.mjs";
import { scheduledSlot } from "../check-external-clock-slot.mjs";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";

export const PROOF_TITLE = "[PROOF] 100xFenok pipeline job failure alarm";
export const PROOF_NOTICE = "[PROOF] 라이브 알람 경로 증명 - 실제 장애 아님";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function a1Fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-proof-a1-"));
  try {
    const resultPath = path.join(temp, "health.json");
    fs.writeFileSync(resultPath, JSON.stringify({ status: "ok", workflows: [] }));
    for (const lane of LANE_REGISTRY.lanes.filter(row => row.external_status)) {
      const target = path.join(temp, lane.external_status);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify({ schema_version: "a1-lane-status/v1", lane_id: lane.id,
        enabled: lane.id === "fdic_tier1", push_enabled: true, cadence_hours: 24, grace_hours: 1,
        updated_at: new Date().toISOString(), last_success_at: null, consecutive_failures: 2 }));
    }
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/ops/check-a1-lane-health.mjs")], {
      cwd: temp, encoding: "utf8", env: { ...process.env, PIPELINE_JOB_HEALTH_RESULT: resultPath,
        A1_LANE_STATUS_PATH: path.join(temp, "ops/a1-lanes/fdic_tier1.json") }, timeout: 10_000,
    });
    assert.equal(result.status, 2, result.stderr || result.error?.message);
    const incidents = JSON.parse(fs.readFileSync(resultPath, "utf8")).workflows;
    assert.equal(incidents.length, 1);
    assert.deepEqual(incidents[0].alarm_reasons, ["a1_consecutive_failures"]);
    return incidents[0];
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function createProofIncidents() {
  const policy = deriveWorkflowWatchPolicy();
  function failures(file, proofCase, detail, marked = false) {
    const workflow = policy.watched.find(row => row.file === file);
    assert.ok(workflow, `Proof workflow is not watched: ${file}`);
    const count = workflow.failure_streak_threshold;
    let stamp = workflow.crons.length ? scheduledSlot(workflow.crons[0], "2026-10-23T12:45:00Z") : "2026-10-23T12:45:00.000Z";
    const now = Date.parse(stamp) + 60_000;
    const runs = [];
    for (let i = 0; i < count; i += 1) {
      runs.push({ id: count - i, event: marked ? "workflow_dispatch" : workflow.crons.length ? "schedule" : "workflow_run",
        status: "completed", conclusion: "failure", created_at: stamp, run_started_at: stamp,
        display_title: marked ? `external-clock/a1/v1 ${file} ${stamp}` : "[PROOF] synthetic failure",
        html_url: null });
      stamp = workflow.crons.length ? scheduledSlot(workflow.crons[0], new Date(Date.parse(stamp) - 60_000))
        : new Date(Date.parse(stamp) - 60_000).toISOString();
    }
    const incident = evaluateWorkflow(workflow, runs, { now });
    assert.equal(incident.status, "alarm");
    assert.deepEqual(incident.alarm_reasons, ["failure_streak"]);
    return { ...incident, proof: true, proof_case: proofCase, label: `[PROOF] ${detail}` };
  }
  const kpi = classifyKpiGenerationStoppage(["11", "10"].map(hour => ({
    generated_at: `2026-10-23T${hour}:00:00Z`, sets: [{ set: "proof_member_freshness", status: "delayed",
      fresh_members: 1461, total_members: 1495 }],
  })), { now: Date.parse("2026-10-23T11:01:00Z"), crons: ["0 10,11 * * *"] });
  assert.equal(kpi.status, "alarm");
  const member = buildAlarmState({ health: { status: "alarm", data_health_kpi: kpi } }).open_incidents[0];
  return [
    failures("r2-usage-report.yml", "r2_breach", "R2 measured breach report failures (exit 2)"),
    failures("fenok-edge-daily.yml", "edge", "Edge publication withheld"),
    { ...classifyComputedCoverageEvidence({ schema_version: "computed-coverage/v1", family: "computed-signals",
        generation_id: "proof-published", receipt_id: "proof-receipt", status: "alarm", findings: [{
          path: "public/data/computed/signals.json", field: "rows.[].sp500_tracking_similarity",
          before: { present: 761, total: 763 }, after: { present: 0, total: 763 }, verdict: "collapse",
        }] }, "computed-signals"), proof: true, proof_case: "computed",
      label: "[PROOF] Computed coverage collapse; publication continued" },
    { ...member, file: member.workflow, status: "alarm", proof: true, proof_case: "members",
      label: "[PROOF] Member freshness 1461/1495" },
    failures("fetch-yahoo-ticker.yml", "yahoo", "Yahoo external-clock failures", true),
    { ...a1Fixture(), proof: true, proof_case: "a1", label: "[PROOF] A1 consecutive failures" },
    failures("r2-usage-report.yml", "r2_unverified", "R2 unverified measurement report failures (exit 3)"),
  ];
}

function realIncidents(health) {
  return buildAlarmState({ health }).open_incidents.filter(row => row.proof !== true);
}

// The detector is always run first. Proof data never replaces its real observations.
export function applyProofPhase({ health, prior = null, phase = "none", incidents } = {}) {
  if (!["none", "trigger", "clear"].includes(phase)) throw new Error(`Invalid proof phase: ${phase}`);
  if (phase === "none") return { health };
  assert.ok(health && typeof health === "object" && Array.isArray(health.workflows), "Real detector result is required");
  const real = { ...health, workflows: health.workflows.filter(row => row.proof !== true) };
  if (health.proof_context?.original) {
    for (const key of ["status", "issueTitle", "issueBody"]) {
      if (health.proof_context.original[key] === undefined) delete real[key];
      else real[key] = health.proof_context.original[key];
    }
  }
  delete real.proof_context;
  const before = realIncidents(real);
  const baseline = prior?.proof_context?.real_incidents_before;
  const result = phase === "trigger" ? {
    ...real, status: "alarm", issueTitle: PROOF_TITLE,
    workflows: [...real.workflows, ...(incidents ?? createProofIncidents())],
    proof_context: { real_incidents_before: before,
      original: { status: real.status, issueTitle: real.issueTitle, issueBody: real.issueBody } },
  } : { ...real, issueTitle: PROOF_TITLE };
  if (phase === "trigger") {
    const proofRows = result.workflows.filter(row => row.proof === true);
    assert.equal(proofRows.length, 7);
    assert.equal(new Set(proofRows.map(row => row.proof_case)).size, 7);
    result.issueBody = [real.issueBody, PROOF_NOTICE, buildIssueBody(proofRows)].filter(Boolean).join("\n\n");
  }
  assert.deepEqual(realIncidents(result), before, "Proof merge/removal changed a real incident");
  return { health: result, realComparison: phase === "trigger" ? "identical"
    : !Array.isArray(baseline) ? "baseline unavailable"
      : JSON.stringify(baseline) === JSON.stringify(before) ? "identical" : "changed",
    realCount: before.length };
}

function main() {
  const phase = process.env.PROOF_PHASE || "none";
  if (phase === "none") return;
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch", "Proof is dispatch-only");
  const resultPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const health = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const priorPath = path.join(repoRoot, "data/admin/alarm-state.json");
  const prior = JSON.parse(fs.readFileSync(priorPath, "utf8"));
  const result = applyProofPhase({ health, prior, phase });
  fs.writeFileSync(resultPath, `${JSON.stringify(result.health, null, 2)}\n`);
  const line = `real incidents before/after: ${result.realComparison}`;
  const detail = phase === "trigger" ? "Seven tagged proof incidents added; real incidents preserved."
    : `Proof incidents removed; ${result.realCount} real incident(s) remain. Fresh detector status: ${result.health.status}.`;
  console.log(`${line}\n${detail}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${PROOF_NOTICE}\n\n${line}\n\n${detail}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `alarming=${result.health.status === "alarm" || result.health.status === "blind"}\nissue_title=${PROOF_TITLE}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
