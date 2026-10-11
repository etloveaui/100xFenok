import assert from "node:assert/strict";
import {
  ETF_DETAIL_COMPAT_EXPIRES_AT,
  getEtfDataSupplyPresentation,
  isLegacyEtfDetailCompatibilityActive,
  parseEtfApiResponse,
  parseEtfDataSupply,
} from "../src/lib/data-supply-etf-ui";

const base = {
  enrollment_state: "enrolled",
  provider_role: "fallback",
  fallback_depth: 1,
  source_as_of: "2026-07-02T01:57:29Z",
  selected_at: "2026-07-11T00:00:00Z",
  source_age_days: 9,
  reason_code: "primary_unavailable",
  recovery_transition: null,
  projection_digest: "a".repeat(64),
} as const;

const expectations = [
  ["fresh_primary", null, 0],
  ["fresh_fallback", "보조 공급원 최신값", 1],
  ["lkg_primary", "마지막 확인값", 1],
  ["lkg_fallback", "마지막 확인값", 2],
  ["unavailable", "세부 데이터 일시 이용 불가", null],
] as const;

async function main() {

for (const [resolution_state, label, fallback_depth] of expectations) {
  const value = parseEtfDataSupply({
    ...base,
    resolution_state,
    provider_role: resolution_state === "unavailable" ? null : resolution_state.endsWith("primary") ? "primary" : "fallback",
    fallback_depth,
    source_as_of: resolution_state === "unavailable" ? null : base.source_as_of,
    selected_at: resolution_state === "unavailable" ? null : base.selected_at,
    source_age_days: resolution_state === "unavailable" ? null : 9,
    reason_code: resolution_state === "unavailable" ? null : base.reason_code,
    recovery_transition: resolution_state === "unavailable" ? "unavailable" : null,
  });
  assert.ok(value);
  assert.equal(getEtfDataSupplyPresentation(value).label, label);
  assert.equal(value.fallback_depth, fallback_depth);
  if (resolution_state !== "unavailable") {
    for (const wrongDepth of [-1, 0, 1, 2, 3, 1.5].filter((depth) => depth !== fallback_depth)) {
      assert.equal(parseEtfDataSupply({ ...value, fallback_depth: wrongDepth }), null,
        `${resolution_state} must reject depth ${wrongDepth}`);
    }
  }
  if (resolution_state === "lkg_primary" || resolution_state === "lkg_fallback") {
    const restored = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
      asset_type: "etf", ticker: "BITW", data_supply: value,
    }), "BITW");
    assert.equal(restored.kind, "ok");
    if (restored.kind === "ok") {
      assert.deepEqual(restored.dataSupply, value, "HTTP 200 must retain verified LKG metadata");
      const presentation = getEtfDataSupplyPresentation(restored.dataSupply);
      assert.equal(presentation.label, "마지막 확인값");
      assert.equal(presentation.sourceDate, base.source_as_of);
      assert.equal(presentation.ageDays, base.source_age_days);
      assert.equal(presentation.degraded, true);
    }
  }
}

const noTime = parseEtfDataSupply({
  ...base,
  resolution_state: "unavailable",
  provider_role: null,
  fallback_depth: null,
  source_as_of: null,
  selected_at: null,
  source_age_days: null,
  reason_code: null,
  recovery_transition: "unavailable",
});
assert.ok(noTime);
assert.equal(getEtfDataSupplyPresentation(noTime).sourceDate, null);

const typed = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "DATA_SUPPLY_UNAVAILABLE", data_supply: noTime },
  { status: 503 },
), "ADIU");
assert.equal(typed.kind, "unavailable");

for (const status of ["closed", "renamed"] as const) {
  const lifecycle = { status, effective_date: "2026-08-21", successor_ticker: status === "renamed" ? "MEGX" : null,
    reason: "issuer notice", primary_reference: "www.sec.gov/Archives/notice.htm", last_source_as_of: "2026-08-20T19:11:29Z" };
  const result = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
    error: status === "renamed" ? "DATA_SUPPLY_SECURITY_RENAMED" : "DATA_SUPPLY_SECURITY_CLOSED",
    ticker: "MGKX", data_supply: { ...noTime, security_lifecycle: lifecycle },
  }, { status: 410 }), "MGKX");
  assert.equal(result.kind, "unavailable");
  const presentation = getEtfDataSupplyPresentation(result.dataSupply);
  assert.equal(presentation.label, status === "renamed" ? "티커 변경" : "거래 종료");
  assert.equal(presentation.sourceDate, lifecycle.last_source_as_of);
  assert.equal(presentation.ageDays, null);
}
const wrongTerminal = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
  error: "DATA_SUPPLY_SECURITY_CLOSED", ticker: "OTHER", data_supply: noTime,
}, { status: 410 }), "MGKX");
assert.equal(wrongTerminal.kind, "failed");
const inferredClosed = parseEtfDataSupply({ ...noTime, security_lifecycle: {
  status: "closed", effective_date: "2026-10-14", successor_ticker: null,
  reason: "three scheduled provider observations", primary_reference: "stockanalysis.com/etf/lost/",
  last_source_as_of: "2026-08-01", evidence_kind: "provider_observations",
} });
assert.ok(inferredClosed);
const inferredPresentation = getEtfDataSupplyPresentation(inferredClosed);
assert.equal(inferredPresentation.label, "공급자 제공 종료");
assert.equal(inferredPresentation.sourceDate, "2026-08-01");
assert.ok(!inferredPresentation.description?.includes("공식 공시"));

const shardUnavailable = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE", ticker: "SPY" },
  { status: 503, headers: { "Cache-Control": "no-store" } },
), "SPY");
assert.equal(shardUnavailable.kind, "shard_infrastructure_unavailable");

const generic = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "DATA_SUPPLY_INDEX_UNAVAILABLE" },
  { status: 503 },
), "SPY");
assert.equal(generic.kind, "failed");

const missing = await parseEtfApiResponse<Record<string, unknown>>(Response.json(
  { error: "STOCKANALYSIS_ASSET_NOT_FOUND", ticker: "ZZZZ" },
  { status: 404 },
), "ZZZZ");
assert.equal(missing.kind, "missing");

const valid = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
  schema_version: "stockanalysis/v1",
  source: "stockanalysis",
  asset_type: "etf",
  ticker: "SPY",
}), "SPY");
assert.equal(valid.kind, "ok");

const capturedZero = { schema_version: "stockanalysis/v1", asset_type: "etf", ticker: "AIQD",
  source_as_of: "2026-09-30T20:00:00Z", normalized: { holdings: [
    { symbol: "PLTR", raw: { s: "$PLTR", sh: 0 } },
    { name: "Not supplied", raw: { sh: "n/a" } },
  ] } };
const zeroResponse = await parseEtfApiResponse<any>(Response.json(capturedZero), "AIQD");
assert.equal(zeroResponse.kind, "ok");
if (zeroResponse.kind === "ok") {
  assert.equal(zeroResponse.data.normalized.holdings[0].shares, 0);
  assert.equal(zeroResponse.data.normalized.holdings[1].shares, undefined);
  assert.equal(zeroResponse.data.source_as_of, capturedZero.source_as_of);
  assert.deepEqual(zeroResponse.data.normalized.holdings[0].raw, capturedZero.normalized.holdings[0].raw);
}

const retainedYahoo = {
  schema_version: "yf-etf-detail/v1", asset_type: "etf", ticker: "ACHX",
  source_as_of: "2026-07-08T22:43:26Z", fetched_at: "2026-07-09T00:00:00Z",
  data_supply: { ...base, resolution_state: "lkg_fallback", fallback_depth: 2 },
  normalized: {
    overview: { aum: 255105, beta: 0 }, quote: { p: 26.205 },
    asset_allocation: { cashPosition: -1.9417, stockPosition: 1.962, bondPosition: 0 },
    sectors: { technology: 0.75 },
    history: [{ date: "2026-07-07", Close: 27.2, Volume: 0 }],
    history_periods: { daily_1y: [{ date: "2026-07-07", Close: 27.2 }] },
  },
  raw: { yf: { info: { longName: "Captured fund name", fundFamily: "Captured issuer",
    trailingPE: 12, sharesOutstanding: 100, fiftyTwoWeekHigh: 30, fiftyTwoWeekLow: 20 } } },
};
const retainedBytes = JSON.stringify(retainedYahoo);
const parsedYahoo = await parseEtfApiResponse<typeof retainedYahoo & { normalized: any }>(Response.json(retainedYahoo), "ACHX");
assert.equal(parsedYahoo.kind, "ok");
if (parsedYahoo.kind === "ok") {
  const normalized = parsedYahoo.data.normalized;
  assert.deepEqual(normalized.asset_allocation, [
    { key: "cashPosition", value: -194.17 }, { key: "stockPosition", value: 196.2 }, { key: "bondPosition", value: 0 },
  ]);
  assert.deepEqual(normalized.sectors, [{ key: "technology", value: 75 }]);
  assert.equal(normalized.history[0].close, 27.2);
  assert.equal(normalized.history[0].volume, 0);
  assert.equal(normalized.history_periods.daily_1y[0].close, 27.2);
  assert.equal(normalized.overview.name, "Captured fund name");
  assert.equal(normalized.overview.peRatio, 12);
  assert.equal(normalized.overview.beta, 0);
  assert.equal(normalized.quote.h52, 30);
  assert.equal(normalized.quote.l52, 20);
  assert.deepEqual(parsedYahoo.data.raw, retainedYahoo.raw);
  assert.equal(parsedYahoo.data.source_as_of, retainedYahoo.source_as_of);
  assert.equal(parsedYahoo.data.fetched_at, retainedYahoo.fetched_at);
  assert.deepEqual(parsedYahoo.dataSupply, retainedYahoo.data_supply);
  assert.equal(getEtfDataSupplyPresentation(parsedYahoo.dataSupply).degraded, true);
  const twice = await parseEtfApiResponse<typeof parsedYahoo.data>(Response.json(parsedYahoo.data), "ACHX");
  assert.equal(twice.kind, "ok");
  if (twice.kind === "ok") assert.deepEqual(twice.data, parsedYahoo.data, "already normalized ratios must not be multiplied twice");
}
assert.equal(JSON.stringify(retainedYahoo), retainedBytes, "captured source input is immutable");

const crossTicker = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
  schema_version: "stockanalysis/v1",
  source: "stockanalysis",
  asset_type: "etf",
  ticker: "QQQ",
}), "SPY");
assert.equal(crossTicker.kind, "failed");

const invalidSuccess = await parseEtfApiResponse<Record<string, unknown>>(Response.json({
  error: "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE",
  ticker: "SPY",
}), "SPY");
assert.equal(invalidSuccess.kind, "failed");

assert.equal(isLegacyEtfDetailCompatibilityActive(
  new Date("2026-07-12T00:00:00Z"),
  "2026-07-18T00:00:00Z",
), true);
assert.equal(isLegacyEtfDetailCompatibilityActive(
  new Date("2026-07-18T00:00:00Z"),
  "2026-07-18T00:00:00Z",
), false);
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-12T00:00:00Z"), null), false);
assert.equal(ETF_DETAIL_COMPAT_EXPIRES_AT, "2026-07-25T00:00:00Z");
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-24T23:59:59Z")), true);
assert.equal(isLegacyEtfDetailCompatibilityActive(new Date("2026-07-25T00:00:00Z")), false);

console.log("data-supply ETF UI tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
