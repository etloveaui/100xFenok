#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyFinraLkgStore,
  buildFreshnessMarker,
  buildManifest,
  buildPayload,
  cachePathForDate,
  classifyFinraEndpointResponse,
  datasetConfig,
  endpointForDate,
  expandDateRange,
  FINRA_AVAILABILITY_POLICY,
  FINRA_PERSISTENCE_POLICY,
  finraHistoryPathFor,
  normalizeDate,
  parseFinraDailyShortVolume,
  rawTextPathForDate,
  reduceFinraEndpointResults,
  retainLatestMarkerDates,
  rotateFinraMarkerHistory,
  run,
  validFinraHistory,
} from "./fetch-fenok-finra-daily-private.mjs";

const sample = [
  "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
  "20260626|NVDA|123|4|1000|B,Q,N",
  "20260626|BRK.B|50|0|200|Q",
  "20260625|OLD|99|0|100|Q",
  "",
].join("\n");

assert.equal(normalizeDate("2026-06-26"), "20260626");
assert.equal(normalizeDate("20260626"), "20260626");
assert.equal(endpointForDate("20260626"), "https://cdn.finra.org/equity/regsho/daily/CNMSshvol20260626.txt");
assert.match(cachePathForDate("20260626"), /_private\/admin\/fenok-flow\/finra\/regsho_daily\/CNMSshvol20260626\.json$/);
assert.match(rawTextPathForDate("20260626"), /_private\/admin\/fenok-flow\/finra\/regsho_daily\/CNMSshvol20260626\.txt$/);
assert.equal(datasetConfig("regsho-daily").dataset_id, "regsho-daily");
assert.equal(FINRA_AVAILABILITY_POLICY.scheduler_guidance.initial_daily_run_kst, "08:30");
assert.equal(FINRA_AVAILABILITY_POLICY.kst_equivalent.edt, "next-day 07:00 KST");
assert.ok(FINRA_AVAILABILITY_POLICY.scheduler_guidance.do_not_default_to.includes("12:45 KST"));
assert.throws(() => datasetConfig("weekly-summary"), /Unsupported FINRA dataset/);
assert.deepEqual(
  expandDateRange({ from: "2026-06-26", to: "2026-06-29" }),
  ["20260626", "20260629"],
);

const rows = parseFinraDailyShortVolume(sample, "20260626");
assert.equal(rows.length, 2);
assert.equal(rows[0].symbol, "BRK.B");
assert.equal(rows[1].symbol, "NVDA");
assert.equal(rows[1].short_volume_ratio, 0.123);
assert.equal(rows[1].short_exempt_ratio, 0.004);

const readyEndpoint = classifyFinraEndpointResponse({ statusCode: 200, body: sample }, "20260626");
assert.equal(readyEndpoint.status, "ready");
assert.deepEqual(readyEndpoint.attempt.assertions, [{ id: "regsho_rows", passed: true }]);
const malformedEndpoint = classifyFinraEndpointResponse({ statusCode: 200, body: "bad header" }, "20260626");
assert.equal(malformedEndpoint.reason, "decode_error");
const missingEndpoint = classifyFinraEndpointResponse({ statusCode: 403, body: "<Error>AccessDenied</Error>" }, "20260703");
assert.equal(missingEndpoint.expectedMissing, true);
assert.equal(reduceFinraEndpointResults([missingEndpoint, readyEndpoint]).status, "ready");
assert.equal(reduceFinraEndpointResults([missingEndpoint]).attempt.http_status, 403);
const latestDueMissingEndpoint = classifyFinraEndpointResponse(
  { statusCode: 403, body: "<Error>AccessDenied</Error>" },
  "20260714",
);
assert.equal(latestDueMissingEndpoint.expectedMissing, false, "a trading-day 403 is actionable, not a holiday");
assert.equal(latestDueMissingEndpoint.attempt.auth, "not_applicable");
assert.equal(
  reduceFinraEndpointResults([readyEndpoint, latestDueMissingEndpoint]).attempt.http_status,
  403,
  "an older ready file cannot hide the latest due trading-day miss",
);

const payload = buildPayload({
  yyyymmdd: "20260626",
  sourceUrl: "https://example.test/CNMSshvol20260626.txt",
  fetchedAt: "2026-06-28T00:00:00.000Z",
  rows,
});
assert.equal(payload.cache_scope, "admin_private_only");
assert.equal(payload.raw_public, false);
assert.equal(payload.public_mirror_allowed, false);
assert.equal(payload.product_surface_allowed, false);
assert.equal(payload.row_count, 2);

const manifest = buildManifest({
  previous: null,
  generatedAt: "2026-06-28T00:00:00.000Z",
  entries: [
    {
      dataset_id: payload.dataset_id,
      provider: payload.provider,
      date: payload.date,
      as_of: payload.as_of,
      generated_at: payload.generated_at,
      source_url: payload.source_url,
      source_kind: "input_file",
      output_file: "_private/admin/fenok-flow/finra/regsho_daily/CNMSshvol20260626.json",
      raw_text_file: null,
      row_count: payload.row_count,
      cache_scope: payload.cache_scope,
      raw_public: payload.raw_public,
      public_mirror_allowed: payload.public_mirror_allowed,
      product_surface_allowed: payload.product_surface_allowed,
    },
  ],
});
assert.equal(manifest.default_dataset, "regsho-daily");
assert.equal(manifest.raw_public, false);
assert.equal(manifest.collections.length, 1);

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-finra-emitter-test-"));
  const attemptShardPath = path.join(tmpDir, "finra_short_volume.json");
  const result = await run([
    "--dataset",
    "regsho-daily",
    "--date",
    "2026-06-26",
    "--no-write",
  ], {
    request: async () => ({ statusCode: 200, body: sample }),
    attemptShardPath,
    observedAt: "2026-07-15T03:00:00Z",
    attemptId: "finra-short-volume-test-1",
  });
  assert.equal(result.row_count, 2);
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.lane_id, "finra_short_volume");
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "regsho_rows", passed: true }]);
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-finra-missing-emitter-test-"));
  const attemptShardPath = path.join(tmpDir, "finra_short_volume.json");
  await assert.rejects(() => run([
    "--dataset",
    "regsho-daily",
    "--date",
    "2026-07-03",
    "--no-write",
  ], {
    request: async () => ({ statusCode: 403, body: "<Error>AccessDenied</Error>" }),
    attemptShardPath,
    observedAt: "2026-07-15T03:05:00Z",
    attemptId: "finra-short-volume-test-missing",
  }), /all files missing/);
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].http_status, 403);
  assert.equal(shard.attempts[0].auth, "not_applicable", "FINRA not-published 403 is not mislabeled as auth rejection");
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-finra-test-"));
  const fixture = path.join(tmpDir, "CNMSshvol20260626.txt");
  fs.writeFileSync(fixture, sample, "utf8");
  const result = await run([
    "--dataset",
    "regsho-daily",
    "--date",
    "2026-06-26",
    "--input-file",
    fixture,
    "--no-write",
  ], {
    attemptShardPath: path.join(tmpDir, "input-finra-attempt.json"),
    observedAt: "2026-06-28T00:00:00Z",
    attemptId: "finra-input-test-1",
  });
  assert.equal(result.dataset, "regsho-daily");
  assert.equal(result.wrote, false);
  assert.equal(result.manifest_file, null);
  assert.equal(result.row_count, 2);
  assert.equal(result.outputs[0].source_kind, "input_file");
}

{
  const plan = await run([
    "--dataset",
    "regsho-daily",
    "--from",
    "2026-06-26",
    "--to",
    "2026-06-29",
    "--no-fetch",
    "--plan-only",
  ]);
  assert.equal(plan.plan_only, true);
  assert.deepEqual(plan.dates, ["20260626", "20260629"]);
  assert.equal(plan.no_fetch, true);
  assert.equal(plan.availability_policy.scheduler_guidance.initial_daily_run_kst, "08:30");
  assert.equal(plan.retry_policy.retries, 2);
  assert.equal(plan.public_mirror_allowed, false);
  assert.match(plan.manifest_file, /_private\/admin\/fenok-flow\/finra\/manifests\/collection_manifest\.json$/);
}

// --- Bounded persistence (P): bounded marker-history rotation ----------------
{
  const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const markerFor = (compactDate, generatedAt = `${iso(compactDate)}T04:00:00Z`) => buildFreshnessMarker({
    payload: buildPayload({
      yyyymmdd: compactDate,
      sourceUrl: "https://example.test",
      fetchedAt: generatedAt,
      rows: [{
        date: compactDate,
        symbol: "NVDA",
        short_volume: 1,
        short_exempt_volume: 0,
        total_volume: 2,
        short_volume_ratio: 0.5,
        short_exempt_ratio: 0,
        market: "Q",
      }],
    }),
    generatedAt,
  });
  const compactAt = (index) => {
    const date = new Date(Date.UTC(2025, 0, 1) + index * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10).replaceAll("-", "");
  };

  // cap enforcement + eviction order: 105 distinct dates -> newest 100 retained.
  const many = Array.from({ length: 105 }, (_, index) => markerFor(compactAt(index)));
  const retained = retainLatestMarkerDates(many);
  assert.equal(retained.entries.length, 100);
  assert.equal(retained.stats.distinct_source_dates, 105);
  assert.equal(retained.stats.pruned, 5);
  assert.equal(retained.entries[0].source_as_of, iso(compactAt(104)), "newest date first");
  assert.equal(retained.entries.some((entry) => entry.source_as_of === iso(compactAt(4))), false, "oldest dates evicted first");
  assert.equal(retained.entries.some((entry) => entry.source_as_of === iso(compactAt(5))), true);

  // sparse history is never pruned.
  const sparse = retainLatestMarkerDates(many.slice(0, 3));
  assert.equal(sparse.entries.length, 3);
  assert.equal(sparse.stats.pruned, 0);

  // duplicate dates collapse to the newest generated_at (idempotent).
  const dupe = markerFor(compactAt(10), "2026-07-18T00:00:00Z");
  const collapsed = retainLatestMarkerDates([many[10], dupe]);
  assert.equal(collapsed.entries.length, 1);
  assert.equal(collapsed.entries[0].generated_at, "2026-07-18T00:00:00Z");

  // malformed entries fail closed.
  assert.throws(() => retainLatestMarkerDates([{ source_as_of: "not-a-date" }]), /invalid FINRA history entry/);
  assert.throws(() => retainLatestMarkerDates([], { max_distinct_source_dates: 0 }), /invalid FINRA persistence/);

  // rotation round-trip: corrupt history fails closed; valid history rotates.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finra-history-"));
  const first = rotateFinraMarkerHistory({ repoRootDir: root, marker: markerFor(compactAt(0)), generatedAt: "2026-07-14T04:00:00Z" });
  assert.equal(first.history.entries.length, 1);
  assert.equal(validFinraHistory(JSON.parse(fs.readFileSync(finraHistoryPathFor(root), "utf8"))), true);
  fs.writeFileSync(finraHistoryPathFor(root), "{corrupt", "utf8");
  assert.throws(
    () => rotateFinraMarkerHistory({ repoRootDir: root, marker: markerFor(compactAt(1)), generatedAt: "2026-07-15T04:00:00Z" }),
    /corrupt/,
    "a corrupt existing history must fail closed instead of dropping dates",
  );
  assert.equal(FINRA_PERSISTENCE_POLICY.max_distinct_source_dates, 100);
}

// --- P hook: a fresh-primary promotion rotates the bounded history -----------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finra-history-hook-"));
  const markerPath = path.join(root, "data", "admin", "finra_short_volume", "current", "regsho_daily.json");
  const ready = (compactDate, observedAt) => {
    const text = [
      "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
      `${compactDate}|NVDA|123|4|1000|B,Q,N`,
      "",
    ].join("\n");
    return {
      dates: [compactDate],
      endpointResults: [classifyFinraEndpointResponse({ statusCode: 200, body: text }, compactDate)],
      results: [{
        payload: buildPayload({
          yyyymmdd: compactDate,
          sourceUrl: "https://example.test",
          fetchedAt: observedAt,
          rows: parseFinraDailyShortVolume(text, compactDate),
        }),
      }],
    };
  };
  const first = applyFinraLkgStore({
    ...ready("20260714", "2026-07-14T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: { runId: "seed-run", runAttempt: 1, eventName: "schedule", observedAt: "2026-07-14T04:00:00Z" },
  });
  assert.equal(first.kind, "success");
  assert.equal(first.history.entries_retained, 1);
  const second = applyFinraLkgStore({
    ...ready("20260715", "2026-07-15T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: { runId: "next-run", runAttempt: 1, eventName: "schedule", observedAt: "2026-07-15T04:00:00Z" },
  });
  assert.equal(second.kind, "success");
  assert.equal(second.history.entries_retained, 2);
  const history = JSON.parse(fs.readFileSync(finraHistoryPathFor(root), "utf8"));
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].source_as_of, "2026-07-15");
  assert.equal(history.entries[1].source_as_of, "2026-07-14");
}

console.log("test-fetch-fenok-finra-daily-private: ok");
