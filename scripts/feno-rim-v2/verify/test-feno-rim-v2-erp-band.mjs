#!/usr/bin/env node

// FENO RIM v2 — restored ERP band consumption tests (band wiring slice).
//
// Pins, on the committed restoration artifact:
// 1. point-in-time windows — the band at an origin uses THAT origin's trailing
//    52 weekly states, never the latest window;
// 2. zero admissible states refuse with a stated reason (no later-vintage
//    fallback);
// 3. point bands (min == max) are served, not thrown;
// 4. the first-knowable component of the window is the latest admissible
//    release, always at or before the origin;
// 5. distinct-release count rides along.

import assert from "node:assert/strict";
import { erpWindowAt } from "../erp-band.mjs";

// Point-in-time: a 2015-06-30 origin sees the 2014 and 2015 releases in its
// 52-week state window (2 distinct); the current date sits past 52 weeks since
// the 2025-01-31 release and sees a single-release point.
const mid2015 = erpWindowAt("2015-06-30", "us");
assert.equal(mid2015.states_used, 52, "mid-2015 origin uses a full 52-week window");
assert.equal(mid2015.distinct_releases, 2, "two annual releases inside the mid-2015 state window");
assert.ok(mid2015.first_knowable <= "2015-06-30", "window first-knowable at or before the origin");
assert.ok(mid2015.band.low < mid2015.band.high, "mid-window band is a range");

const today = erpWindowAt("2026-08-06", "us");
assert.equal(today.point, true, "evaluation date sits past 52 weeks since the last release: point band");
assert.equal(today.distinct_releases, 1, "single distinct release in the point window");
assert.ok(today.first_knowable <= "2026-08-06", "point window first-knowable at or before the origin");

// KR band is the Korea market's own states.
const kr = erpWindowAt("2021-06-30", "kr");
assert.equal(kr.distinct_releases, 2, "KR mid-2021 window spans two releases");
assert.ok(Math.abs(kr.band.high - kr.band.low) > 0, "KR band is a range there");

// Zero admissible states refuse with a stated reason.
assert.throws(() => erpWindowAt("2000-06-01", "us"), /zero admissible restored ERP states/);

// Unknown market refused.
assert.throws(() => erpWindowAt("2020-01-01", "jp"), /unknown market/);

console.log("feno-rim-v2 erp-band tests passed");
