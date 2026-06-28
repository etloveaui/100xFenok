#!/usr/bin/env node
/**
 * Build script: superinvestors Fama-French-derived factor radar summary.
 *
 * Raw Ken French ZIP files are cached under `_private/admin/fama_french/raw`
 * and must never be mirrored to public assets. Public output is slim derived
 * JSON only.
 *
 * Run: node scripts/build-13f-factor-radar-v2.mjs
 * Output: data/sec-13f/analytics/factor_exposures_summary.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORTFOLIO_VIEWS_PATH = path.join(ROOT, "data/sec-13f/analytics/portfolio_views.json");
const OUTPUT = path.join(ROOT, "data/sec-13f/analytics/factor_exposures_summary.json");
const PUBLIC_OUTPUT = path.join(ROOT, "100xfenok-next/public/data/sec-13f/analytics/factor_exposures_summary.json");
const RAW_CACHE_DIR = process.env.FENOK_FF_RAW_CACHE
  ? path.resolve(process.env.FENOK_FF_RAW_CACHE)
  : path.join(ROOT, "_private/admin/fama_french/raw");

const SAME_START_DATE = "2021-03-31";
const MIN_FULL_OBSERVATIONS = 22;
const FACTORS = [
  ["market", "mktRf", "marketBeta", "marketScore"],
  ["size", "smb", "sizeBeta", "sizeScore"],
  ["value", "hml", "valueBeta", "valueScore"],
  ["profitability", "rmw", "profitabilityBeta", "profitabilityScore"],
  ["investment", "cma", "investmentBeta", "investmentScore"],
  ["momentum", "mom", "momentumBeta", "momentumScore"],
];
const FACTOR_KEYS = FACTORS.map(([, key]) => key);
const FIELDS = [
  "investorId",
  "name",
  "asOf",
  "confidence",
  "coverageRatio",
  "observationCount",
  "rSquared",
  "marketBeta",
  "sizeBeta",
  "valueBeta",
  "profitabilityBeta",
  "investmentBeta",
  "momentumBeta",
  "marketScore",
  "sizeScore",
  "valueScore",
  "profitabilityScore",
  "investmentScore",
  "momentumScore",
  "tiltStrengthScore",
];

const SOURCES = {
  fiveFactor: {
    id: "ken_french_5_factor_monthly",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip",
    file: "F-F_Research_Data_5_Factors_2x3_CSV.zip",
  },
  momentum: {
    id: "ken_french_momentum_monthly",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_CSV.zip",
    file: "F-F_Momentum_Factor_CSV.zip",
  },
};

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 4) => (finite(value) ? Number(value.toFixed(digits)) : null);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function fetchZip(source) {
  fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });
  const zipPath = path.join(RAW_CACHE_DIR, source.file);
  if (fs.existsSync(zipPath) && process.env.FENOK_FF_REFRESH !== "1") {
    return { zipPath, lastModified: null, cache: "hit" };
  }
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`fetch failed ${source.url}: HTTP ${response.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  return { zipPath, lastModified: response.headers.get("last-modified"), cache: "refreshed" };
}

function unzipText(zipPath) {
  const result = spawnSync("unzip", ["-p", zipPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`unzip failed for ${zipPath}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function monthKey(value) {
  const text = String(value).trim();
  return /^\d{6}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}` : null;
}

function parseFiveFactorCsv(text) {
  const rows = new Map();
  let headerSeen = false;
  let latestMonth = null;
  let sourceNote = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (headerSeen) break;
      continue;
    }
    if (!sourceNote && line.startsWith("This file was created")) sourceNote = line;
    if (line.startsWith(",Mkt-RF")) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;
    const parts = line.split(",").map((part) => part.trim());
    const key = monthKey(parts[0]);
    if (!key || parts.length < 7) break;
    rows.set(key, {
      mktRf: Number(parts[1]) / 100,
      smb: Number(parts[2]) / 100,
      hml: Number(parts[3]) / 100,
      rmw: Number(parts[4]) / 100,
      cma: Number(parts[5]) / 100,
      rf: Number(parts[6]) / 100,
    });
    latestMonth = key;
  }
  return { rows, latestMonth, sourceNote };
}

function parseMomentumCsv(text) {
  const rows = new Map();
  let headerSeen = false;
  let latestMonth = null;
  let sourceNote = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (headerSeen) break;
      continue;
    }
    if (!sourceNote && line.startsWith("This file was created")) sourceNote = line;
    if (line.startsWith(",Mom")) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;
    const parts = line.split(",").map((part) => part.trim());
    const key = monthKey(parts[0]);
    if (!key || parts.length < 2) break;
    rows.set(key, Number(parts[1]) / 100);
    latestMonth = key;
  }
  return { rows, latestMonth, sourceNote };
}

function addMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function periodMonths(startDate, endDate) {
  const out = [];
  let cur = addMonth(String(startDate).slice(0, 7));
  const end = String(endDate).slice(0, 7);
  while (cur <= end) {
    out.push(cur);
    cur = addMonth(cur);
  }
  return out;
}

function compound(values) {
  return values.reduce((acc, value) => acc * (1 + value), 1) - 1;
}

function isSamePeriodPerformance(performance) {
  return Boolean(
    performance
      && Array.isArray(performance.dates)
      && Array.isArray(performance.portfolio)
      && performance.dates[0] === SAME_START_DATE
      && performance.portfolio.length >= MIN_FULL_OBSERVATIONS,
  );
}

function commonSamePeriodEndDate(portfolioViews) {
  const endCounts = new Map();
  for (const view of Object.values(portfolioViews.investors ?? {})) {
    if (!isSamePeriodPerformance(view.performance)) continue;
    const endDate = view.performance.dates.at(-1);
    if (endDate) endCounts.set(endDate, (endCounts.get(endDate) ?? 0) + 1);
  }
  return [...endCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
}

function alignSamePeriodPerformance(performance, endDate) {
  if (!isSamePeriodPerformance(performance) || !endDate) return null;
  const endIndex = performance.dates.indexOf(endDate);
  if (endIndex < MIN_FULL_OBSERVATIONS - 1) return null;
  return {
    dates: performance.dates.slice(0, endIndex + 1),
    portfolio: performance.portfolio.slice(0, endIndex + 1),
    coverage: Array.isArray(performance.coverage) ? performance.coverage.slice(0, endIndex) : [],
  };
}

function periodFactors(startDate, endDate, factorRows) {
  const months = periodMonths(startDate, endDate);
  const rows = months.map((month) => factorRows.get(month));
  if (rows.some((row) => !row)) return null;
  return Object.fromEntries([
    ...FACTOR_KEYS.map((key) => [key, rows.reduce((acc, row) => acc + row[key], 0)]),
    ["rf", compound(rows.map((row) => row.rf))],
    ["month", months.at(-1)],
  ]);
}

function transpose(matrix) {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]));
}

function matMul(a, b) {
  return a.map((row) => b[0].map((_, col) => row.reduce((sum, value, i) => sum + value * b[i][col], 0)));
}

function matVecMul(a, b) {
  return a.map((row) => row.reduce((sum, value, i) => sum + value * b[i], 0));
}

function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const pivotValue = augmented[col][col];
    for (let j = col; j <= n; j += 1) augmented[col][j] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= n; j += 1) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map((row) => row[n]);
}

function ridgeRegression(samples, lambda = 0.03) {
  const x = samples.map((sample) => [1, ...FACTOR_KEYS.map((key) => sample.factors[key])]);
  const y = samples.map((sample) => sample.excessReturn);
  const xt = transpose(x);
  const xtx = matMul(xt, x);
  for (let i = 1; i < xtx.length; i += 1) xtx[i][i] += lambda;
  const beta = solveLinearSystem(xtx, matVecMul(xt, y));
  if (!beta) return null;
  const fitted = x.map((row) => row.reduce((acc, value, i) => acc + value * beta[i], 0));
  const meanY = y.reduce((acc, value) => acc + value, 0) / y.length;
  const ssTot = y.reduce((acc, value) => acc + (value - meanY) ** 2, 0);
  const ssRes = y.reduce((acc, value, i) => acc + (value - fitted[i]) ** 2, 0);
  return { beta, rSquared: ssTot > 0 ? clamp(1 - ssRes / ssTot) : 0 };
}

function percentile(values, value) {
  if (!finite(value) || values.length === 0) return null;
  if (values.length === 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  let lower = 0;
  while (lower < sorted.length && sorted[lower] < value) lower += 1;
  let upper = lower;
  while (upper < sorted.length && sorted[upper] === value) upper += 1;
  return round((((lower + upper - 1) / 2) / (sorted.length - 1)) * 100, 2);
}

function confidenceLabel({ observationCount, coverageRatio, rSquared }) {
  const score = clamp(observationCount / 20) * 0.45 + clamp(coverageRatio) * 0.35 + clamp(rSquared) * 0.2;
  if (score >= 0.8) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function buildSamples(performance, factorRows) {
  const samples = [];
  for (let i = 1; i < performance.dates.length; i += 1) {
    const prev = performance.portfolio[i - 1];
    const cur = performance.portfolio[i];
    if (!finite(prev) || prev <= 0 || !finite(cur) || cur <= 0) continue;
    const factors = periodFactors(performance.dates[i - 1], performance.dates[i], factorRows);
    if (!factors) continue;
    samples.push({
      endDate: performance.dates[i],
      factorMonth: factors.month,
      excessReturn: cur / prev - 1 - factors.rf,
      coverage: finite(performance.coverage[i - 1]) ? performance.coverage[i - 1] : null,
      factors,
    });
  }
  return samples;
}

async function main() {
  const [fiveFactorZip, momentumZip] = await Promise.all([fetchZip(SOURCES.fiveFactor), fetchZip(SOURCES.momentum)]);
  const fiveFactor = parseFiveFactorCsv(unzipText(fiveFactorZip.zipPath));
  const momentum = parseMomentumCsv(unzipText(momentumZip.zipPath));
  const factorRows = new Map();
  for (const [month, row] of fiveFactor.rows) {
    const mom = momentum.rows.get(month);
    if (finite(mom)) factorRows.set(month, { ...row, mom });
  }

  const portfolioViews = JSON.parse(fs.readFileSync(PORTFOLIO_VIEWS_PATH, "utf8"));
  const commonEndDate = commonSamePeriodEndDate(portfolioViews);
  const samePeriodEntries = Object.entries(portfolioViews.investors ?? {})
    .map(([id, view]) => [id, view, alignSamePeriodPerformance(view.performance, commonEndDate)])
    .filter((entry) => entry[2]);

  const rawRows = [];
  for (const [id, view, performance] of samePeriodEntries) {
    const samples = buildSamples(performance, factorRows);
    if (samples.length < FACTOR_KEYS.length + 3) continue;
    const regression = ridgeRegression(samples);
    if (!regression) continue;
    const coverageValues = samples.map((sample) => sample.coverage).filter(finite);
    const coverageRatio = coverageValues.length > 0
      ? coverageValues.reduce((acc, value) => acc + value, 0) / coverageValues.length
      : 0;
    const row = {
      investorId: id,
      name: view.name || id,
      asOf: samples.at(-1)?.endDate ?? null,
      factorAsOf: samples.at(-1)?.factorMonth ?? null,
      confidence: confidenceLabel({ observationCount: samples.length, coverageRatio, rSquared: regression.rSquared }),
      coverageRatio: round(coverageRatio),
      observationCount: samples.length,
      rSquared: round(regression.rSquared),
    };
    for (let i = 0; i < FACTORS.length; i += 1) row[FACTORS[i][2]] = round(regression.beta[i + 1]);
    rawRows.push(row);
  }

  for (const [, , betaKey, scoreKey] of FACTORS) {
    const values = rawRows.map((row) => row[betaKey]).filter(finite);
    for (const row of rawRows) row[scoreKey] = percentile(values, row[betaKey]);
  }
  for (const row of rawRows) {
    const scores = FACTORS.map(([, , , scoreKey]) => row[scoreKey]).filter(finite);
    row.tiltStrengthScore = scores.length
      ? round(Math.min(100, scores.reduce((acc, score) => acc + Math.abs(score - 50), 0) / scores.length * 2), 2)
      : null;
  }

  const rows = rawRows
    .sort((a, b) => (b.tiltStrengthScore ?? 0) - (a.tiltStrengthScore ?? 0) || a.name.localeCompare(b.name))
    .map((row) => FIELDS.map((field) => row[field] ?? null));

  const confidenceCounts = {};
  for (const row of rawRows) confidenceCounts[row.confidence] = (confidenceCounts[row.confidence] ?? 0) + 1;
  const asOfValues = rawRows.map((row) => row.asOf).filter(Boolean).sort();
  const obsValues = rawRows.map((row) => row.observationCount).filter(finite);
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_file: "private Ken French ZIP fetch + data/sec-13f/analytics/portfolio_views.json",
    formula_version: "superinvestors-factor-radar-v0.1.0",
    contract_doc: "docs/planning/CONTRACT_superinvestors_charts_20260628.md",
    feasibility_doc: "docs/planning/FEASIBILITY_superinvestors_factor_radar_20260628.md",
    public_surface_status: "track_d_v2_factor_radar_derived_public_only",
    raw_data_boundary: "raw Ken French ZIP/CSV cache stays under _private/admin/fama_french/raw and is not mirrored to public assets",
    factor_sources: {
      fiveFactor: {
        id: SOURCES.fiveFactor.id,
        url: SOURCES.fiveFactor.url,
        latest_month: fiveFactor.latestMonth,
        last_modified: fiveFactorZip.lastModified,
        cache: fiveFactorZip.cache,
        source_note: fiveFactor.sourceNote,
      },
      momentum: {
        id: SOURCES.momentum.id,
        url: SOURCES.momentum.url,
        latest_month: momentum.latestMonth,
        last_modified: momentumZip.lastModified,
        cache: momentumZip.cache,
        source_note: momentum.sourceNote,
      },
    },
    coverage: {
      row_count: rows.length,
      same_period_cohort_count: samePeriodEntries.length,
      common_performance_end_date: commonEndDate,
      factor_aligned_as_of: asOfValues.at(-1) ?? null,
      observation_count_min: obsValues.length ? Math.min(...obsValues) : null,
      observation_count_max: obsValues.length ? Math.max(...obsValues) : null,
      confidence_counts: confidenceCounts,
    },
    fields: FIELDS,
    rows,
  };
  writeJson(OUTPUT, output);
  writeJson(PUBLIC_OUTPUT, output);
  console.log(`factor_exposures_summary: rows=${rows.length} same_period=${samePeriodEntries.length} as_of=${output.coverage.factor_aligned_as_of}`);
  console.log(`raw cache: ${RAW_CACHE_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
