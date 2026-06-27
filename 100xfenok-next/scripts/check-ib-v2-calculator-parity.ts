import { createRequire } from "node:module";
import { inspect } from "node:util";
import IBCalculatorV2 from "../src/components/ib/v2/lib/ibCalculator";

type Fixture = {
  name: string;
  covers: string;
  input: Record<string, unknown>;
};

type Calculator = {
  calculate: (input: Record<string, unknown>) => unknown;
};

const require = createRequire(import.meta.url);
const IBCalculatorV1 = require("../public/ib-helper/js/calculator.js") as Calculator;

const FIXED_NOW = "2026-06-27T12:00:00.000Z";
const RealDate = Date;

class FixedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) {
      super(FIXED_NOW);
      return;
    }
    super(...args);
  }

  static now() {
    return new RealDate(FIXED_NOW).getTime();
  }
}

const fixtures: Fixture[] = [
  {
    name: "seed_t0_first_buy",
    covers: "T=0 seed buy",
    input: {
      ticker: "TQQQ",
      principal: 10_000,
      divisions: 40,
      avgPrice: 0,
      totalInvested: 0,
      holdings: 0,
      currentPrice: 100,
      locSellPercent: 5,
      additionalBuyEnabled: true,
    },
  },
  {
    name: "front_half_dead_zone",
    covers: "0<T<20 hard dead-zone",
    input: {
      ticker: "TQQQ",
      principal: 1_000,
      divisions: 40,
      avgPrice: 100,
      totalInvested: 100,
      holdings: 1,
      currentPrice: 100,
      locSellPercent: 5,
      additionalBuyEnabled: true,
    },
  },
  {
    name: "front_half_normal_with_additional_buy",
    covers: "0<T<20 normal LOC + additional-buy",
    input: {
      ticker: "TQQQ",
      principal: 10_000,
      divisions: 40,
      avgPrice: 100,
      totalInvested: 1_250,
      holdings: 20,
      currentPrice: 95,
      locSellPercent: 5,
      additionalBuyEnabled: true,
    },
  },
  {
    name: "back_half_t_ge_20",
    covers: "T>=20 back-half buy + normal sell",
    input: {
      ticker: "TQQQ",
      principal: 10_000,
      divisions: 40,
      avgPrice: 100,
      totalInvested: 6_000,
      holdings: 80,
      currentPrice: 90,
      locSellPercent: 5,
      additionalBuyEnabled: true,
    },
  },
  {
    name: "quarter_stop_t_gt_40",
    covers: "T>40 quarter-stop sell gate",
    input: {
      ticker: "TQQQ",
      principal: 10_000,
      divisions: 40,
      avgPrice: 100,
      totalInvested: 11_000,
      holdings: 100,
      currentPrice: 80,
      locSellPercent: 5,
      additionalBuyEnabled: true,
    },
  },
  {
    name: "multi_divisions_fixed_additional_buy",
    covers: "multi-divisions + fixed additional-buy + SOXL sell%",
    input: {
      ticker: "SOXL",
      principal: 9_000,
      divisions: 30,
      avgPrice: 30,
      totalInvested: 2_100,
      holdings: 61,
      currentPrice: 31.92,
      sellPercent: 12,
      locSellPercent: 7,
      additionalBuyEnabled: true,
      additionalBuyMode: "fixed",
      additionalBuyOrderCount: 3,
      additionalBuyQuantity: 2,
      additionalBuyMaxDecline: 10,
    },
  },
];

function normalize(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort(), 2);
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}) {
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, nextValue] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(nextValue, keys);
    }
  }
  return keys;
}

function runWithFixedDate<T>(fn: () => T): T {
  const previousDate = globalThis.Date;
  globalThis.Date = FixedDate as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = previousDate;
  }
}

let failures = 0;

for (const fixture of fixtures) {
  const v1 = runWithFixedDate(() => IBCalculatorV1.calculate(fixture.input));
  const v2 = runWithFixedDate(() => IBCalculatorV2.calculate(fixture.input));
  const v1Normalized = normalize(v1);
  const v2Normalized = normalize(v2);

  if (v1Normalized !== v2Normalized) {
    failures += 1;
    console.error(`[FAIL] ${fixture.name} :: ${fixture.covers}`);
    console.error("V1:", inspect(v1, { depth: null, colors: false }));
    console.error("V2:", inspect(v2, { depth: null, colors: false }));
    continue;
  }

  const result = v1 as {
    calculation?: { T?: number; phase?: string };
    buyOrders?: Array<{ type?: string }>;
    sellOrders?: Array<{ type?: string }>;
    deadZone?: { active?: boolean; phase?: string } | null;
    quarterStopLoss?: { active?: boolean };
  };
  console.log(
    `[PASS] ${fixture.name} :: ${fixture.covers} :: T=${result.calculation?.T} phase=${result.calculation?.phase} buy=${(result.buyOrders ?? []).map((order) => order.type).join("|") || "-"} sell=${(result.sellOrders ?? []).map((order) => order.type).join("|") || "-"} deadZone=${result.deadZone?.active ? result.deadZone.phase : "no"} quarter=${result.quarterStopLoss?.active ? "yes" : "no"}`,
  );
}

if (failures > 0) {
  console.error(`[ib-v2-calculator-parity] FAIL (${failures}/${fixtures.length})`);
  process.exit(1);
}

console.log(`[ib-v2-calculator-parity] PASS (${fixtures.length}/${fixtures.length})`);
