#!/usr/bin/env node
/**
 * Separate ETF signal builder for Fenok Edge.
 *
 * Scores eligible vanilla ETFs across 8 signal families. ETFs that are
 * leveraged, inverse, or single-stock are catalogued but excluded from the
 * vanilla score denominator. Missing inputs for a signal produce a null score,
 * not zero, and that signal is excluded from the row's coverage.
 *
 * Raw rows stay private; this public artifact exposes only derived metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEffectiveEtfDetailReader } from "./effective-etf-detail-reader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const FORMULA_VERSION = "fenok-etf-signals-v0.2-scores";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md";
const PUBLIC_SURFACE_STATUS = "phase_b_v0_2_etf_signal_scores_separate_lane";
const SOURCE_FILE = "stockanalysis/etf_universe.json";
const OUTPUT_FILE = "computed/fenok_etf_signals.json";
const SUMMARY_OUTPUT_FILE = "computed/fenok_etf_signals_summary.json";

const SIGNAL_KEYS = [
  "cost_efficiency",
  "liquidity",
  "tracking_quality",
  "momentum_trend",
  "risk_adjusted_momentum",
  "income",
  "diversification",
  "classification_risk",
];

const NON_VANILLA_ETF_PATTERNS = [
  /ultrashort/i,
  /ultrapro/i,
  /\b[23]x\b/i,
  /\b-[123]x\b/i,
  /\binverse\b/i,
  /\bleveraged\b/i,
  /\bdaily\s+(bull|bear)\b/i,
  /\/leveraged-and-inverse\//i,
  /\bsingle[-\s]?stock\b/i,
];

function readJson(relPath) {
  const abs = path.join(dataRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`read ${relPath}: ${error.message}`);
  }
}

function readOptionalJson(relPath) {
  const abs = path.join(dataRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const abs = path.join(root, relPath);
    ensureDir(abs);
    fs.writeFileSync(abs, body, "utf8");
  }
}

function parseArgs(argv) {
  return {
    noWrite: argv.includes("--no-write"),
  };
}

function ticker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function parseNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === "" || s === "—" || s === "-") return null;
  const pct = s.match(/^([+-]?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]) / 100;
  const aum = s.match(/^\$?([+-]?\d+(?:\.\d+)?)\s*([BKMT])?$/i);
  if (aum) {
    const n = Number(aum[1]);
    const unit = aum[2] ? aum[2].toUpperCase() : "";
    const mult = { B: 1e9, K: 1e3, M: 1e6, T: 1e12 }[unit] ?? 1;
    return n * mult;
  }
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = parseNumber(value);
    if (n != null) return n;
  }
  return null;
}

function average(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function annualizedVolatility(dailyCloses) {
  if (!Array.isArray(dailyCloses) || dailyCloses.length < 20) return null;
  const logReturns = [];
  for (let i = 1; i < dailyCloses.length; i += 1) {
    const prev = dailyCloses[i - 1];
    const curr = dailyCloses[i];
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }
  if (logReturns.length < 10) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function percentileRank(values, value, invert = false) {
  if (value == null || Number.isNaN(value)) return null;
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const below = nums.filter((v) => v < value).length;
  let rank = below / nums.length;
  if (invert) rank = 1 - rank;
  return Math.round(rank * 100);
}

function clampScore(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function categoryPercentile(valuesByCategory, value, category, invert = false) {
  const values = valuesByCategory.get(category);
  if (values && values.length >= 3) {
    return percentileRank(values, value, invert);
  }
  // Fallback to global if category too small.
  const allValues = [...valuesByCategory.values()].flat();
  return percentileRank(allValues, value, invert);
}

function buildCategoryValues(candidates, valueFn) {
  const map = new Map();
  for (const c of candidates) {
    const value = valueFn(c);
    if (value == null || Number.isNaN(value)) continue;
    const category = c.category || "__uncategorized__";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(value);
  }
  return map;
}

function buildGlobalValues(candidates, valueFn) {
  return candidates
    .map((c) => valueFn(c))
    .filter((v) => v != null && Number.isFinite(v));
}

function nonVanillaReason(row) {
  const classification = row?.classification;
  if (classification && typeof classification === "object") {
    if (classification.is_leveraged) return "classification.is_leveraged";
    if (classification.is_inverse) return "classification.is_inverse";
    if (classification.is_single_stock) return "classification.is_single_stock";
  }

  const text = [
    row?.ticker,
    row?.name,
    row?.etf_website,
    row?.provider_page,
  ].filter(Boolean).join(" ");
  const matched = NON_VANILLA_ETF_PATTERNS.find((pattern) => pattern.test(text));
  return matched ? `heuristic:${matched.source}` : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  const etfUniverse = readJson(SOURCE_FILE);
  const marketFacts = readOptionalJson("computed/market_facts/index.json") ?? {};
  const marketFactsByTicker = new Map();
  for (const row of marketFacts.rows ?? []) {
    marketFactsByTicker.set(ticker(row.ticker), row);
  }
  const candidates = Array.isArray(etfUniverse?.records) ? etfUniverse.records : [];
  const candidateCount = candidates.length;

  const eligibleCandidates = candidates
    .map((row) => {
      const t = ticker(row?.ticker);
      const classification = row?.classification;
      const exclusionReason = nonVanillaReason(row);
      return {
        ticker: t,
        name: row?.name ?? t,
        category: row?.category ?? "Uncategorized",
        classification,
        isVanilla: !exclusionReason,
        exclusionReason,
      };
    })
    .filter((c) => c.isVanilla);

  const vanillaCount = eligibleCandidates.length;
  const effectiveDetailReader = createEffectiveEtfDetailReader({ rootDir: repoRoot });

  // Enrich each candidate with source data.
  const scored = eligibleCandidates.map((c) => {
    const detail = readOptionalJson(path.join("computed", "market_facts", "tickers", `${c.ticker}.json`));
    const facts = detail?.facts ?? {};
    const resolvedDetail = effectiveDetailReader.resolve(c.ticker);
    const saDetail = resolvedDetail.status === "available" ? resolvedDetail.payload : null;
    const saNorm = saDetail?.normalized ?? {};
    const saOverview = saNorm.overview ?? {};
    const saPerformance = saNorm.performance ?? {};
    const saHistoryDaily = Array.isArray(saNorm.history_periods?.daily_1y)
      ? saNorm.history_periods.daily_1y
      : Array.isArray(saNorm.history)
        ? saNorm.history
        : null;
    const saQuote = saNorm.quote ?? {};
    const saHoldings = Array.isArray(saNorm.holdings) ? saNorm.holdings : null;
    const saSectors = Array.isArray(saNorm.sectors) ? saNorm.sectors : null;
    const saCountries = Array.isArray(saNorm.countries) ? saNorm.countries : null;

    const expenseRatio = firstNumber(
      facts.expense_ratio?.value,
      saOverview.expenseRatio,
    );
    const aum = firstNumber(
      facts.total_assets?.value,
      saOverview.aum,
    );
    const beta = firstNumber(
      facts.beta?.value,
      saOverview.beta,
    );
    const dividendYield = firstNumber(
      facts.dividend_yield?.value,
      saOverview.dividendYield,
    );
    const return1m = firstNumber(
      facts.return_1m?.value,
      saPerformance.tr1m,
    );
    const returnYtd = firstNumber(
      facts.return_ytd?.value,
      saPerformance.trYTD,
    );
    const return1y = firstNumber(
      facts.return_1y?.value,
      saPerformance.tr1y,
    );

    const dailyCloses = saHistoryDaily?.map((d) => parseNumber(d.c)).filter((v) => v != null);
    const dailyVolumes = saHistoryDaily?.map((d) => parseNumber(d.v)).filter((v) => v != null);
    const dailyDollarVolumes = saHistoryDaily
      ?.map((d) => {
        const price = parseNumber(d.c);
        const vol = parseNumber(d.v);
        return price != null && vol != null ? price * vol : null;
      })
      .filter((v) => v != null);
    const avgDollarVolume = dailyDollarVolumes?.length
      ? average(dailyDollarVolumes.slice(-63))
      : null;

    const annVol = dailyCloses ? annualizedVolatility(dailyCloses) : null;
    const holdingsCount = saNorm.holding_count ?? detail?.etf?.holdings_count ?? null;
    const sectors = saSectors ?? detail?.etf?.sectors ?? null;
    const countries = saCountries ?? detail?.etf?.countries ?? null;
    const top10Weight = saHoldings
      ? Math.min(100, saHoldings.slice(0, 10).reduce((sum, h) => sum + Math.abs(parseNumber(h.weight_pct) ?? 0), 0))
      : null;

    return {
      ...c,
      inputs: {
        expenseRatio,
        aum,
        beta,
        dividendYield,
        return1m,
        returnYtd,
        return1y,
        avgDollarVolume,
        annVol,
        historyDays: saHistoryDaily?.length ?? null,
        holdingsCount,
        sectorCount: Array.isArray(sectors) ? sectors.length : null,
        countryCount: Array.isArray(countries) ? countries.length : null,
        top10Weight,
      },
    };
  });

  // Percentile maps for category-sensitive and global metrics.
  const expenseByCategory = buildCategoryValues(scored, (c) => c.inputs.expenseRatio);
  const yieldByCategory = buildCategoryValues(scored, (c) => c.inputs.dividendYield);
  const aumValues = buildGlobalValues(scored, (c) => c.inputs.aum);
  const advValues = buildGlobalValues(scored, (c) => c.inputs.avgDollarVolume);
  const holdingsCountValues = buildGlobalValues(scored, (c) => c.inputs.holdingsCount);
  const return1mValues = buildGlobalValues(scored, (c) => c.inputs.return1m);
  const returnYtdValues = buildGlobalValues(scored, (c) => c.inputs.returnYtd);
  const return1yValues = buildGlobalValues(scored, (c) => c.inputs.return1y);
  const sharpeValues = buildGlobalValues(scored, (c) =>
    c.inputs.return1y != null && c.inputs.annVol != null && c.inputs.annVol > 0
      ? c.inputs.return1y / c.inputs.annVol
      : null,
  );

  const rows = scored.map((c) => {
    const scores = {};
    const coverage = {};

    // Cost efficiency: lower expense ratio is better.
    if (c.inputs.expenseRatio != null) {
      scores.cost_efficiency = clampScore(categoryPercentile(expenseByCategory, c.inputs.expenseRatio, c.category, true));
      coverage.cost_efficiency = scores.cost_efficiency != null;
    } else {
      scores.cost_efficiency = null;
      coverage.cost_efficiency = false;
    }

    // Liquidity: higher AUM and average dollar volume are better.
    const aumScore = percentileRank(aumValues, c.inputs.aum, false);
    const advScore = percentileRank(advValues, c.inputs.avgDollarVolume, false);
    if (aumScore != null || advScore != null) {
      scores.liquidity = clampScore(average([aumScore, advScore].filter((s) => s != null)));
      coverage.liquidity = true;
    } else {
      scores.liquidity = null;
      coverage.liquidity = false;
    }

    // Tracking quality: beta close to 1 and sufficient history continuity.
    const betaScore = c.inputs.beta != null
      ? Math.max(0, Math.min(100, 100 - Math.abs(c.inputs.beta - 1) * 100))
      : null;
    const continuityScore = c.inputs.historyDays != null
      ? Math.max(0, Math.min(100, (c.inputs.historyDays / 252) * 100))
      : null;
    if (betaScore != null || continuityScore != null) {
      scores.tracking_quality = clampScore(average([betaScore, continuityScore].filter((s) => s != null)));
      coverage.tracking_quality = true;
    } else {
      scores.tracking_quality = null;
      coverage.tracking_quality = false;
    }

    // Momentum trend: average percentile of available returns.
    const returnScores = [
      percentileRank(return1mValues, c.inputs.return1m, false),
      percentileRank(returnYtdValues, c.inputs.returnYtd, false),
      percentileRank(return1yValues, c.inputs.return1y, false),
    ].filter((s) => s != null);
    if (returnScores.length > 0) {
      scores.momentum_trend = clampScore(average(returnScores));
      coverage.momentum_trend = true;
    } else {
      scores.momentum_trend = null;
      coverage.momentum_trend = false;
    }

    // Risk-adjusted momentum: 1-year return / annualized volatility percentile.
    if (c.inputs.return1y != null && c.inputs.annVol != null && c.inputs.annVol > 0) {
      const sharpe = c.inputs.return1y / c.inputs.annVol;
      scores.risk_adjusted_momentum = clampScore(percentileRank(sharpeValues, sharpe, false));
      coverage.risk_adjusted_momentum = scores.risk_adjusted_momentum != null;
    } else {
      scores.risk_adjusted_momentum = null;
      coverage.risk_adjusted_momentum = false;
    }

    // Income: higher dividend yield is better (category-relative).
    if (c.inputs.dividendYield != null) {
      scores.income = clampScore(categoryPercentile(yieldByCategory, c.inputs.dividendYield, c.category, false));
      coverage.income = scores.income != null;
    } else {
      scores.income = null;
      coverage.income = false;
    }

    // Diversification: holdings count, sector breadth, country breadth, low top-10 concentration.
    const holdingsScore = percentileRank(holdingsCountValues, c.inputs.holdingsCount, false);
    const sectorScore = c.inputs.sectorCount != null ? Math.min(100, (c.inputs.sectorCount / 11) * 100) : null;
    const countryScore = c.inputs.countryCount != null ? Math.min(100, (c.inputs.countryCount / 20) * 100) : null;
    const concentrationScore = c.inputs.top10Weight != null ? Math.max(0, 100 - c.inputs.top10Weight) : null;
    const divParts = [holdingsScore, sectorScore, countryScore, concentrationScore].filter((s) => s != null);
    if (divParts.length > 0) {
      scores.diversification = clampScore(average(divParts));
      coverage.diversification = true;
    } else {
      scores.diversification = null;
      coverage.diversification = false;
    }

    // Classification risk: eligible vanilla ETFs are low risk.
    if (c.classification && typeof c.classification === "object") {
      scores.classification_risk = clampScore(100);
      coverage.classification_risk = true;
    } else {
      scores.classification_risk = null;
      coverage.classification_risk = false;
    }

    const scoredSignalCount = Object.values(scores).filter((s) => s != null).length;

    return {
      ticker: c.ticker,
      company: c.name,
      asset_type: "etf",
      category: c.category,
      aum: c.inputs.aum,
      expense_ratio: c.inputs.expenseRatio,
      dividend_yield: c.inputs.dividendYield,
      beta: c.inputs.beta,
      scores,
      coverage,
      scored_signal_count: scoredSignalCount,
    };
  });

  const signalCoverage = {};
  for (const key of SIGNAL_KEYS) {
    signalCoverage[key] = rows.filter((r) => r.scores[key] != null).length;
  }

  const scoredPublicEtf = rows.length;

  const payload = {
    schema_version: 2,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    source_generated_at: etfUniverse.generated_at ?? null,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    asset_type: "etf",
    raw_policy: {
      external_collection: false,
      full_public_mirror: false,
      third_party_raw_public: false,
      private_proxy_sources: true,
      direct_corpus_tone_public: false,
      public_payload: SUMMARY_OUTPUT_FILE,
    },
    signal_keys: SIGNAL_KEYS,
    coverage: {
      candidate_etf_count: candidateCount,
      eligible_etf_count: vanillaCount,
      scored_public_etf: scoredPublicEtf,
      market_facts_etf_count: marketFacts.coverage?.etf ?? null,
      signal_coverage: signalCoverage,
    },
    rows,
  };

  const summary = {
    schema_version: 2,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    formula_version: FORMULA_VERSION,
    asset_type: "etf",
    coverage: {
      candidate_etf_count: candidateCount,
      eligible_etf_count: vanillaCount,
      scored_public_etf: scoredPublicEtf,
      signal_coverage: signalCoverage,
    },
    fields: ["ticker", "company", "asset_type", "category", "aum", "expense_ratio", "dividend_yield", "beta"],
    rows: rows.map((r) => ({
      ticker: r.ticker,
      company: r.company,
      asset_type: r.asset_type,
      category: r.category,
      aum: r.aum,
      expense_ratio: r.expense_ratio,
      dividend_yield: r.dividend_yield,
      beta: r.beta,
      scores: r.scores,
      scored_signal_count: r.scored_signal_count,
    })),
  };

  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, payload, [dataRoot]);
    writeJson(SUMMARY_OUTPUT_FILE, summary, [dataRoot, publicDataRoot]);
  }

  console.log(JSON.stringify({
    generated_at: generatedAt,
    candidate_etf_count: candidateCount,
    eligible_etf_count: vanillaCount,
    scored_public_etf: scoredPublicEtf,
    signal_coverage: signalCoverage,
    output: args.noWrite ? "(not written)" : OUTPUT_FILE,
    summary_output: args.noWrite ? "(not written)" : SUMMARY_OUTPUT_FILE,
  }, null, 2));
}

main();
