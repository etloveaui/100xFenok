#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkUsIndicesParity, withinParityTolerance } from "./check-us-indices-parity.mjs";
import {
  mergeSeries,
  parseYahooChart,
  runUsIndicesShadow,
} from "./fetch-us-indices-daily.mjs";

const OBSERVED_AT = "2026-07-20T22:00:00Z";

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

assert.equal(withinParityTolerance(6200.01, 6200.04), true);
assert.equal(withinParityTolerance(6200, 6210), false);

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

console.log("test-fetch-us-indices-daily: ok");
