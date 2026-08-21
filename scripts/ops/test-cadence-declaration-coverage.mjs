#!/usr/bin/env node
// The alarm can see a watched workflow FAIL, but it can only see one STOP if
// that workflow has a declared cadence. Eight watched workflows currently carry
// cadence_status "no_declaration", and six of them are the platform's own
// detectors and publishers - the serving probe, the SEC 13F parity check, the
// writer-queue observer, the budget alarm, Update Manifest and Deploy Worker.
// That is the exact shape of every incident found on 2026-08-20: the failure
// was recorded, the silence was not.
//
// This does not attempt to alarm on absence, which would change what the alarm
// asserts for eight workflows at once. It removes the silent default: a
// scheduled workflow must either carry a data-supply cadence declaration or be
// exempted on the record with a reason, so the next one cannot inherit
// invisibility by omission.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "../lib/data-supply-detection-config.mjs";
import { CADENCE_DECLARATION_EXEMPTIONS } from "./check-pipeline-job-health.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

const scheduled = fs.readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith(".yml"))
  .filter((name) => /cron:\s*'/.test(fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8")))
  .sort();

// Read the declaration config directly rather than through the health module's
// internal row builder, so this contract does not depend on that function
// staying exported.
function declaredWorkflowNames(config) {
  const names = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.workflow === "string") names.add(path.basename(node.workflow));
    Object.values(node).forEach(walk);
  };
  walk(config);
  return names;
}

const declaredWorkflows = declaredWorkflowNames(DATA_SUPPLY_DETECTION_CONFIG);

const undeclared = scheduled.filter((name) => !declaredWorkflows.has(name));
const unaccounted = undeclared.filter((name) => !CADENCE_DECLARATION_EXEMPTIONS[name]);

assert.deepEqual(
  unaccounted,
  [],
  "every scheduled workflow must carry a cadence declaration or an exemption with a reason, "
    + `otherwise its silence is invisible:\n  ${unaccounted.join("\n  ")}`,
);

// An exemption is a recorded decision, not a placeholder.
for (const [name, reason] of Object.entries(CADENCE_DECLARATION_EXEMPTIONS)) {
  assert.ok(
    scheduled.includes(name),
    `${name} is exempted from cadence declaration but is not a scheduled workflow`,
  );
  assert.ok(
    typeof reason === "string" && reason.trim().length >= 20,
    `${name} needs a real reason for having no cadence declaration`,
  );
  assert.ok(
    !declaredWorkflows.has(name),
    `${name} is both declared and exempted; the exemption is dead and must be removed`,
  );
}

console.log(
  `cadence declaration coverage: ok (${scheduled.length} scheduled, `
    + `${scheduled.length - undeclared.length} declared, ${undeclared.length} exempted on the record)`,
);
