import assert from "node:assert/strict";
import { signalScoreDataFromRecord } from "../src/app/superinvestors/signalFeeds";

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

console.log("superinvestor signal score normalization: PASS");
