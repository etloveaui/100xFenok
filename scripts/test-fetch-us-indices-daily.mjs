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
  runUsIndicesShadow,
} from "./fetch-us-indices-daily.mjs";

const OBSERVED_AT = "2026-07-20T22:00:00Z";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  return {
    shadowRoot: path.join(root, "data", "admin", "us-indices-daily", "shadow"),
    stateRoot: path.join(root, "data", "admin", "us-indices-daily"),
    attemptShardPath: path.join(root, "attempts", "us_indices_daily.json"),
    parityReportPath: path.join(root, "data", "admin", "us-indices-daily", "parity-report.json"),
    gasCanonicalRoot: path.join(root, "data", "indices"),
  };
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-shadow-success-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.gasCanonicalRoot, { recursive: true });
  fs.writeFileSync(path.join(paths.gasCanonicalRoot, "sp500.json"), `${JSON.stringify(parsed)}\n`);
  fs.writeFileSync(path.join(paths.gasCanonicalRoot, "nasdaq.json"), `${JSON.stringify([{ date: "2026-07-16", value: 20200.1 }])}\n`);
  const request = async (_url, key) => response(200, yahooPayload(
    key === "sp500" ? "^GSPC" : "^IXIC",
    key === "sp500"
      ? [["2026-07-16", 6200.1], ["2026-07-17", 6210.2]]
      : [["2026-07-16", 20200.1], ["2026-07-17", 20250.2]],
  ));
  const first = await runUsIndicesShadow({
    ...paths,
    request,
    observedAt: OBSERVED_AT,
    attemptId: "gh-400-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(first.exitCode, 0);
  assert.equal(first.updated, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.shadowRoot, "sp500.json"), "utf8")).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.shadowRoot, "nasdaq.json"), "utf8")).length, 2);
  const report = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(report.series.sp500.at(-1).status, "pass");
  assert.equal(report.series.nasdaq.at(-1).status, "pending", "pre-GAS NASDAQ dates remain pending");
  const second = await runUsIndicesShadow({
    ...paths,
    request,
    observedAt: "2026-07-20T22:05:00Z",
    attemptId: "gh-401-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(second.exitCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.shadowRoot, "sp500.json"), "utf8")).length, 2);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-shadow-provider-revision-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.shadowRoot, { recursive: true });
  fs.mkdirSync(paths.gasCanonicalRoot, { recursive: true });
  const initial = {
    sp500: [{ date: "2026-07-20", value: 7443.27978515625 }],
    nasdaq: [{ date: "2026-07-20", value: 25508.072265625 }],
  };
  for (const [key, rows] of Object.entries(initial)) {
    fs.writeFileSync(path.join(paths.shadowRoot, `${key}.json`), `${JSON.stringify(rows)}\n`);
    fs.writeFileSync(path.join(paths.gasCanonicalRoot, `${key}.json`), `${JSON.stringify(rows)}\n`);
  }
  const first = await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      key === "sp500"
        ? [["2026-07-20", 7443.27978515625], ["2026-07-21", 7509.2001953125]]
        : [["2026-07-20", 25508.0703125], ["2026-07-21", 25837.2109375]],
    )),
    observedAt: "2026-07-21T22:47:00Z",
    attemptId: "gh-403-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(first.exitCode, 0, "same-date provider variation must not wedge the lane");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.shadowRoot, "nasdaq.json"), "utf8")), [
    initial.nasdaq[0],
    { date: "2026-07-21", value: 25837.2109375 },
  ]);
  const firstReport = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(firstReport.observed_at, "2026-07-21T22:47:00Z", "artifact must be fresh for the current run");
  assert.equal(firstReport.provider_revisions.length, 1);
  assert.equal(firstReport.provider_revisions[0].series, "nasdaq");
  assert.equal(firstReport.provider_revisions[0].symbol, "^IXIC");
  assert.equal(firstReport.provider_revisions[0].run_id, "403");
  assert.equal(firstReport.provider_revisions[0].run_attempt, 1);
  assert.equal(firstReport.provider_revisions[0].event_name, "schedule");
  assert.match(firstReport.provider_revisions[0].body_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(firstReport.provider_revisions[0].occurrences, 1);
  assert.equal(firstReport.qualification.consecutive_clean_trading_days, 0);
  assert.deepEqual(firstReport.qualification.observed_trading_dates, ["2026-07-21"]);

  fs.writeFileSync(path.join(paths.gasCanonicalRoot, "sp500.json"), `${JSON.stringify([
    initial.sp500[0],
    { date: "2026-07-21", value: 7509.2001953125 },
  ])}\n`);
  fs.writeFileSync(path.join(paths.gasCanonicalRoot, "nasdaq.json"), `${JSON.stringify([
    initial.nasdaq[0],
    { date: "2026-07-21", value: 25837.2109375 },
  ])}\n`);

  const second = await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      key === "sp500"
        ? [["2026-07-20", 7443.27978515625], ["2026-07-21", 7509.2001953125]]
        : [["2026-07-20", 25508.072265625], ["2026-07-21", 25837.2109375]],
    )),
    observedAt: "2026-07-21T23:00:00Z",
    attemptId: "gh-404-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(second.exitCode, 0);
  const secondReport = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(secondReport.observed_at, "2026-07-21T23:00:00Z");
  assert.equal(secondReport.provider_revisions.length, 1, "revision history must survive a clean replay");
  assert.equal(secondReport.provider_revisions[0].occurrences, 1);
  assert.equal(secondReport.qualification.consecutive_clean_trading_days, 1);
  assert.deepEqual(secondReport.qualification.counted_dates, ["2026-07-21"]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-shadow-missed-backfill-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.shadowRoot, { recursive: true });
  fs.mkdirSync(paths.gasCanonicalRoot, { recursive: true });
  const rows = {
    sp500: [["2026-07-20", 6200], ["2026-07-21", 6210], ["2026-07-22", 6220]],
    nasdaq: [["2026-07-20", 20200], ["2026-07-21", 20210], ["2026-07-22", 20220]],
  };
  for (const [key, values] of Object.entries(rows)) {
    fs.writeFileSync(path.join(paths.shadowRoot, `${key}.json`), `${JSON.stringify([{
      date: values[0][0], value: values[0][1],
    }])}\n`);
    fs.writeFileSync(path.join(paths.gasCanonicalRoot, `${key}.json`), `${JSON.stringify(
      values.map(([date, value]) => ({ date, value })),
    )}\n`);
  }
  await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      rows[key],
    )),
    observedAt: "2026-07-22T22:05:00Z",
    attemptId: "gh-405-1-us-indices",
    eventName: "schedule",
  });
  const report = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(report.qualification.last_reset.reason, "missed_trading_days_backfilled");
  assert.deepEqual(report.qualification.last_reset.affected_dates, ["2026-07-21"]);
  assert.deepEqual(report.qualification.counted_dates, ["2026-07-22"], "backfilled missed dates must not be credited");
  assert.equal(report.qualification.consecutive_clean_trading_days, 1);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-shadow-blocking-revision-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.shadowRoot, { recursive: true });
  fs.mkdirSync(paths.gasCanonicalRoot, { recursive: true });
  const initial = { sp500: 6200, nasdaq: 20200 };
  for (const [key, value] of Object.entries(initial)) {
    fs.writeFileSync(path.join(paths.shadowRoot, `${key}.json`), `${JSON.stringify([{ date: "2026-07-20", value }])}\n`);
    fs.writeFileSync(path.join(paths.gasCanonicalRoot, `${key}.json`), `${JSON.stringify([
      { date: "2026-07-20", value },
      { date: "2026-07-21", value: value + 10 },
    ])}\n`);
  }
  await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      key === "sp500"
        ? [["2026-07-20", 6100], ["2026-07-21", 6210]]
        : [["2026-07-20", 20200], ["2026-07-21", 20210]],
    )),
    observedAt: "2026-07-21T22:05:00Z",
    attemptId: "gh-406-1-us-indices",
    eventName: "schedule",
  });
  const report = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(report.summary.fail, 1, "out-of-tolerance provider revision must fail closed for legacy summary readers");
  assert.equal(report.summary.provider_revision_out_of_tolerance, 1);
  assert.equal(report.qualification.status, "blocked");
  assert.equal(report.qualification.consecutive_clean_trading_days, 0);
  assert.equal(report.qualification.last_reset.reason, "provider_revision_out_of_tolerance");

  for (const [key, value] of Object.entries(initial)) {
    fs.writeFileSync(path.join(paths.gasCanonicalRoot, `${key}.json`), `${JSON.stringify([
      { date: "2026-07-20", value },
      { date: "2026-07-21", value: value + 10 },
      { date: "2026-07-22", value: value + 20 },
    ])}\n`);
  }
  await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      key === "sp500"
        ? [["2026-07-20", 6200], ["2026-07-21", 6210], ["2026-07-22", 6220]]
        : [["2026-07-20", 20200], ["2026-07-21", 20210], ["2026-07-22", 20220]],
    )),
    observedAt: "2026-07-22T22:05:00Z",
    attemptId: "gh-407-1-us-indices",
    eventName: "schedule",
  });
  const recovered = JSON.parse(fs.readFileSync(paths.parityReportPath, "utf8"));
  assert.equal(recovered.summary.fail, 0, "historical revision evidence must not keep clean runs failed forever");
  assert.equal(recovered.summary.provider_revision_history_events, 1);
  assert.equal(recovered.qualification.status, "building");
  assert.equal(recovered.qualification.consecutive_clean_trading_days, 1);
  assert.deepEqual(recovered.qualification.counted_dates, ["2026-07-22"]);
  assert.equal(recovered.qualification.last_reset.reason, "provider_revision_out_of_tolerance", "recovery must preserve reset evidence");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-shadow-atomic-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.shadowRoot, { recursive: true });
  fs.mkdirSync(paths.gasCanonicalRoot, { recursive: true });
  const protectedPaths = [
    path.join(paths.shadowRoot, "sp500.json"),
    path.join(paths.shadowRoot, "nasdaq.json"),
    path.join(paths.gasCanonicalRoot, "sp500.json"),
    path.join(paths.gasCanonicalRoot, "nasdaq.json"),
    path.join(root, "public", "data", "indices", "sp500.json"),
    path.join(root, "public", "data", "indices", "nasdaq.json"),
  ];
  for (const [index, filePath] of protectedPaths.entries()) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `sentinel-${index}\n`);
  }
  const before = protectedPaths.map((filePath) => fs.readFileSync(filePath));
  const result = await runUsIndicesShadow({
    ...paths,
    request: async (_url, key) => {
      if (key === "nasdaq") throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return response(200, yahooPayload("^GSPC", [["2026-07-17", 6210.2]]));
    },
    observedAt: OBSERVED_AT,
    attemptId: "gh-402-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 2);
  protectedPaths.forEach((filePath, index) => assert.deepEqual(fs.readFileSync(filePath), before[index]));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.lane_id, "us_indices_daily");
  assert.equal(shard.attempts[0].execution, "threw");
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

  function assertRevisionGuardSource(source) {
    assert.match(source, /if \(!Array\.isArray\(providerRevisions\) \|\| !seriesKey\) throw new Error\(`conflicting value for existing date \$\{row\.date\}`\);/,
      "conflicts without an explicit evidence sink must fail closed");
    assert.match(source, /providerRevisions\.push\(revision\);/,
      "accepted provider revisions must be recorded before merge continues");
    assert.match(source, /if \(newCommonDates\.length > 1\) reset\("missed_trading_days_backfilled", newCommonDates\.slice\(0, -1\)\);/,
      "multiple backfilled dates must reset the consecutive qualification clock");
  }
  const producerSource = fs.readFileSync(path.join(REPO_ROOT, "scripts/fetch-us-indices-daily.mjs"), "utf8");
  const paritySource = fs.readFileSync(path.join(REPO_ROOT, "scripts/check-us-indices-parity.mjs"), "utf8");
  const contractSource = `${producerSource}\n${paritySource}`;
  assertRevisionGuardSource(contractSource);
  const swallowedEvidence = contractSource.replace("providerRevisions.push(revision);", "void revision;");
  assert.notEqual(swallowedEvidence, contractSource, "revision-recording mutation anchor must exist");
  assert.throws(
    () => assertRevisionGuardSource(swallowedEvidence),
    /must be recorded/,
    "a mutation that swallows provider revision evidence must fail",
  );
  const launderedBackfill = contractSource.replace(
    'if (newCommonDates.length > 1) reset("missed_trading_days_backfilled", newCommonDates.slice(0, -1));',
    "void newCommonDates;",
  );
  assert.notEqual(launderedBackfill, contractSource, "backfill-clock mutation anchor must exist");
  assert.throws(
    () => assertRevisionGuardSource(launderedBackfill),
    /must reset the consecutive qualification clock/,
    "a mutation that launders missed trading days through backfill must fail",
  );
}

console.log("test-fetch-us-indices-daily: ok");
