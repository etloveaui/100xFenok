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

const SCHEMA_VERSION = "fenok-stock-promotion-candidates-audit/v0.3";
const PROMOTION_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-promotion-artifact/v0.1";
const SCORING_CONTRACT_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-scoring-contract-artifact/v0.1";
const DEFAULT_EXAMPLE_LIMIT = 12;
const JOINED_MIN_EVIDENCE_FAMILIES = 3;
const PROMOTION_FACT_KEYS = [
  "price",
  "previous_close",
  "market_cap",
  "trailing_pe",
  "forward_pe",
  "dividend_yield",
  "beta",
  "return_1m",
  "return_3m",
  "return_ytd",
  "return_1y",
];
const S1_SCORING_OUTPUT_FIELDS = [
  "action_score",
  "signal_score",
  "coverage_ratio",
  "confidence_label",
  "action_bucket",
  "action_label",
  "action_reasons",
  "families",
];
const SCORING_INPUT_LABELS = {
  global_scouter_core_row: "global-scouter core stock row",
  global_scouter_detail_file: "global-scouter detail estimates",
  stockanalysis_financials_file: "StockAnalysis financials",
  revision_movers: "revision movers",
  yf_quarter_closes: "YF quarter closes",
  slickcharts_returns: "SlickCharts returns",
  slickcharts_dividends: "SlickCharts dividends",
  sec13f_guru_holders: "13F guru holders",
  sec13f_enhanced_consensus: "13F enhanced consensus",
};
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
    promotionReport: false,
    scoringContractReport: false,
    examples: DEFAULT_EXAMPLE_LIMIT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--full") args.full = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--promotion-report") args.promotionReport = true;
    else if (arg === "--scoring-contract-report") args.scoringContractReport = true;
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

  if (args.promotionReport && args.scoringContractReport) {
    throw new Error("Use only one of --promotion-report or --scoring-contract-report");
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

function rowTickerSet(rows, field = "ticker") {
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => ticker(row?.[field]))
    .filter(Boolean));
}

function objectTickerSet(payload, key) {
  const block = key ? payload?.[key] : payload;
  if (!block || typeof block !== "object" || Array.isArray(block)) return new Set();
  return new Set(Object.keys(block).map(ticker).filter(Boolean));
}

function revisionTickerSet(payload) {
  return rowTickerSet([...(payload?.up ?? []), ...(payload?.down ?? [])]);
}

function factSnapshot(detail, key) {
  const fact = detail?.facts?.[key];
  return {
    value: fact?.value ?? null,
    source: fact?.source ?? null,
    as_of: fact?.as_of ?? null,
    fetched_at: fact?.fetched_at ?? null,
    confidence: fact?.confidence ?? null,
  };
}

function factSnapshots(detail) {
  return Object.fromEntries(PROMOTION_FACT_KEYS.map((key) => [key, factSnapshot(detail, key)]));
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

function scoringInputPresence(item, context) {
  return {
    global_scouter_core_row: context.globalScouterCoreSet.has(item),
    global_scouter_detail_file: context.globalScouterDetailSet.has(item),
    stockanalysis_financials_file: context.stockanalysisFinancialsSet.has(item),
    revision_movers: context.revisionSet.has(item),
    yf_quarter_closes: context.quarterCloseSet.has(item),
    slickcharts_returns: context.slickReturnsSet.has(item),
    slickcharts_dividends: context.slickDividendsSet.has(item),
    sec13f_guru_holders: context.guruHoldersSet.has(item),
    sec13f_enhanced_consensus: context.enhancedConsensusSet.has(item),
  };
}

function missingScoringAxes(inputs) {
  return Object.entries(inputs)
    .filter(([, present]) => !present)
    .map(([key]) => ({
      key,
      label: SCORING_INPUT_LABELS[key] ?? key,
      value: null,
      display: "미확인",
    }));
}

function promotionCandidateRow(status, context) {
  const item = status.ticker;
  const row = context.marketByTicker.get(item);
  const detail = readJsonOrNull(path.join("data/computed/market_facts/tickers", `${item}.json`));
  const identity = detail?.identity ?? {};
  const scoreInputs = scoringInputPresence(item, context);
  const missingAxes = missingScoringAxes(scoreInputs);
  const joinedReady = status.status === "joined_ready";

  return {
    ticker: item,
    asset_type: row?.asset_type ?? null,
    promotion_status: joinedReady ? "s1_joined_ready_staging" : "blocked_before_joined",
    stage: status.stage,
    claim_scope: joinedReady
      ? "S1 JOINED_READY staging only; not S0 scored/public/daily/gated."
      : "Blocked before S1 JOINED_READY; do not score or promote.",
    can_enter_s1_promotion_artifact: joinedReady,
    can_enter_scored_public_s0: false,
    blockers: status.blockers,
    evidence_family_count: status.evidence_family_count,
    evidence_families: status.evidence_families,
    identity: {
      name: identity.name ?? row?.name ?? item,
      exchange: identity.exchange ?? null,
      currency: identity.currency ?? null,
      country_scope: status.country_scope ?? null,
      sector: identity.sector ?? null,
      industry: identity.industry ?? null,
    },
    observed_facts: factSnapshots(detail),
    source_files: detail?.source_files ?? {},
    score_input_presence: scoreInputs,
    missing_scoring_axes: missingAxes,
    score_preview: {
      action_score: null,
      signal_score: null,
      coverage_ratio: null,
      action_bucket: null,
      action_label: "미확인",
      reason: joinedReady
        ? "Joined-ready evidence is present, but the S0 stock_action scoring contract has not been expanded for this row."
        : "Joined gate blockers must be cleared before scoring input work.",
    },
  };
}

function buildS1PromotionArtifact(statuses, context) {
  const readyStatuses = statuses.filter((status) => status.status === "joined_ready");
  const blockedStatuses = statuses.filter((status) => status.status === "joined_not_ready");
  const readyRows = readyStatuses.map((status) => promotionCandidateRow(status, context));
  const blockedRows = blockedStatuses.map((status) => promotionCandidateRow(status, context));
  const allRows = [...readyRows, ...blockedRows];
  const fakeScoreRows = allRows.filter((row) => Object.values(row.score_preview).some((value) => typeof value === "number")).length;
  const etfRows = allRows.filter((row) => row.asset_type === "etf").length;
  const nonStockRows = allRows.filter((row) => row.asset_type !== "stock").length;

  return {
    schema_version: PROMOTION_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_audit_schema_version: SCHEMA_VERSION,
    purpose: "Stage JOINED_READY S1 stock candidates for explicit future scoring-contract work without mutating S0 public rows.",
    contract: {
      source_gate: "s1_stock_promotion_candidates.joined_gate",
      include_rows: "joined_ready only for ready_rows; joined_not_ready retained separately with blockers.",
      excluded_rows: "ETF asset_type rows and S0 existing rows.",
      public_s0_mutation: false,
      scoring_enabled: false,
      missing_value_policy: "No placeholders. Missing scoring axes remain null / 미확인.",
    },
    counts: {
      public_s0_before: context.s0Set.size,
      public_s0_after_this_artifact: context.s0Set.size,
      staged_if_ready_rows_are_later_promoted: context.s0Set.size + readyRows.length,
      s1_gap_total: statuses.length,
      joined_ready: readyRows.length,
      joined_not_ready: blockedRows.length,
      etf_rows: etfRows,
      non_stock_rows: nonStockRows,
      fake_score_rows: fakeScoreRows,
    },
    blocker_counts: countBlockers(statuses),
    next_required_for_scored_public_promotion: [
      "Define an explicit S1 scoring contract instead of injecting market_facts rows into stock_action_index by default.",
      "Backfill or map missing global-scouter/financial/revision axes per ticker; keep absent values null.",
      "Run opt-in scoring in a non-public lane first, then compare S0 row counts before enabling public output.",
    ],
    ready_rows: readyRows,
    blocked_rows: blockedRows,
  };
}

function buildS1ScoringContractRow(status, context) {
  const base = promotionCandidateRow(status, context);
  const sourceContract = context.stockActionIndex?.score_contract ?? {};
  return {
    ticker: base.ticker,
    asset_type: base.asset_type,
    contract_status: "s1_scoring_contract_ready_not_scored",
    source_stage: base.stage,
    claim_scope: "Non-public S1 scoring-contract artifact only; not scored, not S0, not public, not daily, not gated.",
    eligibility: {
      joined_ready: true,
      outside_s0: status.checks?.outside_s0 === true,
      etf_lane_excluded: status.checks?.etf_lane_excluded === true,
      exact_ticker_contract: status.checks?.exact_ticker_contract === true,
      minimum_evidence_families: JOINED_MIN_EVIDENCE_FAMILIES,
      observed_evidence_family_count: status.evidence_family_count,
    },
    identity: base.identity,
    observed_facts: base.observed_facts,
    source_files: base.source_files,
    score_input_presence: base.score_input_presence,
    missing_scoring_axes: base.missing_scoring_axes,
    scoring_contract_reference: {
      source_contract_version: sourceContract.version ?? null,
      source_contract_doc: sourceContract.doc ?? null,
      allowed_output_fields: S1_SCORING_OUTPUT_FIELDS,
      missing_value_policy: "Null only. No placeholder or inferred score values.",
    },
    score_outputs: Object.fromEntries(S1_SCORING_OUTPUT_FIELDS.map((field) => [field, null])),
  };
}

function buildS1ScoringContractArtifact(statuses, context) {
  const readyStatuses = statuses.filter((status) => status.status === "joined_ready");
  const blockedStatuses = statuses.filter((status) => status.status === "joined_not_ready");
  const contractRows = readyStatuses.map((status) => buildS1ScoringContractRow(status, context));
  const numericScoreRows = contractRows.filter((row) => Object.values(row.score_outputs).some((value) => typeof value === "number")).length;
  const etfRows = contractRows.filter((row) => row.asset_type === "etf").length;
  const nonStockRows = contractRows.filter((row) => row.asset_type !== "stock").length;
  const s0OverlapRows = contractRows.filter((row) => context.s0Set.has(row.ticker)).length;
  const disallowedClaims = {
    scored_public_s0: false,
    public: false,
    daily: false,
    gated: false,
    etf_lane: false,
  };
  const counts = {
    public_s0_before: context.s0Set.size,
    public_s0_after_this_artifact: context.s0Set.size,
    s1_gap_total: statuses.length,
    joined_ready_contract_rows: contractRows.length,
    joined_not_ready_excluded: blockedStatuses.length,
    etf_rows: etfRows,
    non_stock_rows: nonStockRows,
    s0_overlap_rows: s0OverlapRows,
    actual_scored_rows: numericScoreRows,
    fake_score_rows: numericScoreRows,
    files_written: 0,
    public_files_written: 0,
  };
  const acceptanceChecks = [
    {
      id: "s1_scoring_contract_counts_match_gate",
      ok: counts.joined_ready_contract_rows === readyStatuses.length
        && counts.joined_not_ready_excluded === blockedStatuses.length,
      detail: `${counts.joined_ready_contract_rows}+${counts.joined_not_ready_excluded} vs ${readyStatuses.length}+${blockedStatuses.length}`,
    },
    {
      id: "s1_scoring_contract_preserves_s0_count",
      ok: counts.public_s0_before === context.s0Set.size
        && counts.public_s0_after_this_artifact === context.s0Set.size
        && counts.s0_overlap_rows === 0,
      detail: `${counts.public_s0_before}->${counts.public_s0_after_this_artifact}, s0_overlap_rows=${counts.s0_overlap_rows}`,
    },
    {
      id: "s1_scoring_contract_no_etf_or_non_stock_rows",
      ok: counts.etf_rows === 0 && counts.non_stock_rows === 0,
      detail: `etf_rows=${counts.etf_rows}, non_stock_rows=${counts.non_stock_rows}`,
    },
    {
      id: "s1_scoring_contract_no_fake_scores",
      ok: counts.fake_score_rows === 0 && counts.actual_scored_rows === 0,
      detail: `fake_score_rows=${counts.fake_score_rows}, actual_scored_rows=${counts.actual_scored_rows}`,
    },
    {
      id: "s1_scoring_contract_no_public_daily_gated_claim",
      ok: Object.values(disallowedClaims).every((value) => value === false),
      detail: JSON.stringify(disallowedClaims),
    },
    {
      id: "s1_scoring_contract_stdout_only_no_writes",
      ok: counts.files_written === 0 && counts.public_files_written === 0,
      detail: `files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
  ];

  return {
    schema_version: SCORING_CONTRACT_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_audit_schema_version: SCHEMA_VERSION,
    purpose: "Define an opt-in, non-public S1 scoring contract for JOINED_READY stock candidates without computing scores or mutating S0 public rows.",
    file_plan: {
      implementation_file: "scripts/audit-fenok-stock-promotion-candidates.mjs",
      artifact_delivery: "stdout_only",
      command: "node scripts/audit-fenok-stock-promotion-candidates.mjs --scoring-contract-report --check",
      files_written: [],
      public_files_written: [],
      excluded_paths: [
        "data/computed/stock_action_index.json",
        "data/computed/fenok_signals.json",
        "100xfenok-next/public/data/computed/fenok_signals.json",
        "100xfenok-next/public/data/computed/fenok_signals_summary.json",
      ],
    },
    contract: {
      source_gate: "s1_stock_promotion_candidates.joined_gate",
      include_rows: "joined_ready only; joined_not_ready rows are blocker-only exclusions.",
      scoring_enabled: false,
      public_s0_mutation: false,
      output_mode: "non_public_contract_artifact",
      source_score_contract_version: context.stockActionIndex?.score_contract?.version ?? null,
      source_score_contract_doc: context.stockActionIndex?.score_contract?.doc ?? null,
      missing_value_policy: "Keep absent axes and score outputs null. Do not synthesize scores.",
      disallowed_claims: disallowedClaims,
    },
    counts,
    blocker_counts: countBlockers(statuses),
    acceptance_checks: acceptanceChecks,
    contract_rows: contractRows,
    excluded_blocked_rows: blockedStatuses.map(joinedStatusSummary),
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
  promotionContext = null,
  scoringContractContext = null,
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

  const result = {
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

  if (promotionContext) {
    result.promotion_artifact = buildS1PromotionArtifact(statuses, promotionContext);
  }
  if (scoringContractContext) {
    result.scoring_contract_artifact = buildS1ScoringContractArtifact(statuses, scoringContractContext);
  }

  return result;
}

function buildAudit({
  examples = DEFAULT_EXAMPLE_LIMIT,
  full = false,
  promotionReport = false,
  scoringContractReport = false,
} = {}) {
  const signals = readJson("data/computed/fenok_signals.json");
  const stockActionIndex = scoringContractReport ? readJson("data/computed/stock_action_index.json") : null;
  const marketFacts = readJson("data/computed/market_facts/index.json");
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json");
  const slickUniverse = readJson("data/slickcharts/universe.json");
  const sec13f = readJson("data/sec-13f/by_ticker.json");
  const rawMaster = readJson("data/global-scouter/raw/company_master_m_company.json");
  const stockanalysisIndex = readJsonOrNull("data/stockanalysis/index.json");
  const globalScouterStocks = readJsonOrNull("data/global-scouter/core/stocks_analyzer.json");
  const revisions = readJsonOrNull("data/global-scouter/core/revision_movers.json");
  const quarterCloses = readJsonOrNull("data/yf/quarter_closes.json");
  const slickReturns = readJsonOrNull("data/slickcharts/stocks-returns.json");
  const slickDividends = readJsonOrNull("data/slickcharts/stocks-dividends.json");
  const guruHolders = readJsonOrNull("data/sec-13f/analytics/guru_holders_index.json");
  const enhancedConsensus = readJsonOrNull("data/sec-13f/analytics/enhanced_consensus.json");

  const signalRows = Array.isArray(signals.rows) ? signals.rows : [];
  const marketRows = Array.isArray(marketFacts.rows) ? marketFacts.rows : [];
  const marketByTicker = byTickerRows(marketRows);
  const s0Tickers = unique(signalRows.map((row) => ticker(row.ticker)));
  const s0Set = new Set(s0Tickers);
  const globalScouterCoreSet = rowTickerSet(globalScouterStocks?.data ?? [], "symbol");
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
  const globalScouterDetailSet = new Set(listJsonTickers("data/global-scouter/stocks/detail"));
  const stockanalysisFinancialsSet = new Set(listJsonTickers("data/stockanalysis/financials"));
  const revisionSet = revisionTickerSet(revisions);
  const quarterCloseSet = objectTickerSet(quarterCloses, "tickers");
  const slickReturnsSet = rowTickerSet(slickReturns?.stocks ?? [], "symbol");
  const slickDividendsSet = rowTickerSet(slickDividends?.stocks ?? [], "symbol");
  const guruHoldersSet = objectTickerSet(guruHolders, "holders");
  const enhancedConsensusSet = objectTickerSet(enhancedConsensus, "enhanced_consensus");

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
    promotionContext: promotionReport
      ? {
          marketByTicker,
          s0Set,
          globalScouterCoreSet,
          globalScouterDetailSet,
          stockanalysisFinancialsSet,
          revisionSet,
          quarterCloseSet,
          slickReturnsSet,
          slickDividendsSet,
          guruHoldersSet,
          enhancedConsensusSet,
        }
      : null,
    scoringContractContext: scoringContractReport
      ? {
          marketByTicker,
          s0Set,
          stockActionIndex,
          globalScouterCoreSet,
          globalScouterDetailSet,
          stockanalysisFinancialsSet,
          revisionSet,
          quarterCloseSet,
          slickReturnsSet,
          slickDividendsSet,
          guruHoldersSet,
          enhancedConsensusSet,
        }
      : null,
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

  if (promotionReport) {
    const artifact = s1JoinedGate.promotion_artifact;
    hardChecks.push(
      {
        id: "s1_promotion_artifact_counts_match_gate",
        ok: artifact?.counts?.joined_ready === s1JoinedGate.counts.joined_ready
          && artifact?.counts?.joined_not_ready === s1JoinedGate.counts.joined_not_ready,
        detail: `${artifact?.counts?.joined_ready}+${artifact?.counts?.joined_not_ready} vs ${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready}`,
      },
      {
        id: "s1_promotion_artifact_no_etf_rows",
        ok: artifact?.counts?.etf_rows === 0 && artifact?.counts?.non_stock_rows === 0,
        detail: `etf_rows=${artifact?.counts?.etf_rows}, non_stock_rows=${artifact?.counts?.non_stock_rows}`,
      },
      {
        id: "s1_promotion_artifact_no_fake_scores",
        ok: artifact?.counts?.fake_score_rows === 0,
        detail: `fake_score_rows=${artifact?.counts?.fake_score_rows}`,
      },
      {
        id: "s1_promotion_artifact_preserves_s0_count",
        ok: artifact?.counts?.public_s0_before === s0Tickers.length
          && artifact?.counts?.public_s0_after_this_artifact === s0Tickers.length,
        detail: `${artifact?.counts?.public_s0_before}->${artifact?.counts?.public_s0_after_this_artifact}, s0=${s0Tickers.length}`,
      },
    );
  }
  if (scoringContractReport) {
    const artifact = s1JoinedGate.scoring_contract_artifact;
    hardChecks.push(
      {
        id: "s1_scoring_contract_counts_match_gate",
        ok: artifact?.counts?.joined_ready_contract_rows === s1JoinedGate.counts.joined_ready
          && artifact?.counts?.joined_not_ready_excluded === s1JoinedGate.counts.joined_not_ready,
        detail: `${artifact?.counts?.joined_ready_contract_rows}+${artifact?.counts?.joined_not_ready_excluded} vs ${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready}`,
      },
      {
        id: "s1_scoring_contract_no_etf_rows",
        ok: artifact?.counts?.etf_rows === 0 && artifact?.counts?.non_stock_rows === 0,
        detail: `etf_rows=${artifact?.counts?.etf_rows}, non_stock_rows=${artifact?.counts?.non_stock_rows}`,
      },
      {
        id: "s1_scoring_contract_no_fake_scores",
        ok: artifact?.counts?.fake_score_rows === 0 && artifact?.counts?.actual_scored_rows === 0,
        detail: `fake_score_rows=${artifact?.counts?.fake_score_rows}, actual_scored_rows=${artifact?.counts?.actual_scored_rows}`,
      },
      {
        id: "s1_scoring_contract_preserves_s0_count",
        ok: artifact?.counts?.public_s0_before === s0Tickers.length
          && artifact?.counts?.public_s0_after_this_artifact === s0Tickers.length
          && artifact?.counts?.s0_overlap_rows === 0,
        detail: `${artifact?.counts?.public_s0_before}->${artifact?.counts?.public_s0_after_this_artifact}, s0_overlap_rows=${artifact?.counts?.s0_overlap_rows}`,
      },
      {
        id: "s1_scoring_contract_no_public_daily_gated_claim",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_scoring_contract_no_public_daily_gated_claim")?.ok === true,
        detail: JSON.stringify(artifact?.contract?.disallowed_claims ?? null),
      },
      {
        id: "s1_scoring_contract_stdout_only_no_writes",
        ok: artifact?.counts?.files_written === 0 && artifact?.counts?.public_files_written === 0,
        detail: `files_written=${artifact?.counts?.files_written}, public_files_written=${artifact?.counts?.public_files_written}`,
      },
    );
  }

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
  if (result.s1_stock_promotion_candidates.joined_gate.promotion_artifact) {
    console.log(`S1 promotion report counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.promotion_artifact.counts)}`);
  }
  if (result.s1_stock_promotion_candidates.joined_gate.scoring_contract_artifact) {
    console.log(`S1 scoring contract report counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.scoring_contract_artifact.counts)}`);
  }
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
if (args.scoringContractReport) {
  process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.scoring_contract_artifact, null, 2)}\n`);
} else if (args.promotionReport) {
  process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.promotion_artifact, null, 2)}\n`);
} else if (args.json) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
else printHuman(audit);

process.exitCode = args.check && !audit.ok ? 1 : 0;
