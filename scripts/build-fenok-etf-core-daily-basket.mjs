#!/usr/bin/env node
/**
 * Build the ETF Core Daily Basket target list.
 *
 * This is a smaller ETF sublane that can be refreshed daily before the full
 * 4k+ ETF lane is daily-ready. It never promotes the full ETF lane to done.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const ADMIN_REL = "data/admin/fenok-etf-core-daily-basket.json";
const SUMMARY_REL = "data/computed/fenok_etf_core_daily_basket_summary.json";
const PUBLIC_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json";
const ETF_SIGNAL_SUMMARY_REL = "data/computed/fenok_etf_signals_summary.json";
const ETF_ACTION_INDEX_REL = "data/computed/etf_action_index.json";
const ETF_DETAIL_COVERAGE_REL = "data/stockanalysis/coverage/etf_detail.json";
const NEW_ETFS_REL = "data/stockanalysis/surfaces/new_etfs.json";
const ETF_DETAIL_DIR_REL = "data/stockanalysis/etfs";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md";

export const ETF_CORE_DAILY_BASKET_CONFIG = Object.freeze({
  schema_version: "fenok-etf-core-daily-basket/v0.1",
  summary_schema_version: "fenok-etf-core-daily-basket-summary/v0.1",
  basket_id: "etf_core_daily_basket",
  minSelectedCount: 75,
  maxQuoteAgeDays: 7,
  minDaily1yRows: 200,
  minAum: 50_000_000,
  minAverageDollarVolume5d: 1_000_000,
  minScoredSignalCount: 6,
  minCoverageRatio: 0.75,
  allowedActionConfidence: "high",
  categoryCaps: {
    Equity: 50,
    "Fixed Income": 35,
    Alternatives: 15,
    "Asset Allocation": 10,
    Commodity: 7,
    Currency: 3,
    Uncategorized: 5,
  },
});

const CORE_EXCLUDED_DERIVATIVE_INCOME_PATTERNS = [
  /\byieldmax\b/i,
  /\bweeklypay\b/i,
  /\byieldboost\b/i,
  /\boption income strategy etf\b/i,
  /\bperformance\s*&\s*distribution\s*target\b/i,
];

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
    noWrite: argv.includes("--no-write"),
    json: argv.includes("--json"),
  };
}

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
  } catch (error) {
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
}

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function writeJson(relPath, payload) {
  const target = abs(relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normTicker(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function asNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function toIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.valueOf())) return null;
  return parsed.toISOString().slice(0, 10);
}

function dateMs(value) {
  const iso = toIsoDate(value);
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function ageDays(value, now = new Date()) {
  const ms = dateMs(value);
  if (ms == null) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

function latestDailyRows(rows, limit = 5) {
  return asArray(rows)
    .filter((row) => toIsoDate(row?.t ?? row?.date ?? row?.d))
    .sort((a, b) => String(toIsoDate(b?.t ?? b?.date ?? b?.d)).localeCompare(String(toIsoDate(a?.t ?? a?.date ?? a?.d))))
    .slice(0, limit);
}

function latestDailyDate(rows) {
  return latestDailyRows(rows, 1)[0]?.t ?? latestDailyRows(rows, 1)[0]?.date ?? latestDailyRows(rows, 1)[0]?.d ?? null;
}

function rowClose(row) {
  return asNumber(row?.c, asNumber(row?.a, asNumber(row?.close, asNumber(row?.price, 0)))) ?? 0;
}

function rowVolume(row) {
  return asNumber(row?.v, asNumber(row?.volume, 0)) ?? 0;
}

function averageDollarVolume(rows, limit = 5) {
  const values = latestDailyRows(rows, limit)
    .map((row) => rowClose(row) * rowVolume(row))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countBy(values) {
  const counts = {};
  for (const value of values.filter(Boolean)) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function inc(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function categoryKey(value) {
  const text = String(value ?? "").trim();
  return text && text !== "-" ? text : "Uncategorized";
}

function categoryCap(category) {
  return ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps[category] ?? ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps.Uncategorized;
}

function compactAction(row) {
  return {
    ticker: row.ticker,
    company: row.company ?? null,
    asset_type: "etf",
    category: categoryKey(row.category),
    aum: finite(row.aum) ? row.aum : null,
    expense_ratio: finite(row.expense_ratio) ? row.expense_ratio : null,
    dividend_yield: finite(row.dividend_yield) ? row.dividend_yield : null,
    beta: finite(row.beta) ? row.beta : null,
    scored_signal_count: row.scored_signal_count,
    coverage_ratio: row.coverage_ratio,
    signal_score: row.signal_score,
    action_score: row.action_score,
    confidence_label: row.confidence_label,
  };
}

function basketSort(a, b) {
  return (b.action_score ?? -1) - (a.action_score ?? -1)
    || (b.aum ?? -1) - (a.aum ?? -1)
    || a.ticker.localeCompare(b.ticker);
}

function normalizeGenerated(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => (
    key === "generated_at" ? null : value
  )));
}

function detailPayload(ticker) {
  return readJsonOrNull(`${ETF_DETAIL_DIR_REL}/${ticker}.json`);
}

function derivativeIncomeReason({ ticker, actionRow, detail }) {
  const normalized = asObject(detail?.normalized);
  const overview = asObject(normalized.overview);
  const text = [
    ticker,
    actionRow?.company,
    normalized.name,
    overview.provider_page,
    overview.etf_website,
  ].filter(Boolean).join(" ");
  const matched = CORE_EXCLUDED_DERIVATIVE_INCOME_PATTERNS.find((pattern) => pattern.test(text));
  return matched ? "single_stock_or_concentrated_derivative_income_strategy" : null;
}

function structuralReasons({ ticker, actionRow, detail, missingDetailSet, yahooFallbackSet, newEtfSet }) {
  const reasons = [];
  if (!actionRow) reasons.push("action_index_missing");
  if (newEtfSet.has(ticker)) reasons.push("new_etf_radar_only");
  if (missingDetailSet.has(ticker)) reasons.push("detail_missing");
  if (yahooFallbackSet.has(ticker)) reasons.push("yahoo_fallback_detail");
  if (!detail) reasons.push("detail_file_missing");
  if (detail && detail.source !== "stockanalysis") reasons.push("non_stockanalysis_detail");

  const normalized = asObject(detail?.normalized);
  const classification = asObject(normalized.classification);
  if (classification.confidence !== "high") reasons.push("classification_not_high_confidence");
  if (classification.is_leveraged === true) reasons.push("leveraged_etf");
  if (classification.is_inverse === true) reasons.push("inverse_etf");
  if (classification.is_single_stock === true) reasons.push("single_stock_etf");
  const derivativeIncome = derivativeIncomeReason({ ticker, actionRow, detail });
  if (derivativeIncome) reasons.push(derivativeIncome);

  const dailyRows = asArray(asObject(normalized.history_periods).daily_1y);
  if (dailyRows.length < ETF_CORE_DAILY_BASKET_CONFIG.minDaily1yRows) reasons.push("daily_1y_rows_lt_200");

  const avgDollarVolume5d = averageDollarVolume(dailyRows);
  if (!(Number(avgDollarVolume5d) >= ETF_CORE_DAILY_BASKET_CONFIG.minAverageDollarVolume5d)) {
    reasons.push("avg_dollar_volume_5d_lt_1m");
  }

  if (actionRow) {
    if (Number(actionRow.scored_signal_count) < ETF_CORE_DAILY_BASKET_CONFIG.minScoredSignalCount) {
      reasons.push("scored_signal_count_lt_6");
    }
    if (Number(actionRow.coverage_ratio) < ETF_CORE_DAILY_BASKET_CONFIG.minCoverageRatio) {
      reasons.push("coverage_ratio_lt_0_75");
    }
    if (actionRow.confidence_label !== ETF_CORE_DAILY_BASKET_CONFIG.allowedActionConfidence) {
      reasons.push("action_confidence_not_high");
    }
    if (!(Number(actionRow.aum) >= ETF_CORE_DAILY_BASKET_CONFIG.minAum)) {
      reasons.push("aum_lt_50m");
    }
  }

  return reasons;
}

function proofForDetail(detail, now) {
  const normalized = asObject(detail?.normalized);
  const quote = asObject(normalized.quote);
  const dailyRows = asArray(asObject(normalized.history_periods).daily_1y);
  const latestDate = toIsoDate(quote.td) ?? toIsoDate(latestDailyDate(dailyRows));
  const latestVolume = asNumber(quote.v, null) ?? Math.max(0, ...latestDailyRows(dailyRows, 5).map(rowVolume));
  const avgDollarVolume5d = averageDollarVolume(dailyRows);
  const quoteAgeDays = ageDays(latestDate, now);
  return {
    detail_source: detail?.source ?? null,
    classification_confidence: normalized.classification?.confidence ?? null,
    quote_date: latestDate,
    quote_age_days: quoteAgeDays,
    quote_volume: latestVolume,
    daily_1y_rows: dailyRows.length,
    average_dollar_volume_5d: round(avgDollarVolume5d),
  };
}

function freshnessReasons(proof) {
  const reasons = [];
  if (proof.quote_age_days == null || proof.quote_age_days > ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays) {
    reasons.push("quote_or_daily_stale");
  }
  if (!(Number(proof.quote_volume) > 0)) reasons.push("quote_volume_missing");
  return reasons;
}

function buildRows({ signalSummary, actionIndex, detailCoverage, newEtfs, now }) {
  const actionByTicker = new Map(asArray(actionIndex?.rows).map((row) => [normTicker(row.ticker), row]).filter(([ticker]) => ticker));
  const missingDetailSet = new Set(asArray(detailCoverage?.missing_tickers).map(normTicker));
  const yahooFallbackSet = new Set(asArray(detailCoverage?.yahoo_fallback_tickers).map(normTicker));
  const newEtfSet = new Set(asArray(newEtfs?.records).map((row) => normTicker(row.s ?? row.ticker)).filter(Boolean));
  const excludedReasonCounts = {};
  const excludedSamples = {};
  const structuralCandidates = [];

  for (const sourceRow of asArray(signalSummary?.rows)) {
    const ticker = normTicker(sourceRow.ticker);
    if (!ticker) continue;
    const actionRow = actionByTicker.get(ticker);
    const detail = detailPayload(ticker);
    const reasons = structuralReasons({ ticker, actionRow, detail, missingDetailSet, yahooFallbackSet, newEtfSet });
    if (reasons.length > 0) {
      for (const reason of reasons) {
        inc(excludedReasonCounts, reason);
        excludedSamples[reason] = excludedSamples[reason] ?? [];
        if (excludedSamples[reason].length < 8) excludedSamples[reason].push(ticker);
      }
      continue;
    }

    const proof = proofForDetail(detail, now);
    const freshBlockers = freshnessReasons(proof);
    structuralCandidates.push({
      ...compactAction(actionRow),
      core_candidate_allowed: true,
      core_candidate_reason: "passes_structural_core_daily_filters",
      status: freshBlockers.length === 0 ? "fresh" : "needs_refresh",
      freshness_blockers: freshBlockers,
      proof,
    });
  }

  return {
    structuralCandidates,
    excludedReasonCounts: Object.fromEntries(Object.entries(excludedReasonCounts).sort(([a], [b]) => a.localeCompare(b))),
    excludedSamples: Object.fromEntries(Object.entries(excludedSamples).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function selectBasketRows(structuralCandidates) {
  const selected = [];
  const selectedByCategory = {};
  const sortedCandidates = [...structuralCandidates].sort(basketSort);
  const addRow = (row) => {
    const category = categoryKey(row.category);
    if ((selectedByCategory[category] ?? 0) >= categoryCap(category)) return false;
    selectedByCategory[category] = (selectedByCategory[category] ?? 0) + 1;
    selected.push({ ...row, category });
    return true;
  };

  for (const row of sortedCandidates.filter((candidate) => candidate.status === "fresh")) addRow(row);

  if (selected.length < ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount) {
    for (const row of sortedCandidates.filter((candidate) => candidate.status !== "fresh")) addRow(row);
  }

  return {
    selected,
    selectedByCategory: Object.fromEntries(Object.entries(selectedByCategory).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function buildSummary(adminPayload) {
  return {
    schema_version: ETF_CORE_DAILY_BASKET_CONFIG.summary_schema_version,
    generated_at: adminPayload.generated_at,
    source_generated_at: adminPayload.source_generated_at,
    basket_id: adminPayload.basket_id,
    asset_type: "etf",
    contract_doc: CONTRACT_DOC,
    raw_policy: {
      public: true,
      raw_rows_included: false,
      admin_detail_public: false,
    },
    readiness: adminPayload.readiness,
    coverage: adminPayload.coverage,
    daily_refresh_universe: {
      count: adminPayload.daily_refresh_universe.count,
      tickers: adminPayload.daily_refresh_universe.tickers,
    },
    rows: adminPayload.rows.map((row) => ({
      ticker: row.ticker,
      company: row.company,
      category: row.category,
      aum: row.aum,
      expense_ratio: row.expense_ratio,
      dividend_yield: row.dividend_yield,
      beta: row.beta,
      scored_signal_count: row.scored_signal_count,
      coverage_ratio: row.coverage_ratio,
      signal_score: row.signal_score,
      action_score: row.action_score,
      confidence_label: row.confidence_label,
      core_candidate_allowed: row.core_candidate_allowed,
      status: row.status,
      freshness_blockers: row.freshness_blockers,
      quote_date: row.proof.quote_date,
      quote_age_days: row.proof.quote_age_days,
      daily_1y_rows: row.proof.daily_1y_rows,
      average_dollar_volume_5d: row.proof.average_dollar_volume_5d,
    })),
  };
}

export function buildEtfCoreDailyBasket({
  signalSummary = null,
  actionIndex = null,
  detailCoverage = null,
  newEtfs = null,
  generatedAt = new Date(),
  now = generatedAt,
} = {}) {
  const sourceSummary = signalSummary ?? readJson(ETF_SIGNAL_SUMMARY_REL);
  const sourceAction = actionIndex ?? readJson(ETF_ACTION_INDEX_REL);
  const sourceDetailCoverage = detailCoverage ?? readJson(ETF_DETAIL_COVERAGE_REL);
  const sourceNewEtfs = newEtfs ?? readJson(NEW_ETFS_REL);
  const { structuralCandidates, excludedReasonCounts, excludedSamples } = buildRows({
    signalSummary: sourceSummary,
    actionIndex: sourceAction,
    detailCoverage: sourceDetailCoverage,
    newEtfs: sourceNewEtfs,
    now,
  });
  const { selected, selectedByCategory } = selectBasketRows(structuralCandidates);
  const staleRows = selected.filter((row) => row.status !== "fresh");
  const freshRows = selected.filter((row) => row.status === "fresh");
  const freshnessBlockerCounts = countBy(selected.flatMap((row) => row.freshness_blockers));
  const blockers = [
    ...(selected.length < ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount ? ["selected_count_lt_minimum"] : []),
    ...(staleRows.length > 0 ? ["selected_rows_need_daily_refresh"] : []),
  ];
  const ready = blockers.length === 0;
  const generatedIso = generatedAt.toISOString();

  const admin = {
    schema_version: ETF_CORE_DAILY_BASKET_CONFIG.schema_version,
    generated_at: generatedIso,
    basket_id: ETF_CORE_DAILY_BASKET_CONFIG.basket_id,
    asset_type: "etf",
    contract_doc: CONTRACT_DOC,
    source_files: {
      etf_signal_summary: ETF_SIGNAL_SUMMARY_REL,
      etf_action_index: ETF_ACTION_INDEX_REL,
      etf_detail_coverage: ETF_DETAIL_COVERAGE_REL,
      new_etfs: NEW_ETFS_REL,
      etf_detail_dir: ETF_DETAIL_DIR_REL,
    },
    source_generated_at: {
      etf_signal_summary: sourceSummary.generated_at ?? null,
      etf_action_index: sourceAction.generated_at ?? null,
      etf_detail_coverage: sourceDetailCoverage.generated_at ?? null,
      new_etfs: sourceNewEtfs.generated_at ?? null,
    },
    raw_policy: {
      public: false,
      public_mirror: false,
      public_summary_file: SUMMARY_REL,
      public_summary_mirror: PUBLIC_SUMMARY_REL,
      no_full_etf_done_claim: true,
    },
    config: ETF_CORE_DAILY_BASKET_CONFIG,
    readiness: {
      core_daily_basket_ready: ready,
      readiness_status: ready ? "ready" : "not_ready",
      public_done_claim_allowed: false,
      min_selected_count: ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount,
      selected_count: selected.length,
      fresh_selected_count: freshRows.length,
      stale_selected_count: staleRows.length,
      max_quote_age_days: ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays,
      blockers,
      caveat: "This sublane can become daily-ready independently; it does not promote the full ETF scoring lane to DAILY/GATED.",
    },
    coverage: {
      source_scored_etf_count: Number(sourceSummary?.coverage?.scored_public_etf) || asArray(sourceSummary?.rows).length,
      action_index_total_etf_count: Number(sourceAction?.coverage?.total_etf_count) || asArray(sourceAction?.rows).length,
      new_etf_radar_count: asArray(sourceNewEtfs?.records).length,
      detail_candidate_total: Number(sourceDetailCoverage?.counts?.candidate_total) || null,
      detail_stockanalysis_files: Number(sourceDetailCoverage?.counts?.stockanalysis_detail_files) || null,
      detail_yahoo_fallback_files: Number(sourceDetailCoverage?.counts?.yahoo_fallback_files) || null,
      structural_candidate_count: structuralCandidates.length,
      fresh_structural_candidate_count: structuralCandidates.filter((row) => row.status === "fresh").length,
      stale_structural_candidate_count: structuralCandidates.filter((row) => row.status !== "fresh").length,
      selected_count: selected.length,
      fresh_selected_count: freshRows.length,
      stale_selected_count: staleRows.length,
      selected_by_category: selectedByCategory,
      structural_candidates_by_category: countBy(structuralCandidates.map((row) => categoryKey(row.category))),
      freshness_blocker_counts: freshnessBlockerCounts,
      excluded_reason_counts: excludedReasonCounts,
    },
    daily_refresh_universe: {
      source: "selected_core_basket_rows",
      count: selected.length,
      tickers: selected.map((row) => row.ticker),
      stale_tickers: staleRows.map((row) => row.ticker),
      workflow: ".github/workflows/fetch-stockanalysis.yml scheduled runs use this list as the daily ETF priority set.",
    },
    excluded_samples: excludedSamples,
    rows: selected,
  };

  return {
    admin,
    summary: buildSummary(admin),
  };
}

export function validateEtfCoreDailyBasket(adminPayload, summaryPayload) {
  const errors = [];
  const rows = asArray(adminPayload?.rows);
  const summaryRows = asArray(summaryPayload?.rows);
  const dailyUniverse = asArray(adminPayload?.daily_refresh_universe?.tickers);
  const rowTickers = rows.map((row) => row.ticker);
  const uniqueTickers = new Set(rowTickers);

  if (adminPayload?.schema_version !== ETF_CORE_DAILY_BASKET_CONFIG.schema_version) errors.push("admin schema_version mismatch");
  if (summaryPayload?.schema_version !== ETF_CORE_DAILY_BASKET_CONFIG.summary_schema_version) errors.push("summary schema_version mismatch");
  if (adminPayload?.asset_type !== "etf" || summaryPayload?.asset_type !== "etf") errors.push("asset_type must be etf");
  if (adminPayload?.raw_policy?.public !== false || adminPayload?.raw_policy?.public_mirror !== false) errors.push("admin raw_policy must stay private");
  if (summaryPayload?.raw_policy?.public !== true || summaryPayload?.raw_policy?.raw_rows_included !== false) errors.push("summary raw_policy must be public compact");
  if (rows.length !== adminPayload?.coverage?.selected_count) errors.push("admin rows length must equal coverage.selected_count");
  if (summaryRows.length !== rows.length) errors.push("summary rows length must equal admin rows length");
  if (dailyUniverse.length !== rows.length) errors.push("daily_refresh_universe must match selected row count");
  if (uniqueTickers.size !== rows.length) errors.push("duplicate selected tickers");

  for (const row of rows) {
    if (!row.ticker) errors.push("selected row missing ticker");
    if (row.asset_type !== "etf") errors.push(`${row.ticker}: asset_type must be etf`);
    if (row.core_candidate_allowed !== true) errors.push(`${row.ticker}: core_candidate_allowed must be true`);
    if (row.confidence_label !== ETF_CORE_DAILY_BASKET_CONFIG.allowedActionConfidence) errors.push(`${row.ticker}: confidence_label must be high`);
    if (Number(row.scored_signal_count) < ETF_CORE_DAILY_BASKET_CONFIG.minScoredSignalCount) errors.push(`${row.ticker}: scored_signal_count below minimum`);
    if (Number(row.coverage_ratio) < ETF_CORE_DAILY_BASKET_CONFIG.minCoverageRatio) errors.push(`${row.ticker}: coverage_ratio below minimum`);
    if (Number(row.aum) < ETF_CORE_DAILY_BASKET_CONFIG.minAum) errors.push(`${row.ticker}: aum below minimum`);
    if (Number(row.proof?.daily_1y_rows) < ETF_CORE_DAILY_BASKET_CONFIG.minDaily1yRows) errors.push(`${row.ticker}: daily_1y_rows below minimum`);
    if (Number(row.proof?.average_dollar_volume_5d) < ETF_CORE_DAILY_BASKET_CONFIG.minAverageDollarVolume5d) errors.push(`${row.ticker}: average_dollar_volume_5d below minimum`);
    if (!["fresh", "needs_refresh"].includes(row.status)) errors.push(`${row.ticker}: invalid status ${row.status}`);
  }

  if (adminPayload?.readiness?.core_daily_basket_ready === true) {
    if (adminPayload?.readiness?.stale_selected_count !== 0) errors.push("ready basket cannot have stale rows");
    if (adminPayload?.readiness?.selected_count < ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount) errors.push("ready basket selected_count below minimum");
    if (asArray(adminPayload?.readiness?.blockers).length > 0) errors.push("ready basket cannot have blockers");
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildEtfCoreDailyBasket();
  const validation = validateEtfCoreDailyBasket(payload.admin, payload.summary);
  if (!args.noWrite && validation.ok) {
    writeJson(ADMIN_REL, payload.admin);
    writeJson(SUMMARY_REL, payload.summary);
    writeJson(PUBLIC_SUMMARY_REL, payload.summary);
  }

  const result = {
    ok: validation.ok,
    generated_at: payload.admin.generated_at,
    admin_output: args.noWrite ? "(no-write)" : ADMIN_REL,
    summary_output: args.noWrite ? "(no-write)" : SUMMARY_REL,
    public_summary_output: args.noWrite ? "(no-write)" : PUBLIC_SUMMARY_REL,
    selected_count: payload.admin.coverage.selected_count,
    fresh_selected_count: payload.admin.coverage.fresh_selected_count,
    stale_selected_count: payload.admin.coverage.stale_selected_count,
    selected_by_category: payload.admin.coverage.selected_by_category,
    readiness: payload.admin.readiness,
    errors: validation.errors,
  };

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Fenok ETF core daily basket: ${validation.ok ? "PASS" : "FAIL"}`);
    console.log(`selected_count: ${result.selected_count}`);
    console.log(`fresh_selected_count: ${result.fresh_selected_count}`);
    console.log(`stale_selected_count: ${result.stale_selected_count}`);
    console.log(`readiness: ${result.readiness.readiness_status}`);
  }

  process.exitCode = args.check && !validation.ok ? 1 : 0;
}

export { ADMIN_REL, SUMMARY_REL, normalizeGenerated };
