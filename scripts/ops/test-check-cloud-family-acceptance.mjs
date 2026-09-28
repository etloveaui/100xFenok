import assert from "node:assert/strict";

import {
  checkCloudFamilyAcceptance,
  evaluateStrictServingResponse,
  familyPaths,
} from "./check-cloud-family-acceptance.mjs";

const family = "slickcharts-symbols";
const minObservedAt = "2026-08-16T07:30:00.000Z";
const nowIso = "2026-08-16T07:32:00.000Z";
const paths = familyPaths(family);
assert.deepEqual(
  [...paths].sort(),
  ["/data/slickcharts/symbols-all.json", "/data/slickcharts/symbols.json"],
);

const serving = (publishedAt = "2026-08-16T07:31:30.000Z") => async () => new Response(null, {
  status: 200,
  headers: {
    "x-data-plane-generation": "slickcharts-symbols-abcdef0123456789",
    "x-data-plane-source-as-of": "2026-08-16",
    "x-data-plane-published-at": publishedAt,
  },
});

const proven = await checkCloudFamilyAcceptance({ family, minObservedAt, nowIso, fetchFn: serving() });
assert.equal(proven.state, "proven");
assert.equal(proven.paths.length, 2);

const stale = await checkCloudFamilyAcceptance({
  family, minObservedAt, nowIso, fetchFn: serving("2026-08-16T07:29:59.000Z"),
});
assert.equal(stale.state, "not_proven");
assert.ok(stale.paths.every((entry) => entry.failures.some((failure) => failure.includes("predates"))));

const missing = await checkCloudFamilyAcceptance({
  family, minObservedAt, nowIso, fetchFn: async () => new Response(null, { status: 200 }),
});
assert.equal(missing.state, "not_proven");
assert.ok(missing.paths.every((entry) => entry.failures.length > 0));

const future = evaluateStrictServingResponse({
  path: paths[0], family, minObservedAt, status: 200,
  generationHeader: "generation", sourceAsOfHeader: "2026-08-16",
  publishedAtHeader: "2026-08-16T07:33:00.000Z", nowIso,
});
assert.equal(future.ok, false);
assert.ok(future.failures.some((failure) => failure.includes("future")));

console.log("PASS check-cloud-family-acceptance (live serving headers and current-run freshness)");
