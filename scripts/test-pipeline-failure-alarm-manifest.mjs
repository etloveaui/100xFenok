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

const workflows = Object.fromEntries(Object.entries(files).map(([key, file]) => [
  key,
  {
    file,
    source: fs.readFileSync(path.join(root, file), "utf8"),
    steps: parseSteps(fs.readFileSync(path.join(root, file), "utf8")),
  },
]));

const INCIDENT_IF =
  "steps.pipeline.outcome == 'failure' && steps.alarm_state.outputs.incident_changed != 'false'";
const ISSUE_COMMANDS = [/gh issue comment/, /gh issue create/];
const STEP_CONTRACTS = [
  { workflow: "pipeline", name: "Check pipeline job health", id: "pipeline", bestEffort: true },
  { workflow: "pipeline", name: "Emit alarm state", id: "alarm_state", condition: "always()", bestEffort: false },
  { workflow: "pipeline", name: "Prepare issue body", condition: INCIDENT_IF, bestEffort: false },
  { workflow: "pipeline", name: "Open or update OPS issue", condition: INCIDENT_IF, bestEffort: false, contains: ISSUE_COMMANDS },
  {
    workflow: "pipeline", name: "Post all-clear on the OPS issue", bestEffort: false,
    condition: "steps.alarm_state.outputs.incident_resolved == 'true'",
    contains: [/gh issue comment/, /gh issue close "\$existing" --reason completed --comment/],
  },
  {
    workflow: "pipeline", name: "Commit alarm state", bestEffort: true,
    contains: [
      /scripts\/stage-lane-manifest\.sh[\s\S]*--stage always_if_exists \|\| exit 0/,
      /git add data\/admin\/alarm-state\.json \|\| exit 0/,
    ],
  },
  { workflow: "probe", name: "Probe enrolled assets", id: "probe", bestEffort: true },
  {
    workflow: "probe", name: "Open or update probe issue", bestEffort: false,
    condition: "steps.probe.outcome == 'failure'", contains: ISSUE_COMMANDS,
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

function stepOf(model, workflow, name) {
  const step = model[workflow].steps.find((candidate) => candidate.name === name);
  assert.ok(step, `${model[workflow].file}: ${name} step must exist`);
  return step;
}

function assertStepContracts(model) {
  for (const contract of STEP_CONTRACTS) {
    const step = stepOf(model, contract.workflow, contract.name);
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
  const names = model.pipeline.steps.map((step) => step.name);
  const commitIndex = names.indexOf("Commit alarm state");
  for (const name of REPORTING_STEPS) {
    assert.ok(names.indexOf(name) < commitIndex, `${name} must precede alarm-state persistence`);
  }
  assert.equal(commitIndex, names.length - 1, "best-effort alarm-state commit must be the final step");
  assert.equal(
    stepOf(model, "pipeline", "Commit alarm state").condition,
    undefined,
    "alarm-state commit must rely on GitHub's default success gate so failed reporting skips persistence",
  );
}

function assertNoIncidentConditionedFail(model) {
  for (const workflow of Object.values(model)) {
    for (const step of workflow.steps) {
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

function mutateStep(model, workflow, name, patch) {
  Object.assign(stepOf(model, workflow, name), patch);
  return model;
}

function expectStepMutation({ workflow, name, patch, check = assertStepContracts, pattern, message }) {
  const mutated = mutateStep(cloneModel(), workflow, name, patch);
  assert.throws(() => check(mutated), pattern, message);
}

assertStepContracts(workflows);
assertPipelineTopology(workflows);
assertNoIncidentConditionedFail(workflows);

assert.doesNotMatch(workflows.pipeline.source, /git add (?:-A|--all)/);
assert.doesNotMatch(workflows.pipeline.source, /100xfenok-next\/public\/data\/admin\/alarm-state/);
assert.doesNotMatch(
  stepOf(workflows, "pipeline", "Post all-clear on the OPS issue").raw,
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

expectStepMutation({ workflow: "pipeline", name: "Commit alarm state", patch: { bestEffort: false },
  pattern: /best-effort contract drifted/, message: "alarm-state Git persistence must remain best-effort" });
expectStepMutation({ workflow: "pipeline", name: "Commit alarm state", patch: { condition: "always()" },
  check: assertPipelineTopology, pattern: /default success gate/,
  message: "failed reporting must skip alarm-state persistence" });

{
  const reordered = cloneModel();
  const steps = reordered.pipeline.steps;
  const [commit] = steps.splice(steps.findIndex((step) => step.name === "Commit alarm state"), 1);
  steps.splice(steps.findIndex((step) => step.name === "Open or update OPS issue"), 0, commit);
  assert.throws(
    () => assertPipelineTopology(reordered),
    /must precede alarm-state persistence/,
    "reporting must finish before alarm-state persistence",
  );
}

{
  const incidentFail = cloneModel();
  incidentFail.pipeline.steps.push({
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
