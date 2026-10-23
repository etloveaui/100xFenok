#!/usr/bin/env node
// Isolated producer -> A1 health detector -> alarm emitter open/clear proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";

const ENV = { GITHUB_RUN_ID: "a1-preflight-proof", GITHUB_EVENT_NAME: "workflow_dispatch" };

// The hosted proof uses real local Git inspection and the runner/checker/emitter
// CLIs. Git transport and status publication use local sinks; the M4 driver
// models Linux host admission only. Hosted Linux uses its actual platform.
// The emitter resolves its output from its module path, so copy the actual code
// under the OS temp root before invoking it; cwd alone cannot isolate its writes.
{
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-a1-preflight-proof-"));
  const repo = path.join(fixture, "repo");
  const stateRoot = path.join(fixture, "collector-state");
  const healthPath = path.join(fixture, "pipeline-job-health-result.json");
  const outputPath = path.join(fixture, "github-output");
  const readBytes = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null;
  const protectedPaths = ["data/admin/alarm-state.json", "100xfenok-next/public/data/admin/alarm-state.json"];
  const before = protectedPaths.map((relative) => readBytes(path.join(sourceRoot, relative)));
  const childEnv = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  };
  const run = (command, args, expected = 0, options = {}) => {
    const result = spawnSync(command, args, { cwd: repo, env: childEnv,
      encoding: "utf8", timeout: 20_000, ...options });
    assert.equal(result.status, expected, `${command} failed: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const driver = String.raw`
import importlib.util
import json
from pathlib import Path
import sys

repo = Path.cwd()
state_root = repo.parent / "collector-state"
spec = importlib.util.spec_from_file_location("a1_preflight_proof", repo / "ops/a1-lanes/sec13f-runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.LANE_ID = "fdic_tier1"
runner.STATUS_PATH = "ops/a1-lanes/fdic_tier1.json"
runner.DATA_ROOT = "data/macro/fdic-tier1.json"
# This fixture exercises the dirty-checkout path after host admission. Hosted
# Linux passes it unchanged; the M4 interpreter models that precondition only.
if sys.platform != "linux":
    runner.sys.platform = "linux"
if sys.argv[1] == "open":
    original_git = runner.git
    transport_calls = []
    def local_git(root, *args):
        if args[0] in ("fetch", "push"):
            transport_calls.append(args)
            raise AssertionError("preflight proof must never contact a Git remote")
        return original_git(root, *args)
    def status_sink(args, status, scratch):
        runner.write_json(state_root / "publication-sink.json", status)
        return "published"
    runner.git = local_git
    runner.publish_status_only = status_sink
    sys.argv = ["sec13f-runner.py", "--lane", "fdic_tier1", "--repo", str(repo),
                "--state-root", str(state_root), "--publish"]
    assert runner.main() == 1
    state = runner.read_json(state_root / "last-run.json")
    assert state["last_run"]["outcome"] == "failed"
    assert state["last_run"]["reason"] == "Collector checkout is dirty; preserve it and stop"
    assert state["consecutive_failures"] == 2
    assert runner.read_json(state_root / "publication-sink.json") == state
    assert transport_calls == []
else:
    previous = runner.read_json(state_root / "last-run.json")
    clock = (previous["last_run"].get("source_quarter"), previous["last_run"].get("source_as_of"))
    state = runner.build_state("retained", None, clock, clock, previous, 0,
                               runner._now(), True, publication="published")
    assert state["consecutive_failures"] == 0
    runner.write_json(state_root / "last-run.json", state)
`;
  try {
    assert.ok(!path.relative(os.tmpdir(), fixture).startsWith(".."));
    assert.notEqual(repo, sourceRoot);
    for (const relative of ["ops/a1-lanes/sec13f-runner.py", "scripts/ops/check-a1-lane-health.mjs",
      "scripts/ops/emit-alarm-state.mjs", "scripts/lib/lane-registry.mjs",
      "scripts/lib/json-canonical.mjs", "scripts/lib/slickcharts-composite-recovery.mjs",
      "100xfenok-next/scripts/cloud-data-plane/json-canonical.mjs"]) {
      const target = path.join(repo, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, relative), target);
    }
    const now = new Date().toISOString();
    for (const lane of LANE_REGISTRY.lanes.filter((row) => row.external_status)) {
      writeJson(path.join(repo, lane.external_status), {
        schema_version: "a1-lane-status/v1", lane_id: lane.id, enabled: true, push_enabled: true,
        updated_at: now, last_success_at: now, consecutive_failures: lane.id === "fdic_tier1" ? 1 : 0,
        cadence_hours: lane.id === "fdic_tier1" ? 96 : 24, grace_hours: 12,
        last_run: { outcome: lane.id === "fdic_tier1" ? "failed" : "retained",
          source_as_of: "2026-06-30", source_quarter: null },
      });
    }
    const payload = path.join(repo, "data/macro/fdic-tier1.json");
    writeJson(payload, { data: [{ date: "2026-06-30", value: 1 }] });
    const payloadBefore = fs.readFileSync(payload);
    run("git", ["init", "--quiet"]);
    run("git", ["remote", "add", "origin", "git@github-100xf-a1:etloveaui/100xFenok.git"]);
    run("python3", ["-", "open"], 0, { input: driver });
    const failed = JSON.parse(fs.readFileSync(path.join(stateRoot, "last-run.json"), "utf8"));
    assert.deepEqual(fs.readFileSync(payload), payloadBefore, "preflight must preserve the current payload");
    const detectorEnv = { ...childEnv, PIPELINE_JOB_HEALTH_RESULT: healthPath,
      A1_LANE_STATUS_PATH: path.join(stateRoot, "last-run.json") };
    const emitterEnv = { ...detectorEnv, ...ENV, GITHUB_OUTPUT: outputPath };
    const resetHealth = () => writeJson(healthPath, { status: "ok", workflows: [], data_health_kpi: { status: "ok" } });
    resetHealth();
    run(process.execPath, ["scripts/ops/check-a1-lane-health.mjs"], 2, { env: detectorEnv });
    const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
    assert.deepEqual(health.workflows.map((row) => row.file), ["a1-fdic-tier1"]);
    assert.deepEqual(health.workflows[0].alarm_reasons, ["a1_consecutive_failures"]);
    assert.match(health.issueBody, /A1 FDIC.*collector/);
    assert.match(health.issueBody, /a1_consecutive_failures/);
    fs.writeFileSync(outputPath, "");
    const opening = run(process.execPath, ["scripts/ops/emit-alarm-state.mjs"], 0, { env: emitterEnv });
    const alarmPath = path.join(repo, "data/admin/alarm-state.json");
    const opened = JSON.parse(fs.readFileSync(alarmPath, "utf8"));
    assert.equal(opened.status, "open");
    assert.equal(opened.open_incident_count, 1);
    assert.equal(opened.open_incidents[0].workflow, "a1-fdic-tier1");
    assert.deepEqual(opened.open_incidents[0].alarm_reasons, ["a1_consecutive_failures"]);
    assert.match(opening.stdout, /alarm-state: status=open open=1/);
    assert.match(fs.readFileSync(outputPath, "utf8"), /incident_changed=true/);
    console.log(`PROOF a1-preflight open: outcome=${failed.last_run.outcome} consecutive_failures=${failed.consecutive_failures} alarm_reasons=${health.workflows[0].alarm_reasons.join(",")} state=${opened.status}`);

    run("python3", ["-", "clear"], 0, { input: driver });
    resetHealth();
    run(process.execPath, ["scripts/ops/check-a1-lane-health.mjs"], 0, { env: detectorEnv });
    fs.writeFileSync(outputPath, "");
    const clearing = run(process.execPath, ["scripts/ops/emit-alarm-state.mjs"], 0, { env: emitterEnv });
    const cleared = JSON.parse(fs.readFileSync(alarmPath, "utf8"));
    assert.equal(cleared.status, "clear");
    assert.equal(cleared.open_incident_count, 0);
    assert.ok(cleared.last_resolved_at);
    assert.deepEqual(cleared.last_firing, opened.last_firing);
    assert.match(clearing.stdout, /alarm-state: status=clear open=0/);
    assert.match(fs.readFileSync(outputPath, "utf8"), /incident_resolved=true/);
    assert.deepEqual(fs.readFileSync(payload), payloadBefore);
    console.log(`PROOF a1-preflight clear: state=${cleared.status} open=${cleared.open_incident_count} last_resolved_at=${cleared.last_resolved_at} incident_resolved=true`);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    protectedPaths.forEach((relative, index) => assert.deepEqual(readBytes(path.join(sourceRoot, relative)), before[index],
      `hosted proof must not change the checkout's ${relative}`));
  }
}
