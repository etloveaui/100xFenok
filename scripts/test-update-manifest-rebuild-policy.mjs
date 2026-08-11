#!/usr/bin/env node
// Rebuild-policy gate for update-manifest.yml (DEC-261 follow-up).
//
// Every workflow_dispatch — including the ~19 source workflows that dispatch
// with no inputs — must rebuild current SlickCharts membership before strict
// validation. The historical gate
//   inputs.rebuild_slickcharts == 'true'   (input default: false)
// made omitted-input dispatches rebuild-less, so strict validation ran against
// a stale universe/membership projection and failed 20 consecutive runs.
//
// Pinned policy:
//   - primary and retry steps share ONE identical REBUILD_SLICKCHARTS expression
//   - the expression derives rebuild from the trigger event only
//     (push | schedule | workflow_dispatch), never from an input value
//   - rebuild_slickcharts survives as a legacy compatibility input with
//     default:true — legacy callers still pass -f rebuild_slickcharts=true and
//     must not break — but the policy ignores its value entirely, so no
//     dispatch path (omitted, true, or false) can disable the rebuild
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = new URL("../.github/workflows/update-manifest.yml", import.meta.url);
const workflow = fs.readFileSync(workflowPath, "utf8");

// --- Compatibility input: present, default true, never consulted. ---
const inputBlock = /(?:\n|^)      rebuild_slickcharts:\n([\s\S]*?)(?=\n\S)/.exec(workflow);
assert.ok(inputBlock !== null,
  "rebuild_slickcharts compatibility input must stay declared for legacy callers passing -f rebuild_slickcharts=true");
assert.match(inputBlock[1], /default: true/, "compatibility input default must stay true");
assert.match(inputBlock[1], /type: boolean/, "compatibility input must stay boolean-typed");

// --- Both rebuild steps must share the same derived policy. ---
const assignments = [...workflow.matchAll(/REBUILD_SLICKCHARTS:\s*(\$\{\{[^}]*\}\})/g)];
assert.equal(assignments.length, 2,
  `expected exactly two REBUILD_SLICKCHARTS assignments (primary + retry), got ${assignments.length}`);
const [primaryExpr, retryExpr] = assignments.map((match) => match[1]);
assert.equal(primaryExpr, retryExpr, "primary and retry steps must use the identical rebuild policy");
assert.doesNotMatch(primaryExpr, /inputs|rebuild_slickcharts/,
  "rebuild policy must never consult an input value: the compatibility flag is ignored");

// --- Evaluate the policy against GitHub expression semantics. ---
const CLAUSE = /^github\.event_name == '([a-z_]+)'$/;
function rebuildPolicy(eventName) {
  const expr = primaryExpr.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  const clauses = expr.split(" || ");
  assert.ok(clauses.length >= 1, `policy must be a disjunction of event comparisons: ${expr}`);
  const names = clauses.map((clause) => {
    const match = CLAUSE.exec(clause);
    assert.ok(match !== null,
      `policy clause must compare github.event_name to a literal trigger name, got: ${clause}`);
    return match[1];
  });
  assert.deepEqual(names, ["push", "schedule", "workflow_dispatch"],
    "policy must cover exactly the declared triggers: push, schedule, workflow_dispatch");
  return names.includes(eventName);
}

for (const eventName of ["push", "schedule"]) {
  assert.equal(rebuildPolicy(eventName), true, `${eventName} events must always rebuild`);
}
// Dispatch semantics: input omitted, explicitly true, or explicitly false —
// the policy must ignore the value entirely and rebuild in every case.
for (const inputValue of [undefined, "true", "false"]) {
  assert.equal(rebuildPolicy("workflow_dispatch"), true,
    `workflow_dispatch must rebuild regardless of input value (${String(inputValue)})`);
}
assert.equal(rebuildPolicy("workflow_call"), false,
  "policy must fail closed for undeclared triggers so adding a trigger requires an explicit policy update");

console.log("test-update-manifest-rebuild-policy: ok");
