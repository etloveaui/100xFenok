#!/usr/bin/env node
// B-386. PLANE_FRESHNESS_MAX_AGE_HOURS was a single flat 60 applied to every
// age-mode family, whose cadences span one hour to a month. Its own comment
// says it was calibrated for one weekday family.
//
// The defect runs BOTH ways, and the second half was never reported. A weekly
// producer breaches 60h for 108 of every 168 healthy hours and a monthly one
// for about 91% of its cycle - three of the seven open alarm rows on
// 2026-08-21 were exactly that and nothing else. But an HOURLY producer is
// invisible for two and a half days before a flat 60h notices it is dead.
//
// The ceiling is now derived from each producer's own declared cron plus the
// grace already declared for it, which is the same correction applied to the
// serving-probe axis on 2026-08-21 (551 FAIL to 9, where the survivors were
// honest staleness). Seven families get a TIGHTER ceiling than 60h under this
// rule, including 60h -> 7h for the two hourly lanes and 60h -> 12h for
// treasury-tga. That is the evidence the rule was not tuned to make today's
// board green: it makes the fastest lanes in the fleet harder to pass.
//
// A family whose cadence cannot be resolved FAILS CLOSED. Defaulting such a
// family to any number is how the flat ceiling happened in the first place.

import assert from "node:assert/strict";

import {
  deriveFailureStreakThreshold,
  maxCronGapHours,
  planeFreshnessCeilingHours,
} from "./check-pipeline-job-health.mjs";

// --- The cadence gap must be the WORST case, not the best -------------------
// A weekday-only cron's longest wait is the weekend, and a family is late
// against its longest healthy wait, never its shortest.
assert.equal(maxCronGapHours(["0 8 * * *"]), 24, "daily");
assert.equal(maxCronGapHours(["0 */6 * * *"]), 6, "six-hourly");
assert.equal(maxCronGapHours(["12 * * * *"]), 1, "hourly");
assert.equal(maxCronGapHours(["0 22 * * 1-5"]), 72, "weekday-only spans the weekend");
assert.equal(maxCronGapHours(["17 11 * * 6"]), 168, "weekly");
assert.equal(maxCronGapHours(["0 8 1 * *"]), 744, "monthly must use the longest month");

// Day-of-month and day-of-week are OR in cron, so a 1-7 + Monday declaration
// fires every Monday, not only in the first week.
assert.equal(maxCronGapHours(["0 6 1-7 * 1"]), 168, "day-of-month OR day-of-week");

// Multiple crons combine into one effective cadence.
assert.equal(maxCronGapHours(["50 23 * * 1-5", "20 23 * * 0"]), 47.5, "combined declarations");

// Unresolvable input must throw, never return a number a caller would trust.
for (const bad of [[], null, undefined, ["not a cron"], [""], [{}]]) {
  assert.throws(() => maxCronGapHours(bad), `unresolvable cadence must fail closed: ${JSON.stringify(bad)}`);
}
// Stated honestly rather than dressed up: two mutations do NOT fail this file,
// and neither is a gap in the assertions.
//   - Deleting the empty-declarations guard still throws, because the Gregorian
//     walk then finds no occurrence and raises its own error. Fail-closed is
//     preserved by defence in depth; only the message changes.
//   - Deleting the cycle-wrap term changes no value here, because no cron this
//     repository declares makes the wrap the binding gap - the longest month
//     already appears inside the cycle. The term is completeness for a cron
//     that fires once per cycle, and inventing a fixture to force it would be
//     asserting a shape rather than a behaviour.

// --- The ceiling is cadence plus the declared grace -------------------------
assert.equal(
  planeFreshnessCeilingHours({ crons: ["12 * * * *"], graceHours: 6 }),
  7,
  "an hourly lane gets 1h + 6h grace, not 60h - it was invisible for 2.5 days",
);
assert.equal(planeFreshnessCeilingHours({ crons: ["0 */6 * * *"], graceHours: 6 }), 12);
assert.equal(planeFreshnessCeilingHours({ crons: ["0 8 * * *"], graceHours: 24 }), 48);
assert.equal(planeFreshnessCeilingHours({ crons: ["17 11 * * 6"], graceHours: 48 }), 216);
assert.equal(planeFreshnessCeilingHours({ crons: ["0 8 1 * *"], graceHours: 168 }), 912);

// Fail closed rather than default.
for (const bad of [{}, { crons: [] }, { crons: ["12 * * * *"] }, { crons: ["12 * * * *"], graceHours: -1 }]) {
  assert.throws(
    () => planeFreshnessCeilingHours(bad),
    `a family whose ceiling cannot be derived must fail closed: ${JSON.stringify(bad)}`,
  );
}

// --- The derivation must tighten as well as loosen --------------------------
// If every derived ceiling were >= 60 the rule would just be a widening, which
// is the shape forbidden by the standing no-tuning rule.
const hourly = planeFreshnessCeilingHours({ crons: ["12 * * * *"], graceHours: 6 });
const monthly = planeFreshnessCeilingHours({ crons: ["0 8 1 * *"], graceHours: 168 });
assert.ok(hourly < 60, `an hourly lane must end up tighter than the flat ceiling, got ${hourly}`);
assert.ok(monthly > 60, `a monthly lane must end up looser than the flat ceiling, got ${monthly}`);

// --- The existing threshold derivation must not regress ---------------------
// Both walk the same Gregorian cycle; a shared refactor that broke one would be
// caught here rather than in production.
assert.equal(deriveFailureStreakThreshold(["12 * * * *"]), 2, "fast cadence keeps the noise guard");
assert.equal(deriveFailureStreakThreshold(["17 11 * * 6"]), 1, "weekly pages on the first failure");
assert.equal(deriveFailureStreakThreshold(["0 8 1 * *"]), 1, "monthly pages on the first failure");

console.log("test-plane-ceiling-matches-cadence: ok");
