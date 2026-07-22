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
  runUsIndicesDaily,
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
    canonicalRoot: path.join(root, "data", "indices"),
    publicRoot: path.join(root, "public", "data", "indices"),
    stateRoot: path.join(root, "data", "admin", "us-indices-daily"),
    attemptShardPath: path.join(root, "attempts", "us_indices_daily.json"),
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-success-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  fs.mkdirSync(paths.publicRoot, { recursive: true });
  fs.writeFileSync(path.join(paths.canonicalRoot, "sp500.json"), `${JSON.stringify([{ date: "2026-07-16", value: 6200.1 }])}\n`);
  fs.writeFileSync(path.join(paths.canonicalRoot, "nasdaq.json"), `${JSON.stringify([{ date: "2026-07-16", value: 20200.1 }])}\n`);
  fs.cpSync(paths.canonicalRoot, paths.publicRoot, { recursive: true });
  const request = async (_url, key) => response(200, yahooPayload(
    key === "sp500" ? "^GSPC" : "^IXIC",
    key === "sp500"
      ? [["2026-07-16", 6200.1], ["2026-07-17", 6210.2]]
      : [["2026-07-16", 20200.1], ["2026-07-17", 20250.2]],
  ));
  const first = await runUsIndicesDaily({
    ...paths,
    request,
    observedAt: OBSERVED_AT,
    attemptId: "gh-400-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(first.exitCode, 0);
  assert.equal(first.updated, true);
  for (const key of ["sp500", "nasdaq"]) {
    const canonical = fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`));
    const publicMirror = fs.readFileSync(path.join(paths.publicRoot, `${key}.json`));
    assert.deepEqual(publicMirror, canonical, `${key} public mirror must be byte-identical`);
    assert.equal(JSON.parse(canonical).length, 2);
  }
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
  fs.mkdirSync(paths.publicRoot, { recursive: true });
  const initial = {
    sp500: [{ date: "2026-07-20", value: 7443.27978515625 }],
    nasdaq: [{ date: "2026-07-20", value: 25508.072265625 }],
  };
  for (const [key, rows] of Object.entries(initial)) {
    for (const rootPath of [paths.canonicalRoot, paths.publicRoot]) {
      fs.writeFileSync(path.join(rootPath, `${key}.json`), `${JSON.stringify(rows)}\n`);
    }
  }
  const result = await runUsIndicesDaily({
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
  assert.equal(result.exitCode, 0, "one-float32-ULP provider variation must not wedge the lane");
  assert.equal(result.providerRevisions.length, 1);
  assert.equal(result.providerRevisions[0].same_date_change_class, "float32_ulp_flutter");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, "nasdaq.json"), "utf8")), [
    initial.nasdaq[0],
    { date: "2026-07-21", value: 25837.2109375 },
  ]);
  assert.deepEqual(
    fs.readFileSync(path.join(paths.publicRoot, "nasdaq.json")),
    fs.readFileSync(path.join(paths.canonicalRoot, "nasdaq.json")),
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-backfill-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  fs.mkdirSync(paths.publicRoot, { recursive: true });
  const rows = {
    sp500: [["2026-07-20", 6200], ["2026-07-21", 6210], ["2026-07-22", 6220]],
    nasdaq: [["2026-07-20", 20200], ["2026-07-21", 20210], ["2026-07-22", 20220]],
  };
  for (const [key, values] of Object.entries(rows)) {
    const initial = [{ date: values[0][0], value: values[0][1] }];
    for (const rootPath of [paths.canonicalRoot, paths.publicRoot]) {
      fs.writeFileSync(path.join(rootPath, `${key}.json`), `${JSON.stringify(initial)}\n`);
    }
  }
  const result = await runUsIndicesDaily({
    ...paths,
    request: async (_url, key) => response(200, yahooPayload(
      key === "sp500" ? "^GSPC" : "^IXIC",
      rows[key],
    )),
    observedAt: "2026-07-22T22:05:00Z",
    attemptId: "gh-405-1-us-indices",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 0);
  for (const key of ["sp500", "nasdaq"]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.canonicalRoot, `${key}.json`), "utf8")).length, 3,
      "range=5d must keep natural multi-date recovery after the clock is retired");
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-out-of-tolerance-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.canonicalRoot, { recursive: true });
  fs.mkdirSync(paths.publicRoot, { recursive: true });
  for (const [key, value] of Object.entries({ sp500: 6200, nasdaq: 20200 })) {
    for (const rootPath of [paths.canonicalRoot, paths.publicRoot]) {
      fs.writeFileSync(path.join(rootPath, `${key}.json`), `${JSON.stringify([{ date: "2026-07-20", value }])}\n`);
    }
  }
  const before = [paths.canonicalRoot, paths.publicRoot].flatMap((rootPath) =>
    ["sp500", "nasdaq"].map((key) => fs.readFileSync(path.join(rootPath, `${key}.json`))));
  const result = await runUsIndicesDaily({
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
  assert.equal(result.exitCode, 2, "out-of-tolerance settled-date changes must remain fail-closed after parity retirement");
  assert.equal(result.providerRevisions.some((row) => row.within_tolerance === false), true);
  const after = [paths.canonicalRoot, paths.publicRoot].flatMap((rootPath) =>
    ["sp500", "nasdaq"].map((key) => fs.readFileSync(path.join(rootPath, `${key}.json`))));
  after.forEach((bytes, index) => assert.deepEqual(bytes, before[index]));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].assertions.some((assertion) => assertion.passed === false), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "us-indices-live-atomic-"));
  const paths = pathsFor(root);
  const protectedPaths = [paths.canonicalRoot, paths.publicRoot].flatMap((rootPath) =>
    ["sp500", "nasdaq"].map((key) => path.join(rootPath, `${key}.json`)));
  for (const [index, filePath] of protectedPaths.entries()) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `sentinel-${index}\n`);
  }
  const before = protectedPaths.map((filePath) => fs.readFileSync(filePath));
  const result = await runUsIndicesDaily({
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

  function assertLiveProducerSource(source) {
    assert.match(source, /if \(!Array\.isArray\(providerRevisions\) \|\| !seriesKey\) throw new Error\(`conflicting value for existing date \$\{row\.date\}`\);/,
      "conflicts without an explicit evidence sink must fail closed");
    assert.match(source, /providerRevisions\.push\(revision\);/,
      "accepted provider revisions must be recorded before merge continues");
    assert.match(source, /if \(outOfTolerance\.length > 0\) \{/,
      "out-of-tolerance settled-date revisions must fail closed");
    assert.match(source, /\{ targetPath: canonicalPath, bytes \},\s*\{ targetPath: publicPath, bytes \}/u,
      "successful live writes must include canonical and public mirror targets");
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
