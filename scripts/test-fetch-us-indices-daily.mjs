#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_REVISION_RETENTION_LIMIT,
  checkUsIndicesParity,
  classifyFloat32Change,
  mergeProviderRevisionHistory,
  withinParityTolerance,
} from "./check-us-indices-parity.mjs";
import {
  mergeSeries,
  parseYahooChart,
  retainLatestSeriesRows,
  runUsIndicesDaily,
  seriesContainsProviderObservation,
  US_INDICES_MAX_SERIES_DATES,
  US_INDICES_PERSISTENCE_POLICY,
  withFileRollback,
  writeUsIndicesGitHubOutputs,
} from "./fetch-us-indices-daily.mjs";

const OBSERVED_AT = "2026-07-20T22:00:00Z";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const US_SERIES_KEYS = ["sp500", "nasdaq", "nasdaq100", "sox"];
const US_SYMBOL_BY_KEY = Object.freeze({
  sp500: "^GSPC",
  nasdaq: "^IXIC",
  nasdaq100: "^NDX",
  sox: "^SOX",
});

function yahooPayload(symbol, rows) {
  return {
    chart: {
      result: [{
        meta: { symbol, exchangeTimezoneName: "America/New_York" },
        timestamp: rows.map(([date]) => Math.floor(Date.parse(`${date}T20:00:00Z`) / 1000)),
        indicators: { quote: [{ close: rows.map(([, value]) => value) }] },
      }],
      error: null,
    },
  };
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function pathsFor(root) {
  const stateRoot = path.join(root, "data", "admin", "us-indices-daily");
  return {
    canonicalRoot: path.join(root, "data", "indices"),
    stateRoot,
    persistencePath: path.join(stateRoot, "persistence.json"),
    attemptShardPath: path.join(root, "attempts", "us_indices_daily.json"),
  };
}

function yahooResponseForKey(key, rowsByKey) {
  return response(200, yahooPayload(US_SYMBOL_BY_KEY[key], rowsByKey[key]));
}

const parsed = parseYahooChart(yahooPayload("^GSPC", [
  ["2026-07-16", 6200.1],
  ["2026-07-17", 6210.2],
]), "^GSPC");
assert.deepEqual(parsed, [
  { date: "2026-07-16", value: 6200.1 },
  { date: "2026-07-17", value: 6210.2 },
]);
assert.throws(() => parseYahooChart(yahooPayload("^GSPC", [["2026-07-17", Number.NaN]]), "^GSPC"), /finite positive/);

assert.deepEqual(
  mergeSeries([{ date: "2026-07-15", value: 6190 }], parsed),
  [{ date: "2026-07-15", value: 6190 }, ...parsed],
  "all newer rows in the 5d window are backfilled in order",
);
assert.deepEqual(mergeSeries(parsed, parsed), parsed, "same-date replay is idempotent");
assert.throws(
  () => mergeSeries([{ date: "2026-07-17", value: 6210.2 }], [{ date: "2026-07-17", value: 1 }]),
  /conflicting value/,
);
assert.equal(
  seriesContainsProviderObservation(
    [{ date: "2026-07-17", value: 6210.2 }],
    [{ date: "2026-07-17", value: 6210.21 }],
  ),
  true,
  "a policy-tolerated same-date observation remains bound into the settled candidate",
);
assert.equal(
  seriesContainsProviderObservation(
    [{ date: "2026-07-17", value: 6210.2 }],
    [{ date: "2026-07-18", value: 6220.2 }],
  ),
  false,
  "a provider date missing from the candidate is not contained",
);
assert.equal(US_INDICES_MAX_SERIES_DATES, 15_000);
assert.deepEqual(US_INDICES_PERSISTENCE_POLICY, {
  schema_version: "us-indices-bounded-persistence/v1",
  basis: "distinct_provider_date_per_series",
  max_distinct_provider_dates_per_series: 15_000,
  eviction: "oldest_provider_date_first",
});

{
  const rows = Array.from({ length: US_INDICES_MAX_SERIES_DATES + 1 }, (_, index) => ({
    date: new Date(Date.UTC(1980, 0, index + 1)).toISOString().slice(0, 10),
    value: 100 + index,
  }));
  const retained = retainLatestSeriesRows(rows);
  assert.equal(retained.rows.length, US_INDICES_MAX_SERIES_DATES);
  assert.equal(retained.rows[0].date, "1980-01-02");
  assert.equal(retained.persistence_state.pruned_distinct_provider_dates, 1);
  assert.deepEqual(
    retainLatestSeriesRows(retained.rows).rows,
    retained.rows,
    "bounded index persistence must be idempotent",
  );
  assert.throws(
    () => retainLatestSeriesRows([{ date: "2026-02-31", value: 1 }]),
    /valid date/,
  );
}

{
  const providerRevisions = [];
  const merged = mergeSeries(
    [{ date: "2026-07-20", value: 25508.072265625 }],
    [
      { date: "2026-07-20", value: 25508.0703125 },
      { date: "2026-07-21", value: 25837.2109375 },
    ],
    { seriesKey: "nasdaq", providerRevisions, observedAt: "2026-07-21T22:47:00Z" },
  );
  assert.deepEqual(merged, [
    { date: "2026-07-20", value: 25508.072265625 },
    { date: "2026-07-21", value: 25837.2109375 },
  ], "provider revision must preserve settled evidence while allowing newer dates");
  assert.deepEqual(providerRevisions, [{
    series: "nasdaq",
    date: "2026-07-20",
    stored_value: 25508.072265625,
    observed_value: 25508.0703125,
    abs_diff: 0.001953125,
    relative_diff: 0.001953125 / 25508.072265625,
    within_tolerance: true,
    float32_ulp: 0.001953125,
    delta_float32_ulps: 1,
    float32_step_distance: 1,
    stored_value_float32_exact: true,
    observed_value_float32_exact: true,
    within_one_float32_ulp: true,
    same_date_change_class: "float32_ulp_flutter",
    observed_at: "2026-07-21T22:47:00Z",
  }]);
}

assert.equal(withinParityTolerance(6200.01, 6200.04), true);
assert.equal(withinParityTolerance(6200, 6210), false);
assert.deepEqual(
  classifyFloat32Change(25508.072265625, 25508.0703125),
  {
    float32_ulp: 0.001953125,
    delta_float32_ulps: 1,
    float32_step_distance: 1,
    stored_value_float32_exact: true,
    observed_value_float32_exact: true,
    within_one_float32_ulp: true,
    same_date_change_class: "float32_ulp_flutter",
  },
  "the observed NASDAQ delta is exactly one float32 ULP, not an editorial revision",
);
assert.equal(
  classifyFloat32Change(25508.072265625, 25508.068359375).within_one_float32_ulp,
  false,
  "a two-ULP change must remain visually distinct from float32 flutter",
);
assert.equal(
  classifyFloat32Change(1, 0.9999998807907104).within_one_float32_ulp,
  false,
  "two adjacent steps across a float32 power boundary must not collapse into one-Ulp flutter",
);
assert.equal(classifyFloat32Change(0, 2 ** -149).within_one_float32_ulp, true);
assert.equal(classifyFloat32Change(-(2 ** -149), 2 ** -149).within_one_float32_ulp, false);
assert.deepEqual(
  classifyFloat32Change(1e39, 1e39 + 1e30),
  {
    float32_ulp: null,
    delta_float32_ulps: null,
    float32_step_distance: null,
    stored_value_float32_exact: false,
    observed_value_float32_exact: false,
    within_one_float32_ulp: false,
    same_date_change_class: "provider_value_change",
  },
  "finite values outside float32 range must never inherit an Infinity-sized flutter tolerance",
);

{
  const previous = Array.from({ length: PROVIDER_REVISION_RETENTION_LIMIT + 2 }, (_, index) => ({
    series: "nasdaq",
    date: "2026-07-20",
    stored_value: 25_000,
    observed_value: 25_000 + index,
    observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    first_observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    last_observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    occurrences: 1,
  }));
  const retained = mergeProviderRevisionHistory(previous, []);
  assert.equal(retained.length, PROVIDER_REVISION_RETENTION_LIMIT);
  assert.equal(retained[0].observed_value, 25_002, "the two oldest revision identities must be evicted");
  assert.equal(retained.at(-1).observed_value, 25_101, "the newest revision identity must be retained");
}

{
  const existing = {
    series: "nasdaq",
    date: "2026-07-20",
    stored_value: 25_000,
    observed_value: 25_001,
    observed_at: "2026-07-03T00:00:00.000Z",
    first_observed_at: "2026-07-01T00:00:00.000Z",
    last_observed_at: "2026-07-03T00:00:00.000Z",
    occurrences: 1,
  };
  const [merged] = mergeProviderRevisionHistory([existing], [{
    ...existing,
    observed_at: "2026-06-30T00:00:00.000Z",
  }]);
  assert.equal(merged.occurrences, 2);
  assert.equal(merged.first_observed_at, "2026-06-30T00:00:00.000Z");
  assert.equal(merged.last_observed_at, "2026-07-03T00:00:00.000Z", "an older replay must not regress recency");
}

{
  const base = Array.from({ length: PROVIDER_REVISION_RETENTION_LIMIT }, (_, index) => ({
    series: "nasdaq",
    date: "2026-07-20",
    stored_value: 25_000,
    observed_value: 25_000 + index,
    observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    first_observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    last_observed_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    occurrences: 1,
  }));
  const refreshedAt = "2026-07-02T00:00:00.000Z";
  const retained = mergeProviderRevisionHistory(base, [
    { ...base[0], observed_at: refreshedAt },
    { ...base[0], observed_value: 99_999, observed_at: "2026-07-02T00:00:01.000Z" },
  ]);
  assert.equal(retained.length, PROVIDER_REVISION_RETENTION_LIMIT);
  assert.equal(retained.some((row) => row.observed_value === 25_001), false, "oldest unrefreshed identity must be evicted");
  const refreshed = retained.find((row) => row.observed_value === 25_000);
  assert.equal(refreshed.occurrences, 2);
  assert.equal(refreshed.last_observed_at, refreshedAt);
  assert.equal(retained.at(-1).observed_value, 99_999);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-success-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  const initialRows = {
    sp500: [["2026-07-16", 6200.1], ["2026-07-17", 6210.2]],
    nasdaq: [["2026-07-16", 20200.1], ["2026-07-17", 20250.2]],
    nasdaq100: [["2026-07-16", 28200.1], ["2026-07-17", 28300.2]],
    sox: [["2026-07-16", 11300.1], ["2026-07-17", 11400.2]],
  };
  for (const key of US_SERIES_KEYS) {
    fs.writeFileSync(
      path.join(paths.canonicalRoot, `${key}.json`),
      `${JSON.stringify([{ date: initialRows[key][0][0], value: initialRows[key][0][1] }])}\n`,
    );
  }
  const request = async (_url, key) => yahooResponseForKey(key, initialRows);
  const first = await runUsIndicesDaily({
    ...paths,
    request,
    observedAt: OBSERVED_AT,
    attemptId: "gh-400-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(first.exitCode, 0);
  assert.equal(first.updated, true);
  for (const key of US_SERIES_KEYS) {
    const canonical = fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`));
    assert.equal(JSON.parse(canonical).length, 2);
  }
  const persistence = JSON.parse(fs.readFileSync(paths.persistencePath, "utf8"));
  assert.deepEqual(persistence.persistence_policy, US_INDICES_PERSISTENCE_POLICY);
  assert.deepEqual(Object.keys(persistence.series), US_SERIES_KEYS);
  assert.equal(persistence.series.sp500.retained_distinct_provider_dates, 2);
  assert.equal(persistence.series.sp500.pruned_distinct_provider_dates, 0);
  assert.equal(persistence.series.nasdaq100.retained_distinct_provider_dates, 2);
  assert.equal(persistence.series.sox.retained_distinct_provider_dates, 2);
  assert.equal(fs.existsSync(path.join(paths.stateRoot, "shadow")), false, "live producer must not write shadow paths");
  assert.equal(fs.existsSync(path.join(paths.stateRoot, "parity-report.json")), false, "retired parity must not be emitted live");

  const second = await runUsIndicesDaily({
    ...paths,
    request,
    observedAt: "2026-07-20T22:05:00Z",
    attemptId: "gh-401-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(second.exitCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, "sp500.json"), "utf8")).length, 2);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-provider-revision-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  const initial = {
    sp500: [{ date: "2026-07-20", value: 7443.27978515625 }],
    nasdaq: [{ date: "2026-07-20", value: 25508.072265625 }],
    nasdaq100: [{ date: "2026-07-20", value: 28274.2 }],
    sox: [{ date: "2026-07-20", value: 11311.08 }],
  };
  for (const [key, rows] of Object.entries(initial)) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify(rows)}\n`);
  }
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-20", 7443.27978515625], ["2026-07-21", 7509.2001953125]],
      nasdaq: [["2026-07-20", 25508.0703125], ["2026-07-21", 25837.2109375]],
      nasdaq100: [["2026-07-20", 28274.2], ["2026-07-21", 28350.1]],
      sox: [["2026-07-20", 11311.08], ["2026-07-21", 11400.2]],
    }),
    observedAt: "2026-07-21T22:47:00Z",
    attemptId: "gh-403-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 0, "one-float32-ULP provider variation must not wedge the lane");
  assert.equal(result.providerRevisions.length, 1);
  assert.equal(result.providerRevisions[0].same_date_change_class, "float32_ulp_flutter");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, "nasdaq.json"), "utf8")), [
    initial.nasdaq[0],
    { date: "2026-07-21", value: 25837.2109375 },
  ]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-backfill-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  const rows = {
    sp500: [["2026-07-20", 6200], ["2026-07-21", 6210], ["2026-07-22", 6220]],
    nasdaq: [["2026-07-20", 20200], ["2026-07-21", 20210], ["2026-07-22", 20220]],
    nasdaq100: [["2026-07-20", 28200], ["2026-07-21", 28210], ["2026-07-22", 28220]],
    sox: [["2026-07-20", 11300], ["2026-07-21", 11310], ["2026-07-22", 11320]],
  };
  for (const [key, values] of Object.entries(rows)) {
    const initial = [{ date: values[0][0], value: values[0][1] }];
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify(initial)}\n`);
  }
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, rows),
    observedAt: "2026-07-22T22:05:00Z",
    attemptId: "gh-405-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 0);
  for (const key of US_SERIES_KEYS) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`), "utf8")).length, 3,
      "range=5d must keep natural multi-date recovery after the clock is retired");
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-rounded-provider-revision-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  const initial = {
    sp500: [{ date: "2026-07-23", value: 6400 }],
    nasdaq: [{ date: "2026-07-23", value: 25137.69 }],
    nasdaq100: [{ date: "2026-07-23", value: 28274.2 }],
    sox: [{ date: "2026-07-23", value: 11311.08 }],
  };
  for (const [key, rows] of Object.entries(initial)) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify(rows)}\n`);
  }
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-23", 6400], ["2026-07-24", 6410]],
      nasdaq: [["2026-07-23", 25137.693359375], ["2026-07-24", 25200.125]],
      nasdaq100: [["2026-07-23", 28274.2], ["2026-07-24", 28350.125]],
      sox: [["2026-07-23", 11311.08], ["2026-07-24", 11400.125]],
    }),
    observedAt: "2026-07-24T22:48:00Z",
    attemptId: "gh-407-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 0, "a tolerated 2dp provider revision must not wedge the lane");
  assert.equal(result.updated, true);
  assert.equal(result.providerRevisions.length, 1);
  assert.equal(result.providerRevisions[0].same_date_change_class, "provider_value_change");
  assert.equal(result.providerRevisions[0].within_tolerance, true);
  assert.equal(result.providerRevisions[0].within_one_float32_ulp, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, "nasdaq.json"), "utf8")), [
    initial.nasdaq[0],
    { date: "2026-07-24", value: 25200.125 },
  ], "the rounded settled value must be preserved while the new date appends");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-out-of-tolerance-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200, nasdaq100: 28200, sox: 11300 })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-20", value }])}\n`);
  }
  const before = US_SERIES_KEYS.map((key) =>
    fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)));
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-20", 6100], ["2026-07-21", 6210]],
      nasdaq: [["2026-07-20", 20200], ["2026-07-21", 20210]],
      nasdaq100: [["2026-07-20", 28200], ["2026-07-21", 28210]],
      sox: [["2026-07-20", 11300], ["2026-07-21", 11310]],
    }),
    observedAt: "2026-07-21T22:05:00Z",
    attemptId: "gh-406-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 2, "out-of-tolerance settled-date changes must remain fail-closed after parity retirement");
  assert.equal(result.providerRevisions.some((row) => row.within_tolerance === false), true);
  const after = US_SERIES_KEYS.map((key) =>
    fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)));
  after.forEach((bytes, index) => assert.deepEqual(bytes, before[index]));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].assertions.some((assertion) => assertion.passed === false), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-atomic-"));
  const paths = pathsFor(root);
  const protectedPaths = US_SERIES_KEYS.map((key) => path.join(paths.canonicalRoot, `${key}.json`));
  for (const [index, filePath] of protectedPaths.entries()) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `sentinel-${index}\n`);
  }
  const before = protectedPaths.map((filePath) => fs.readFileSync(filePath));
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => {
      if (key === "nasdaq") throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return yahooResponseForKey(key, {
        sp500: [["2026-07-17", 6210.2]],
        nasdaq100: [["2026-07-17", 28300.2]],
        sox: [["2026-07-17", 11400.2]],
      });
    },
    observedAt: OBSERVED_AT,
    attemptId: "gh-402-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.failure_detail, /^Error: reset$/);
  protectedPaths.forEach((filePath, index) => assert.deepEqual(fs.readFileSync(filePath), before[index]));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.lane_id, "us_indices_daily");
  assert.equal(shard.attempts[0].execution, "threw");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-state-write-rollback-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200, nasdaq100: 28200, sox: 11300 })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-16", value }])}\n`);
  }
  const request = async (_url, key) => yahooResponseForKey(key, {
    sp500: [["2026-07-16", 6200], ["2026-07-17", 6210]],
    nasdaq: [["2026-07-16", 20200], ["2026-07-17", 20210]],
    nasdaq100: [["2026-07-16", 28200], ["2026-07-17", 28210]],
    sox: [["2026-07-16", 11300], ["2026-07-17", 11310]],
  });
  await runUsIndicesDaily({
    ...paths,
    request,
    observedAt: "2026-07-17T22:00:00Z",
    attemptId: "gh-410-1-us-indices",
    eventName: "schedule",
  });
  const payloadPaths = [
    ...US_SERIES_KEYS.map((key) => path.join(paths.canonicalRoot, `${key}.json`)),
    paths.persistencePath,
  ];
  const before = payloadPaths.map((filePath) => fs.readFileSync(filePath));
  const providerReceiptRoot = path.join(paths.stateRoot, "provider-observations");
  const receiptsBefore = fs.readdirSync(providerReceiptRoot).sort();
  let commitCalls = 0;
  const failed = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210], ["2026-07-18", 20220]],
      nasdaq100: [["2026-07-17", 28210], ["2026-07-18", 28220]],
      sox: [["2026-07-17", 11310], ["2026-07-18", 11320]],
    }),
    observedAt: "2026-07-18T22:00:00Z",
    attemptId: "gh-411-1-us-indices",
    eventName: "schedule",
    commitCandidateFn: (store, candidate) => {
      const committed = store.commitCandidate(candidate);
      commitCalls += 1;
      if (commitCalls === 1) throw new Error("injected state write failure after first key");
      return committed;
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.equal(failed.index.counts.lkg, 4);
  assert.equal(failed.index.counts.retry, 4);
  assert.deepEqual(failed.index.retry_keys, US_SERIES_KEYS.map((key) => `${key}.json`));
  payloadPaths.forEach((filePath, index) => {
    assert.deepEqual(fs.readFileSync(filePath), before[index], `${filePath} payload bytes must roll back`);
  });
  assert.deepEqual(
    fs.readdirSync(providerReceiptRoot).sort(),
    receiptsBefore,
    "provider receipt creation must roll back with canonical/state publication",
  );
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].execution, "threw");
  assert.equal(shard.attempts[0].exception_kind, "unexpected");
  for (const key of US_SERIES_KEYS) {
    const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
    assert.equal(state.resolution_state, "lkg_primary");
    assert.equal(state.retry, true);
    assert.equal(state.latest_failure?.run_id, "411");
    assert.equal(state.latest_failure?.failure_kind, "unexpected");
  }
}

{
  let rollbackError;
  try {
    withFileRollback(
      [],
      () => { throw new Error("publication failed"); },
      () => { throw new Error("restore failed"); },
    );
  } catch (error) {
    rollbackError = error;
  }
  assert.equal(rollbackError instanceof AggregateError, true);
  assert.equal(rollbackError.rollbackFailed, true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-rollback-failure-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200, nasdaq100: 28200, sox: 11300 })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-16", value }])}\n`);
  }
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-16", 6200], ["2026-07-17", 6210]],
      nasdaq: [["2026-07-16", 20200], ["2026-07-17", 20210]],
      nasdaq100: [["2026-07-16", 28200], ["2026-07-17", 28210]],
      sox: [["2026-07-16", 11300], ["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-17T22:00:00Z",
    attemptId: "gh-412-1-us-indices",
    eventName: "schedule",
    withFileRollbackFn: (filePaths, action) => withFileRollback(
      filePaths,
      () => {
        action();
        throw new Error("injected publication failure after writes");
      },
      () => { throw new Error("injected restore failure"); },
    ),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.degraded, false);
  assert.equal(result.corrupt, true);
  assert.equal(result.rollback_failed, true);
  assert.equal(result.index, null);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].execution, "threw");
  const outputPath = path.join(root, "github-output.txt");
  writeUsIndicesGitHubOutputs(result, outputPath);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "rollback_failed=true\n");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-malformed-canonical-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  fs.writeFileSync(path.join(paths.canonicalRoot, "sp500.json"), "{\n");
  fs.writeFileSync(
    path.join(paths.canonicalRoot, "nasdaq.json"),
    `${JSON.stringify([{ date: "2026-07-16", value: 20200 }])}\n`,
  );
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210]],
      nasdaq: [["2026-07-17", 20210]],
      nasdaq100: [["2026-07-17", 28210]],
      sox: [["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-17T22:00:00Z",
    attemptId: "gh-413-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.corrupt, true);
  assert.equal(result.index.counts.retry, 4);
  assert.equal(result.index.counts.unavailable, 3);
  assert.equal(result.index.counts.lkg, 1);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].execution, "threw");
  for (const key of US_SERIES_KEYS) {
    assert.equal(fs.existsSync(path.join(paths.stateRoot, "keys", `${key}.json`)), true);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-fresh-retry-mixed-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200, nasdaq100: 28200, sox: 11300 })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-16", value }])}\n`);
  }
  const seeded = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-16", 6200], ["2026-07-17", 6210]],
      nasdaq: [["2026-07-16", 20200], ["2026-07-17", 20210]],
      nasdaq100: [["2026-07-16", 28200], ["2026-07-17", 28210]],
      sox: [["2026-07-16", 11300], ["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-17T22:00:00Z",
    attemptId: "gh-430-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(seeded.exitCode, 0);
  const freshSp500 = JSON.parse(
    fs.readFileSync(path.join(paths.stateRoot, "keys", "sp500.json"), "utf8"),
  );
  const oneFailed = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => {
      if (key === "nasdaq") throw new Error("isolated transport failure");
      return yahooResponseForKey(key, {
        sp500: [["2026-07-18", 6220]],
        nasdaq100: [["2026-07-18", 28220]],
        sox: [["2026-07-18", 11320]],
      });
    },
    observedAt: "2026-07-18T12:00:00Z",
    attemptId: "gh-431-1-us-indices",
    eventName: "workflow_dispatch",
  });
  assert.equal(oneFailed.index.retry_keys.includes("nasdaq.json"), true);
  assert.equal(oneFailed.index.retry_keys.includes("sp500.json"), false);
  assert.equal(oneFailed.index.retry_keys.includes("nasdaq100.json"), false);
  assert.equal(oneFailed.index.retry_keys.includes("sox.json"), false);
  const canonicalBeforeMixed = US_SERIES_KEYS.map((key) =>
    fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)));
  const mixed = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210]],
      nasdaq100: [["2026-07-17", 28210]],
      sox: [["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-18T22:00:00Z",
    attemptId: "gh-432-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(mixed.exitCode, 0);
  assert.equal(mixed.updated, false);
  assert.equal(mixed.index.current_attempt.attempted, 4);
  assert.equal(mixed.index.current_attempt.successes, 0);
  assert.equal(mixed.index.current_attempt.promotion_deferrals, 4);
  const deferredSp500 = JSON.parse(
    fs.readFileSync(path.join(paths.stateRoot, "keys", "sp500.json"), "utf8"),
  );
  for (const field of ["updated_at", "last_run_id", "last_run_attempt", "last_event_name"]) {
    assert.equal(
      deferredSp500[field],
      freshSp500[field],
      `fresh V2 provider proof binding ${field} must survive atomic peer deferral`,
    );
  }
  assert.equal(deferredSp500.latest_promotion_deferral.reason, "atomic_peer_deferral");
  for (const [index, key] of US_SERIES_KEYS.entries()) {
    assert.deepEqual(
      fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)),
      canonicalBeforeMixed[index],
      "fresh/retry mixed recovery cannot publish partial canonical bytes",
    );
  }
  const recovered = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210], ["2026-07-18", 20220]],
      nasdaq100: [["2026-07-17", 28210], ["2026-07-18", 28220]],
      sox: [["2026-07-17", 11310], ["2026-07-18", 11320]],
    }),
    observedAt: "2026-07-21T22:00:00Z",
    attemptId: "gh-433-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.index.counts.unavailable, 0);
  assert.deepEqual(recovered.index.retry_keys, []);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-controlled-recovery-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200, nasdaq100: 28200, sox: 11300 })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-16", value }])}\n`);
  }
  await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-16", 6200], ["2026-07-17", 6210]],
      nasdaq: [["2026-07-16", 20200], ["2026-07-17", 20210]],
      nasdaq100: [["2026-07-16", 28200], ["2026-07-17", 28210]],
      sox: [["2026-07-16", 11300], ["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-17T22:00:00Z",
    attemptId: "gh-420-1-us-indices",
    eventName: "schedule",
  });
  const canonicalBefore = US_SERIES_KEYS.map((key) =>
    fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)));
  const failed = await runUsIndicesDaily({
    ...paths,
    request: async () => {
      throw new Error("controlled failure must not contact Yahoo");
    },
    controlledFailure: "transport",
    observedAt: "2026-07-18T12:00:00Z",
    attemptId: "gh-421-1-us-indices",
    eventName: "workflow_dispatch",
  });
  assert.equal(failed.reason, "controlled_failure");
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.equal(failed.exitCode, 0);
  assert.equal(failed.index.counts.lkg, 4);
  assert.equal(failed.index.counts.retry, 4);
  canonicalBefore.forEach((bytes, index) => {
    assert.deepEqual(
      fs.readFileSync(path.join(paths.canonicalRoot, `${US_SERIES_KEYS[index]}.json`)),
      bytes,
      "controlled failure must retain canonical bytes",
    );
  });
  const recoveryStateBeforeMixed = Object.fromEntries(US_SERIES_KEYS.map((key) => [
    key,
    JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8")),
  ]));
  const mixedSource = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210]],
      nasdaq100: [["2026-07-17", 28210]],
      sox: [["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-18T19:30:00Z",
    attemptId: "gh-4211-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(mixedSource.exitCode, 0);
  assert.equal(mixedSource.degraded, true);
  assert.equal(mixedSource.updated, false);
  assert.equal(mixedSource.index.current_attempt.attempted, 4);
  assert.equal(mixedSource.index.current_attempt.successes, 0);
  assert.equal(mixedSource.index.current_attempt.failed, 0);
  assert.equal(mixedSource.index.current_attempt.promotion_deferrals, 4);
  assert.deepEqual(
    mixedSource.index.current_attempt.promotion_deferral_keys,
    US_SERIES_KEYS.map((key) => `${key}.json`),
  );
  assert.deepEqual(
    mixedSource.index.promotion_deferral_details.map(({ key, reason, blocked_by_keys: blockedByKeys }) => ({
      key,
      reason,
      blocked_by_keys: blockedByKeys,
    })),
    [
      {
        key: "sp500.json",
        reason: "atomic_peer_deferral",
        blocked_by_keys: ["nasdaq.json", "nasdaq100.json", "sox.json"],
      },
      { key: "nasdaq.json", reason: "recovery_not_advanced_by_provider", blocked_by_keys: undefined },
      { key: "nasdaq100.json", reason: "recovery_not_advanced_by_provider", blocked_by_keys: undefined },
      { key: "sox.json", reason: "recovery_not_advanced_by_provider", blocked_by_keys: undefined },
    ],
  );
  for (const [index, key] of US_SERIES_KEYS.entries()) {
    assert.deepEqual(
      fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`)),
      canonicalBefore[index],
      "mixed recovery cannot publish partial canonical bytes",
    );
    const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
    assert.deepEqual(state.latest_failure, recoveryStateBeforeMixed[key].latest_failure);
    assert.deepEqual(state.lkg, recoveryStateBeforeMixed[key].lkg);
  }
  const sameSource = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210]],
      nasdaq: [["2026-07-17", 20210]],
      nasdaq100: [["2026-07-17", 28210]],
      sox: [["2026-07-17", 11310]],
    }),
    observedAt: "2026-07-18T20:00:00Z",
    attemptId: "gh-422-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(sameSource.exitCode, 0);
  assert.equal(sameSource.degraded, true);
  assert.equal(sameSource.updated, false);
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");
  assert.equal(sameSource.index.current_attempt.failed, 0);
  assert.equal(sameSource.index.current_attempt.promotion_deferrals, 4);
  assert.equal(sameSource.index.counts.retry, 4);
  for (const key of US_SERIES_KEYS) {
    const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
    assert.equal(state.latest_failure.run_id, "421", "same-source deferral preserves the controlled failure");
    assert.equal(state.latest_failure.failure_kind, "controlled_failure");
    assert.equal(state.latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  }
  canonicalBefore.forEach((bytes, index) => assert.deepEqual(
    fs.readFileSync(path.join(paths.canonicalRoot, `${US_SERIES_KEYS[index]}.json`)),
    bytes,
    "same-source deferral cannot publish canonical bytes",
  ));

  for (const [eventName, attemptId, observedAt] of [
    ["workflow_dispatch", "gh-423-1-us-indices", "2026-07-18T20:30:00Z"],
    ["schedule", "gh-424-2-us-indices", "2026-07-18T21:00:00Z"],
  ]) {
    const nonNatural = await runUsIndicesDaily({
      ...paths,
      request: async (_url, key) => yahooResponseForKey(key, {
        sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
        nasdaq: [["2026-07-17", 20210], ["2026-07-18", 20220]],
        nasdaq100: [["2026-07-17", 28210], ["2026-07-18", 28220]],
        sox: [["2026-07-17", 11310], ["2026-07-18", 11320]],
      }),
      observedAt,
      attemptId,
      eventName,
    });
    assert.equal(nonNatural.exitCode, 0);
    assert.equal(nonNatural.updated, false);
    assert.equal(nonNatural.reason, "recovery_requires_schedule");
    assert.equal(nonNatural.index.current_attempt.promotion_deferrals, 4);
    for (const key of US_SERIES_KEYS) {
      const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
      assert.equal(state.latest_failure.run_id, "421", "dispatch/attempt 2 cannot replace the controlled failure");
    }
  }

  for (const [key, values] of Object.entries({
    sp500: [6200, 6210, 6220, 6230],
    nasdaq: [20200, 20210, 20220, 20230],
    nasdaq100: [28200, 28210, 28220, 28230],
    sox: [11300, 11310, 11320, 11330],
  })) {
    fs.writeFileSync(path.join(paths.canonicalRoot, `${key}.json`), `${JSON.stringify(
      values.map((value, index) => ({ date: `2026-07-${String(16 + index).padStart(2, "0")}`, value })),
      null,
      2,
    )}\n`);
  }
  const foreignWriter = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210], ["2026-07-18", 20220]],
      nasdaq100: [["2026-07-17", 28210], ["2026-07-18", 28220]],
      sox: [["2026-07-17", 11310], ["2026-07-18", 11320]],
    }),
    observedAt: "2026-07-18T21:30:00Z",
    attemptId: "gh-425-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(foreignWriter.exitCode, 0);
  assert.equal(foreignWriter.reason, "foreign_writer_conflict");
  assert.equal(foreignWriter.index.current_attempt.failed, 0);
  for (const key of US_SERIES_KEYS) {
    const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
    assert.equal(state.latest_failure.run_id, "421");
    assert.equal(state.latest_promotion_deferral.reason, "foreign_writer_conflict");
  }
  canonicalBefore.forEach((bytes, index) => fs.writeFileSync(
    path.join(paths.canonicalRoot, `${US_SERIES_KEYS[index]}.json`),
    bytes,
  ));
  const recovered = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => yahooResponseForKey(key, {
      sp500: [["2026-07-17", 6210], ["2026-07-18", 6220]],
      nasdaq: [["2026-07-17", 20210], ["2026-07-18", 20220]],
      nasdaq100: [["2026-07-17", 28210], ["2026-07-18", 28220]],
      sox: [["2026-07-17", 11310], ["2026-07-18", 11320]],
    }),
    observedAt: "2026-07-18T22:00:00Z",
    attemptId: "gh-426-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.index.counts.recovered, 4);
  assert.deepEqual(recovered.index.retry_keys, []);
  for (const key of US_SERIES_KEYS) {
    const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", `${key}.json`), "utf8"));
    assert.notEqual(
      state.provider_observation.payload_sha256,
      state.current.payload_sha256,
      "the current provider response hash must remain distinct from merged canonical history",
    );
    assert.equal(fs.existsSync(path.join(
      paths.stateRoot,
      "provider-observations",
      `${state.provider_observation.payload_sha256}.json`,
    )), true);
  }
  await assert.rejects(() => runUsIndicesDaily({
    ...paths,
    controlledFailure: "transport",
    eventName: "schedule",
  }), /requires workflow_dispatch/);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-decode-detail-"));
  const paths = pathsFor(root);
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => key === "nasdaq"
      ? { statusCode: 200, body: "provider-secret-body" }
      : yahooResponseForKey(key, {
        sp500: [["2026-07-17", 6210.2]],
        nasdaq100: [["2026-07-17", 28300.2]],
        sox: [["2026-07-17", 11400.2]],
      }),
    observedAt: OBSERVED_AT,
    attemptId: "gh-403-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.failure_detail, /^SyntaxError:/);
  assert.doesNotMatch(result.failure_detail, /provider-secret-body/);
}

{
  const report = checkUsIndicesParity({
    shadowSeries: { sp500: [{ date: "2026-07-17", value: 6200 }], nasdaq: [] },
    gasSeries: { sp500: [{ date: "2026-07-17", value: 6210 }], nasdaq: [] },
    observedAt: OBSERVED_AT,
  });
  assert.equal(report.series.sp500[0].status, "fail");
}

{
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "100xfenok-next/package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/fetch-us-indices-daily.yml"), "utf8");
  assert.equal(
    packageJson.scripts?.["qa:us-indices-daily"],
    "node ../scripts/test-fetch-us-indices-daily.mjs",
    "package hop must own the US indices regression suite",
  );
  assert.match(
    workflow,
    /npm --prefix 100xfenok-next run qa:us-indices-daily/,
    "workflow must invoke the package-script hop",
  );
  assert.match(workflow, /controlled_failure:/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE:/);
  assert.match(workflow, /ROLLBACK_FAILED: \$\{\{ steps\.fetch_indices\.outputs\.rollback_failed \|\| 'false' \}\}/);
  assert.match(workflow, /if \[\[ "\$ROLLBACK_FAILED" == "true" \]\]; then/);
  assert.match(
    workflow,
    /git add -- data\/admin\/data-supply-state\/detection-attempts\/us_indices_daily\.json/,
    "rollback failure must publish only fail-closed attempt evidence",
  );
  assert.match(workflow, /"\$FETCH_OUTCOME" == "success" && "\$ROLLBACK_FAILED" != "true"/);

  function assertLiveProducerSource(source) {
    assert.match(source, /if \(!Array\.isArray\(providerRevisions\) \|\| !seriesKey\) throw new Error\(`conflicting value for existing date \$\{row\.date\}`\);/,
      "conflicts without an explicit evidence sink must fail closed");
    assert.match(source, /providerRevisions\.push\(revision\);/,
      "accepted provider revisions must be recorded before merge continues");
    assert.match(source, /if \(outOfTolerance\.length > 0\) \{/,
      "out-of-tolerance settled-date revisions must fail closed");
    assert.match(source, /\{ targetPath: canonicalPath, bytes \}/u,
      "successful live writes must include the canonical target");
    assert.doesNotMatch(source, /\bpublicPath\b/u,
      "the live producer must not retain a public write target");
    assert.doesNotMatch(source, /emitUsIndicesParity|qualification/,
      "the live producer must not retain the retired qualification clock or emit parity");
  }
  const producerSource = fs.readFileSync(path.join(REPO_ROOT, "scripts/fetch-us-indices-daily.mjs"), "utf8");
  assertLiveProducerSource(producerSource);
  const swallowedEvidence = producerSource.replace("providerRevisions.push(revision);", "void revision;");
  assert.notEqual(swallowedEvidence, producerSource, "revision-recording mutation anchor must exist");
  assert.throws(
    () => assertLiveProducerSource(swallowedEvidence),
    /must be recorded/,
    "a mutation that swallows provider revision evidence must fail",
  );
  const bypassedRevisionGuard = producerSource.replace(
    "if (outOfTolerance.length > 0) {",
    "if (false) {",
  );
  assert.notEqual(bypassedRevisionGuard, producerSource, "revision-failure mutation anchor must exist");
  assert.throws(
    () => assertLiveProducerSource(bypassedRevisionGuard),
    /must fail closed/,
    "a mutation that bypasses the revision failure path must fail",
  );
}

console.log("test-fetch-us-indices-daily: ok");
