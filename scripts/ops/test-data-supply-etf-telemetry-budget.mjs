import assert from "node:assert/strict";
import {
  buildAnalyticsQuery,
  evaluateAnalyticsBudget,
  parseAnalyticsResult,
} from "./check-data-supply-etf-telemetry-budget.mjs";

const query = buildAnalyticsQuery({
  dataset: "fenok_data_supply_unavailable",
  dayStart: new Date("2026-07-11T00:00:00Z"),
  now: new Date("2026-07-11T12:00:00Z"),
});
assert.match(query, /sum\(_sample_interval\) AS request_count/);
assert.match(query, /count\(DISTINCT index1\) AS unique_ticker_count/);
assert.match(query, /sumIf\(_sample_interval, blob5 = 'HIT'\) AS cache_hit_count/);
assert.match(query, /sum\(double1 \* _sample_interval\) \/ sum\(_sample_interval\) AS average_state_age_hours/);
assert.match(query, /FROM fenok_data_supply_unavailable/);
assert.match(query, /toDateTime\('2026-07-11 00:00:00'\)/);
assert.throws(() => buildAnalyticsQuery({
  dataset: "unsafe; DROP TABLE x",
  dayStart: new Date("2026-07-11T00:00:00Z"),
  now: new Date("2026-07-11T12:00:00Z"),
}));

const usage = parseAnalyticsResult({
  data: [{
    request_count: "79999",
    unique_ticker_count: "212",
    cache_hit_count: "60000",
    average_state_age_hours: "2.5",
    max_state_age_hours: "7",
  }],
});
assert.deepEqual(usage, {
  todayRequests: 79_999,
  uniqueTickers: 212,
  cacheHits: 60_000,
  averageStateAgeHours: 2.5,
  maxStateAgeHours: 7,
});
assert.equal(evaluateAnalyticsBudget(usage, 80_000).status, "ok");
assert.equal(evaluateAnalyticsBudget({ ...usage, todayRequests: 80_000 }, 80_000).status, "alert");
assert.equal(parseAnalyticsResult({ data: [] }).todayRequests, 0);

console.log("data-supply ETF telemetry budget tests passed");
