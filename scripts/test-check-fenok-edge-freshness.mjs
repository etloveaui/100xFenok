#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  activeS0DailyGatedReady,
  freshnessReady,
  fullSourceCoverage,
  requirementsReady,
  warnOnlyStaleCountedSource,
} from "./check-fenok-edge-freshness.mjs";

const freshOccChecks = [{ id: "us_occ_source_date", status: "ready" }];

assert.equal(freshnessReady(freshOccChecks, "us_occ_source_date"), true);
assert.equal(freshnessReady([{ id: "us_occ_source_date", status: "stale" }], "us_occ_source_date"), false);

const occPartial = { availability_status: "partial", covered_count: 560, denominator: 637 };
const occIncompleteReadyStatus = { availability_status: "ready", covered_count: 560, denominator: 637 };
const occFull = { availability_status: "ready", covered_count: 637, denominator: 637 };

assert.equal(fullSourceCoverage(occPartial), false);
assert.equal(fullSourceCoverage(occIncompleteReadyStatus), false);
assert.equal(fullSourceCoverage(occFull), true);
assert.equal(fullSourceCoverage({ availability_status: "ready", covered_count: 0, denominator: 0 }), false);

assert.equal(fullSourceCoverage(occPartial) && freshnessReady(freshOccChecks, "us_occ_source_date"), false);
assert.equal(fullSourceCoverage(occIncompleteReadyStatus) && freshnessReady(freshOccChecks, "us_occ_source_date"), false);
assert.equal(fullSourceCoverage(occFull) && freshnessReady(freshOccChecks, "us_occ_source_date"), true);

const completeRequirements = {
  source_available: true,
  normalized: true,
  joined_to_target_universe: true,
  scored: true,
  public: true,
  daily: true,
  gated: true,
};
assert.equal(requirementsReady(completeRequirements), true);
assert.equal(requirementsReady({ ...completeRequirements, gated: false }), false);

const readyTrack = {
  denominator: 1064,
  readiness_status: "ready",
  public_done_claim_allowed: true,
  requirements: completeRequirements,
};
assert.equal(activeS0DailyGatedReady(readyTrack, 1064), true);
assert.equal(activeS0DailyGatedReady({ ...readyTrack, requirements: { ...completeRequirements, daily: false } }, 1064), false);
assert.equal(activeS0DailyGatedReady({ ...readyTrack, denominator: 1065 }, 1064), false);
assert.equal(activeS0DailyGatedReady(readyTrack, 0), false);

assert.equal(warnOnlyStaleCountedSource({ id: "us_occ_source_date", status: "stale" }), false);
assert.equal(warnOnlyStaleCountedSource({ id: "us_occ_source_date", status: "stale" }, true), true);
assert.equal(warnOnlyStaleCountedSource({ id: "us_class_yf_source_date", status: "stale" }, true), true);
assert.equal(warnOnlyStaleCountedSource({ id: "asia_ex_taiwan_yf_source_date", status: "stale" }, true), true);
assert.equal(warnOnlyStaleCountedSource({ id: "us_occ_source_date", status: "missing" }, true), false);
assert.equal(warnOnlyStaleCountedSource({ id: "etf_signal_summary_freshness", status: "stale" }, true), false);

console.log("test-check-fenok-edge-freshness: ok");
