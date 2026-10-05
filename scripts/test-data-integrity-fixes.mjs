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
    ["78464A698", "KRE"],
    ["78464A755", "XME"],
    ["78464A797", "KBE"],
    ["78464A870", "XBI"],
    ["78468R556", "XOP"],
    ["78468R663", "BIL"],
    ["81369Y209", "XLV"],
    ["81369Y308", "XLP"],
    ["81369Y407", "XLY"],
    ["81369Y506", "XLE"],
    ["81369Y605", "XLF"],
    ["81369Y704", "XLI"],
    ["81369Y803", "XLK"],
    ["81369Y886", "XLU"],
    ["464286400", "EWZ"],
    ["464286509", "EWC"],
    ["464287150", "ITOT"],
    ["464287184", "FXI"],
    ["464287200", "IVV"],
    ["464287226", "AGG"],
    ["464287234", "EEM"],
    ["464287242", "LQD"],
    ["464287432", "TLT"],
    ["464287440", "IEF"],
    ["464287465", "EFA"],
    ["464287499", "IWR"],
    ["464287507", "IJH"],
    ["464287515", "IGV"],
    ["464287523", "SOXX"],
    ["464287556", "IBB"],
    ["464287598", "IWD"],
    ["464287614", "IWF"],
    ["464287622", "IWB"],
    ["464287655", "IWM"],
    ["464287663", "IUSV"],
    ["464287671", "IUSG"],
    ["464287689", "IWV"],
    ["464287804", "IJR"],
    ["464288257", "ACWI"],
    ["464288372", "IGF"],
    ["464288414", "MUB"],
    ["464288588", "MBB"],
    ["464288646", "IGSB"],
    ["464288729", "EXI"],
    ["464288810", "IHI"],
    ["46432F339", "QUAL"],
    ["46432F834", "IXUS"],
    ["46432F842", "IEFA"],
    ["46434G103", "IEMG"],
    ["46434G764", "EMXC"],
    ["46435U853", "USHY"],
    ["46436E718", "SGOV"],
    ["718172109", "PM"],
    ["459200101", "IBM"],
    ["655844108", "NSC"],
    ["026874784", "AIG"],
    ["609207105", "MDLZ"],
    ["910047109", "UAL"],
    ["G87110105", "FTI"],
    ["907818108", "UNP"],
    ["053015103", "ADP"],
    ["06849F108", "B"],
    ["136385101", "CNQ"],
    ["D18190898", "DB"],
    ["136375102", "CNI"],
    ["758750103", "RRX"],
    ["009158106", "APD"],
    ["828806109", "SPG"],
    ["571903202", "MAR"],
    ["929740108", "WAB"],
    ["12769G100", "CZR"],
    ["228368106", "CCK"],
    ["281020107", "EIX"],
    ["31620M106", "FIS"],
    ["857477103", "STT"],
    ["398182303", "AHR"],
    ["55825T103", "MSGS"],
    ["45168D104", "IDXX"],
    ["77311W101", "RKT"],
    ["526107107", "LII"],
    ["136069101", "CM"],
    ["051774107", "AUR"],
    ["72348N109", "PNFP"],
    ["171484108", "CHDN"],
    ["302130109", "EXPD"],
    ["741623102", "PRMB"],
    ["649445400", "FLG"],
    ["538034109", "LYV"],
    ["679580100", "ODFL"],
    ["09228F103", "BB"],
    ["44916Y106", "PURR"],
    ["00650F109", "ADPT"],
    ["42806J700", "HTZ"],
    ["812215200", "SEG"],
    ["31620R303", "FNF"],
    ["608190104", "MHK"],
    ["749685103", "RPM"],
    ["558256103", "MSGE"],
    ["302520101", "FNB"],
    ["913903100", "UHS"],
    ["007973100", "AEIS"],
    ["07782B104", "BLTE"],
    ["67080N101", "NUVB"],
    ["91823B109", "UWMC"],
    ["74144T108", "TROW"],
    ["032095101", "APH"],
    ["N20944109", "CNH"],
    ["426281101", "JKHY"],
    ["042735100", "ARW"],
    ["M5216V106", "GLBE"],
    ["G9572D103", "BULL"],
    ["85208M102", "SFM"],
    ["83443Q103", "SOLS"],
    ["778920306", "SHAZ"],
    ["56501R106", "MFC"],
    ["40054J109", "AERO"],
    ["37890B100", "GBTG"],
    ["37637K108", "GTLB"],
    ["07373V105", "BEAM"],
    ["N69605108", "PHVS"],
    ["N5505D105", "MICC"],
    ["H82027105", "SOPH"],
    ["H50430232", "LOGI"],
    ["G9600F104", "VGNT"],
    ["G89479102", "TRMD"],
    ["G7553X106", "KRSP"],
    ["98420N105", "XENE"],
    ["955306105", "WST"],
    ["947002101", "WLTH"],
    ["92918V307", "VRM"],
    ["92857W308", "VOD"],
    ["922967104", "MANE"],
    ["91733P107", "USAR"],
    ["90114C107", "TUYA"],
    ["89832Q109", "TFC"],
    ["88034P109", "TME"],
    ["829401108", "SION"],
    ["78475V103", "MWH"],
    ["775133101", "ROG"],
    ["747906600", "QMCO"],
    ["70451X104", "PAYO"],
    ["647581206", "EDU"],
    ["639193101", "NAVN"],
    ["608012308", "MOGU"],
    ["379577208", "GMED"],
    ["36322Q206", "DMRA"],
    ["26622P107", "DOCS"],
    ["21217B100", "CTNM"],
    ["099502106", "BAH"],
    ["095924106", "OTF"],
    ["03969T109", "ARCT"],
    ["03676B102", "AM"],
    ["033853102", "ANDG"],
    ["023193105", "AMBQ"],
    ["00138L108", "RERE"],
    ["559222401", "MGA"],
    ["00090Q103", "ADT"],
    ["925283103", "VSNT"],
    ["G48833118", "WFRD"],
    ["04272N102", "AVBP"],
    ["482497104", "BEKE"],
    ["92763W103", "VIPS"],
    ["36165L108", "GDS"],
    ["092667104", "SRTA"],
    ["577128101", "MATW"],
    ["89346D107", "TAC"],
    ["024061103", "DCH"],
    ["M6158M104", "ITRN"],
    ["536797103", "LAD"],
    ["36472T109", "TDAY"],
    ["12503M108", "CBOE"],
    ["44951W106", "IESC"],
    ["45781M101", "INVA"],
    ["703481101", "PTEN"],
    ["75776W103", "RDW"],
    ["20337X109", "VISN"],
    ["942749102", "WTS"],
    ["142339100", "CSL"],
    ["68390D106", "OR"],
    ["10948W103", "AAMI"],
    ["69121K104", "OBDC"],
    ["09581B103", "OWL"],
    ["63001N106", "NATL"],
    ["43300A203", "HLT"],
    ["934423104", "WBD"],
    ["72651A207", "PAGP"],
    ["55261F104", "MTB"],
    ["693506107", "PPG"],
    ["49845K101", "KVYO"],
    ["G65163100", "JOBY"],
    ["03945R102", "ACHR"],
    ["00091E109", "ABSI"],
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
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVV", cusip: "464287999", name: "ISHARES TR" }).symbol, null);
  assert.equal(resolver.resolveHoldingSymbol({ ticker: "IVV", cusip: "464287432", name: "ISHARES TR" }).symbol, "TLT");
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
