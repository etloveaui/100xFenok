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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PATHS = {
  stocksIndex: path.join(ROOT, "data/global-scouter/core/stocks_index.json"),
  companyMaster: path.join(ROOT, "data/global-scouter/raw/company_master_m_company.json"),
  epsConsensus: path.join(ROOT, "data/global-scouter/raw/eps_consensus_t_eps_c.json"),
  stocksDetailDir: path.join(ROOT, "data/global-scouter/stocks/detail"),
  output: path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json"),
  perBandsOutput: path.join(ROOT, "data/global-scouter/core/per_bands_index.json"),
};

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

/* ── 1. stocks_index (base) ── */
const index = loadJson(PATHS.stocksIndex);
const sourceDate = index.source_date ?? index.generated_at?.slice(0, 10);

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

/* ── 5. Merge ── */
const merged = [];

for (const [symbol, idx] of Object.entries(index.stocks)) {
  const cmRec = cmMap.get(symbol);
  const ecRec = ecMap.get(symbol);
  const pbRec = perBands[symbol];

  if (!cmRec) {
    // stocks_index에 있지만 company_master에 없는 경우 skip
    // (이론상 없어야 하지만 방어적)
    continue;
  }

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
  });
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
const output = {
  generated_at: new Date().toISOString(),
  source_date: sourceDate,
  count: merged.length,
  data: merged,
};

fs.mkdirSync(path.dirname(PATHS.output), { recursive: true });
fs.writeFileSync(PATHS.output, JSON.stringify(output, null, 2));

console.log(`[build-stocks-analyzer] Written ${merged.length} stocks to ${PATHS.output}`);

/* ── 8. per_bands_index.json ── */
const perBandsOutput = {
  generated_at: new Date().toISOString(),
  source_date: sourceDate,
  count: Object.keys(perBands).length,
  data: perBands,
};
fs.writeFileSync(PATHS.perBandsOutput, JSON.stringify(perBandsOutput, null, 2));
console.log(`[build-stocks-analyzer] Written ${perBandsOutput.count} per-band records to ${PATHS.perBandsOutput}`);

/* ── 9. Smoke check ── */
const samples = ["AAPL", "NVDA", "MSFT"];
for (const sym of samples) {
  const rec = merged.find((m) => m.symbol === sym);
  if (rec) {
    console.log(
      `  ${sym}: mc=${rec.marketCap?.toLocaleString()}, per=${rec.per?.toFixed(2)}, pbr=${rec.pbr?.toFixed(2)}, eps=${rec.eps?.toFixed(2)}, roe=${rec.roe?.toFixed(2)}, opm=${rec.opm?.toFixed(2)}, 3M=${rec.growthRate?.toFixed(3)}, rank=${rec.rank}`
    );
  } else {
    console.log(`  ${sym}: NOT FOUND`);
  }
}
