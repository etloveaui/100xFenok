#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectSecondaryDepositaryRepresentations,
  marketScopeFromMarket,
  normalizeTicker,
} from "./stock-action-score-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scouterRoot = path.join(repoRoot, "data", "global-scouter");
const builderSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "build-phase2-closeout-indexes.mjs"),
  "utf8",
);
const rows = JSON.parse(
  fs.readFileSync(path.join(scouterRoot, "core", "stocks_analyzer.json"), "utf8"),
).data;
const detailCache = new Map();

function readDetail(symbol) {
  if (!detailCache.has(symbol)) {
    detailCache.set(
      symbol,
      JSON.parse(
        fs.readFileSync(path.join(scouterRoot, "stocks", "detail", `${symbol}.json`), "utf8"),
      ),
    );
  }
  return detailCache.get(symbol);
}

function clone(value) {
  return structuredClone(value);
}

function marketFor(symbol, classifications) {
  return normalizeTicker(symbol, classifications).market;
}

const classifications = detectSecondaryDepositaryRepresentations(rows, readDetail);
assert.deepEqual(
  [...classifications.keys()].sort(),
  ["SKHY"],
  "only the measured SKHY/000660.KS secondary representation may qualify",
);
assert.equal(classifications.get("SKHY")?.home_symbol, "000660.KS");
assert(classifications.get("SKHY")?.financial_ratio > 14);
assert(classifications.get("SKHY")?.financial_ratio < 15);
assert(classifications.get("SKHY")?.max_relative_dispersion < 0.1);

assert.equal(marketFor("SKHY", classifications), "US_CLASS");
for (const symbol of ["TSM", "ASML", "NVO", "RIO", "BHP", "AZN"]) {
  assert.equal(marketFor(symbol, classifications), "US", `${symbol} must remain plain US`);
}
assert.equal(
  marketFor("BRK.B", classifications),
  "US_CLASS",
  "the existing dot-based class-share rule must survive",
);
assert.equal(marketFor("2454.TW", classifications), "TW", "Taiwan .TW suffix must map to Taiwan");
assert.equal(marketFor("1234.TWO", classifications), "TW", "Taiwan .TWO suffix must map to Taiwan");
assert.equal(marketScopeFromMarket("TW"), "asia", "Taiwan uses the existing Asia scoring scope");
assert.equal(marketFor("285A.T", classifications), "US_CLASS", "Japan .T suffix remains visible as an upstream anomaly until denominator policy is fixed");
const stockActionIndex = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "data", "computed", "stock_action_index.json"), "utf8"),
);
assert.deepEqual(
  stockActionIndex.rows.find((row) => row.ticker_normalized === "2454-TW"),
  {
    ...stockActionIndex.rows.find((row) => row.ticker_normalized === "2454-TW"),
    market: "TW",
    marketScope: "asia",
    country: "TW",
  },
  "landed stock-action artifact must carry the reviewed Taiwan market mapping",
);

const withoutHomeLine = rows.filter((row) => row.symbol !== "000660.KS");
const withoutHomeClassifications = detectSecondaryDepositaryRepresentations(
  withoutHomeLine,
  readDetail,
);
assert.equal(
  marketFor("SKHY", withoutHomeClassifications),
  "US",
  "a depositary row without its home line must remain plain US",
);

const withoutDepositaryMarker = clone(rows);
withoutDepositaryMarker.find((row) => row.symbol === "SKHY").companyName = "SK hynix";
assert.equal(
  marketFor(
    "SKHY",
    detectSecondaryDepositaryRepresentations(withoutDepositaryMarker, readDetail),
  ),
  "US",
  "removing the depositary name marker must disable the override",
);

for (const [section, metric] of [
  ["income_statement", "revenue"],
  ["scale", "total_equity"],
  ["scale", "total_assets"],
]) {
  const mutatedHome = clone(readDetail("000660.KS"));
  mutatedHome[section][metric] = mutatedHome[section][metric].map(() => null);
  const mutatedDetail = (symbol) => (
    symbol === "000660.KS" ? mutatedHome : readDetail(symbol)
  );
  assert.equal(
    marketFor(
      "SKHY",
      detectSecondaryDepositaryRepresentations(rows, mutatedDetail),
    ),
    "US",
    `removing ${section}.${metric} proportionality must disable the override`,
  );
}

function syntheticDetail(multiplier = 1) {
  const base = [100, 110, 120, 130, 140];
  return {
    income_statement: { revenue: base.map((value) => value * multiplier) },
    scale: {
      total_equity: base.map((value) => value * 0.6 * multiplier),
      total_assets: base.map((value) => value * 1.8 * multiplier),
    },
  };
}

const lowRatioRows = [
  { symbol: "DEP", companyName: "Example ADR" },
  { symbol: "HOME", companyName: "Example Home" },
];
const lowRatioDetails = new Map([
  ["DEP", syntheticDetail(1)],
  ["HOME", syntheticDetail(0.05)],
]);
assert.equal(
  marketFor(
    "DEP",
    detectSecondaryDepositaryRepresentations(
      lowRatioRows,
      (symbol) => lowRatioDetails.get(symbol),
    ),
  ),
  "US",
  "a stable 0.05 ratio is not FX-plausible and must not classify as secondary",
);

const highRatioDetails = new Map([
  ["DEP", syntheticDetail(1)],
  ["HOME", syntheticDetail(150)],
]);
assert.equal(
  marketFor(
    "DEP",
    detectSecondaryDepositaryRepresentations(
      lowRatioRows,
      (symbol) => highRatioDetails.get(symbol),
    ),
  ),
  "US",
  "a stable 150 ratio exceeds the FX-plausible ceiling and must not classify as secondary",
);

const twoOverlapDetails = new Map([
  ["DEP", syntheticDetail(1)],
  ["HOME", syntheticDetail(14.2)],
]);
for (const detail of twoOverlapDetails.values()) {
  detail.income_statement.revenue.splice(0, 3, null, null, null);
  detail.scale.total_equity.splice(0, 3, null, null, null);
  detail.scale.total_assets.splice(0, 3, null, null, null);
}
assert.equal(
  marketFor(
    "DEP",
    detectSecondaryDepositaryRepresentations(
      lowRatioRows,
      (symbol) => twoOverlapDetails.get(symbol),
    ),
  ),
  "US",
  "two overlapping observations per metric are insufficient",
);

const unstableDetails = new Map([
  ["DEP", syntheticDetail(1)],
  ["HOME", syntheticDetail(14.2)],
]);
unstableDetails.get("HOME").scale.total_assets[4] *= 2;
assert.equal(
  marketFor(
    "DEP",
    detectSecondaryDepositaryRepresentations(
      lowRatioRows,
      (symbol) => unstableDetails.get(symbol),
    ),
  ),
  "US",
  "deleting the 10% dispersion guard must be caught",
);

assert.match(
  builderSource,
  /detectSecondaryDepositaryRepresentations\(\s*scouterRows,\s*stockDetail,\s*\)/,
  "the stock-action builder must compute the universe-level depositary classification",
);
assert.match(
  builderSource,
  /normalizeTicker\(symbol,\s*secondaryDepositaryRepresentations\)/,
  "the stock-action builder must apply the classification before marketScope is derived",
);

console.log("stock market classification tests passed");
