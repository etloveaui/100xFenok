#!/usr/bin/env node
/**
 * Build script: Merge stocks_index + raw company_master + eps_consensus
 * into a single native-ready stocks_analyzer.json.
 *
 * Run: node scripts/build-stocks-analyzer.mjs
 * Output: data/global-scouter/core/stocks_analyzer.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyYfForwardFallback,
  extractYfForwardEnrichment,
} from "./lib/yf-screener-enrichment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PUBLIC_MIRROR = path.join(ROOT, "100xfenok-next/public/data/global-scouter/core");

const PATHS = {
  stocksIndex: path.join(ROOT, "data/global-scouter/core/stocks_index.json"),
  companyMaster: path.join(ROOT, "data/global-scouter/raw/company_master_m_company.json"),
  epsConsensus: path.join(ROOT, "data/global-scouter/raw/eps_consensus_t_eps_c.json"),
  stocksDetailDir: path.join(ROOT, "data/global-scouter/stocks/detail"),
  slickchartsDir: path.join(ROOT, "data/slickcharts/stocks"),
  yfFinanceDir: path.join(ROOT, "data/yf/finance"),
  output: path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json"),
  perBandsOutput: path.join(ROOT, "data/global-scouter/core/per_bands_index.json"),
  slickOutput: path.join(ROOT, "data/global-scouter/core/slick_index.json"),
};

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeBoth(rootPath, data) {
  writeJson(rootPath, data);
  const mirrorPath = path.join(PUBLIC_MIRROR, path.basename(rootPath));
  writeJson(mirrorPath, data);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const sanitized = value.replace(/,/g, "").trim();
    if (!sanitized) return undefined;
    const n = Number(sanitized);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function loadJson(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

function sourceDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function completeSourceFloor(values) {
  const dates = values.map(sourceDate);
  return dates.length > 0 && dates.every(Boolean) ? [...dates].sort().at(0) : null;
}

/* ── 1. stocks_index (base) ── */
const index = loadJson(PATHS.stocksIndex);

/* ── 2. company_master (momentum + roe + opm) ── */
const cm = loadJson(PATHS.companyMaster);
const cmMap = new Map();

for (const rec of cm.records) {
  const v = rec.values;
  const ticker = rec.key;
  if (!ticker) continue;

  cmMap.set(ticker, {
    companyName: v[2],
    exchange: v[3],
    wi26: v[4],
    marketCap: toFiniteNumber(v[8]),
    roe: toFiniteNumber(v[9]),
    opm: toFiniteNumber(v[10]),
    per: toFiniteNumber(v[11]),
    pbr: toFiniteNumber(v[12]),
    momentum1m: toFiniteNumber(v[14]),
    momentum3m: toFiniteNumber(v[15]),
    momentum6m: toFiniteNumber(v[16]),
    momentum12m: toFiniteNumber(v[17]),
  });
}

/* ── 3. eps_consensus (eps) ── */
const ec = loadJson(PATHS.epsConsensus);
const ecMap = new Map();
const globalScouterSourceDates = {
  stocks_index: sourceDate(index.source_date),
  company_master: sourceDate(cm.source_date),
  eps_consensus: sourceDate(ec.source_date),
};
const globalScouterSourceDate = completeSourceFloor(Object.values(globalScouterSourceDates));
const globalScouterSourceDateReason = globalScouterSourceDate
  ? null
  : "one or more required Global Scouter inputs do not publish a source date";

// Section 1 date columns: indices 21-26 (first "W" block)
const EPS_SECTION_INDICES = [21, 22, 23, 24, 25, 26];

for (const rec of ec.records) {
  const ticker = rec.key;
  if (!ticker) continue;

  let eps;
  for (let i = EPS_SECTION_INDICES.length - 1; i >= 0; i--) {
    const idx = EPS_SECTION_INDICES[i];
    const val = toFiniteNumber(rec.values[idx]);
    if (val !== undefined) {
      eps = val;
      break;
    }
  }

  ecMap.set(ticker, { eps });
}

/* ── 4. per_bands from detail/*.json ── */
const perBands = {}; // symbol -> { current, min, avg, max }

for (const [symbol] of Object.entries(index.stocks)) {
  let detail = null;
  try {
    detail = loadJson(path.join(PATHS.stocksDetailDir, `${symbol}.json`));
  } catch {
    // detail file missing
  }

  const pb = detail?.per_bands;
  const current = toFiniteNumber(pb?.current);
  const min = toFiniteNumber(pb?.min_8y);
  const avg = toFiniteNumber(pb?.avg_8y);
  const max = toFiniteNumber(pb?.max_8y);

  if (current !== undefined && min !== undefined && avg !== undefined && max !== undefined) {
    perBands[symbol] = { current, min, avg, max };
  }
}

/* ── 4.5 slickcharts (forward PE, dividend, returns) ── */
const slickMap = new Map();

for (const [symbol] of Object.entries(index.stocks)) {
  let slick = null;
  try {
    slick = loadJson(path.join(PATHS.slickchartsDir, `${symbol}.json`));
  } catch {
    // slickcharts file missing (non-US or not in universe)
  }

  if (!slick?.current) continue;

  const metricsDates = (Array.isArray(slick.metrics_history) ? slick.metrics_history : [])
    .map((row) => sourceDate(row?.date))
    .filter(Boolean)
    .sort();
  const slickSourceAsOf = metricsDates.at(-1) ?? null;

  const peForward = toFiniteNumber(slick.current.pe_forward);
  const epsForward = toFiniteNumber(slick.current.eps_forward);
  const dividendTtm = toFiniteNumber(slick.current.dividend_ttm);

  // Returns: 1Y = 2025, 3Y = cumulative 2023-2025, 5Y = cumulative 2021-2025
  let ret1y, ret3y, ret5y;
  const returns = slick.returns;
  if (Array.isArray(returns)) {
    const byYear = new Map(returns.map((r) => [r.year, r.return]));

    const r25 = byYear.get(2025);
    if (r25 !== undefined) ret1y = r25 / 100;

    const r23 = byYear.get(2023);
    const r24 = byYear.get(2024);
    if (r23 !== undefined && r24 !== undefined && r25 !== undefined) {
      ret3y = (1 + r23 / 100) * (1 + r24 / 100) * (1 + r25 / 100) - 1;
    }

    const years5 = [2021, 2022, 2023, 2024, 2025];
    const vals5 = years5.map((y) => byYear.get(y)).filter((v) => v !== undefined);
    if (vals5.length === 5) {
      ret5y = vals5.reduce((acc, v) => acc * (1 + v / 100), 1) - 1;
    }
  }

  slickMap.set(symbol, {
    peForward,
    epsForward,
    dividendTtm,
    ret1y,
    ret3y,
    ret5y,
    sourceAsOf: slickSourceAsOf,
  });
}

const slickSourceDates = [...slickMap.values()].map((row) => row.sourceAsOf);
const slickSourceDate = completeSourceFloor(slickSourceDates);
const slickMissingSourceDates = slickSourceDates.filter((date) => !date).length;
const slickSourceDateReason = slickSourceDate
  ? null
  : `aggregate source floor unavailable: ${slickMissingSourceDates}/${slickSourceDates.length} SlickCharts rows have no observation date`;

/* ── 4.6 Yahoo forward-metric fallback (existing screener fields only) ── */
const yfForwardMap = new Map();

for (const [symbol] of Object.entries(index.stocks)) {
  let payload = null;
  try {
    payload = loadJson(path.join(PATHS.yfFinanceDir, `${symbol}.json`));
  } catch {
    // Yahoo file missing: preserve the existing null/undefined screener value.
  }
  const enrichment = extractYfForwardEnrichment(symbol, payload);
  if (enrichment) yfForwardMap.set(symbol, enrichment);
}

const yfFallbackStats = {
  matchedRows: 0,
  peForward: 0,
  epsForward: 0,
  sourceDates: [],
};

/* ── 5. Merge ── */
const merged = [];

for (const [symbol, idx] of Object.entries(index.stocks)) {
  const cmRec = cmMap.get(symbol);
  const ecRec = ecMap.get(symbol);
  const pbRec = perBands[symbol];
  const slickRec = slickMap.get(symbol);
  const yfForwardRec = yfForwardMap.get(symbol);
  const forwardMetrics = applyYfForwardFallback(slickRec, yfForwardRec);

  if (!cmRec) {
    // stocks_index에 있지만 company_master에 없는 경우 skip
    // (이론상 없어야 하지만 방어적)
    continue;
  }

  if (yfForwardRec) yfFallbackStats.matchedRows += 1;

  merged.push({
    symbol,
    companyName: idx.n || cmRec.companyName || symbol,
    sector: idx.s || cmRec.wi26 || "",
    industry: cmRec.exchange || "",
    country: idx.c || "",
    price: toFiniteNumber(idx.p),
    marketCap: toFiniteNumber(idx.mc) ?? cmRec.marketCap,
    per: toFiniteNumber(idx.pe) ?? cmRec.per,
    pbr: toFiniteNumber(idx.pb) ?? cmRec.pbr,
    dividendYield: toFiniteNumber(idx.dy),
    return12m: toFiniteNumber(idx.r12),
    roe: cmRec.roe,
    opm: cmRec.opm,
    eps: ecRec?.eps,
    growthRate: cmRec.momentum3m,
    momentum1m: cmRec.momentum1m,
    momentum3m: cmRec.momentum3m,
    momentum6m: cmRec.momentum6m,
    momentum12m: cmRec.momentum12m,
    perBandCurrent: pbRec?.current,
    perBandMin: pbRec?.min,
    perBandAvg: pbRec?.avg,
    perBandMax: pbRec?.max,
    peForward: forwardMetrics.peForward,
    epsForward: forwardMetrics.epsForward,
    peForwardSource: forwardMetrics.peForwardSource,
    epsForwardSource: forwardMetrics.epsForwardSource,
    yfForwardSourceAsOf: forwardMetrics.yfFallbackUsed ? yfForwardRec?.sourceAsOf ?? null : undefined,
    dividendTtm: slickRec?.dividendTtm,
    ret1y: slickRec?.ret1y,
    ret3y: slickRec?.ret3y,
    ret5y: slickRec?.ret5y,
  });

  if (forwardMetrics.peForwardSource === "yf") yfFallbackStats.peForward += 1;
  if (forwardMetrics.epsForwardSource === "yf") yfFallbackStats.epsForward += 1;
  if (forwardMetrics.yfFallbackUsed) yfFallbackStats.sourceDates.push(yfForwardRec?.sourceAsOf ?? null);
}

/* ── 5. Synthetic rank (pe-rank + pb-rank) ── */
const count = merged.length;

function assignRanks(items, getter) {
  const sorted = items
    .map((item, i) => ({ index: i, value: getter(item) }))
    .filter(({ value }) => value !== undefined && value !== null && Number.isFinite(value))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array(items.length).fill(count + 1); // nulls get worst rank
  sorted.forEach((entry, rankZeroBased) => {
    ranks[entry.index] = rankZeroBased + 1; // 1-based rank
  });
  return ranks;
}

const peRanks = assignRanks(merged, (m) => m.per);
const pbRanks = assignRanks(merged, (m) => m.pbr);

const scores = merged.map((_, i) => peRanks[i] + pbRanks[i]);
const scoreWithIndex = scores.map((score, i) => ({ index: i, score }));
scoreWithIndex.sort((a, b) => a.score - b.score);

const finalRanks = new Array(count).fill(0);
scoreWithIndex.forEach((entry, rankZeroBased) => {
  finalRanks[entry.index] = rankZeroBased + 1;
});

for (let i = 0; i < count; i++) {
  merged[i].rank = finalRanks[i];
}

/* ── 7. Output ── */
const yfFallbackSourceAsOf = completeSourceFloor(yfFallbackStats.sourceDates);
const yfFallbackDatedRows = yfFallbackStats.sourceDates.filter(Boolean).length;
const output = {
  generated_at: new Date().toISOString(),
  source_date: globalScouterSourceDate,
  source_date_reason: globalScouterSourceDateReason,
  source_dates: globalScouterSourceDates,
  enrichment: {
    yf_finance: {
      mode: "fallback_only",
      fields: ["peForward", "epsForward"],
      matched_rows: yfFallbackStats.matchedRows,
      fallback_counts: {
        peForward: yfFallbackStats.peForward,
        epsForward: yfFallbackStats.epsForward,
      },
      source_as_of: yfFallbackSourceAsOf,
      source_date_coverage: {
        dated_rows: yfFallbackDatedRows,
        total_rows: yfFallbackStats.sourceDates.length,
      },
      source_as_of_reason: yfFallbackStats.sourceDates.length === 0
        ? "no Yahoo fallback values were used"
        : yfFallbackSourceAsOf
          ? null
          : "one or more used Yahoo fallback values have no provider source date",
    },
  },
  count: merged.length,
  data: merged,
};

writeBoth(PATHS.output, output);
console.log(`[build-stocks-analyzer] Written ${merged.length} stocks to ${PATHS.output} + mirror`);

/* ── 8. per_bands_index.json ── */
const perBandsOutput = {
  generated_at: new Date().toISOString(),
  source_date: globalScouterSourceDate,
  source_date_reason: globalScouterSourceDateReason,
  source_dates: globalScouterSourceDates,
  count: Object.keys(perBands).length,
  data: perBands,
};
writeBoth(PATHS.perBandsOutput, perBandsOutput);
console.log(`[build-stocks-analyzer] Written ${perBandsOutput.count} per-band records to ${PATHS.perBandsOutput} + mirror`);

/* ── 9. slick_index.json ── */
const slickIndex = {};
for (const [symbol, rec] of slickMap) {
  slickIndex[symbol] = {
    peForward: rec.peForward,
    epsForward: rec.epsForward,
    dividendTtm: rec.dividendTtm,
    ret1y: rec.ret1y,
    ret3y: rec.ret3y,
    ret5y: rec.ret5y,
    source_as_of: rec.sourceAsOf,
  };
}
const slickOutput = {
  generated_at: new Date().toISOString(),
  source_date: slickSourceDate,
  source_date_reason: slickSourceDateReason,
  source_date_coverage: {
    dated_rows: slickSourceDates.length - slickMissingSourceDates,
    total_rows: slickSourceDates.length,
  },
  count: Object.keys(slickIndex).length,
  data: slickIndex,
};
writeBoth(PATHS.slickOutput, slickOutput);
console.log(`[build-stocks-analyzer] Written ${slickOutput.count} slick records to ${PATHS.slickOutput} + mirror`);

/* ── 10. Smoke check ── */
const samples = ["AAPL", "NVDA", "MSFT"];
for (const sym of samples) {
  const rec = merged.find((m) => m.symbol === sym);
  if (rec) {
    console.log(
      `  ${sym}: mc=${rec.marketCap?.toLocaleString()}, per=${rec.per?.toFixed(2)}, pbr=${rec.pbr?.toFixed(2)}, eps=${rec.eps?.toFixed(2)}, roe=${rec.roe?.toFixed(2)}, opm=${rec.opm?.toFixed(2)}, 3M=${rec.growthRate?.toFixed(3)}, rank=${rec.rank}, fwdPE=${rec.peForward?.toFixed(2)}, divTTM=${rec.dividendTtm?.toFixed(2)}, ret1Y=${rec.ret1y?.toFixed(3)}`
    );
  } else {
    console.log(`  ${sym}: NOT FOUND`);
  }
}
