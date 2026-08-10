import assert from "node:assert/strict";
import {
  DEFAULT_MAX_SOURCE_AGE_DAYS,
  FALLBACK_ALLOWED_FAMILIES,
  buildReport,
  evaluateProbeResponse,
  probeAll,
} from "./probe-data-plane-serving.mjs";
import { ENROLLED_PATHS, ENROLLED_PREFIXES } from "../lib/cloud-data-plane-worker-read.mjs";

const NOW = "2026-08-03T12:00:00Z";
const base = {
  path: "/data/macro/fred-macro.json",
  family: "fred-macro",
  status: 200,
  nowIso: NOW,
  maxAgeDays: DEFAULT_MAX_SOURCE_AGE_DAYS,
};

// The exported allowlist is immutable; callers cannot broaden fallback policy.
{
  assert.throws(() => FALLBACK_ALLOWED_FAMILIES.push("slickcharts-daily"), TypeError);
  assert.equal(FALLBACK_ALLOWED_FAMILIES.includes("slickcharts-daily"), false);
}

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

// Fallback mode: an intentionally unpublished family serving its static copy
// (200 with BOTH plane headers absent) passes, labelled FALLBACK-ALLOWED.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/AAPL.json",
    family: "slickcharts-history",
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "fallback-allowed");
}

// A fully published response for an allowlisted family validates strictly and
// reports OK — fallback applies only to the no-header state.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/AAPL.json",
    family: "slickcharts-history",
    generationHeader: "slickcharts-history-abc123",
    sourceAsOfHeader: "2026-08-03",
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "strict");
}

// Partial header on an allowlisted family escapes fallback and is strict: a
// present generation with no source date fails.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/symbols.json",
    family: "slickcharts-symbols",
    generationHeader: "slickcharts-symbols-abc123",
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /x-data-plane-source-as-of is absent/);
}

// Only true header absence enables fallback. Empty header values are present
// but malformed, including when both are empty or the other header is absent.
{
  const bothEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-history",
    generationHeader: "",
    sourceAsOfHeader: "",
  });
  assert.equal(bothEmpty.ok, false);
  assert.equal(bothEmpty.mode, "strict");
  assert.match(bothEmpty.failures[0], /is "" \(expected prefix/);
  assert.match(bothEmpty.failures[1], /unparseable \(""\)/);

  const generationEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-symbols",
    generationHeader: "",
    sourceAsOfHeader: null,
  });
  assert.equal(generationEmpty.ok, false);
  assert.equal(generationEmpty.mode, "strict");

  const sourceEmpty = evaluateProbeResponse({
    ...base,
    family: "slickcharts-symbols",
    generationHeader: null,
    sourceAsOfHeader: "",
  });
  assert.equal(sourceEmpty.ok, false);
  assert.equal(sourceEmpty.mode, "strict");
}

// Wrong-family generation on an allowlisted family is a routing defect.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/edgar-korean-summaries/2026-08-03.json",
    family: "edgar-korean-summaries",
    generationHeader: "slickcharts-daily-abc123",
    sourceAsOfHeader: "2026-08-03",
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /expected prefix "edgar-korean-summaries-"/);
}

// Stale generated response on an allowlisted family still alarms: headers
// present means the plane is publishing, so full freshness applies.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/TSLA.json",
    family: "slickcharts-history",
    generationHeader: "slickcharts-history-abc123",
    sourceAsOfHeader: "2026-07-20",
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /days old/);
}

// A published family is NOT allowlisted: the 2026-08-03 incident shape (200,
// no headers) still fails for slickcharts-daily.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/gainers.json",
    family: "slickcharts-daily",
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, "strict");
  assert.match(r.failures[0], /silently serving the deploy-time bundled copy/);
}

// Non-200 fails even for an allowlisted family — fallback never excuses a
// broken serving status.
{
  const r = evaluateProbeResponse({
    ...base,
    path: "/data/slickcharts/stocks/A.json",
    family: "slickcharts-history",
    status: 503,
    generationHeader: null,
    sourceAsOfHeader: null,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ["HTTP 503 (expected 200)"]);
}

// Report labels fallback success FALLBACK-ALLOWED, never OK.
{
  const report = buildReport([
    { path: "/data/slickcharts/stocks/AAPL.json", family: "slickcharts-history", ok: true, mode: "fallback-allowed", failures: [] },
    { path: "/data/macro/fred-macro.json", family: "fred-macro", ok: true, mode: "strict", failures: [] },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.failingCount, 0);
  assert.match(report.body, /- FALLBACK-ALLOWED \/data\/slickcharts\/stocks\/AAPL\.json \(slickcharts-history\)/);
  assert.match(report.body, /- OK \/data\/macro\/fred-macro\.json \(fred-macro\)/);
  assert.doesNotMatch(report.body, /FALLBACK-ALLOWED .*\(fred-macro\)/);
}

// The fallback allowlist only names families production actually enrolls
// (exact entries or prefix declarations) — enforced at module load.
{
  const enrolledFamilies = new Set([
    ...ENROLLED_PATHS.values(),
    ...ENROLLED_PREFIXES.map(({ family }) => family),
  ]);
  for (const family of FALLBACK_ALLOWED_FAMILIES) {
    assert.equal(enrolledFamilies.has(family), true, `family ${family} must be enrolled`);
  }
}

// Known limitation: EDGAR is prefix-enrolled, while probeAll enumerates exact
// ENROLLED_PATHS only. This patch defines its fallback policy but does not
// claim live EDGAR coverage.
{
  assert.equal([...ENROLLED_PATHS.values()].includes("edgar-korean-summaries"), false);
  assert.equal(ENROLLED_PREFIXES.some(({ family }) => family === "edgar-korean-summaries"), true);
}

console.log("probe-data-plane-serving tests passed");
