#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  pipeline: ".github/workflows/pipeline-failure-alarm.yml",
  probe: ".github/workflows/data-plane-serving-probe.yml",
  budget: ".github/workflows/worker-request-budget-alarm.yml",
};

function parseSteps(source) {
  const lines = source.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)-\s+name:\s*(.+?)\s*$/.exec(lines[index]);
    if (match) starts.push({ index, indent: match[1].length, name: match[2] });
  }
  return starts.map((start, position) => {
    const next = starts.slice(position + 1).find((candidate) => candidate.indent === start.indent);
    const bodyLines = lines.slice(start.index, next?.index ?? lines.length);
    const fields = {};
    for (const line of bodyLines.slice(1)) {
      const leading = line.match(/^\s*/)[0].length;
      if (leading !== start.indent + 2) continue;
      const field = /^\s*([\w-]+):(?:\s*(.*))?$/.exec(line);
      if (field) fields[field[1]] = field[2] ?? "";
    }
    return {
      name: start.name,
      id: fields.id,
      condition: fields.if,
      bestEffort: fields["continue-on-error"] === "true",
      run: fields.run,
      raw: bodyLines.join("\n"),
    };
  });
}

function parseJobs(source) {
  const lines = source.split("\n");
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsStart === -1) return [];
  const starts = [];
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    const match = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (match) starts.push({ index, name: match[1] });
  }
  return starts.map((start, position) => {
    const next = starts[position + 1]?.index ?? lines.length;
    const raw = lines.slice(start.index, next).join("\n");
    return { name: start.name, raw, steps: parseSteps(raw) };
  });
}

const workflows = Object.fromEntries(Object.entries(files).map(([key, file]) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  return [key, { file, source, jobs: parseJobs(source) }];
}));

// The alarm now hydrates and publishes one plane generation in the check job.
const check = workflows.pipeline.jobs.find(job => job.name === "check");
assert.ok(check, "alarm check job must exist");
const step = name => {
  const found = check.steps.find(item => item.name === name);
  assert.ok(found, `missing alarm step: ${name}`);
  return found;
};
const baseline = step("Hydrate active alarm transition state");
const detector = step("Check pipeline job health");
const proof = step("Apply dispatch-only alarm proof");
const emitter = step("Emit alarm state");
const issue = step("Open or update OPS issue");
const clear = step("Post all-clear on the OPS issue");
const publish = step("Publish alarm transition state");
const ordered = [baseline, detector, proof, emitter, issue, clear, publish].map(item => check.steps.indexOf(item));
assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
assert.equal(detector.bestEffort, true, "detection failures must reach reporting");
for (const item of [baseline, proof, emitter, issue, clear, publish]) assert.equal(item.bestEffort, false, item.name);
assert.match(baseline.raw, /--family pipeline-alarm-state/);
assert.match(publish.raw, /--family=pipeline-alarm-state/);
assert.match(publish.raw, /PUBLISH_EXPECTED_ACTIVE_GENERATION_ID:.*steps\.baseline\.outputs\.generation/);
assert.match(publish.raw, /PUBLISH_EXPECTED_ACTIVE_MANIFEST_SHA256:.*steps\.baseline\.outputs\.manifest/);
assert.match(workflows.pipeline.source, /options: \[none, trigger, clear\]/);
assert.match(proof.condition, /github\.event_name == 'workflow_dispatch'/);
assert.match(proof.condition, /inputs\.proof_phase != 'none'/);
assert.match(proof.condition, /steps\.baseline\.outcome == 'success'/);
assert.match(proof.raw, /node scripts\/ops\/alarm-proof-lifecycle\.mjs/);
assert.match(emitter.condition, /steps\.baseline\.outcome == 'success'/);
assert.match(emitter.condition, /steps\.proof\.outcome != 'failure'/);
assert.match(issue.condition, /steps\.proof\.outputs\.alarming == 'true'/);
assert.match(clear.condition, /inputs\.proof_phase == 'clear'/);
assert.match(clear.raw, /Proof clear requires the exact proof issue title/);
assert.equal(publish.condition, undefined, "normal success gating prevents promotion after reporting failures");

// Execute the shipped detector shell without network calls. Either failed
// detector must leave a failure outcome for the continue-on-error step.
const shell = detector.raw.split("        run: |\n")[1].split("\n")
  .map(line => line.replace(/^          /, "")).join("\n");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-detector-"));
try {
  fs.writeFileSync(path.join(temp, "node"), `#!/bin/sh
case "$1" in
  *check-pipeline-job-health.mjs) exit "$PIPELINE_EXIT" ;;
  *check-a1-lane-health.mjs) exit "$A1_EXIT" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  for (const [pipeline, a1] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
    const run = () => execFileSync("bash", ["-c", shell], {
      cwd: temp, stdio: "pipe",
      env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, PIPELINE_EXIT: String(pipeline), A1_EXIT: String(a1) },
    });
    if (pipeline || a1) assert.throws(run, error => error.status === 2);
    else run();
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

console.log("test-pipeline-failure-alarm-manifest: ok");
