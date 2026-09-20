import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMBO_SIGNALS,
  calculateYoY,
  computeLiquidityFlowSnapshot,
} from "../tools/macro-monitor/shared/signals-core.mjs";
import { loadTickerResolver } from "./lib/sec13f-symbols.mjs";
import {
  aggregateFilingHoldings,
  portfolioCoverage,
  sectorWeights,
  treemapRows,
} from "./lib/sec13f-portfolio-views.mjs";
import {
  CALENDAR_RETURN_PERIODS,
  compoundCalendarReturns,
} from "./lib/screener-return-periods.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const m2 = [
  { date: "2025-07-01", val: 22025.5 },
  { date: "2025-08-01", val: 22092.6 },
  { date: "2026-06-01", val: 23115.2 },
  { date: "2026-07-01", val: 23218 },
];
assert.equal(calculateYoY(m2), ((23218 - 22025.5) / 22025.5) * 100);
assert.equal(calculateYoY(m2.filter((point) => point.date !== "2025-07-01")), null);
assert.equal(
  computeLiquidityFlowSnapshot({
    m2,
    fedBs: [{ date: "2026-07-01", val: 6_600_000 }],
    tga: [{ date: "2026-07-01", val: 800_000 }],
    rrp: [{ date: "2026-07-01", val: 100 }],
    stablecoin: null,
  }).m2YoY,
  5.41,
);

const resolverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sec13f-identity-"));
try {
  const investorDir = path.join(resolverRoot, "data/sec-13f/investors");
  fs.mkdirSync(investorDir, { recursive: true });
  fs.writeFileSync(path.join(investorDir, "fixture.json"), JSON.stringify({
    investor: {
      filings: [{
        holdings: [{ ticker: "IVE", cusip: "530909100", name: "LIBERTY LIVE HOLDINGS INC" }],
      }],
    },
  }));
  const resolver = loadTickerResolver(resolverRoot);
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", cusip: "530909100", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, "LLYVA");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", cusip: "530909308", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, "LLYVK");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, null);
} finally {
  fs.rmSync(resolverRoot, { recursive: true, force: true });
}

const buffett = JSON.parse(read("data/sec-13f/investors/buffett.json"));
const libertyRows = buffett.investor.filings.flatMap((filing) => filing.holdings ?? [])
  .filter((row) => row.cusip === "530909100" || row.cusip === "530909308");
assert.ok(libertyRows.length > 0);
for (const row of libertyRows) {
  assert.equal(row.ticker, row.cusip === "530909100" ? "LLYVA" : "LLYVK");
  for (const staleKey of ["price_at_filing", "price_latest", "return_since_filing_pct", "return_as_of", "price_source", "enrichment_source"]) {
    assert.equal(row[staleKey], undefined, `${row.cusip} must not retain IVE-derived ${staleKey}`);
  }
}
const enrichmentBackfill = read("scripts/build-13f-enrichment-backfill.mjs");
assert.match(enrichmentBackfill, /resolved\.source === "sec-liberty-live-2025-annual-report"/);
assert.match(enrichmentBackfill, /return resolved\.symbol \? profileForSymbol\(resolved\.symbol\) : null/);

const filing = {
  holdings: [
    { ticker: "AAA", name: "Mapped", market_value: 70, sector: "Industrials" },
    { ticker: null, cusip: "000000001", name: "Unmapped", market_value: 30 },
  ],
};
const aggregate = aggregateFilingHoldings(filing);
assert.deepEqual(portfolioCoverage(aggregate), {
  reported_value: 100,
  mapped_value: 70,
  unmapped_value: 30,
  mapped_ratio: 0.7,
  unmapped_rows: 1,
});
const treemap = treemapRows(aggregate, 50, null, { resolveSector: () => "Industrials", returnForTicker: () => null });
assert.equal(treemap.find((row) => row.ticker === "_UNMAPPED")?.weight, 0.3);
assert.equal(treemap.reduce((sum, row) => sum + row.weight, 0), 1);
const sectors = sectorWeights(aggregate, { resolveSector: () => "Industrials", canonical: ["Industrials", "Other"] });
assert.equal(sectors.Industrials, 0.7);
assert.equal(sectors.Other, 0.3);

assert.equal(CALENDAR_RETURN_PERIODS.ret1y.label, "2025년");
assert.equal(CALENDAR_RETURN_PERIODS.ret3y.label, "2023–2025 누적");
assert.equal(CALENDAR_RETURN_PERIODS.ret5y.label, "2021–2025 누적");
assert.equal(compoundCalendarReturns([{ year: 2025, return: null }], [2025]), undefined);
assert.equal(compoundCalendarReturns([{ year: 2025, return: "" }], [2025]), undefined);
assert.ok(Math.abs(compoundCalendarReturns([{ year: 2023, return: 10 }, { year: 2024, return: -10 }, { year: 2025, return: 20 }], [2023, 2024, 2025]) - 0.188) < 1e-12);

for (const signal of COMBO_SIGNALS) {
  assert.equal("winRate" in signal, false);
  assert.equal("correctionProb" in signal, false);
  assert.equal("avgReturn" in signal, false);
}
const sentimentHtml = read("tools/macro-monitor/details/sentiment-signal/index.html");
assert.doesNotMatch(sentimentHtml, /winRate|correctionProb/);
const liquidityWidget = read("tools/macro-monitor/widgets/liquidity-flow.html");
assert.match(liquidityWidget, /m2YoY == null\s*\? '—'/);
assert.doesNotMatch(liquidityWidget, /toFiniteNumber\(data\.m2YoY, 0\)/);

const dashboardConstants = read("100xfenok-next/src/lib/dashboard/constants.ts");
assert.match(dashboardConstants, /judgmentInputsReady:\s*false/);
assert.doesNotMatch(dashboardConstants, /fearGreedScore:\s*72|liquidityFlow:\s*87|vixValue:\s*14\.2/);
const home = read("100xfenok-next/src/app/HomeCanvasPlusClient.tsx");
assert.match(home, /dashboard\.judgmentInputsReady/);
assert.match(home, /판단 대기/);

const screener = read("100xfenok-next/src/app/screener/ScreenerClient.tsx");
for (const label of ["2025년", "2023–2025 누적", "2021–2025 누적"]) assert.ok(screener.includes(label));
assert.ok(screener.includes("12M 수익률"), "rolling 12M label must remain distinct");

const etfBuilder = read("scripts/build-fenok-etf-signals.mjs");
assert.match(etfBuilder, /베타·이력 점수/);
assert.match(etfBuilder, /beta proximity to 1/i);
const etfDetail = read("100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx");
assert.match(etfDetail, /tracking_quality", label: "베타·이력 점수"/);

console.log("data integrity fixes: ok");
