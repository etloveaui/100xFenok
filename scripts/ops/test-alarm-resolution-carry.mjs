#!/usr/bin/env node
// The alarm's persistence step turned red for a guard behaving correctly.
//
// Two alarm runs overlap routinely: the check job serialises on its own group,
// but persist queues on the global writer lock, so a later run can land its
// state while an earlier run is still waiting. The earlier run then finds the
// base fingerprint changed and refuses - correctly, because a stale document
// must not overwrite a newer one. It then exited 1 and emitted the same
// ::error:: as three genuinely different faults.
//
// Measured over the last 140 alarm runs: 12 failures, 10 of which reached that
// one collapsed message. Over the last 100: 4 of 5 failures were this guard,
// all starting within 30 minutes of the previous run - a bucket with a 12%
// failure rate against 0% above 30 minutes. A detector whose red is usually
// benign teaches operators to ignore it, which is the failure this programme
// exists to prevent.
//
// Nothing is lost by the refusal: every incident field is recomputed from the
// live API each run, and the OPS issue was already written by the check job
// before persist ran. There is exactly ONE exception, and it is why this file
// exists rather than a bare `exit 0`. `last_resolved_at` is the only field the
// emitter carries forward from the prior document, so if a discarded run was
// the sole observer of an open -> clear transition, that timestamp would be
// lost. It is forward-carried before standing down.

import assert from "node:assert/strict";

import { decideResolutionCarry } from "./carry-alarm-resolution.mjs";

const doc = (lastResolvedAt, extra = {}) => ({
  schema_version: 1,
  status: "open",
  last_resolved_at: lastResolvedAt,
  ...extra,
});

// --- The exception this exists for: the discarded run saw the resolution -----
{
  const verdict = decideResolutionCarry({
    artifact: doc("2026-08-21T04:00:00.000Z"),
    current: doc("2026-07-22T08:30:32.025Z"),
  });
  assert.equal(verdict.carry, true, "a newer resolution seen only by the losing run must survive");
  assert.equal(verdict.last_resolved_at, "2026-08-21T04:00:00.000Z");
}

// --- The ordinary case: main already knows at least as much ------------------
for (const [artifact, current] of [
  ["2026-07-22T08:30:32.025Z", "2026-07-22T08:30:32.025Z"],
  ["2026-07-22T08:30:32.025Z", "2026-08-21T04:00:00.000Z"],
  [null, "2026-08-21T04:00:00.000Z"],
  [null, null],
]) {
  const verdict = decideResolutionCarry({ artifact: doc(artifact), current: doc(current) });
  assert.equal(verdict.carry, false, `nothing to carry for ${artifact} over ${current}`);
}

// A resolution the losing run saw where main has none at all still counts.
assert.equal(
  decideResolutionCarry({ artifact: doc("2026-08-21T04:00:00.000Z"), current: doc(null) }).carry,
  true,
);

// --- Fail closed on anything unreadable -------------------------------------
// Carrying a field derived from a document we could not parse would write
// garbage into the one value this whole mechanism exists to protect.
for (const bad of [
  { artifact: null, current: doc(null) },
  { artifact: doc("not a timestamp"), current: doc(null) },
  { artifact: doc("2026-08-21T04:00:00.000Z"), current: null },
  { artifact: doc("2026-08-21T04:00:00.000Z"), current: doc("not a timestamp") },
  {},
]) {
  const verdict = decideResolutionCarry(bad);
  assert.equal(verdict.carry, false, `unreadable input must not carry: ${JSON.stringify(bad)}`);
  assert.ok(verdict.reason, "an unreadable input must say why it stood down");
}

// --- The workflow must stand down on CAS refusal, and only on that ------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "pipeline-failure-alarm.yml"), "utf8",
);

// Anchor on the comparison, not on a message. A first version pinned the old
// error string and broke the moment the string was replaced, which is a
// contract asserting a spelling rather than a behaviour.
const casAt = workflow.indexOf('if [ "$base_fingerprint" != "$current_fingerprint" ]');
assert.ok(casAt > 0, "the compare-and-swap guard is gone; this contract is stale");
const casBlock = workflow.slice(casAt, casAt + 1600);
assert.match(
  casBlock,
  /carry-alarm-resolution\.mjs/,
  "the CAS path must forward-carry last_resolved_at before standing down",
);
assert.match(casBlock, /::notice::/, "a correct refusal must not be reported as an error");
assert.match(casBlock, /exit 0/, "a correct refusal must stand down, not fail the job");
// The only ::error:: permitted inside the CAS block is the one for failing to
// PUSH a carried resolution, which is a genuine fault.
for (const line of [...casBlock.matchAll(/::error::([^\n"]*)/g)].map((m) => m[1])) {
  assert.match(
    line,
    /resolution carry could not be pushed/,
    `the CAS path must not raise errors for refusing: ${line.trim()}`,
  );
}

// Every OTHER failure path keeps exit 1 and must not share one message. The
// collapsed signal is the defect; distinct causes need distinct lines.
const persistStep = workflow.slice(
  workflow.indexOf("- name: Commit alarm state"),
  workflow.indexOf("- name: Surface alarm-state persistence"),
);
// Anchor on the guards themselves. Pinning their wording is what broke twice
// while writing this file, and a contract that asserts a spelling drifts the
// moment the message is improved.
assert.match(
  persistStep,
  /grep -Eq '\^\[0-9a-f\]\{64\}\$'/,
  "the fingerprint-shape guard is gone; this contract is stale",
);
assert.match(
  persistStep,
  /for attempt in 1 2 3; do[\s\S]{0,200}git push origin HEAD:main/,
  "the bounded push retry is gone; this contract is stale",
);
const errorLines = [...persistStep.matchAll(/::error::([^\n"]*)/g)].map((m) => m[1].trim());
assert.ok(errorLines.length >= 2, "each genuine fault needs its own error line, not one shared message");
assert.equal(
  new Set(errorLines).size,
  errorLines.length,
  `two genuine faults still share one message: ${errorLines.join(" | ")}`,
);

console.log("test-alarm-resolution-carry: ok");
