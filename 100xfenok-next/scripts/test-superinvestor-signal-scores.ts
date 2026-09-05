import assert from "node:assert/strict";
import { signalScoreDataFromRecord } from "../src/app/superinvestors/signalFeeds";
import { holdingChangeFor } from "../src/lib/superinvestors/ticker-evidence";
import type { GuruHoldersIndexData } from "../src/lib/superinvestors/types";

const canonical = signalScoreDataFromRecord({
  shortTermConvictionScore: 61.2,
  shortTermScore: 58,
  longTermConvictionScore: 76.85,
  longTermScore: 70,
  asOf: "2026-08-28T00:00:00Z",
});
assert.deepEqual(canonical, {
  shortTermScore: 61.2,
  longTermScore: 76.85,
  asOf: "2026-08-28T00:00:00Z",
});

const fallback = signalScoreDataFromRecord({
  shortTermConvictionScore: null,
  shortTermScore: 53.79,
  longTermConvictionScore: null,
  longTermScore: 49.5,
  asOf: " 2026-08-28 ",
});
assert.deepEqual(fallback, {
  shortTermScore: 53.79,
  longTermScore: 49.5,
  asOf: "2026-08-28",
});

const missing = signalScoreDataFromRecord({
  shortTermConvictionScore: Number.NaN,
  shortTermScore: null,
  longTermConvictionScore: undefined,
  longTermScore: Number.POSITIVE_INFINITY,
  asOf: "  ",
});
assert.deepEqual(missing, { shortTermScore: null, longTermScore: null, asOf: null });

const evidence: GuruHoldersIndexData = {
  metadata: { change_coverage: { comparison_basis: "public_retained_holdings" } },
  holders: {},
  holding_changes: {
    NVDA: {
      held_count: 4,
      new_count: 2,
      increased_count: 1,
      decreased_count: 0,
      unchanged_count: 1,
      sold_count: 0,
      comparable_count: 2,
      mean_weight_delta: 0.0125,
      current_quarter: "2026-Q2",
      previous_quarter: "2026-Q1",
    },
    BAC: {
      held_count: 0,
      new_count: 0,
      increased_count: 0,
      decreased_count: 0,
      unchanged_count: 0,
      sold_count: 1,
      comparable_count: 0,
      mean_weight_delta: null,
      current_quarter: "2026-Q2",
      previous_quarter: "2026-Q1",
    },
  },
};
assert.equal(holdingChangeFor(evidence, "nvda")?.new_count, 2,
  "holding-change lookup must normalize ticker case and preserve dynamic evidence");
assert.equal(holdingChangeFor(evidence, "BAC")?.held_count, 0,
  "sold-only evidence must retain an explicit zero current holding count");
assert.equal(holdingChangeFor(evidence, "MSFT"), null);
assert.equal(holdingChangeFor({ metadata: {}, holders: {} }, "NVDA"), null,
  "legacy holder-only payloads must remain valid without optional change rows");

console.log("superinvestor signal score normalization: PASS");
