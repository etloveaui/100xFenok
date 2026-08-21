#!/usr/bin/env node
// The liveness terminator was built on a premise its own header stated and the
// repository does not honour: "Every run persists data/admin/alarm-state.json
// with a generated_at". It does not. emit-alarm-state.mjs writes the PRIOR
// document back byte-identical when no significant key changed, so the stamp
// only advances when the INCIDENT changes - not when the alarm runs.
//
// Measured over the 299 alarm-state commits between 2026-07-24T09:38:46Z and
// 2026-08-21T02:26:20Z, 51 gaps (17.1%) exceeded the 3h ceiling, totalling
// 237.3h of false staleness. The largest was 23.8h - 2026-08-13T10:50:34Z to
// 2026-08-14T10:37:31Z - during which the alarm ran 21 times, every one a
// success. A stamp-age rule would have reported the alarm dead for most of a
// day while it worked perfectly.
//
// The limit was never the problem, so it is not widened here. The MEASUREMENT
// is replaced: liveness now counts the alarm's own scheduled slots that passed
// with no run, which is the same rule the alarm applies to the four detectors
// it watches.
//
// Independence is load-bearing and is why the slot counter is inlined rather
// than imported from check-pipeline-job-health.mjs: that module is the very
// machinery this check exists to observe, and importing it would also drag in
// the deep module graph whose breakage disarmed four lanes on 2026-08-17. The
// two implementations are bound by an equivalence assertion below instead, so
// drift fails loudly here rather than silently in production.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { missedSlotCount } from "./check-pipeline-job-health.mjs";
import {
  ALARM_MISSED_SLOT_THRESHOLD,
  countMissedSlots,
  evaluateAlarmLiveness,
  readAlarmCron,
} from "./check-alarm-liveness.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// The cron is derived from the alarm's own workflow, never hand-copied. If the
// alarm is rescheduled, this rule follows it; a hand-kept constant would rot.
// ---------------------------------------------------------------------------
const cron = readAlarmCron(REPO_ROOT);
assert.equal(typeof cron, "string", "the alarm cron must be readable from its workflow");
assert.match(cron, /^\S+( \S+){4}$/, `alarm cron is not a 5-field cron: ${cron}`);

const workflow = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "pipeline-failure-alarm.yml"),
  "utf8",
);
assert.ok(
  workflow.includes(`- cron: '${cron}'`),
  "readAlarmCron must return a cron the workflow actually declares",
);

// Value-matching alone cannot tell a read from a hardcode that happens to be
// correct today - a literal '23 * * * *' passed this file's first version. The
// derivation itself is what must hold, so point the reader at a workflow that
// declares something else and require it to follow.
{
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-cron-"));
  const fixtureDir = path.join(fixtureRoot, ".github", "workflows");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "pipeline-failure-alarm.yml"),
    "on:\n  schedule:\n    - cron: '44 */3 * * *'\n",
  );
  try {
    assert.equal(
      readAlarmCron(fixtureRoot),
      "44 */3 * * *",
      "readAlarmCron must derive the cadence from the workflow, not carry a copy",
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The inlined counter must agree with the alarm's own, across every cadence
// class the rule can meet. This is what makes inlining safe.
// ---------------------------------------------------------------------------
const base = Date.parse("2026-08-21T00:00:00Z");
// Every branch of the cadence reader must be exercised, or a drift in an
// uncovered branch passes. The weekly branch was missing on the first pass and
// a 24*7 -> 24*6 mutation went undetected.
for (const c of [
  "23 * * * *",    // hourly
  "7 * * * *",     // hourly, different minute
  "41 */6 * * *",  // stepped hours
  "15 10 * * *",   // daily
  "30 7 * * 0",    // weekly (dayOfWeek)
  "0 7 * * 1",     // weekly, different day
  "0 9 1 * *",     // monthly (dayOfMonth)
  "0 9 15 * *",    // monthly, different day
]) {
  // The elapsed grid must separate the cadence classes, not merely visit them.
  // A weekly 24*7 -> 24*6 drift survived a grid that stopped at 200h, because
  // both step sizes yield the same slot count there.
  for (const elapsed of [
    0, 0.5, 1, 1.9, 2, 3, 5, 7, 13, 25, 47, 100,
    145, 150, 160, 169, 200, 290, 340,   // separates 144h from 168h
    700, 730, 745, 800, 1450, 1500,     // 730 and 1450 separate 24*30 from 24*31
  ]) {
    const since = base;
    const now = base + elapsed * HOUR;
    assert.equal(
      countMissedSlots(c, since, now),
      missedSlotCount(c, since, now),
      `inlined counter drifted from the alarm's rule at cron=${c} elapsed=${elapsed}h`,
    );
  }
}
assert.equal(countMissedSlots("not a cron", base, base + HOUR), null);

// ---------------------------------------------------------------------------
// THE REGRESSION. The 2026-08-13 incident, replayed. The alarm ran throughout;
// only the stamp was frozen. This must read live.
// ---------------------------------------------------------------------------
const frozenStampIncident = evaluateAlarmLiveness({
  // The real gap: stamp last advanced 23.8h before now.
  latestRunStartedAt: "2026-08-14T10:26:01Z", // the alarm's actual newest run in that window
  cron: "23 * * * *",
  nowMs: Date.parse("2026-08-14T10:37:31Z"),
});
assert.equal(
  frozenStampIncident.status,
  "live",
  "the alarm ran 21 times in that window; a frozen stamp must not read as death",
);

// ---------------------------------------------------------------------------
// Slot semantics: one dropped slot is routine, two is not.
// ---------------------------------------------------------------------------
const now = Date.parse("2026-08-21T03:30:00Z");
assert.equal(ALARM_MISSED_SLOT_THRESHOLD, 2, "two missed slots is the alarm's own tolerance");

const ranLastSlot = evaluateAlarmLiveness({
  latestRunStartedAt: "2026-08-21T03:23:00Z", cron: "23 * * * *", nowMs: now,
});
assert.equal(ranLastSlot.status, "live");
assert.equal(ranLastSlot.missed_slots, 0);

const oneDropped = evaluateAlarmLiveness({
  latestRunStartedAt: "2026-08-21T02:23:00Z", cron: "23 * * * *", nowMs: now,
});
assert.equal(oneDropped.status, "live", "GitHub drops single slots routinely");
assert.equal(oneDropped.missed_slots, 1);

const twoDropped = evaluateAlarmLiveness({
  latestRunStartedAt: "2026-08-21T01:23:00Z", cron: "23 * * * *", nowMs: now,
});
assert.equal(twoDropped.status, "stale", "two consecutive missed slots is the incident shape");
assert.equal(twoDropped.missed_slots, 2);
assert.match(twoDropped.reason, /2 .*slot/i);

// The 2026-08-21T01:30Z incident the feature was written for, on the alarm's
// own clock. An elapsed-multiple rule missed this by 0.09h; slot counting must not.
const measuredIncident = evaluateAlarmLiveness({
  latestRunStartedAt: "2026-08-20T23:35:00Z", cron: "23 * * * *",
  nowMs: Date.parse("2026-08-21T01:30:00Z"),
});
assert.equal(measuredIncident.status, "stale");
assert.equal(measuredIncident.missed_slots, 2);

// ---------------------------------------------------------------------------
// Fail closed. Absence of evidence is never an all-clear.
// ---------------------------------------------------------------------------
for (const missing of [null, undefined, "", "not a timestamp"]) {
  const r = evaluateAlarmLiveness({ latestRunStartedAt: missing, cron: "23 * * * *", nowMs: now });
  assert.equal(r.status, "unreadable", `a missing run time must not read live: ${String(missing)}`);
}
assert.equal(
  evaluateAlarmLiveness({ latestRunStartedAt: "2026-08-21T03:23:00Z", cron: "nope", nowMs: now }).status,
  "unreadable",
  "an unreadable cron must not read live",
);

// ---------------------------------------------------------------------------
// The replaced measurement must be gone, not merely unused. A stamp-age rule
// left in place would be re-adopted by the next reader.
// ---------------------------------------------------------------------------
const source = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "ops", "check-alarm-liveness.mjs"), "utf8",
);
// Prose may name the removed measurement - that is how the next reader learns
// why it went. Only executable lines are held to the ban.
const code = source.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
assert.ok(
  !/alarm-state\.json/.test(code),
  "liveness must no longer read the incident document; its stamp does not measure runs",
);
assert.ok(
  !/ALARM_MAX_AGE_HOURS/.test(code),
  "the stamp-age ceiling must be removed, not retained alongside the slot rule",
);
for (const line of code.split("\n")) {
  assert.ok(
    !/generated_at/.test(line),
    `liveness must not consult the incident stamp: ${line.trim()}`,
  );
}

// Independence: node builtins plus nothing. Importing the alarm's own modules
// would reintroduce both the recursion and the module-graph fragility.
for (const line of source.split("\n").filter((l) => /^import /.test(l))) {
  assert.match(line, /from "node:[a-z]+";$/, `liveness must import only node builtins: ${line}`);
}

console.log("test-alarm-liveness: ok");
