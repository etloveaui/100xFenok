import assert from "node:assert/strict";
import { calculate } from "../src/components/ib/v2/lib/ibCalculator";
import {
  getEnabledIbStocks,
  type IbV1DailyData,
  type IbV1Profile,
  type IbV1ProfileStore,
} from "../src/components/ib/v2/lib/ibV1Storage";
import {
  buildIbCalculatorInput,
  computeIbV1AvgPrice,
  normalizeAdditionalBuy,
} from "../src/components/ib/v2/useIbHelperV2LiveData";
import {
  DAILY_MULTI_SOXL,
  DAILY_MULTI_TQQQ,
  DAILY_SOXL_ACCUMULATING,
  DAILY_SOXL_ACTIVE,
  DAILY_TQQQ_ACCUMULATING,
  DAILY_TQQQ_ACTIVE,
  DAILY_TQQQ_OVER,
  DAILY_TQQQ_T0,
  PROFILE_MULTI,
  PROFILE_SOXL_CUSTOM,
  PROFILE_TQQQ_40DIV,
} from "../src/components/ib/v2/lib/__fixtures__/ib-v2-fixtures";

type FixtureDaily = {
  storageKey: string;
  payload: IbV1DailyData;
  expectedT: number;
  expectedPhase: string;
};

type Quote = {
  ticker: string;
  price: number;
  source: string;
  rawSource: string;
  cached: boolean;
  fetchedAt: string;
};

function activeProfile(store: IbV1ProfileStore): IbV1Profile {
  const id = store.activeProfileId;
  assert.ok(id, "activeProfileId is required");
  const profile = store.profiles?.[id];
  assert.ok(profile, `profile missing: ${id}`);
  return { ...profile, id };
}

function quoteFor(ticker: string, price: number): Quote {
  return {
    ticker,
    price,
    source: "WEBAPP:FIXTURE",
    rawSource: "FIXTURE",
    cached: false,
    fetchedAt: "2026-06-27T12:00:00.000Z",
  };
}

function assertFixtureInput(store: IbV1ProfileStore, daily: FixtureDaily) {
  const profile = activeProfile(store);
  const symbol = daily.storageKey.split("_").at(-1);
  assert.ok(symbol, `symbol missing from ${daily.storageKey}`);
  const stock = profile.stocks?.find((entry) => entry.symbol === symbol);
  assert.ok(stock, `stock missing: ${symbol}`);

  const quote = quoteFor(symbol, daily.payload.currentPrice || 0);
  const input = buildIbCalculatorInput(profile, stock, daily.payload, quote);
  const expectedAvg = computeIbV1AvgPrice(daily.payload.totalInvested, daily.payload.holdings);

  assert.equal(input.ticker, symbol);
  assert.equal(input.avgPrice, expectedAvg);
  assert.equal(input.currentPrice, daily.payload.currentPrice || 0);
  assert.equal(input.totalInvested, daily.payload.totalInvested || 0);
  assert.equal(input.holdings, parseInt(String(daily.payload.holdings ?? ""), 10) || 0);

  const result = calculate(input) as { error?: string; calculation?: { T?: number; phase?: string } };
  assert.equal(result.error, undefined);
  assert.ok(Number.isFinite(result.calculation?.T), `${symbol} calculation T should be finite`);

  console.log(
    `[PASS] fixture input ${profile.id}/${symbol} :: avg=${input.avgPrice} current=${input.currentPrice} T=${result.calculation?.T} phase=${result.calculation?.phase}`,
  );
}

for (const daily of [
  DAILY_TQQQ_T0,
  DAILY_TQQQ_ACCUMULATING,
  DAILY_TQQQ_ACTIVE,
  DAILY_TQQQ_OVER,
] as FixtureDaily[]) {
  assertFixtureInput(PROFILE_TQQQ_40DIV as IbV1ProfileStore, daily);
}

for (const daily of [DAILY_SOXL_ACTIVE, DAILY_SOXL_ACCUMULATING] as FixtureDaily[]) {
  assertFixtureInput(PROFILE_SOXL_CUSTOM as IbV1ProfileStore, daily);
}

for (const daily of [DAILY_MULTI_TQQQ, DAILY_MULTI_SOXL] as FixtureDaily[]) {
  assertFixtureInput(PROFILE_MULTI as IbV1ProfileStore, daily);
}

const soxlProfile = activeProfile(PROFILE_SOXL_CUSTOM as IbV1ProfileStore);
const soxlAdd = normalizeAdditionalBuy(soxlProfile);
const soxlStock = soxlProfile.stocks?.[0];
assert.ok(soxlStock, "SOXL fixture stock missing");
const soxlInput = buildIbCalculatorInput(
  soxlProfile,
  soxlStock,
  DAILY_SOXL_ACCUMULATING.payload,
  quoteFor("SOXL", DAILY_SOXL_ACCUMULATING.payload.currentPrice || 0),
);
assert.equal(soxlAdd.enabled, false);
assert.equal(soxlInput.additionalBuyEnabled, false);
assert.equal(soxlInput.additionalBuyOrderCount, 0);
assert.equal(soxlInput.additionalBuyBudgetRatio, 0);
assert.equal(soxlInput.additionalBuyMode, "budget_ratio");
assert.equal(soxlInput.additionalBuyAllowOneOver, true);
assert.equal(soxlInput.deadZoneGuardEnabled, true);
assert.equal(soxlInput.additionalBuyMaxDecline, 15);
assert.equal(soxlInput.additionalBuyQuantity, 1);
assert.equal(soxlInput.sellPercent, 10);
assert.equal(soxlInput.locSellPercent, 5);
console.log("[PASS] disabled additional-buy keeps V1 non-zero props while zeroing orderCount/budgetRatio");

const multiProfile = activeProfile(PROFILE_MULTI as IbV1ProfileStore);
assert.deepEqual(
  getEnabledIbStocks(multiProfile).map((stock) => stock.symbol),
  ["TQQQ", "SOXL"],
);
console.log("[PASS] disabled ticker excluded from hook input candidates");

const migrationProfile: IbV1Profile = {
  id: "budget_migration",
  settings: {
    additionalBuy: {
      enabled: true,
      mode: "budget_ratio",
      budgetRatio: 25,
      allowOneOver: false,
      deadZoneGuardEnabled: false,
      maxDecline: 17,
      quantity: 2,
      orderCount: 99,
    },
  },
};
const migrated = normalizeAdditionalBuy(migrationProfile);
assert.equal(migrated.budgetRatio, 20);
assert.equal(migrated.orderCount, 8);
assert.equal(migrated.allowOneOver, false);
assert.equal(migrated.deadZoneGuardEnabled, false);
console.log("[PASS] additional-buy 25% migration and clamps match V1");

const t0Profile = activeProfile(PROFILE_TQQQ_40DIV as IbV1ProfileStore);
const t0Stock = t0Profile.stocks?.[0];
assert.ok(t0Stock, "TQQQ fixture stock missing");
const t0Input = buildIbCalculatorInput(
  t0Profile,
  t0Stock,
  DAILY_TQQQ_T0.payload,
  quoteFor("TQQQ", DAILY_TQQQ_T0.payload.currentPrice || 0),
);
const t0Result = calculate(t0Input) as { error?: string; calculation?: { T?: number }; seedInfo?: unknown };
assert.equal(t0Result.error, undefined);
assert.equal(t0Result.calculation?.T, 0);
console.log("[PASS] T=0 allowed when currentPrice > 0");

const avgOnlyInput = buildIbCalculatorInput(t0Profile, t0Stock, DAILY_TQQQ_ACCUMULATING.payload, null);
const avgOnlyResult = calculate(avgOnlyInput) as { error?: string };
assert.equal(avgOnlyInput.currentPrice, 0);
assert.ok(avgOnlyInput.avgPrice > 0);
assert.equal(avgOnlyResult.error, undefined);
console.log("[PASS] missing live price falls back to avgPrice-only calculation");

const noPriceInput = buildIbCalculatorInput(
  t0Profile,
  t0Stock,
  { totalInvested: 0, holdings: 0, currentPrice: 0 },
  null,
);
const noPriceResult = calculate(noPriceInput) as { error?: string };
assert.equal(noPriceInput.avgPrice, 0);
assert.equal(noPriceInput.currentPrice, 0);
assert.equal(noPriceResult.error, "평단가 또는 현재가를 입력하세요");
console.log("[PASS] missing avgPrice and currentPrice fails like V1");

console.log("[ib-v2-live-data-fixtures] PASS");
