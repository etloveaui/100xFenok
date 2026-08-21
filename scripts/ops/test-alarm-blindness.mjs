#!/usr/bin/env node
// The alarm that watches every other detector fails open.
//
// check-pipeline-job-health catches any GitHub API failure per workflow, marks
// that workflow "unknown", and its final line is
// `process.exit(alarms.length > 0 ? ALERT_EXIT : 0)`. Unknowns are not alarms,
// so the process exits 0. The workflow gates all reporting on
// `steps.pipeline.outcome == 'failure'`, so nothing is reported. An API outage
// at alarm time therefore makes all 34 watched workflows unreadable and the
// alarm says everything is fine, with nothing counting how long that lasts.
//
// The catch comment states the intent - "a transient API failure must never
// itself alarm" - and that intent is correct and preserved here. What was
// missing is a bound. A transient failure hits one workflow; blindness is
// correlated and hits most of them at once. So a minority of unknowns stays
// quiet exactly as before, and a MAJORITY means the alarm's "ok" describes a
// minority of what it claims to watch, which is not evidence of health.
//
// Majority is used deliberately instead of a tuned number: it is the point at
// which the statement "everything I watch is fine" stops being mostly true.
//
// The unset-repository path is separate and is not transient at all. It wrote
// status "unknown" and exited 0, so a misconfigured alarm reported green
// forever. Configuration faults cannot fix themselves and must be loud.

import assert from "node:assert/strict";

import {
  BLINDNESS_REASON,
  buildBlindnessBody,
  classifyAlarmBlindness,
} from "./check-pipeline-job-health.mjs";

// --- A minority of unknowns is transient and must stay quiet ----------------
for (const [watched, unknown] of [[34, 0], [34, 1], [34, 5], [34, 16], [34, 17], [3, 1], [1, 0]]) {
  const verdict = classifyAlarmBlindness({ watched, unknown });
  assert.equal(
    verdict.blind,
    false,
    `${unknown} of ${watched} unknown is a minority and must not alarm by itself`,
  );
  assert.equal(verdict.reason, null);
}

// --- A majority means the alarm cannot make its assertion -------------------
for (const [watched, unknown] of [[34, 18], [34, 34], [3, 2], [2, 2], [1, 1]]) {
  const verdict = classifyAlarmBlindness({ watched, unknown });
  assert.equal(
    verdict.blind,
    true,
    `${unknown} of ${watched} unknown leaves the alarm asserting about a minority`,
  );
  assert.equal(verdict.reason, BLINDNESS_REASON);
}

// The exact boundary, stated so a refactor cannot drift it silently.
assert.equal(classifyAlarmBlindness({ watched: 34, unknown: 17 }).blind, false);
assert.equal(classifyAlarmBlindness({ watched: 34, unknown: 18 }).blind, true);

// --- Nothing watched at all is blindness, not health ------------------------
// An empty watch list would otherwise report ok, which is the same failure in
// a different costume: asserting health over nothing.
assert.equal(classifyAlarmBlindness({ watched: 0, unknown: 0 }).blind, true);

// --- Malformed input must never read as healthy -----------------------------
for (const input of [undefined, {}, { watched: null, unknown: null }, { watched: "34", unknown: 0 }]) {
  assert.equal(
    classifyAlarmBlindness(input).blind,
    true,
    `unusable counts must fail closed, not report health: ${JSON.stringify(input)}`,
  );
}

// --- The blindness reason must be usable by an operator ---------------------
assert.equal(typeof BLINDNESS_REASON, "string");
assert.ok(BLINDNESS_REASON.length >= 20, "the reason must say what happened");
assert.ok(
  !/unknown error|failed|error occurred/i.test(BLINDNESS_REASON),
  "the reason must describe blindness, not restate a generic failure",
);

// --- The exit path must actually be wired ------------------------------------
// A pure function nobody calls is the vacuous-contract shape that let today's
// credential defect ship, so assert the seam and not only the logic.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const healthSource = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "ops", "check-pipeline-job-health.mjs"), "utf8",
);
const healthCode = healthSource.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

assert.ok(
  /classifyAlarmBlindness\(/.test(healthCode.replace(/export function classifyAlarmBlindness[^\n]*/, "")),
  "classifyAlarmBlindness is defined but never called; the check would be decorative",
);
assert.ok(
  !/process\.exit\(alarms\.length > 0 \? ALERT_EXIT : 0\)/.test(healthCode),
  "the exit still ignores blindness: an unreadable run would exit 0 and report nothing",
);

// The unset-repository path deliberately still exits 0, and that is asserted
// here so it reads as a decision rather than an oversight. It was changed while
// fixing this defect and changed back: the Actions runner always sets
// GITHUB_REPOSITORY, so in CI the path is unreachable and it exists only for
// running the script by hand offline, where alarming would be noise.
// test-check-pipeline-job-health has asserted that exit 0 since before this
// work, and the real fail-open was the API path, which classifyAlarmBlindness
// now bounds.
const unsetIndex = healthSource.indexOf("GITHUB_REPOSITORY is not set");
assert.ok(unsetIndex > 0, "the unset-repository path is gone; its contract below is stale");
assert.ok(
  /process\.exit\(0\);/.test(healthSource.slice(unsetIndex, unsetIndex + 1400)),
  "the offline unset-repository path must keep exiting 0; see the note above",
);

// An operator must be told what happened, through the body the workflow reads.
// Asserting only that the string "issueBody" appears somewhere after the
// classifier was vacuous - the alarms path sets it too, so deleting the
// blindness body entirely still passed. Exercise the body, then require the
// blindness branch to actually assign it.
{
  const body = buildBlindnessBody({
    watched: 34,
    unknown: 30,
    unknownWorkflows: [
      { file: "fetch-sentiment.yml", message: "gh api 503" },
      { file: "deploy-worker.yml", message: undefined },
    ],
  });
  assert.match(body, /could not see/i, "the body must say the alarm was blind");
  assert.match(body, /30 of 34/, "the body must carry the measured counts");
  assert.match(body, /fetch-sentiment\.yml/, "the body must name the unreadable workflows");
  assert.match(body, /gh api 503/, "the body must carry each workflow's reason");
  assert.match(body, /no message/, "a workflow with no message must still be listed");
  // Asserting the ABSENCE of reassuring words was tried and was wrong: the body
  // says "does not assert that the pipeline is healthy", and a keyword ban
  // cannot read negation. Assert the positive marker instead.
  assert.ok(
    body.startsWith("[alert]"),
    `the body must open with the alert marker the operator scans for: ${body.slice(0, 40)}`,
  );
}

const blindBranch = healthCode.slice(healthCode.indexOf("if (blindness.blind) {"));
assert.ok(
  blindBranch.startsWith("if (blindness.blind) {"),
  "the blindness branch is gone; nothing would report an unreadable run",
);
assert.ok(
  /result\.issueBody\s*=/.test(blindBranch.slice(0, 700)),
  "the blindness branch must assign result.issueBody; the workflow reports only that",
);

console.log("test-alarm-blindness: ok");
