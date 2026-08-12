#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

const INCIDENT_IF =
  "steps.pipeline.outcome == 'failure' && steps.alarm_state.outputs.incident_changed != 'false'";
const ISSUE_COMMANDS = [/gh issue comment/, /gh issue create/];
const PROBE_ISSUE_COMMANDS = [/gh issue edit/, /gh issue create/];
const STEP_CONTRACTS = [
  {
    workflow: "pipeline", job: "check", name: "Record alarm-state base fingerprint", bestEffort: false,
    contains: [
      /sha256sum data\/admin\/alarm-state\.json/,
      /printf '%s\\n' missing > pipeline-alarm-state-transfer\/base\.sha256/,
    ],
  },
  { workflow: "pipeline", job: "check", name: "Check pipeline job health", id: "pipeline", bestEffort: true },
  { workflow: "pipeline", job: "check", name: "Emit alarm state", id: "alarm_state", condition: "always()", bestEffort: false },
  { workflow: "pipeline", job: "check", name: "Prepare issue body", condition: INCIDENT_IF, bestEffort: false },
  { workflow: "pipeline", job: "check", name: "Open or update OPS issue", condition: INCIDENT_IF, bestEffort: false, contains: ISSUE_COMMANDS },
  {
    workflow: "pipeline", job: "check", name: "Post all-clear on the OPS issue", bestEffort: false,
    condition: "steps.alarm_state.outputs.incident_resolved == 'true'",
    contains: [/gh issue comment/, /gh issue close "\$existing" --reason completed --comment/],
  },
  {
    workflow: "pipeline", job: "check", name: "Prepare alarm state for persistence", bestEffort: false,
    contains: [
      /test -f pipeline-alarm-state-transfer\/base\.sha256/,
      /cp data\/admin\/alarm-state\.json pipeline-alarm-state-transfer\/alarm-state\.json/,
    ],
  },
  {
    workflow: "pipeline", job: "check", name: "Upload alarm state for persistence", bestEffort: false,
    contains: [
      /actions\/upload-artifact@v4/,
      /name: pipeline-alarm-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
      /path: pipeline-alarm-state-transfer/,
      /if-no-files-found: error/,
    ],
  },
  {
    workflow: "pipeline", job: "persist-alarm-state", name: "Download alarm state", bestEffort: false,
    contains: [
      /actions\/download-artifact@v4/,
      /name: pipeline-alarm-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    ],
  },
  {
    workflow: "pipeline", job: "persist-alarm-state", name: "Commit alarm state", bestEffort: true,
    contains: [
      /scripts\/stage-lane-manifest\.sh[\s\S]*--stage always_if_exists/,
      /git add data\/admin\/alarm-state\.json/,
      /git fetch --depth=1 origin main/,
      /alarm-state base changed before persistence; refusing stale overwrite/,
    ],
  },
  {
    workflow: "pipeline", job: "persist-alarm-state", name: "Surface alarm-state persistence failure",
    bestEffort: false, condition: "steps.persist.outcome == 'failure'", contains: [/exit 1/],
  },
  { workflow: "probe", name: "Probe enrolled assets", id: "probe", bestEffort: true },
  {
    workflow: "probe", name: "Open or update probe issue", bestEffort: false,
    condition: "steps.probe.outcome == 'failure'", contains: [
      ...PROBE_ISSUE_COMMANDS,
      /probe-failures\.md/,
      /test -s probe-failures\.md/,
    ],
  },
  {
    workflow: "probe", name: "Close probe issue on recovery", bestEffort: false,
    condition: "steps.probe.outcome == 'success'",
    contains: [/gh issue comment/, /gh issue close "\$existing" --reason completed/],
  },
  { workflow: "budget", name: "Check Worker request budget", id: "budget", bestEffort: true },
  {
    workflow: "budget", name: "Open or update OPS issue", bestEffort: false,
    condition: "steps.budget.outcome == 'failure'", contains: ISSUE_COMMANDS,
  },
  {
    workflow: "budget", name: "Check ETF typed-unavailable telemetry budget",
    id: "telemetry", bestEffort: true,
  },
  {
    workflow: "budget", name: "Open or update telemetry OPS issue", bestEffort: false,
    condition: "steps.telemetry.outcome == 'failure'", contains: ISSUE_COMMANDS,
  },
];

function stepOf(model, workflow, name, jobName = null) {
  const jobs = jobName
    ? model[workflow].jobs.filter((job) => job.name === jobName)
    : model[workflow].jobs;
  const step = jobs.flatMap((job) => job.steps).find((candidate) => candidate.name === name);
  assert.ok(step, `${model[workflow].file}: ${name} step must exist`);
  return step;
}

function jobOf(model, workflow, name) {
  const job = model[workflow].jobs.find((candidate) => candidate.name === name);
  assert.ok(job, `${model[workflow].file}: ${name} job must exist`);
  return job;
}

function assertStepContracts(model) {
  for (const contract of STEP_CONTRACTS) {
    const step = stepOf(model, contract.workflow, contract.name, contract.job);
    assert.equal(step.bestEffort, contract.bestEffort, `${contract.name}: best-effort contract drifted`);
    assert.equal(step.condition, contract.condition, `${contract.name}: condition contract drifted`);
    if (contract.id) assert.equal(step.id, contract.id, `${contract.name}: step id drifted`);
    for (const pattern of contract.contains ?? []) {
      assert.match(step.raw, pattern, `${contract.name}: reporting/persistence command drifted`);
    }
  }
}

const REPORTING_STEPS = [
  "Prepare issue body",
  "Open or update OPS issue",
  "Post all-clear on the OPS issue",
];

function assertPipelineTopology(model) {
  const pipeline = model.pipeline;
  const check = jobOf(model, "pipeline", "check");
  const persist = jobOf(model, "pipeline", "persist-alarm-state");
  assert.doesNotMatch(pipeline.source, /^concurrency:\s*$/m, "alarm workflow must not hold the global lock at workflow scope");
  assert.match(
    check.raw,
    /concurrency:\s*\n\s+group: pipeline-failure-alarm\s*\n\s+cancel-in-progress: false/,
    "detector/reporting job must keep only its dedicated short lock",
  );
  assert.doesNotMatch(check.raw, /fenok-data-writer-refs\/heads\/main/, "detector/reporting job must stay outside the data-writer queue");
  assert.match(
    persist.raw,
    /needs: check[\s\S]*if: \$\{\{ needs\.check\.result == 'success' \}\}/,
    "state persistence must depend on successful detection/reporting",
  );
  assert.match(
    persist.raw,
    /concurrency:\s*\n\s+group: fenok-data-writer-refs\/heads\/main\s*\n\s+cancel-in-progress: false\s*\n\s+queue: max/,
    "state persistence must be the bounded global writer job",
  );
  const checkNames = check.steps.map((step) => step.name);
  const transferIndex = checkNames.indexOf("Prepare alarm state for persistence");
  for (const name of REPORTING_STEPS) {
    assert.ok(checkNames.indexOf(name) < transferIndex, `${name} must precede state transfer`);
  }
  const persistNames = persist.steps.map((step) => step.name);
  assert.ok(
    persistNames.indexOf("Commit alarm state") < persistNames.indexOf("Surface alarm-state persistence failure"),
    "persistence failure must remain visible after the best-effort commit step",
  );
}

function assertCurrentRunArtifactBinding(model) {
  const expected = /name: pipeline-alarm-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/;
  assert.match(
    stepOf(model, "pipeline", "Upload alarm state for persistence", "check").raw,
    expected,
    "uploaded alarm state must be named for the current run and attempt",
  );
  assert.match(
    stepOf(model, "pipeline", "Download alarm state", "persist-alarm-state").raw,
    expected,
    "persistence must download only the current run and attempt artifact",
  );
}

function assertStaleArtifactGuard(model) {
  const raw = stepOf(model, "pipeline", "Commit alarm state", "persist-alarm-state").raw;
  assert.match(raw, /current_fingerprint=missing/, "missing canonical state must have a deterministic fingerprint");
  const refreshIndex = raw.indexOf("git fetch --depth=1 origin main");
  const compareIndex = raw.indexOf('if [ "$base_fingerprint" != "$current_fingerprint" ]; then');
  const copyIndex = raw.indexOf("cp pipeline-alarm-state/alarm-state.json data/admin/alarm-state.json");
  assert.ok(compareIndex >= 0, "stale-state comparison must exist");
  assert.ok(refreshIndex >= 0 && refreshIndex < compareIndex, "latest main must be fetched before stale-state comparison");
  assert.ok(compareIndex < copyIndex, "stale-state comparison must happen before copying or staging");
}

function assertNoIncidentConditionedFail(model) {
  for (const workflow of Object.values(model)) {
    for (const step of workflow.jobs.flatMap((job) => job.steps)) {
      if (step.run !== "exit 1") continue;
      assert.doesNotMatch(
        step.condition ?? "",
        /steps\.(?:pipeline|probe|budget|telemetry)\.outcome == 'failure'/,
        `${workflow.file}: incident state must not directly fail the run`,
      );
    }
  }
}

function cloneModel() {
  return structuredClone(workflows);
}

function mutateStep(model, workflow, name, patch, jobName = null) {
  Object.assign(stepOf(model, workflow, name, jobName), patch);
  return model;
}

function expectStepMutation({ workflow, job, name, patch, check = assertStepContracts, pattern, message }) {
  const mutated = mutateStep(cloneModel(), workflow, name, patch, job);
  assert.throws(() => check(mutated), pattern, message);
}

function expectJobMutation({ workflow, job, patch, check = assertPipelineTopology, pattern, message }) {
  const mutated = cloneModel();
  Object.assign(jobOf(mutated, workflow, job), patch);
  assert.throws(() => check(mutated), pattern, message);
}

assertStepContracts(workflows);
assertPipelineTopology(workflows);
assertCurrentRunArtifactBinding(workflows);
assertStaleArtifactGuard(workflows);
assertNoIncidentConditionedFail(workflows);

assert.doesNotMatch(workflows.pipeline.source, /git add (?:-A|--all)/);
assert.doesNotMatch(workflows.pipeline.source, /100xfenok-next\/public\/data\/admin\/alarm-state/);
assert.doesNotMatch(
  stepOf(workflows, "pipeline", "Post all-clear on the OPS issue", "check").raw,
  /gh issue create/,
  "all-clear must never open an issue",
);

// One mutation per material failure contract. These mutate the parsed model,
// avoiding indentation-sensitive source rewrites while proving each guard fires.
for (const detector of STEP_CONTRACTS.filter((contract) => contract.bestEffort && contract.id !== undefined)) {
  expectStepMutation({ ...detector, patch: { bestEffort: false }, pattern: /best-effort contract drifted/,
    message: `${detector.name}: detector must remain best-effort` });
}

expectStepMutation({ workflow: "pipeline", name: "Emit alarm state", patch: { bestEffort: true },
  pattern: /best-effort contract drifted/, message: "emitter failure must directly turn the job red" });

for (const reporting of STEP_CONTRACTS.filter((contract) => (
  contract.bestEffort === false && contract.name !== "Emit alarm state"
))) {
  expectStepMutation({ ...reporting, patch: { bestEffort: true }, pattern: /best-effort contract drifted/,
    message: `${reporting.name}: reporting failure must turn the job red` });
}

for (const conditional of STEP_CONTRACTS.filter((contract) => contract.condition !== undefined)) {
  const weakenedCondition = conditional.condition === "always()" ? "success()" : "always()";
  expectStepMutation({ ...conditional, patch: { condition: weakenedCondition }, pattern: /condition contract drifted/,
    message: `${conditional.name}: transition/dedup condition must remain exact` });
}

expectStepMutation({ workflow: "pipeline", job: "persist-alarm-state", name: "Commit alarm state", patch: { bestEffort: false },
  pattern: /best-effort contract drifted/, message: "alarm-state Git persistence must remain best-effort" });
expectJobMutation({ workflow: "pipeline", job: "persist-alarm-state",
  patch: { raw: workflows.pipeline.jobs.find((job) => job.name === "persist-alarm-state").raw.replace("needs: check", "needs: other") },
  pattern: /state persistence must depend on successful detection\/reporting/,
  message: "failed reporting must skip alarm-state persistence" });
expectJobMutation({ workflow: "pipeline", job: "persist-alarm-state",
  patch: { raw: workflows.pipeline.jobs.find((job) => job.name === "persist-alarm-state").raw.replace("group: fenok-data-writer-refs\/heads\/main", "group: persist-alarm-state") },
  pattern: /bounded global writer job/,
  message: "alarm-state persistence must join the global writer queue" });

{
  const staleBlind = cloneModel();
  const persist = stepOf(staleBlind, "pipeline", "Commit alarm state", "persist-alarm-state");
  persist.raw = persist.raw.replace(
    'if [ "$base_fingerprint" != "$current_fingerprint" ]; then',
    'if false; then',
  );
  assert.throws(
    () => assertStaleArtifactGuard(staleBlind),
    /stale-state comparison must exist/,
    "removing the stale-artifact comparison must fail the manifest guard",
  );
}

{
  const crossRun = cloneModel();
  const upload = stepOf(crossRun, "pipeline", "Upload alarm state for persistence", "check");
  upload.raw = upload.raw.replace("${{ github.run_id }}", "latest");
  assert.throws(
    () => assertCurrentRunArtifactBinding(crossRun),
    /uploaded alarm state must be named for the current run and attempt/,
    "artifact transfer must remain bound to the current workflow run",
  );
}

{
  const reordered = cloneModel();
  const steps = jobOf(reordered, "pipeline", "check").steps;
  const transferIndex = steps.findIndex((step) => step.name === "Prepare alarm state for persistence");
  const [transfer] = steps.splice(transferIndex, 1);
  steps.splice(steps.findIndex((step) => step.name === "Open or update OPS issue"), 0, transfer);
  assert.throws(
    () => assertPipelineTopology(reordered),
    /must precede state transfer/,
    "reporting must finish before state transfer",
  );
}

{
  const incidentFail = cloneModel();
  jobOf(incidentFail, "pipeline", "check").steps.push({
    name: "Fail on alarm",
    condition: "steps.pipeline.outcome == 'failure'",
    bestEffort: false,
    run: "exit 1",
    raw: "run: exit 1",
  });
  assert.throws(
    () => assertNoIncidentConditionedFail(incidentFail),
    /incident state must not directly fail the run/,
    "incident-conditioned final-fail semantics must remain forbidden",
  );
}

console.log("test-pipeline-failure-alarm-manifest: ok");
