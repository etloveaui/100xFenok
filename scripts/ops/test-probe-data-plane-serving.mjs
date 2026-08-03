import assert from "node:assert/strict";
import {
  DEFAULT_MAX_SOURCE_AGE_DAYS,
  buildReport,
  evaluateProbeResponse,
  probeAll,
} from "./probe-data-plane-serving.mjs";
import { ENROLLED_PATHS } from "../lib/cloud-data-plane-worker-read.mjs";

const NOW = "2026-08-03T12:00:00Z";
const base = {
  path: "/data/macro/fred-macro.json",
  family: "fred-macro",
  status: 200,
  nowIso: NOW,
  maxAgeDays: DEFAULT_MAX_SOURCE_AGE_DAYS,
};

// Healthy: plane header with the family prefix and a fresh source date.
{
  const r = evaluateProbeResponse({ ...base, generationHeader: "fred-macro-abc123", sourceAsOfHeader: "2026-08-03" });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
}

// The 2026-08-03 incident shape: valid 200, no generation header — the URL is
// silently serving the bundled copy. This MUST fail.
{
  const r = evaluateProbeResponse({ ...base, generationHeader: null, sourceAsOfHeader: null });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /silently serving the deploy-time bundled copy/);
}

// A generation from another family is a routing defect, not health.
{
  const r = evaluateProbeResponse({ ...base, generationHeader: "oecd-cli-abc123", sourceAsOfHeader: "2026-08-03" });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /expected prefix "fred-macro-"/);
}

// Stale source date beyond the calendar tolerance alarms; within it passes
// (a Friday date read on Monday is 3 days — inside the 5-day tolerance).
{
  const stale = evaluateProbeResponse({ ...base, generationHeader: "fred-macro-abc123", sourceAsOfHeader: "2026-07-20" });
  assert.equal(stale.ok, false);
  assert.match(stale.failures[0], /days old/);
  const weekend = evaluateProbeResponse({ ...base, generationHeader: "fred-macro-abc123", sourceAsOfHeader: "2026-07-31" });
  assert.equal(weekend.ok, true);
}

// Non-200 short-circuits with the status failure alone.
{
  const r = evaluateProbeResponse({ ...base, status: 530, generationHeader: null, sourceAsOfHeader: null });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ["HTTP 530 (expected 200)"]);
}

// probeAll walks every enrolled path and never throws on a network failure.
{
  const asked = [];
  const results = await probeAll({
    baseUrl: "https://example.test",
    nowIso: NOW,
    maxAgeDays: DEFAULT_MAX_SOURCE_AGE_DAYS,
    fetchFn: async (url) => {
      asked.push(url);
      throw new Error("connect timeout");
    },
  });
  assert.equal(asked.length, ENROLLED_PATHS.size);
  assert.equal(results.length, ENROLLED_PATHS.size);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.match(r.failures[0], /fetch failed: connect timeout/);
  }
}

// Report aggregates: one failing asset flips the whole probe.
{
  const report = buildReport([
    { path: "/a", family: "x", ok: true, failures: [] },
    { path: "/b", family: "y", ok: false, failures: ["boom"] },
  ]);
  assert.equal(report.ok, false);
  assert.equal(report.failingCount, 1);
  assert.match(report.body, /- OK \/a/);
  assert.match(report.body, /- FAIL \/b/);
  assert.match(report.body, /  - boom/);
}

console.log("probe-data-plane-serving tests passed");
