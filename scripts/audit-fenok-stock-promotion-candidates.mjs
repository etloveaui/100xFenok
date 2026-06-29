#!/usr/bin/env node
/**
 * Audit Fenok Edge stock promotion layers without fetching or writing data.
 *
 * The audit separates:
 * - S0: current active public stock scoring chain
 * - S1: normalized stock candidates in market_facts
 * - S2: stock expansion fuel/enrichment sources
 * - S3: ETF lane, explicitly excluded from stock promotion
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SCHEMA_VERSION = "fenok-stock-promotion-candidates-audit/v0.2";
const DEFAULT_EXAMPLE_LIMIT = 12;
const JOINED_MIN_EVIDENCE_FAMILIES = 3;
const JOINED_US_EXCHANGES = new Set([
  "AMEX",
  "ASE",
  "BTS",
  "NCM",
  "NGM",
  "NMS",
  "NASDAQ",
  "NYQ",
  "NYSE",
  "PCX",
]);

function parseArgs(argv) {
  const args = {
    json: false,
    full: false,
    check: false,
    examples: DEFAULT_EXAMPLE_LIMIT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--full") args.full = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--examples") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Expected --examples to be a non-negative integer, got: ${argv[i]}`);
      }
      args.examples = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  const fullPath = abs(relPath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
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

function listJsonTickers(relDir, { exclude = new Set() } = {}) {
  const dir = abs(relDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !exclude.has(name))
    .map((name) => ticker(name.replace(/\.json$/u, "")))
    .sort(compareTicker);
}

function ticker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function compareTicker(a, b) {
  return a.localeCompare(b);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort(compareTicker);
}

function sample(values, limit) {
  return values.slice(0, limit);
}

function sourceKey(row) {
  const keys = Object.entries(row.sources ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort();
  return keys.join("+") || "none";
}

function countBy(values, keyFn) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFn(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function setIntersectionCount(values, set) {
  let count = 0;
  for (const value of values) if (set.has(value)) count += 1;
  return count;
}

function byTickerRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = ticker(row.ticker);
    if (key) map.set(key, row);
  }
  return map;
}

function sec13fTickers(payload) {
  if (Array.isArray(payload)) {
    return unique(payload.map((row) => ticker(row.ticker ?? row.symbol ?? row.key)));
  }
  if (payload && typeof payload === "object") return unique(Object.keys(payload).map(ticker));
  return [];
}

function rawMasterTickers(payload) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  return unique(rows.map((row) => ticker(row.key ?? row.ticker ?? row.values?.[1])));
}

function marketFactAssetSet(rows, assetType) {
  return new Set(rows
    .filter((row) => row.asset_type === assetType)
    .map((row) => ticker(row.ticker))
    .filter(Boolean));
}

function existingTickerFiles(tickers, relDir) {
  return tickers.filter((item) => fs.existsSync(abs(path.join(relDir, `${item}.json`))));
}

function numericFact(detail, key) {
  const value = detail?.facts?.[key]?.value;
  return typeof value === "number" && Number.isFinite(value);
}

function inferCountryScope(identity) {
  const explicitCountry = identity?.country ?? identity?.country_code ?? identity?.countryCode ?? identity?.market_country;
  if (explicitCountry) return String(explicitCountry).trim().toUpperCase();

  const exchange = String(identity?.exchange ?? "").trim().toUpperCase();
  const currency = String(identity?.currency ?? "").trim().toUpperCase();
  if (currency === "USD" && JOINED_US_EXCHANGES.has(exchange)) return "US";

  return null;
}

function evidenceFamiliesForTicker(item, row, {
  yfSet,
  secSet,
  slickUniverseSet,
  slickStockFileSet,
  rawMasterSet,
}) {
  const sources = row?.sources ?? {};
  const families = [];

  if (sources.yf === true || yfSet.has(item)) families.push("yf");
  if (sources.stockanalysis === true || sources.stockanalysis_yf_fallback === true) families.push("stockanalysis");
  if (sources.slickcharts === true || slickUniverseSet.has(item) || slickStockFileSet.has(item)) families.push("slickcharts");
  if (secSet.has(item)) families.push("sec13f");
  if (rawMasterSet.has(item)) families.push("raw_company_master");

  return [...new Set(families)].sort((a, b) => a.localeCompare(b));
}

function countBlockers(statuses) {
  return countBy(statuses.flatMap((status) => status.blockers), (blocker) => blocker);
}

function joinedStatusSummary(status) {
  return {
    ticker: status.ticker,
    stage: status.stage,
    blockers: status.blockers,
    evidence_family_count: status.evidence_family_count,
    evidence_families: status.evidence_families,
    country_scope: status.country_scope,
  };
}

function buildS1JoinedGate({
  gapTickers,
  marketByTicker,
  s0Set,
  etfAssetSet,
  yfSet,
  secSet,
  slickUniverseSet,
  slickStockFileSet,
  rawMasterSet,
  examples,
  full,
}) {
  const statuses = gapTickers.map((item) => {
    const row = marketByTicker.get(item);
    const detail = readJsonOrNull(path.join("data/computed/market_facts/tickers", `${item}.json`));
    const identity = detail?.identity ?? {};
    const countryScope = inferCountryScope(identity);
    const evidenceFamilies = evidenceFamiliesForTicker(item, row, {
      yfSet,
      secSet,
      slickUniverseSet,
      slickStockFileSet,
      rawMasterSet,
    });
    const checks = {
      asset_type_stock: row?.asset_type === "stock",
      outside_s0: !s0Set.has(item),
      etf_lane_excluded: !etfAssetSet.has(item),
      exact_ticker_contract: ticker(row?.ticker) === item,
      market_currency_country_scope: Boolean(identity.exchange && identity.currency && countryScope),
      price_or_market_cap: numericFact(detail, "price") || numericFact(detail, "market_cap"),
      evidence_families_min3: evidenceFamilies.length >= JOINED_MIN_EVIDENCE_FAMILIES,
    };
    const blockers = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => key)
      .sort();
    const stage = blockers.length === 0 ? "JOINED_READY_NOT_SCORED" : "NORMALIZED_NOT_JOINED";

    return {
      ticker: item,
      status: blockers.length === 0 ? "joined_ready" : "joined_not_ready",
      stage,
      evidence_family_count: evidenceFamilies.length,
      evidence_families: evidenceFamilies,
      country_scope: countryScope,
      checks,
      blockers,
    };
  });

  const ready = statuses.filter((status) => status.status === "joined_ready");
  const notReady = statuses.filter((status) => status.status === "joined_not_ready");
  const etfLeaks = statuses.filter((status) => !status.checks.etf_lane_excluded);
  const classTickerStatuses = statuses.filter((status) => status.ticker.includes("."));

  return {
    stage_ceiling: "JOINED_READY_NOT_SCORED",
    contract: {
      claim_scope: "S1 normalized stock candidates only; this gate does not score, publish, fetch, or write data.",
      ready_requires_all_checks: [
        "asset_type_stock",
        "outside_s0",
        "etf_lane_excluded",
        "exact_ticker_contract",
        "market_currency_country_scope",
        "price_or_market_cap",
        "evidence_families_min3",
      ],
      minimum_evidence_families: JOINED_MIN_EVIDENCE_FAMILIES,
      country_scope_note: "Explicit country is used when present; otherwise USD plus a known US exchange infers US.",
    },
    counts: {
      total: statuses.length,
      joined_ready: ready.length,
      joined_not_ready: notReady.length,
      etf_lane_leaks: etfLeaks.length,
      class_tickers_checked: classTickerStatuses.length,
    },
    blocker_counts: countBlockers(statuses),
    examples: {
      joined_ready: sample(ready.map(joinedStatusSummary), examples),
      joined_not_ready: sample(notReady.map(joinedStatusSummary), examples),
      class_tickers: classTickerStatuses.map(joinedStatusSummary),
    },
    candidate_statuses: full ? statuses : undefined,
  };
}

function buildAudit({ examples = DEFAULT_EXAMPLE_LIMIT, full = false } = {}) {
  const signals = readJson("data/computed/fenok_signals.json");
  const marketFacts = readJson("data/computed/market_facts/index.json");
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json");
  const slickUniverse = readJson("data/slickcharts/universe.json");
  const sec13f = readJson("data/sec-13f/by_ticker.json");
  const rawMaster = readJson("data/global-scouter/raw/company_master_m_company.json");
  const stockanalysisIndex = readJsonOrNull("data/stockanalysis/index.json");

  const signalRows = Array.isArray(signals.rows) ? signals.rows : [];
  const marketRows = Array.isArray(marketFacts.rows) ? marketFacts.rows : [];
  const marketByTicker = byTickerRows(marketRows);
  const s0Tickers = unique(signalRows.map((row) => ticker(row.ticker)));
  const s0Set = new Set(s0Tickers);
  const stockRows = marketRows.filter((row) => row.asset_type === "stock");
  const etfRows = marketRows.filter((row) => row.asset_type === "etf");
  const stockCandidateTickers = unique(stockRows.map((row) => ticker(row.ticker)));
  const etfCandidateTickers = unique(etfRows.map((row) => ticker(row.ticker)));
  const gapTickers = stockCandidateTickers.filter((item) => !s0Set.has(item));
  const gapRows = gapTickers.map((item) => marketByTicker.get(item)).filter(Boolean);

  const yfTickers = listJsonTickers("data/yf/finance", { exclude: new Set(["_summary.json"]) });
  const yfSet = new Set(yfTickers);
  const secTickers = sec13fTickers(sec13f);
  const secSet = new Set(secTickers);
  const slickUniverseTickers = unique((slickUniverse.stocks ?? []).map((row) => ticker(row.symbol)));
  const slickUniverseSet = new Set(slickUniverseTickers);
  const slickStockFileTickers = listJsonTickers("data/slickcharts/stocks");
  const slickStockFileSet = new Set(slickStockFileTickers);
  const rawMasterTickerList = rawMasterTickers(rawMaster);
  const rawMasterSet = new Set(rawMasterTickerList);
  const stockAssetSet = marketFactAssetSet(marketRows, "stock");
  const etfAssetSet = marketFactAssetSet(marketRows, "etf");

  const gapWithYf = gapTickers.filter((item) => yfSet.has(item));
  const gapWithSec = gapTickers.filter((item) => secSet.has(item));
  const gapWithSlickSource = gapRows.filter((row) => row.sources?.slickcharts).map((row) => ticker(row.ticker));
  const gapWithSlickUniverse = gapTickers.filter((item) => slickUniverseSet.has(item));
  const gapWithRawMaster = gapTickers.filter((item) => rawMasterSet.has(item));
  const gapMarketFactsDetails = existingTickerFiles(gapTickers, "data/computed/market_facts/tickers");
  const gapGlobalScouterDetails = existingTickerFiles(gapTickers, "data/global-scouter/stocks/detail");
  const classTickerGap = gapTickers.filter((item) => item.includes("."));
  const slickSourceNotUniverse = gapWithSlickSource.filter((item) => !slickUniverseSet.has(item));
  const slickUniverseMissingFiles = slickUniverseTickers.filter((item) => !slickStockFileSet.has(item));
  const slickStockFilesOutsideUniverse = slickStockFileTickers.filter((item) => !slickUniverseSet.has(item));

  const yfOutsideS0 = yfTickers.filter((item) => !s0Set.has(item));
  const yfStockOutsideS0 = yfOutsideS0.filter((item) => stockAssetSet.has(item));
  const yfEtfOutsideS0 = yfOutsideS0.filter((item) => etfAssetSet.has(item));
  const secOutsideS0 = secTickers.filter((item) => !s0Set.has(item));
  const secStockOutsideS0 = secOutsideS0.filter((item) => stockAssetSet.has(item));
  const secEtfOutsideS0 = secOutsideS0.filter((item) => etfAssetSet.has(item));
  const secUnresolvedOutsideS0 = secOutsideS0.filter((item) => !stockAssetSet.has(item) && !etfAssetSet.has(item));
  const slickUniverseOutsideS0 = slickUniverseTickers.filter((item) => !s0Set.has(item));
  const slickUniverseOverlapS0 = setIntersectionCount(slickUniverseTickers, s0Set);
  const rawMasterOverlapS0 = setIntersectionCount(rawMasterTickerList, s0Set);
  const rawMasterOnlyNotNormalized = rawMasterTickerList
    .filter((item) => !s0Set.has(item) && !stockAssetSet.has(item) && !etfAssetSet.has(item));
  const s1JoinedGate = buildS1JoinedGate({
    gapTickers,
    marketByTicker,
    s0Set,
    etfAssetSet,
    yfSet,
    secSet,
    slickUniverseSet,
    slickStockFileSet,
    rawMasterSet,
    examples,
    full,
  });

  const hardChecks = [
    {
      id: "market_facts_asset_split",
      ok: stockRows.length + etfRows.length === marketRows.length,
      detail: `${stockRows.length}+${etfRows.length} vs ${marketRows.length}`,
    },
    {
      id: "s1_gap_formula",
      ok: gapTickers.length === stockCandidateTickers.length - s0Tickers.length,
      detail: `${gapTickers.length} vs ${stockCandidateTickers.length}-${s0Tickers.length}`,
    },
    {
      id: "s1_no_etf_leakage",
      ok: gapTickers.every((item) => !etfAssetSet.has(item)),
      detail: "S1 gap contains stock asset_type rows only",
    },
    {
      id: "class_ticker_exact_match_guard",
      ok: !gapTickers.includes("BRK.B") && classTickerGap.includes("BF.B"),
      detail: "Use ticker, not ticker_normalized, when comparing S0 to market_facts",
    },
    {
      id: "s1_joined_gate_classifies_all_gap",
      ok: s1JoinedGate.counts.total === gapTickers.length
        && s1JoinedGate.counts.joined_ready + s1JoinedGate.counts.joined_not_ready === gapTickers.length,
      detail: `${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready} vs ${gapTickers.length}`,
    },
    {
      id: "s1_joined_gate_no_etf_leakage",
      ok: s1JoinedGate.counts.etf_lane_leaks === 0,
      detail: `${s1JoinedGate.counts.etf_lane_leaks} ETF rows in S1 JOINED gate`,
    },
    {
      id: "s1_joined_gate_preserves_class_tickers",
      ok: (s1JoinedGate.examples.class_tickers ?? []).every((status) => status.ticker === "BF.B"),
      detail: `class tickers checked=${s1JoinedGate.counts.class_tickers_checked}`,
    },
  ];

  const warnings = [];
  if (marketFacts.coverage?.stock !== stockRows.length) {
    warnings.push(`market_facts.coverage.stock=${marketFacts.coverage?.stock} but rows asset_type=stock=${stockRows.length}`);
  }
  if (marketFacts.coverage?.etf !== etfRows.length) {
    warnings.push(`market_facts.coverage.etf=${marketFacts.coverage?.etf} but rows asset_type=etf=${etfRows.length}`);
  }
  if (marketFacts.coverage?.slickcharts !== slickStockFileTickers.length) {
    warnings.push(`market_facts.coverage.slickcharts=${marketFacts.coverage?.slickcharts} but slickcharts/stocks files=${slickStockFileTickers.length}`);
  }
  if (slickStockFileTickers.length !== slickUniverseTickers.length) {
    warnings.push(`SlickCharts stock files ${slickStockFileTickers.length} != index universe ${slickUniverseTickers.length}; keep these denominators separate`);
  }

  const result = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    read_only: true,
    purpose: "Audit S0/S1/S2 stock promotion candidates without changing scoring or mixing ETFs into stock coverage.",
    source_files: {
      s0: "data/computed/fenok_signals.json",
      s1: "data/computed/market_facts/index.json",
      market_facts_details: "data/computed/market_facts/tickers/*.json",
      yf: "data/yf/finance/*.json",
      sec13f: "data/sec-13f/by_ticker.json",
      slickcharts_index_universe: "data/slickcharts/universe.json",
      slickcharts_stock_files: "data/slickcharts/stocks/*.json",
      raw_company_master: "data/global-scouter/raw/company_master_m_company.json",
      coverage_index: "data/admin/fenok-edge-coverage-index.json",
    },
    completion_ladder: coverageIndex?.public_scoring_readiness?.completion_ladder
      ?? ["COLLECTED", "NORMALIZED", "JOINED", "SCORED", "PUBLIC", "DAILY", "GATED"],
    s0_active_stock_scoring: {
      stage: "PUBLIC_NOT_DAILY_GATED",
      count: s0Tickers.length,
      coverage_index_count: coverageIndex?.active_scoring_universe?.total ?? null,
      by_market_scope: countBy(signalRows, (row) => String(row.market_scope ?? "unknown")),
      caveat: "Current public-scored stock universe only; not complete/paid-ready until DAILY + GATED are proven.",
    },
    s1_stock_promotion_candidates: {
      stage: "NORMALIZED",
      market_facts_assets: marketRows.length,
      market_facts_stock_candidates: stockCandidateTickers.length,
      market_facts_etf_candidates_excluded: etfCandidateTickers.length,
      active_s0_stock_count: s0Tickers.length,
      stock_promotion_gap: gapTickers.length,
      source_mix_for_gap: countBy(gapRows, sourceKey),
      reason_counts: {
        promotable_stock_gap: gapTickers.length,
        enrichment_only_existing_s0_stock_candidates: stockCandidateTickers.length - gapTickers.length,
        unresolved_identity: 0,
        etf_lane_excluded: etfCandidateTickers.length,
      },
      gap_overlap_counts: {
        market_facts_detail_files: gapMarketFactsDetails.length,
        global_scouter_detail_files: gapGlobalScouterDetails.length,
        yf_files: gapWithYf.length,
        sec13f_by_ticker: gapWithSec.length,
        slickcharts_source_flag: gapWithSlickSource.length,
        slickcharts_index_universe: gapWithSlickUniverse.length,
        raw_company_master: gapWithRawMaster.length,
      },
      edge_cases: {
        class_tickers: classTickerGap,
        slickcharts_source_not_index_universe: slickSourceNotUniverse,
        bk_has_slickcharts_source_not_index_universe: slickSourceNotUniverse.includes("BK"),
      },
      gate_reasons: {
        promotable_stock: "asset_type=stock and outside S0; still needs identity, market/currency/country, evidence-family, scoring, public, daily, and gated checks.",
        enrichment_only: "already in S0 or source evidence that enriches existing rows without increasing scored coverage.",
        unresolved_identity: "source ticker is not mapped to stock or ETF in market_facts.",
        etf_lane_excluded: "asset_type=etf belongs to S3 and must not increase S1 stock coverage.",
      },
      joined_gate: s1JoinedGate,
      gap_tickers: full ? gapTickers : undefined,
      examples: {
        gap: sample(gapTickers, examples),
        yf_gap: sample(gapWithYf, examples),
        sec13f_gap: sample(gapWithSec, examples),
        slickcharts_source_gap: sample(gapWithSlickSource, examples),
        slickcharts_index_universe_gap: sample(gapWithSlickUniverse, examples),
        raw_master_gap: sample(gapWithRawMaster, examples),
      },
    },
    s2_stock_expansion_fuel: {
      caveat: "Fuel/enrichment assets are not one denominator and do not expand public stock scoring until promoted through S1 gates.",
      yf: {
        ticker_payloads_excluding_summary: yfTickers.length,
        overlap_s0: setIntersectionCount(yfTickers, s0Set),
        stock_not_s0: yfStockOutsideS0.length,
        etf_not_s0: yfEtfOutsideS0.length,
        unresolved_not_s0: yfOutsideS0.length - yfStockOutsideS0.length - yfEtfOutsideS0.length,
        reason_counts: {
          promotable_stock_candidate: yfStockOutsideS0.length,
          enrichment_only_existing_s0: setIntersectionCount(yfTickers, s0Set),
          etf_lane_excluded: yfEtfOutsideS0.length,
          unresolved_identity: yfOutsideS0.length - yfStockOutsideS0.length - yfEtfOutsideS0.length,
        },
        examples_stock_not_s0: sample(yfStockOutsideS0, examples),
      },
      sec13f: {
        by_ticker_keys: secTickers.length,
        overlap_s0: setIntersectionCount(secTickers, s0Set),
        stock_not_s0: secStockOutsideS0.length,
        etf_not_s0: secEtfOutsideS0.length,
        unresolved_identity_not_s0: secUnresolvedOutsideS0.length,
        reason_counts: {
          promotable_stock_candidate: secStockOutsideS0.length,
          enrichment_only_existing_s0: setIntersectionCount(secTickers, s0Set),
          etf_lane_excluded: secEtfOutsideS0.length,
          unresolved_identity: secUnresolvedOutsideS0.length,
        },
        examples_stock_not_s0: sample(secStockOutsideS0, examples),
        examples_unresolved_identity: sample(secUnresolvedOutsideS0, examples),
      },
      slickcharts: {
        index_universe: slickUniverseTickers.length,
        stock_files: slickStockFileTickers.length,
        market_facts_source_coverage: marketFacts.coverage?.slickcharts ?? null,
        index_universe_overlap_s0: slickUniverseOverlapS0,
        index_universe_stock_not_s0: slickUniverseOutsideS0.filter((item) => stockAssetSet.has(item)).length,
        reason_counts_for_index_universe: {
          promotable_stock_candidate: slickUniverseOutsideS0.filter((item) => stockAssetSet.has(item)).length,
          enrichment_only_existing_s0: slickUniverseOverlapS0,
          etf_lane_excluded: slickUniverseOutsideS0.filter((item) => etfAssetSet.has(item)).length,
          unresolved_identity: slickUniverseOutsideS0.filter((item) => !stockAssetSet.has(item) && !etfAssetSet.has(item)).length,
        },
        stock_files_outside_index_universe: slickStockFilesOutsideUniverse.length,
        index_universe_missing_stock_files: slickUniverseMissingFiles.length,
        examples_stock_files_outside_index_universe: sample(slickStockFilesOutsideUniverse, examples),
        examples_index_universe_missing_stock_files: sample(slickUniverseMissingFiles, examples),
      },
      raw_company_master: {
        records: Number(rawMaster.count) || (rawMaster.records ?? []).length,
        unique_tickers: rawMasterTickerList.length,
        overlap_s0: rawMasterOverlapS0,
        stock_gap_overlap: gapWithRawMaster.length,
        reason_counts: {
          promotable_stock_candidate_overlap: gapWithRawMaster.length,
          enrichment_only_existing_s0: rawMasterOverlapS0,
          raw_only_not_normalized_stock_candidate: rawMasterOnlyNotNormalized.length,
          etf_lane_excluded: rawMasterTickerList.filter((item) => etfAssetSet.has(item)).length,
          unresolved_identity: 0,
        },
        examples_raw_only_not_normalized: sample(rawMasterOnlyNotNormalized, examples),
        stage: "COLLECTED_FUEL_ONLY",
      },
    },
    s3_etf_lane_excluded_from_stock_promotion: {
      market_facts_etf_candidates: etfCandidateTickers.length,
      stockanalysis_etf_records: stockanalysisIndex?.counts?.etf_universe ?? null,
      stockanalysis_etf_candidate_total: stockanalysisIndex?.counts?.etf_candidate_total ?? null,
      scored_public_etf: coverageIndex?.etf_universe?.scored_public_etf ?? 0,
      caveat: "ETF data is a separate lane. Do not mix these rows into S1 stock promotion.",
    },
    checks: hardChecks,
    ok: hardChecks.every((check) => check.ok),
    warning_count: warnings.length,
    warnings,
  };

  return result;
}

function printHuman(result) {
  console.log(`Fenok stock promotion audit: ${result.ok ? "PASS" : "FAIL"} (read-only)`);
  console.log(`S0 active stock scoring: ${result.s0_active_stock_scoring.count} (${result.s0_active_stock_scoring.stage})`);
  console.log(`S1 market_facts stock candidates: ${result.s1_stock_promotion_candidates.market_facts_stock_candidates}`);
  console.log(`S1 promotion gap: ${result.s1_stock_promotion_candidates.stock_promotion_gap}`);
  console.log(`S1 gap source mix: ${JSON.stringify(result.s1_stock_promotion_candidates.source_mix_for_gap)}`);
  console.log(`S1 reason counts: ${JSON.stringify(result.s1_stock_promotion_candidates.reason_counts)}`);
  console.log(`S1 gap overlaps: ${JSON.stringify(result.s1_stock_promotion_candidates.gap_overlap_counts)}`);
  console.log(`S1 JOINED gate counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.counts)}`);
  console.log(`S1 JOINED blockers: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.blocker_counts)}`);
  console.log(
    `S2 fuel: YF=${result.s2_stock_expansion_fuel.yf.ticker_payloads_excluding_summary}, `
    + `SEC13F=${result.s2_stock_expansion_fuel.sec13f.by_ticker_keys}, `
    + `SlickCharts universe=${result.s2_stock_expansion_fuel.slickcharts.index_universe}, `
    + `SlickCharts stock_files=${result.s2_stock_expansion_fuel.slickcharts.stock_files}, `
    + `raw_master=${result.s2_stock_expansion_fuel.raw_company_master.records}`,
  );
  console.log(
    `S3 ETF lane excluded: market_facts_etf=${result.s3_etf_lane_excluded_from_stock_promotion.market_facts_etf_candidates}, `
    + `stockanalysis_records=${result.s3_etf_lane_excluded_from_stock_promotion.stockanalysis_etf_records}, `
    + `stockanalysis_candidate_total=${result.s3_etf_lane_excluded_from_stock_promotion.stockanalysis_etf_candidate_total}, `
    + `scored_public_etf=${result.s3_etf_lane_excluded_from_stock_promotion.scored_public_etf}`,
  );
  console.log(`Edge class tickers in gap: ${result.s1_stock_promotion_candidates.edge_cases.class_tickers.join(", ") || "none"}`);
  console.log(`SlickCharts source not index-universe: ${result.s1_stock_promotion_candidates.edge_cases.slickcharts_source_not_index_universe.join(", ") || "none"}`);
  console.log(`Examples gap: ${result.s1_stock_promotion_candidates.examples.gap.join(", ")}`);
  for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  for (const check of result.checks) {
    if (!check.ok) console.error(`ERROR: ${check.id}: ${check.detail}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const audit = buildAudit(args);
if (args.json) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
else printHuman(audit);

process.exitCode = args.check && !audit.ok ? 1 : 0;
