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
  mergePortfolioAggregates,
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
        holdings: [{ ticker: "IVE", cusip: "530909100", name: "LIBERTY LIVE HOLDINGS INC" },
          { ticker: "ATI", cusip: "459200101", name: "INTERNATIONAL BUSINESS MACHS" },
          { ticker: "IBM", cusip: "459200101", name: "INTERNATIONAL BUSINESS MACHS" }],
      }],
    },
  }));
  const edgarDir = path.join(resolverRoot, "data/edgar");
  fs.mkdirSync(edgarDir, { recursive: true });
  fs.writeFileSync(path.join(edgarDir, "company_tickers.json"), JSON.stringify({ rows: [
    { ticker: "ZZZ", title: "UNRELATED RETAINED ALIAS CORP" },
    { ticker: "ATI", title: "ATI INC" },
    { ticker: "IBM", title: "INTERNATIONAL BUSINESS MACHINES CORP" },
    { ticker: "T", title: "AT&T INC." },
  ] }));
  const aliasesDir = path.join(resolverRoot, "data/sec-13f/analytics");
  fs.mkdirSync(aliasesDir, { recursive: true });
  fs.writeFileSync(path.join(aliasesDir, "ticker_aliases.json"), JSON.stringify({
    aliases: [{ raw_key: "Fixture shared security family", normalized_key: "Fixture shared security family",
      symbol: "PNC", source: "issuer-pnc-common-stock-faq", cusips: ["693475105"] },
      { raw_key: "Fixture shared security family INC", normalized_key: "Fixture shared security family",
        symbol: "PNC", source: "issuer-pnc-common-stock-faq", cusips: ["000000000"] },
      { raw_key: "Unrelated retained alias", normalized_key: "Unrelated retained alias",
        symbol: "ZZZ", source: "alias-history", cusips: ["999999999"] },
      { raw_key: "PHILIP MORRIS INTL INC", normalized_key: "PHILIP MORRIS",
        symbol: "ATI", source: "13f-history", cusips: ["718172109"] }],
  }));
  const resolver = loadTickerResolver(resolverRoot);
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", cusip: "530909100", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, "LLYVA");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", cusip: "530909308", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, "LLYVK");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVE", name: "LIBERTY LIVE HOLDINGS INC" }).symbol, null);
  const exactPrimaryIdentities = [
    ["025537101", "AEP"], ["064058100", "BNY"], ["12504L109", "CBRE"],
    ["219350105", "GLW"], ["46428Q109", "SLV"], ["49177J102", "KVUE"],
    ["56585A102", "MPC"], ["693475105", "PNC"], ["74762E102", "PWR"],
    ["77543R102", "ROKU"], ["780087102", "RY"], ["872540109", "TJX"],
    ["00187Y100", "APG"],
    ["030420103", "AWK"],
    ["03076C106", "AMP"],
    ["03820C105", "AIT"],
    ["063671101", "BMO"],
    ["143130102", "KMX"],
    ["15675D103", "CBRS"],
    ["25459W458", "SOXL"],
    ["25459Y165", "SPUU"],
    ["291011104", "EMR"],
    ["33939L100", "TILT"],
    ["33939L407", "GUNR"],
    ["33939L506", "TDTT"],
    ["33939L795", "NFRA"],
    ["33939L860", "QDF"],
    ["33939L886", "RAVI"],
    ["34631F102", "FPS"],
    ["45104G104", "IBN"],
    ["452308109", "ITW"],
    ["45866F104", "ICE"],
    ["464288737", "KXI"],
    ["464289180", "EUFN"],
    ["565394103", "CART"],
    ["571748102", "MRSH"],
    ["58507V107", "MDLN"],
    ["606822104", "MUFG"],
    ["695156109", "PKG"],
    ["744573106", "PEG"],
    ["780287108", "RGLD"],
    ["866966104", "SUNB"],
    ["87612G101", "TRGP"],
    ["88023B103", "TEM"],
    ["88635A105", "PBEU"],
    ["88635A204", "PBPH"],
    ["88635A303", "PBOG"],
    ["911312106", "UPS"],
    ["912008109", "USFD"],
    ["94106L109", "WM"],
    ["G4705A100", "ICLR"],
    ["G6700G107", "NVT"],
    ["42824C109", "HPE"],
    ["H25662182", "CFRHF"],
    ["00508Y102", "AYI"],
    ["718172109", "PM"],
    ["459200101", "IBM"],
    ["655844108", "NSC"],
    ["026874784", "AIG"],
    ["609207105", "MDLZ"],
    ["910047109", "UAL"],
    ["G87110105", "FTI"],
  ];
  for (const [cusip, symbol] of exactPrimaryIdentities) {
    const exact = resolver.resolveHoldingSymbol({ ticker: "WRONG", cusip, name: "Unrelated fixture name" });
    assert.equal(exact.symbol, symbol);
    assert.match(exact.source, /^(sec|issuer)-/);
    assert.equal(exact.authoritative, true);
    assert.equal(resolver.resolveHoldingSymbol({ cusip: ` ${cusip.toLowerCase()} ` }).symbol, symbol);
  }
  assert.equal(resolver.resolveHoldingSymbol({ name: "Unrelated fixture name" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "464286772", name: "Unknown iShares class" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "42824C208", name: "HEWLETT PACKARD ENTERPRISE C" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "000000000", name: "ACUITY INC" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "21874A106", name: "CORE SCIENTIFIC INC", put_call: "Call" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "21874A114", name: "CORE SCIENTIFIC INC NEW" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "000000000" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "000000000", name: "Fixture shared security family" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ name: "Fixture shared security family" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "000000000", name: "Fixture shared security family INC" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ name: "Unrelated retained alias" }).symbol, "ZZZ");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "ZZZ", name: "Unrelated retained alias" }).symbol, "ZZZ");
  // Stored filing tickers and generated aliases need the symbol's own issuer name.
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "ZZZ" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "ATI", cusip: "718172109", name: "PHILIP MORRIS INTL INC" }).symbol, "PM");
  assert.equal(resolver.resolveHoldingSymbol({ name: "PHILIP MORRIS INTL INC" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "ATI", cusip: "01741R102", name: "ATI INC" }).symbol, "ATI");
  assert.equal(resolver.resolveHoldingSymbol({ cusip: "459200101", name: "INTERNATIONAL BUSINESS MACHS" }).symbol, "IBM");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "T", name: "AT&T INC" }).symbol, "T");
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVV", cusip: "464287432", name: "ISHARES TR" }).symbol, null);
  assert.equal(resolver.confirmed("ATI", "SPACE EXPLORATION TECHN CORP"), false);
  const profileSource = read("scripts/build-13f-enrichment-backfill.mjs");
  const profileBody = profileSource.slice(profileSource.indexOf("function resolveProfile("), profileSource.indexOf("function priceSnapshot("));
  const calls = [];
  let exactAvailable = true;
  const resolveProfile = new Function("resolver", "profileForSymbol", "normalizeCompanyName", `${profileBody}; return resolveProfile;`)(
    resolver,
    (symbol) => { calls.push(symbol); return symbol === "WRONG" || exactAvailable ? { symbol } : null; },
    (name) => name,
  );
  calls.length = 0;
  assert.equal(resolveProfile({ ticker: "ATI", cusip: "000000009", name: "PHILIP MORRIS INTL INC" }), null);
  assert.deepEqual(calls, []);
  for (const [cusip, symbol] of exactPrimaryIdentities) {
    calls.length = 0;
    exactAvailable = true;
    assert.equal(resolveProfile({ ticker: "WRONG", cusip }).symbol, symbol);
    assert.deepEqual(calls, [symbol]);
    calls.length = 0;
    exactAvailable = false;
    assert.equal(resolveProfile({ ticker: "WRONG", cusip }), null);
    assert.deepEqual(calls, [symbol]);
  }
  const backfillBody = profileSource.slice(profileSource.indexOf("function backfillHolding("), profileSource.indexOf("function collectCoverage("));
  const backfillHolding = new Function("resolver", "resolveProfile", "classifyMarketCap", "priceSnapshot", `${backfillBody}; return backfillHolding;`)(
    resolver, () => null, () => null, () => null,
  );
  for (const [cusip] of exactPrimaryIdentities) {
    const raw = { ticker: null, cusip, name: "Reported security", shares: 11, market_value: 220, weight: 3, title_of_class: "Reported class" };
    const holding = { ...raw, sector: "Wrong sector", industry: "Wrong industry", price_latest: 999, price_source: "wrong", market_cap_usd: 999, enrichment_source: "wrong", enrichment_symbol: "WRONG" };
    const stats = { total: 0, profileMiss: 0 };
    backfillHolding(holding, {}, stats);
    assert.deepEqual(holding, raw);
    assert.deepEqual(stats, { total: 1, profileMiss: 1 });
  }
  const misTickered = { ticker: "ATI", cusip: "000000009", name: "PHILIP MORRIS INTL INC", shares: 5 };
  const misEnriched = { ...misTickered, sector: "Industrials", industry: "Metals", market_cap_usd: 9, price_latest: 9, enrichment_source: "yf-local" };
  backfillHolding(misEnriched, {}, { total: 0, profileMiss: 0 });
  assert.deepEqual(misEnriched, misTickered);
  const unrelated = { cusip: "000000000", sector: "Existing sector", price_latest: 9 };
  backfillHolding(unrelated, {}, { total: 0, profileMiss: 0 });
  assert.deepEqual(unrelated, { cusip: "000000000", sector: "Existing sector", price_latest: 9 });
  const partialProfileBackfill = new Function("resolver", "resolveProfile", "classifyMarketCap", "priceSnapshot", `${backfillBody}; return backfillHolding;`)(
    resolver, (holding) => ({ symbol: resolver.resolveHoldingSymbol(holding).symbol, sector: "Current sector", industry: null, market_cap: null }), () => null, () => null,
  );
  const partialHolding = { cusip: "693475105", ticker: null, shares: 11, sector: "Wrong sector", industry: "Wrong industry", price_latest: 999, market_cap_usd: 999 };
  partialProfileBackfill(partialHolding, {}, { total: 0, profileHit: 0, profileSymbols: new Set(), touched: 0 });
  assert.deepEqual(partialHolding, { cusip: "693475105", ticker: null, shares: 11, sector: "Current sector", enrichment_source: "yf-local", enrichment_symbol: "PNC" });
  const verifiedLkg = { cusip: "693475105", ticker: null, sector: "Financials", price_latest: 200, enrichment_source: "yf-local", enrichment_symbol: "PNC" };
  const verifiedBefore = { ...verifiedLkg };
  backfillHolding(verifiedLkg, {}, { total: 0, profileMiss: 0 });
  assert.deepEqual(verifiedLkg, verifiedBefore);
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
assert.match(enrichmentBackfill, /resolved\.authoritative/);
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
  unrepresented_value: 0,
});
const treemap = treemapRows(aggregate, 50, null, { resolveSector: () => "Industrials", returnForTicker: () => null });
assert.equal(treemap.find((row) => row.ticker === "_UNMAPPED")?.weight, 0.3);
assert.equal(treemap.reduce((sum, row) => sum + row.weight, 0), 1);
const sectors = sectorWeights(aggregate, { resolveSector: () => "Industrials", canonical: ["Industrials", "Other"] });
assert.equal(sectors.Industrials, 0.7);
assert.equal(sectors.Other, 0.3);
const filtered = aggregateFilingHoldings({ ...filing, aum_total: 125 });
assert.equal(filtered.reportedValue, 125);
assert.equal(filtered.unrepresentedValue, 25);
const filteredRows = treemapRows(filtered, 50, null, { resolveSector: () => "Industrials", returnForTicker: () => null });
assert.equal(filteredRows.find((row) => row.ticker === "AAA").weight, 0.56);
assert.equal(filteredRows.find((row) => row.ticker === "_UNREPRESENTED").weight, 0.2);
assert.equal(filteredRows.reduce((sum, row) => sum + row.value, 0), 125);
assert.equal(aggregateFilingHoldings({ ...filing, aum_total: "N/A", normalized_table_value_total: 125 }).reportedValue, 125);
assert.equal(aggregateFilingHoldings({ ...filing, aum_total: 90 }).reportedValue, 100);
const merged = mergePortfolioAggregates(aggregateFilingHoldings(filing), filtered);
assert.equal(merged.reportedValue, 225);
assert.equal(merged.unrepresentedValue, 25);
assert.equal(merged.mappedValue + merged.unmappedValue + merged.unrepresentedValue, merged.reportedValue);
const filteredSectors = sectorWeights(filtered, { resolveSector: () => "Industrials", canonical: ["Industrials", "Other"] });
assert.deepEqual(filteredSectors, { Industrials: 0.56, Other: 0.44 });

const currentBuffett = aggregateFilingHoldings(buffett.investor.filings.find((row) => row.quarter === "2026-Q2"));
assert.equal(currentBuffett.reportedValue, 299253556246);
assert.equal(currentBuffett.unrepresentedValue, 3015598169);
assert.equal(portfolioCoverage(currentBuffett).mapped_ratio, 0.8991);
assert.equal(treemapRows(currentBuffett, 50, null, { resolveSector: () => "Other", returnForTicker: () => null }).find((row) => row.ticker === "AAPL").weight, 0.2197);


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
