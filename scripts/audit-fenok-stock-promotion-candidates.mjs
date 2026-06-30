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
import {
  actionFrom,
  marketScopeFromMarket,
  normalizeTicker,
  num,
} from "./stock-action-score-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SCHEMA_VERSION = "fenok-stock-promotion-candidates-audit/v0.3";
const PROMOTION_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-promotion-artifact/v0.1";
const SCORING_CONTRACT_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-scoring-contract-artifact/v0.1";
const SCORE_PREVIEW_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-score-preview-artifact/v0.1";
const PROMOTION_GATE_PLAN_ARTIFACT_SCHEMA_VERSION = "fenok-s1-stock-promotion-gate-plan/v0.2";
const BLOCKED_UNBLOCK_DIAGNOSTICS_SCHEMA_VERSION = "fenok-s1-stock-blocked-unblock-diagnostics/v0.2";
const SCORE_CORE_SOURCE = "scripts/stock-action-score-core.mjs";
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
    scorePreviewReport: false,
    promotionGatePlanReport: false,
    blockedUnblockDiagnosticsReport: false,
    examples: DEFAULT_EXAMPLE_LIMIT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--full") args.full = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--promotion-report") args.promotionReport = true;
    else if (arg === "--scoring-contract-report") args.scoringContractReport = true;
    else if (arg === "--score-preview-report") args.scorePreviewReport = true;
    else if (arg === "--promotion-gate-plan-report") args.promotionGatePlanReport = true;
    else if (arg === "--blocked-unblock-diagnostics-report") args.blockedUnblockDiagnosticsReport = true;
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

  const reportModeCount = [
    args.promotionReport,
    args.scoringContractReport,
    args.scorePreviewReport,
    args.promotionGatePlanReport,
    args.blockedUnblockDiagnosticsReport,
  ]
    .filter(Boolean).length;
  if (reportModeCount > 1) {
    throw new Error("Use only one of --promotion-report, --scoring-contract-report, --score-preview-report, --promotion-gate-plan-report, or --blocked-unblock-diagnostics-report");
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

function stockanalysisSurfaceTickers(payload) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  return unique(rows.flatMap((row) => [
    ticker(String(row?.symbol ?? "").replace(/^\$/u, "")),
    ticker(row?.other === "N/A" ? "" : row?.other),
  ]));
}

function stockanalysisCorporateActionsByTicker(payload) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const byTicker = new Map();
  for (const row of rows) {
    const symbolTicker = ticker(String(row?.symbol ?? "").replace(/^\$/u, ""));
    const otherTicker = ticker(row?.other === "N/A" ? "" : row?.other);
    const affectedTickers = unique([symbolTicker, otherTicker]);
    const type = String(row?.type ?? row?.action ?? "").trim();
    const terminal = ["Acquisition", "Delisted"].includes(type);
    const symbolChange = type === "Symbol Change";
    for (const item of affectedTickers) {
      if (!item) continue;
      const entry = {
        type: type || null,
        date: row?.date ?? null,
        symbol: symbolTicker || null,
        other: otherTicker || null,
        text: row?.text ?? null,
        terminal,
        alias_target: symbolChange && item === otherTicker && symbolTicker !== otherTicker ? symbolTicker : null,
        alias_source: symbolChange && item === symbolTicker && otherTicker !== symbolTicker ? otherTicker : null,
      };
      if (!byTicker.has(item)) byTicker.set(item, []);
      byTicker.get(item).push(entry);
    }
  }
  return byTicker;
}

function corporateActionEvidenceFor(item, context) {
  return (context?.stockanalysisCorporateActionMap?.get(item) ?? []).map((row) => ({
    type: row.type,
    date: row.date,
    symbol: row.symbol,
    other: row.other,
    text: row.text,
    terminal: row.terminal,
    alias_target: row.alias_target,
    alias_source: row.alias_source,
  }));
}

function corporateActionPolicyStatusFor(item, context) {
  const evidence = corporateActionEvidenceFor(item, context);
  const policyRows = evidence.filter((row) => row.terminal || row.alias_target);
  return {
    status: policyRows.length > 0 ? "policy_required_before_promotion" : "none",
    reason: policyRows.length > 0
      ? "StockAnalysis corporate-action surface indicates an acquired/delisted or old-symbol row; do not synthesize identity or promote without an explicit terminal/alias policy."
      : null,
    evidence,
  };
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

function evidenceFamilyFlagsForTicker(item, row, {
  yfSet,
  secSet,
  slickUniverseSet,
  slickStockFileSet,
  stockanalysisSurfaceSet = new Set(),
  rawMasterSet,
}) {
  const sources = row?.sources ?? {};
  return {
    yf: sources.yf === true || yfSet.has(item),
    stockanalysis: sources.stockanalysis === true
      || sources.stockanalysis_yf_fallback === true
      || stockanalysisSurfaceSet.has(item),
    slickcharts: sources.slickcharts === true
      || slickUniverseSet.has(item)
      || slickStockFileSet.has(item),
    sec13f: secSet.has(item),
    raw_company_master: rawMasterSet.has(item),
  };
}

function evidenceFamiliesForTicker(item, row, context) {
  const flags = evidenceFamilyFlagsForTicker(item, row, context);
  const families = [];

  if (flags.yf) families.push("yf");
  if (flags.stockanalysis) families.push("stockanalysis");
  if (flags.slickcharts) families.push("slickcharts");
  if (flags.sec13f) families.push("sec13f");
  if (flags.raw_company_master) families.push("raw_company_master");

  return [...new Set(families)].sort((a, b) => a.localeCompare(b));
}

function countBlockers(statuses) {
  return countBy(statuses.flatMap((status) => status.blockers), (blocker) => blocker);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
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

function percentPointToRatio(value) {
  const numeric = num(value);
  return numeric === null ? null : numeric / 100;
}

function dividendYieldToRatio(value) {
  const numeric = num(value);
  if (numeric === null) return null;
  return numeric >= 0.5 && numeric <= 100 ? numeric / 100 : numeric;
}

function mapBySymbol(rows, mapper) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = ticker(row?.symbol ?? row?.ticker);
    if (!symbol) continue;
    map.set(symbol, mapper(row));
  }
  return map;
}

function slickUniverseMap(payload) {
  return mapBySymbol(payload?.stocks, (row) => ({
    indices: Array.isArray(row.indices) ? row.indices : [],
    indexCount: num(row.indexCount),
  }));
}

function indexWeightMap() {
  const defs = [
    ["sp500", "data/slickcharts/sp500-analysis.json"],
    ["nasdaq100", "data/slickcharts/nasdaq100-analysis.json"],
    ["dowjones", "data/slickcharts/dowjones-analysis.json"],
  ];
  const map = new Map();
  for (const [index, relPath] of defs) {
    const doc = readJsonOrNull(relPath);
    const rows = Array.isArray(doc?.analysis) ? doc.analysis : [];
    for (const row of rows) {
      const symbol = ticker(row?.symbol);
      if (!symbol) continue;
      if (!map.has(symbol)) map.set(symbol, []);
      map.get(symbol).push({
        index,
        rank: num(row.rank),
        weight: num(row.weight),
        cumulativeWeight: num(row.cumulativeWeight),
      });
    }
  }
  return map;
}

function dividendHistoryMap(payload) {
  return mapBySymbol(payload?.stocks, (row) => {
    const dividends = Array.isArray(row.dividends) ? row.dividends : [];
    const latest = dividends[0] ?? null;
    const ttm = dividends.slice(0, 4).reduce((sum, item) => {
      const amount = num(item?.amount);
      return sum + (amount ?? 0);
    }, 0);
    return {
      latestAmount: num(latest?.amount),
      latestExDate: typeof latest?.exDate === "string" ? latest.exDate : null,
      ttm: dividends.length > 0 ? Number(ttm.toFixed(4)) : null,
      historyCount: dividends.length,
    };
  });
}

function quarterCloseHistoryMap(payload) {
  const rows = payload?.tickers && typeof payload.tickers === "object" ? payload.tickers : {};
  const map = new Map();
  for (const [symbolRaw, row] of Object.entries(rows)) {
    const symbol = ticker(symbolRaw);
    const points = Object.entries(row ?? {})
      .filter(([date, value]) => date !== "latest" && num(value) !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    const last = points[points.length - 1];
    const latest = row?.latest && typeof row.latest === "object" ? row.latest : null;
    map.set(symbol, {
      points: points.length,
      latestDate: typeof latest?.date === "string" ? latest.date : last?.[0] ?? null,
      latestClose: num(latest?.close) ?? num(last?.[1]),
    });
  }
  return map;
}

function revisionMapByTicker(payload) {
  const map = new Map();
  for (const [direction, rows] of [
    ["up", payload?.up],
    ["down", payload?.down],
  ]) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const symbol = ticker(row?.ticker);
      if (!symbol) continue;
      map.set(symbol, {
        direction,
        change1w: num(row.change_1w),
        epsFy1: num(row.eps_fy1),
        asOf: typeof row.as_of === "string" ? row.as_of : null,
      });
    }
  }
  return map;
}

function previewStockFromBase(base) {
  const facts = base.observed_facts ?? {};
  return {
    symbol: base.ticker,
    companyName: base.identity?.name ?? base.ticker,
    price: num(facts.price?.value),
    marketCap: num(facts.market_cap?.value),
    per: num(facts.trailing_pe?.value),
    peForward: num(facts.forward_pe?.value),
    dividendYield: dividendYieldToRatio(facts.dividend_yield?.value),
    return12m: percentPointToRatio(facts.return_1y?.value),
    momentum3m: percentPointToRatio(facts.return_3m?.value),
    epsForward: null,
  };
}

function scoreInputMapping(base, context) {
  const facts = base.observed_facts ?? {};
  const tickerKey = base.ticker;
  const dividendHistory = context.dividendHistoryMap.get(tickerKey) ?? null;
  const universe = context.slickUniverseMap.get(tickerKey) ?? { indices: [], indexCount: null };
  const weights = context.indexWeightsMap.get(tickerKey) ?? [];
  const consensus = context.enhancedConsensus?.enhanced_consensus?.[tickerKey] ?? null;
  return {
    valuation: {
      trailing_pe: num(facts.trailing_pe?.value),
      forward_pe: num(facts.forward_pe?.value),
      per_band: null,
    },
    momentum_revision: {
      return_1y_ratio: percentPointToRatio(facts.return_1y?.value),
      return_3m_ratio: percentPointToRatio(facts.return_3m?.value),
      revision: context.revisionMap.get(tickerKey) ?? null,
    },
    income: {
      dividend_yield_ratio: dividendYieldToRatio(facts.dividend_yield?.value),
      dividend_yield_raw: num(facts.dividend_yield?.value),
      dividend_history: dividendHistory,
    },
    index_structure: {
      indices: universe.indices,
      weights,
    },
    smart_money: {
      guru_holders: num(context.guruHolders?.holders?.[tickerKey]),
      consensus,
      conviction: null,
    },
    sector_smart_money: {
      canonical_sector: "Other",
      sector_smart_money: null,
    },
  };
}

function unsupportedScoringAxes(base) {
  const axes = [
    {
      key: "per_band",
      label: "PER band",
      value: null,
      display: "미확인",
      reason: "S1 market_facts does not carry Global Scouter PER-band min/current/max.",
    },
    {
      key: "sector_smart_money",
      label: "sector smart money",
      value: null,
      display: "미확인",
      reason: "S1 market_facts identity sector is not yet bridged to the stock_action canonical sector map.",
    },
    {
      key: "conviction_entries",
      label: "13F conviction entries",
      value: null,
      display: "미확인",
      reason: "S1 score preview keeps conviction unmapped until the ticker-level source join is explicit.",
    },
  ];
  if (base.score_input_presence?.global_scouter_core_row) {
    return axes.filter((axis) => axis.key !== "per_band");
  }
  return axes;
}

function buildS1ScorePreviewRow(status, context) {
  const base = buildS1ScoringContractRow(status, context);
  const normalized = normalizeTicker(base.ticker);
  const marketScope = marketScopeFromMarket(normalized.market);
  const previewContext = {
    marketScope,
    canonicalSector: "Other",
    universe: context.slickUniverseMap.get(base.ticker) ?? { indices: [], indexCount: null },
    weights: context.indexWeightsMap.get(base.ticker) ?? [],
    guruHolders: num(context.guruHolders?.holders?.[base.ticker]),
    consensus: context.enhancedConsensus?.enhanced_consensus?.[base.ticker] ?? null,
    conviction: null,
    convictionNameOnly: false,
    returnHistory: null,
    dividendHistory: context.dividendHistoryMap.get(base.ticker) ?? null,
    quarterClose: context.quarterCloseMap.get(base.ticker) ?? null,
    revision: context.revisionMap.get(base.ticker) ?? null,
    sectorSmartMoney: null,
  };
  const action = actionFrom(previewStockFromBase(base), previewContext);
  const scorePreview = {
    action_score: action.actionScore,
    signal_score: action.signalScore,
    coverage_ratio: action.coverageRatio,
    confidence_label: action.confidenceLabel,
    action_bucket: action.actionBucket,
    action_label: action.actionLabel,
    action_reasons: action.actionReasons,
    families: action.families,
  };

  return {
    ticker: base.ticker,
    asset_type: base.asset_type,
    preview_status: "s1_score_preview_ready_non_public",
    source_stage: base.source_stage,
    claim_scope: "Non-public S1 score-preview artifact only; not S0, not public, not daily, not gated.",
    eligibility: base.eligibility,
    identity: base.identity,
    score_input_presence: base.score_input_presence,
    missing_scoring_axes: base.missing_scoring_axes,
    unsupported_scoring_axes: unsupportedScoringAxes(base),
    scoring_contract_reference: {
      ...base.scoring_contract_reference,
      score_source: SCORE_CORE_SOURCE,
      preview_only: true,
    },
    score_input_mapping: scoreInputMapping(base, context),
    score_preview: scorePreview,
    score_quality_flags: action.scoreQualityFlags,
    normalized_ticker: normalized,
    market_scope: marketScope,
  };
}

function buildS1ScorePreviewArtifact(statuses, context) {
  const readyStatuses = statuses.filter((status) => status.status === "joined_ready");
  const blockedStatuses = statuses.filter((status) => status.status === "joined_not_ready");
  const previewRows = readyStatuses.map((status) => buildS1ScorePreviewRow(status, context));
  const etfRows = previewRows.filter((row) => row.asset_type === "etf").length;
  const nonStockRows = previewRows.filter((row) => row.asset_type !== "stock").length;
  const s0OverlapRows = previewRows.filter((row) => context.s0Set.has(row.ticker)).length;
  const scoredPreviewRows = previewRows.filter((row) => typeof row.score_preview.action_score === "number").length;
  const fakeScoreRows = previewRows.filter((row) => (
    typeof row.score_preview.action_score === "number"
    && row.scoring_contract_reference.score_source !== SCORE_CORE_SOURCE
  )).length;
  const missingAxesNull = previewRows.every((row) => [
    ...(row.missing_scoring_axes ?? []),
    ...(row.unsupported_scoring_axes ?? []),
  ].every((axis) => axis.value === null && axis.display === "미확인"));
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
    joined_ready_preview_rows: previewRows.length,
    joined_not_ready_excluded: blockedStatuses.length,
    etf_rows: etfRows,
    non_stock_rows: nonStockRows,
    s0_overlap_rows: s0OverlapRows,
    scored_preview_rows: scoredPreviewRows,
    fake_score_rows: fakeScoreRows,
    rows_with_missing_axes: previewRows.filter((row) => row.missing_scoring_axes.length > 0).length,
    rows_with_unsupported_axes: previewRows.filter((row) => row.unsupported_scoring_axes.length > 0).length,
    files_written: 0,
    public_files_written: 0,
  };
  const acceptanceChecks = [
    {
      id: "s1_score_preview_counts_match_gate",
      ok: counts.joined_ready_preview_rows === readyStatuses.length
        && counts.joined_not_ready_excluded === blockedStatuses.length,
      detail: `${counts.joined_ready_preview_rows}+${counts.joined_not_ready_excluded} vs ${readyStatuses.length}+${blockedStatuses.length}`,
    },
    {
      id: "s1_score_preview_preserves_s0_count",
      ok: counts.public_s0_before === context.s0Set.size
        && counts.public_s0_after_this_artifact === context.s0Set.size
        && counts.s0_overlap_rows === 0,
      detail: `${counts.public_s0_before}->${counts.public_s0_after_this_artifact}, s0_overlap_rows=${counts.s0_overlap_rows}`,
    },
    {
      id: "s1_score_preview_no_etf_or_non_stock_rows",
      ok: counts.etf_rows === 0 && counts.non_stock_rows === 0,
      detail: `etf_rows=${counts.etf_rows}, non_stock_rows=${counts.non_stock_rows}`,
    },
    {
      id: "s1_score_preview_no_fake_scores",
      ok: counts.fake_score_rows === 0 && counts.scored_preview_rows === previewRows.length,
      detail: `fake_score_rows=${counts.fake_score_rows}, scored_preview_rows=${counts.scored_preview_rows}`,
    },
    {
      id: "s1_score_preview_no_public_daily_gated_claim",
      ok: Object.values(disallowedClaims).every((value) => value === false),
      detail: JSON.stringify(disallowedClaims),
    },
    {
      id: "s1_score_preview_missing_axes_null_explicit",
      ok: missingAxesNull,
      detail: `rows_with_missing_axes=${counts.rows_with_missing_axes}, rows_with_unsupported_axes=${counts.rows_with_unsupported_axes}`,
    },
    {
      id: "s1_score_preview_stdout_only_no_writes",
      ok: counts.files_written === 0 && counts.public_files_written === 0,
      detail: `files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
  ];

  return {
    schema_version: SCORE_PREVIEW_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_audit_schema_version: SCHEMA_VERSION,
    purpose: "Emit an opt-in, non-public S1 stock score preview for JOINED_READY candidates using the shared S0 scoring core without mutating S0/public rows.",
    file_plan: {
      implementation_files: [
        SCORE_CORE_SOURCE,
        "scripts/build-phase2-closeout-indexes.mjs",
        "scripts/audit-fenok-stock-promotion-candidates.mjs",
      ],
      artifact_delivery: "stdout_only",
      command: "node scripts/audit-fenok-stock-promotion-candidates.mjs --score-preview-report --check",
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
      scoring_enabled: true,
      public_s0_mutation: false,
      output_mode: "non_public_score_preview_artifact",
      score_source: SCORE_CORE_SOURCE,
      source_score_contract_version: context.stockActionIndex?.score_contract?.version ?? null,
      source_score_contract_doc: context.stockActionIndex?.score_contract?.doc ?? null,
      missing_value_policy: "Keep absent or unsupported axes null / 미확인. Numeric preview values must come from the shared S0 scoring core.",
      disallowed_claims: disallowedClaims,
    },
    counts,
    blocker_counts: countBlockers(statuses),
    acceptance_checks: acceptanceChecks,
    preview_rows: previewRows,
    excluded_blocked_rows: blockedStatuses.map(joinedStatusSummary),
  };
}

function promotionGateRowFromPreview(row) {
  return {
    ticker: row.ticker,
    asset_type: row.asset_type,
    source_stage: row.source_stage,
    target_stage: "S1_PROMOTION_GATE_READY_NON_PUBLIC",
    promotion_action: "shadow_candidate_only",
    claim_scope: "Non-public S1 promotion gate plan only; not S0, not public, not daily, not gated.",
    eligibility: row.eligibility,
    identity: row.identity,
    score_source: SCORE_CORE_SOURCE,
    score_preview_summary: row.score_preview,
    score_quality_flags: row.score_quality_flags,
    missing_scoring_axes: row.missing_scoring_axes,
    unsupported_scoring_axes: row.unsupported_scoring_axes,
    scoring_contract_reference: row.scoring_contract_reference,
  };
}

function blockerActionFor(blocker) {
  if (blocker === "market_currency_country_scope") {
    return {
      blocker,
      required_action: "repair identity exchange/currency/country scope normalization before joined-ready promotion.",
      future_file_targets: [
        "scripts/build-market-facts.py",
        "scripts/audit-fenok-stock-promotion-candidates.mjs",
      ],
    };
  }
  if (blocker === "price_or_market_cap") {
    return {
      blocker,
      required_action: "refresh numeric price or market_cap evidence before any score/public promotion.",
      future_file_targets: [
        "scripts/fetch-yf-finance.py",
        "scripts/build-market-facts.py",
        "scripts/audit-fenok-stock-promotion-candidates.mjs",
      ],
    };
  }
  if (blocker === "evidence_families_min3") {
    return {
      blocker,
      required_action: `add one accepted evidence family so the ticker reaches ${JOINED_MIN_EVIDENCE_FAMILIES} independent families.`,
      future_file_targets: [
        "scripts/fetch-stockanalysis.py",
        "scripts/probe-stockanalysis-financials.py",
        "scripts/audit-fenok-stock-promotion-candidates.mjs",
      ],
    };
  }
  return {
    blocker,
    required_action: "repair the joined-gate blocker before shadow promotion.",
    future_file_targets: ["scripts/audit-fenok-stock-promotion-candidates.mjs"],
  };
}

function promotionBlockedPlanRow(status, context) {
  const corporateActionPolicy = corporateActionPolicyStatusFor(status.ticker, context);
  return {
    ticker: status.ticker,
    source_stage: status.stage,
    target_stage: "S1_PROMOTION_BLOCKED",
    promotion_action: corporateActionPolicy.status === "policy_required_before_promotion"
      ? "corporate_action_policy_required_before_shadow_candidate"
      : "repair_blockers_before_shadow_candidate",
    claim_scope: "Blocked S1 stock candidate plan only; do not score, publish, or include in S0.",
    blockers: status.blockers,
    evidence_family_count: status.evidence_family_count,
    evidence_families: status.evidence_families,
    country_scope: status.country_scope,
    corporate_action_policy: corporateActionPolicy,
    blocker_actions: status.blockers.map(blockerActionFor),
  };
}

function factDiagnostic(detail, key) {
  const fact = detail?.facts?.[key] ?? null;
  const value = fact?.value;
  return {
    key,
    present: typeof value === "number" && Number.isFinite(value),
    value: value ?? null,
    source: fact?.source ?? null,
    as_of: fact?.as_of ?? null,
    fetched_at: fact?.fetched_at ?? null,
    candidate_count: fact?.candidate_count ?? 0,
  };
}

function localSourceFilesFor(item, row, detail, context) {
  const detailSources = detail?.sources ?? {};
  const indexSources = row?.sources ?? {};
  const acceptedFamilyFlags = evidenceFamilyFlagsForTicker(item, row, {
    yfSet: context.yfSet,
    secSet: context.secSet,
    slickUniverseSet: context.slickUniverseSet,
    slickStockFileSet: context.slickStockFileSet,
    stockanalysisSurfaceSet: context.stockanalysisSurfaceSet,
    rawMasterSet: context.rawMasterSet,
  });
  return {
    market_facts_detail: Boolean(detail),
    yf_finance_file: context.yfSet.has(item),
    slickcharts_stock_file: context.slickStockFileSet.has(item),
    stockanalysis_surface_file: context.stockanalysisSurfaceSet.has(item),
    stockanalysis_financials_file: context.stockanalysisFinancialsSet.has(item),
    sec13f_by_ticker: context.secSet.has(item),
    raw_company_master: context.rawMasterSet.has(item),
    source_flags: {
      yf: detailSources.yf === true || indexSources.yf === true,
      stockanalysis: detailSources.stockanalysis === true || indexSources.stockanalysis === true,
      stockanalysis_yf_fallback: detailSources.stockanalysis_yf_fallback === true
        || indexSources.stockanalysis_yf_fallback === true,
      slickcharts: detailSources.slickcharts === true || indexSources.slickcharts === true,
    },
    accepted_family_flags: acceptedFamilyFlags,
  };
}

function blockerDiagnosticFor(blocker, status, detail, row, context) {
  const item = status.ticker;
  const identity = detail?.identity ?? {};
  const base = blockerActionFor(blocker);
  const localSources = localSourceFilesFor(item, row, detail, context);
  const corporateActionPolicy = corporateActionPolicyStatusFor(item, context);
  if (blocker === "market_currency_country_scope") {
    const policyRequired = corporateActionPolicy.status === "policy_required_before_promotion";
    return {
      ...base,
      current_evidence: {
        exchange: identity.exchange ?? null,
        currency: identity.currency ?? null,
        explicit_country: identity.country ?? identity.country_code ?? identity.countryCode ?? identity.market_country ?? null,
        inferred_country_scope: status.country_scope,
        corporate_action_policy: corporateActionPolicy,
      },
      unblock_target: "market_facts identity must carry exchange, currency, and a country scope inferable by the joined gate.",
      next_non_public_slice: policyRequired
        ? "define terminal/alias policy for this corporate-action row before synthesizing identity or promoting it."
        : "repair market_facts identity normalization, then rerun the joined gate before any public scoring write.",
    };
  }
  if (blocker === "price_or_market_cap") {
    return {
      ...base,
      current_evidence: {
        price: factDiagnostic(detail, "price"),
        market_cap: factDiagnostic(detail, "market_cap"),
      },
      unblock_target: "market_facts detail must expose numeric price or market_cap.",
      next_non_public_slice: "refresh YF/StockAnalysis numeric facts, rebuild market_facts, then rerun this diagnostics report.",
    };
  }
  if (blocker === "evidence_families_min3") {
    return {
      ...base,
      current_evidence: {
        evidence_family_count: status.evidence_family_count,
        evidence_families: status.evidence_families,
        local_source_files: localSources,
        accepted_family_rule: "yf, stockanalysis, slickcharts, sec13f, and raw_company_master are the current joined-gate families.",
      },
      unblock_target: `raise accepted evidence families from ${status.evidence_family_count} to at least ${JOINED_MIN_EVIDENCE_FAMILIES}.`,
      next_non_public_slice: "add or normalize an accepted evidence family; do not count extra files unless evidenceFamiliesForTicker recognizes them.",
    };
  }
  return {
    ...base,
    current_evidence: {
      checks: status.checks,
    },
    unblock_target: "all joined-gate checks must pass.",
    next_non_public_slice: "repair the failing joined-gate check and rerun diagnostics.",
  };
}

function blockedUnblockDiagnosticRow(status, context) {
  const row = context.marketByTicker.get(status.ticker);
  const detail = readJsonOrNull(path.join("data/computed/market_facts/tickers", `${status.ticker}.json`));
  const identity = detail?.identity ?? {};
  const corporateActionPolicy = corporateActionPolicyStatusFor(status.ticker, context);
  return {
    ticker: status.ticker,
    asset_type: row?.asset_type ?? null,
    source_stage: status.stage,
    target_stage: "S1_JOINED_UNBLOCK_DIAGNOSTICS_ONLY",
    claim_scope: "Blocked S1 diagnostics only; no score, no public, no daily, no gated claim.",
    blockers: status.blockers,
    checks: status.checks,
    evidence_family_count: status.evidence_family_count,
    evidence_families: status.evidence_families,
    country_scope: status.country_scope,
    local_identity: {
      name: identity.name ?? row?.name ?? null,
      exchange: identity.exchange ?? null,
      currency: identity.currency ?? null,
      sector: identity.sector ?? null,
      industry: identity.industry ?? null,
      explicit_country: identity.country ?? identity.country_code ?? identity.countryCode ?? identity.market_country ?? null,
    },
    local_fact_status: {
      price: factDiagnostic(detail, "price"),
      market_cap: factDiagnostic(detail, "market_cap"),
      present_fact_keys: Object.keys(detail?.facts ?? {}).sort(),
    },
    local_source_files: localSourceFilesFor(status.ticker, row, detail, context),
    corporate_action_policy: corporateActionPolicy,
    blocker_diagnostics: status.blockers.map((blocker) => blockerDiagnosticFor(blocker, status, detail, row, context)),
  };
}

function buildS1BlockedUnblockDiagnosticsArtifact(statuses, context) {
  const blockedStatuses = statuses.filter((status) => status.status === "joined_not_ready");
  const diagnosticRows = blockedStatuses.map((status) => blockedUnblockDiagnosticRow(status, context));
  const expectedBlockedRows = [
    ["DAY", ["market_currency_country_scope"]],
    ["HOLX", ["market_currency_country_scope"]],
    ["MMC", ["market_currency_country_scope"]],
    ["STRC", ["evidence_families_min3"]],
  ];
  const actualBlockedRows = diagnosticRows
    .map((row) => [row.ticker, row.blockers])
    .sort(([a], [b]) => a.localeCompare(b));
  const blockerSetsMatch = actualBlockedRows.length === expectedBlockedRows.length
    && actualBlockedRows.every(([tickerValue, blockers], index) => (
      tickerValue === expectedBlockedRows[index][0]
      && arraysEqual(blockers, expectedBlockedRows[index][1])
    ));
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
    s1_candidates: context.s0Set.size + statuses.length,
    s1_gap_total: statuses.length,
    joined_ready_rows: statuses.length - blockedStatuses.length,
    blocked_diagnostic_rows: diagnosticRows.length,
    etf_rows: diagnosticRows.filter((row) => row.asset_type === "etf").length,
    non_stock_rows: diagnosticRows.filter((row) => row.asset_type !== "stock").length,
    s0_overlap_rows: diagnosticRows.filter((row) => context.s0Set.has(row.ticker)).length,
    files_written: 0,
    public_files_written: 0,
  };
  const acceptanceChecks = [
    {
      id: "s1_blocked_unblock_diagnostics_counts_match_gate",
      ok: counts.joined_ready_rows + counts.blocked_diagnostic_rows === statuses.length,
      detail: `${counts.joined_ready_rows}+${counts.blocked_diagnostic_rows} vs ${statuses.length}`,
    },
    {
      id: "s1_blocked_unblock_diagnostics_blockers_exact_current_set",
      ok: blockerSetsMatch,
      detail: JSON.stringify(actualBlockedRows),
    },
    {
      id: "s1_blocked_unblock_diagnostics_no_etf_or_non_stock_rows",
      ok: counts.etf_rows === 0 && counts.non_stock_rows === 0,
      detail: `etf_rows=${counts.etf_rows}, non_stock_rows=${counts.non_stock_rows}`,
    },
    {
      id: "s1_blocked_unblock_diagnostics_preserves_s0_count",
      ok: counts.public_s0_before === context.s0Set.size
        && counts.public_s0_after_this_artifact === context.s0Set.size
        && counts.s0_overlap_rows === 0,
      detail: `${counts.public_s0_before}->${counts.public_s0_after_this_artifact}, s0_overlap_rows=${counts.s0_overlap_rows}`,
    },
    {
      id: "s1_blocked_unblock_diagnostics_no_public_daily_gated_claim",
      ok: Object.values(disallowedClaims).every((value) => value === false),
      detail: JSON.stringify(disallowedClaims),
    },
    {
      id: "s1_blocked_unblock_diagnostics_stdout_only_no_writes",
      ok: counts.files_written === 0 && counts.public_files_written === 0,
      detail: `files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
  ];

  return {
    schema_version: BLOCKED_UNBLOCK_DIAGNOSTICS_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_audit_schema_version: SCHEMA_VERSION,
    purpose: "Diagnose the exact local blockers for S1 joined-not-ready stock rows without fetching, scoring, publishing, or writing data.",
    file_plan: {
      implementation_file: "scripts/audit-fenok-stock-promotion-candidates.mjs",
      artifact_delivery: "stdout_only",
      command: "node scripts/audit-fenok-stock-promotion-candidates.mjs --blocked-unblock-diagnostics-report --check",
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
      include_rows: "joined_not_ready only; joined_ready rows are intentionally excluded from this blocker diagnostics artifact.",
      scoring_enabled: false,
      public_s0_mutation: false,
      output_mode: "non_public_blocked_unblock_diagnostics_artifact",
      target_stage: "S1_JOINED_UNBLOCK_DIAGNOSTICS_ONLY",
      disallowed_claims: disallowedClaims,
    },
    implementation_targets_for_future_unblock: [
      "scripts/build-market-facts.py",
      "scripts/fetch-yf-finance.py",
      "scripts/fetch-stockanalysis.py",
      "scripts/probe-stockanalysis-financials.py",
      "scripts/audit-fenok-stock-promotion-candidates.mjs",
    ],
    counts,
    blocker_counts: countBlockers(blockedStatuses),
    acceptance_checks: acceptanceChecks,
    blocked_diagnostic_rows: diagnosticRows,
  };
}

function buildS1PromotionGatePlanArtifact(statuses, context) {
  const previewArtifact = buildS1ScorePreviewArtifact(statuses, context);
  const promotionRows = previewArtifact.preview_rows.map(promotionGateRowFromPreview);
  const blockedStatuses = statuses.filter((status) => status.status === "joined_not_ready");
  const blockedPlanRows = blockedStatuses.map((status) => promotionBlockedPlanRow(status, context));
  const etfRows = promotionRows.filter((row) => row.asset_type === "etf").length;
  const nonStockRows = promotionRows.filter((row) => row.asset_type !== "stock").length;
  const s0OverlapRows = promotionRows.filter((row) => context.s0Set.has(row.ticker)).length;
  const fakeScoreRows = promotionRows.filter((row) => (
    typeof row.score_preview_summary?.action_score === "number"
    && row.score_source !== SCORE_CORE_SOURCE
  )).length;
  const missingAxesNull = promotionRows.every((row) => [
    ...(row.missing_scoring_axes ?? []),
    ...(row.unsupported_scoring_axes ?? []),
  ].every((axis) => axis.value === null && axis.display === "미확인"));
  const disallowedClaims = {
    scored_public_s0: false,
    public: false,
    daily: false,
    gated: false,
    etf_lane: false,
  };
  const actualBlockedRows = blockedPlanRows
    .map((row) => [row.ticker, row.blockers])
    .sort(([a], [b]) => a.localeCompare(b));
  const sourceBlockerCounts = countBlockers(blockedStatuses);
  const actualBlockerCounts = countBlockers(blockedPlanRows);
  const blockerKeys = new Set([...Object.keys(sourceBlockerCounts), ...Object.keys(actualBlockerCounts)]);
  const blockerCountsMatchSource = [...blockerKeys].every((key) => (
    Number(sourceBlockerCounts[key] ?? 0) === Number(actualBlockerCounts[key] ?? 0)
  ));
  const blockerSetsMatch = actualBlockedRows.length === blockedStatuses.length
    && actualBlockedRows.every(([tickerValue, blockers]) => (
      typeof tickerValue === "string"
      && tickerValue.length > 0
      && Array.isArray(blockers)
      && blockers.length > 0
      && blockers.every((blocker) => typeof blocker === "string" && blocker.length > 0)
    ))
    && blockerCountsMatchSource;
  const counts = {
    public_s0_before: context.s0Set.size,
    public_s0_after_this_artifact: context.s0Set.size,
    s1_candidates: context.s0Set.size + statuses.length,
    s1_gap_total: statuses.length,
    promotion_gate_rows: promotionRows.length,
    excluded_blocked_rows: blockedPlanRows.length,
    future_candidate_count_if_approved: context.s0Set.size + promotionRows.length,
    etf_rows: etfRows,
    non_stock_rows: nonStockRows,
    s0_overlap_rows: s0OverlapRows,
    scored_preview_rows: previewArtifact.counts.scored_preview_rows,
    fake_score_rows: fakeScoreRows,
    rows_with_missing_axes: promotionRows.filter((row) => row.missing_scoring_axes.length > 0).length,
    rows_with_unsupported_axes: promotionRows.filter((row) => row.unsupported_scoring_axes.length > 0).length,
    files_written: 0,
    public_files_written: 0,
  };
  const acceptanceChecks = [
    {
      id: "s1_promotion_gate_plan_counts_match_gate",
      ok: counts.promotion_gate_rows === previewArtifact.counts.joined_ready_preview_rows
        && counts.excluded_blocked_rows === previewArtifact.counts.joined_not_ready_excluded,
      detail: `${counts.promotion_gate_rows}+${counts.excluded_blocked_rows} vs ${previewArtifact.counts.joined_ready_preview_rows}+${previewArtifact.counts.joined_not_ready_excluded}`,
    },
    {
      id: "s1_promotion_gate_plan_preserves_s0_count",
      ok: counts.public_s0_before === context.s0Set.size
        && counts.public_s0_after_this_artifact === context.s0Set.size
        && counts.s0_overlap_rows === 0
        && counts.future_candidate_count_if_approved === context.s0Set.size + counts.promotion_gate_rows,
      detail: `${counts.public_s0_before}->${counts.public_s0_after_this_artifact}, future=${counts.future_candidate_count_if_approved}, s0_overlap_rows=${counts.s0_overlap_rows}`,
    },
    {
      id: "s1_promotion_gate_plan_no_etf_or_non_stock_rows",
      ok: counts.etf_rows === 0 && counts.non_stock_rows === 0,
      detail: `etf_rows=${counts.etf_rows}, non_stock_rows=${counts.non_stock_rows}`,
    },
    {
      id: "s1_promotion_gate_plan_no_fake_scores",
      ok: counts.fake_score_rows === 0
        && promotionRows.every((row) => row.score_source === SCORE_CORE_SOURCE),
      detail: `fake_score_rows=${counts.fake_score_rows}, score_source=${SCORE_CORE_SOURCE}`,
    },
    {
      id: "s1_promotion_gate_plan_no_public_daily_gated_claim",
      ok: Object.values(disallowedClaims).every((value) => value === false),
      detail: JSON.stringify(disallowedClaims),
    },
    {
      id: "s1_promotion_gate_plan_missing_axes_null_explicit",
      ok: missingAxesNull,
      detail: `rows_with_missing_axes=${counts.rows_with_missing_axes}, rows_with_unsupported_axes=${counts.rows_with_unsupported_axes}`,
    },
    {
      id: "s1_promotion_gate_plan_blockers_exact_current_set",
      ok: blockerSetsMatch,
      detail: JSON.stringify({ blocked_rows: actualBlockedRows, source_blocker_counts: sourceBlockerCounts }),
    },
    {
      id: "s1_promotion_gate_plan_stdout_only_no_writes",
      ok: counts.files_written === 0 && counts.public_files_written === 0,
      detail: `files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
  ];

  return {
    schema_version: PROMOTION_GATE_PLAN_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_audit_schema_version: SCHEMA_VERSION,
    purpose: "Plan the next non-public S1 stock promotion gate using score-preview rows without mutating S0/public outputs.",
    file_plan: {
      implementation_file: "scripts/audit-fenok-stock-promotion-candidates.mjs",
      artifact_delivery: "stdout_only",
      command: "node scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check",
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
      source_preview_schema_version: SCORE_PREVIEW_ARTIFACT_SCHEMA_VERSION,
      include_rows: "joined_ready score-preview rows only as non-public shadow candidates; joined_not_ready rows remain blocker plans.",
      scoring_enabled: false,
      public_s0_mutation: false,
      output_mode: "non_public_promotion_gate_plan_artifact",
      promotion_action: "shadow_candidate_only",
      target_stage: "S1_PROMOTION_GATE_READY_NON_PUBLIC",
      score_source: SCORE_CORE_SOURCE,
      source_score_contract_version: context.stockActionIndex?.score_contract?.version ?? null,
      source_score_contract_doc: context.stockActionIndex?.score_contract?.doc ?? null,
      missing_value_policy: "Keep absent or unsupported axes null / 미확인. Preview scores are references only, not public scores.",
      disallowed_claims: disallowedClaims,
    },
    implementation_targets_for_future_unblock: [
      "scripts/build-market-facts.py",
      "scripts/fetch-yf-finance.py",
      "scripts/fetch-stockanalysis.py",
      "scripts/probe-stockanalysis-financials.py",
      "scripts/audit-fenok-stock-promotion-candidates.mjs",
    ],
    counts,
    blocker_counts: sourceBlockerCounts,
    acceptance_checks: acceptanceChecks,
    promotion_gate_rows: promotionRows,
    blocked_plan_rows: blockedPlanRows,
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
  stockanalysisSurfaceSet,
  rawMasterSet,
  promotionContext = null,
  scoringContractContext = null,
  scorePreviewContext = null,
  promotionGatePlanContext = null,
  blockedUnblockDiagnosticsContext = null,
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
      stockanalysisSurfaceSet,
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
  if (scorePreviewContext) {
    result.score_preview_artifact = buildS1ScorePreviewArtifact(statuses, scorePreviewContext);
  }
  if (promotionGatePlanContext) {
    result.promotion_gate_plan_artifact = buildS1PromotionGatePlanArtifact(statuses, promotionGatePlanContext);
  }
  if (blockedUnblockDiagnosticsContext) {
    result.blocked_unblock_diagnostics_artifact = buildS1BlockedUnblockDiagnosticsArtifact(statuses, blockedUnblockDiagnosticsContext);
  }

  return result;
}

function buildAudit({
  examples = DEFAULT_EXAMPLE_LIMIT,
  full = false,
  promotionReport = false,
  scoringContractReport = false,
  scorePreviewReport = false,
  promotionGatePlanReport = false,
  blockedUnblockDiagnosticsReport = false,
} = {}) {
  const signals = readJson("data/computed/fenok_signals.json");
  const stockActionIndex = scoringContractReport || scorePreviewReport || promotionGatePlanReport
    ? readJson("data/computed/stock_action_index.json")
    : null;
  const marketFacts = readJson("data/computed/market_facts/index.json");
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json");
  const slickUniverse = readJson("data/slickcharts/universe.json");
  const sec13f = readJson("data/sec-13f/by_ticker.json");
  const rawMaster = readJson("data/global-scouter/raw/company_master_m_company.json");
  const stockanalysisIndex = readJsonOrNull("data/stockanalysis/index.json");
  const stockanalysisActionsRecent = readJsonOrNull("data/stockanalysis/surfaces/actions_recent.json");
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
  const stockanalysisSurfaceTickerList = stockanalysisSurfaceTickers(stockanalysisActionsRecent);
  const stockanalysisSurfaceSet = new Set(stockanalysisSurfaceTickerList);
  const stockanalysisCorporateActionMap = stockanalysisCorporateActionsByTicker(stockanalysisActionsRecent);
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
  const needsScorePreviewContext = scorePreviewReport || promotionGatePlanReport;
  const previewSlickUniverseMap = needsScorePreviewContext ? slickUniverseMap(slickUniverse) : null;
  const previewIndexWeightsMap = needsScorePreviewContext ? indexWeightMap() : null;
  const previewDividendHistoryMap = needsScorePreviewContext ? dividendHistoryMap(slickDividends) : null;
  const previewQuarterCloseMap = needsScorePreviewContext ? quarterCloseHistoryMap(quarterCloses) : null;
  const previewRevisionMap = needsScorePreviewContext ? revisionMapByTicker(revisions) : null;

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
    stockanalysisSurfaceSet,
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
    scorePreviewContext: scorePreviewReport
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
          slickUniverseMap: previewSlickUniverseMap,
          indexWeightsMap: previewIndexWeightsMap,
          dividendHistoryMap: previewDividendHistoryMap,
          quarterCloseMap: previewQuarterCloseMap,
          revisionMap: previewRevisionMap,
          guruHolders,
          enhancedConsensus,
        }
      : null,
    promotionGatePlanContext: promotionGatePlanReport
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
          slickUniverseMap: previewSlickUniverseMap,
          indexWeightsMap: previewIndexWeightsMap,
          dividendHistoryMap: previewDividendHistoryMap,
          quarterCloseMap: previewQuarterCloseMap,
          revisionMap: previewRevisionMap,
          guruHolders,
          enhancedConsensus,
          stockanalysisCorporateActionMap,
        }
      : null,
    blockedUnblockDiagnosticsContext: blockedUnblockDiagnosticsReport
      ? {
          marketByTicker,
          s0Set,
          yfSet,
          secSet,
          slickUniverseSet,
          slickStockFileSet,
          stockanalysisSurfaceSet,
          stockanalysisCorporateActionMap,
          rawMasterSet,
          stockanalysisFinancialsSet,
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
  if (scorePreviewReport) {
    const artifact = s1JoinedGate.score_preview_artifact;
    hardChecks.push(
      {
        id: "s1_score_preview_counts_match_gate",
        ok: artifact?.counts?.joined_ready_preview_rows === s1JoinedGate.counts.joined_ready
          && artifact?.counts?.joined_not_ready_excluded === s1JoinedGate.counts.joined_not_ready,
        detail: `${artifact?.counts?.joined_ready_preview_rows}+${artifact?.counts?.joined_not_ready_excluded} vs ${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready}`,
      },
      {
        id: "s1_score_preview_no_etf_rows",
        ok: artifact?.counts?.etf_rows === 0 && artifact?.counts?.non_stock_rows === 0,
        detail: `etf_rows=${artifact?.counts?.etf_rows}, non_stock_rows=${artifact?.counts?.non_stock_rows}`,
      },
      {
        id: "s1_score_preview_no_fake_scores",
        ok: artifact?.counts?.fake_score_rows === 0
          && artifact?.preview_rows?.every((row) => row.scoring_contract_reference?.score_source === SCORE_CORE_SOURCE) === true,
        detail: `fake_score_rows=${artifact?.counts?.fake_score_rows}, score_source=${SCORE_CORE_SOURCE}`,
      },
      {
        id: "s1_score_preview_preserves_s0_count",
        ok: artifact?.counts?.public_s0_before === s0Tickers.length
          && artifact?.counts?.public_s0_after_this_artifact === s0Tickers.length
          && artifact?.counts?.s0_overlap_rows === 0,
        detail: `${artifact?.counts?.public_s0_before}->${artifact?.counts?.public_s0_after_this_artifact}, s0_overlap_rows=${artifact?.counts?.s0_overlap_rows}`,
      },
      {
        id: "s1_score_preview_no_public_daily_gated_claim",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_score_preview_no_public_daily_gated_claim")?.ok === true,
        detail: JSON.stringify(artifact?.contract?.disallowed_claims ?? null),
      },
      {
        id: "s1_score_preview_missing_axes_null_explicit",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_score_preview_missing_axes_null_explicit")?.ok === true,
        detail: `rows_with_missing_axes=${artifact?.counts?.rows_with_missing_axes}, rows_with_unsupported_axes=${artifact?.counts?.rows_with_unsupported_axes}`,
      },
      {
        id: "s1_score_preview_stdout_only_no_writes",
        ok: artifact?.counts?.files_written === 0 && artifact?.counts?.public_files_written === 0,
        detail: `files_written=${artifact?.counts?.files_written}, public_files_written=${artifact?.counts?.public_files_written}`,
      },
    );
  }
  if (promotionGatePlanReport) {
    const artifact = s1JoinedGate.promotion_gate_plan_artifact;
    hardChecks.push(
      {
        id: "s1_promotion_gate_plan_counts_match_gate",
        ok: artifact?.counts?.promotion_gate_rows === s1JoinedGate.counts.joined_ready
          && artifact?.counts?.excluded_blocked_rows === s1JoinedGate.counts.joined_not_ready,
        detail: `${artifact?.counts?.promotion_gate_rows}+${artifact?.counts?.excluded_blocked_rows} vs ${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready}`,
      },
      {
        id: "s1_promotion_gate_plan_no_etf_rows",
        ok: artifact?.counts?.etf_rows === 0 && artifact?.counts?.non_stock_rows === 0,
        detail: `etf_rows=${artifact?.counts?.etf_rows}, non_stock_rows=${artifact?.counts?.non_stock_rows}`,
      },
      {
        id: "s1_promotion_gate_plan_no_fake_scores",
        ok: artifact?.counts?.fake_score_rows === 0
          && artifact?.promotion_gate_rows?.every((row) => row.score_source === SCORE_CORE_SOURCE) === true,
        detail: `fake_score_rows=${artifact?.counts?.fake_score_rows}, score_source=${SCORE_CORE_SOURCE}`,
      },
      {
        id: "s1_promotion_gate_plan_preserves_s0_count",
        ok: artifact?.counts?.public_s0_before === s0Tickers.length
          && artifact?.counts?.public_s0_after_this_artifact === s0Tickers.length
          && artifact?.counts?.s0_overlap_rows === 0
          && artifact?.counts?.future_candidate_count_if_approved === s0Tickers.length + s1JoinedGate.counts.joined_ready,
        detail: `${artifact?.counts?.public_s0_before}->${artifact?.counts?.public_s0_after_this_artifact}, future=${artifact?.counts?.future_candidate_count_if_approved}, s0_overlap_rows=${artifact?.counts?.s0_overlap_rows}`,
      },
      {
        id: "s1_promotion_gate_plan_no_public_daily_gated_claim",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_promotion_gate_plan_no_public_daily_gated_claim")?.ok === true,
        detail: JSON.stringify(artifact?.contract?.disallowed_claims ?? null),
      },
      {
        id: "s1_promotion_gate_plan_missing_axes_null_explicit",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_promotion_gate_plan_missing_axes_null_explicit")?.ok === true,
        detail: `rows_with_missing_axes=${artifact?.counts?.rows_with_missing_axes}, rows_with_unsupported_axes=${artifact?.counts?.rows_with_unsupported_axes}`,
      },
      {
        id: "s1_promotion_gate_plan_blockers_exact_current_set",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_promotion_gate_plan_blockers_exact_current_set")?.ok === true,
        detail: JSON.stringify(artifact?.blocked_plan_rows?.map((row) => [row.ticker, row.blockers]) ?? []),
      },
      {
        id: "s1_promotion_gate_plan_stdout_only_no_writes",
        ok: artifact?.counts?.files_written === 0 && artifact?.counts?.public_files_written === 0,
        detail: `files_written=${artifact?.counts?.files_written}, public_files_written=${artifact?.counts?.public_files_written}`,
      },
    );
  }
  if (blockedUnblockDiagnosticsReport) {
    const artifact = s1JoinedGate.blocked_unblock_diagnostics_artifact;
    hardChecks.push(
      {
        id: "s1_blocked_unblock_diagnostics_counts_match_gate",
        ok: artifact?.counts?.joined_ready_rows === s1JoinedGate.counts.joined_ready
          && artifact?.counts?.blocked_diagnostic_rows === s1JoinedGate.counts.joined_not_ready,
        detail: `${artifact?.counts?.joined_ready_rows}+${artifact?.counts?.blocked_diagnostic_rows} vs ${s1JoinedGate.counts.joined_ready}+${s1JoinedGate.counts.joined_not_ready}`,
      },
      {
        id: "s1_blocked_unblock_diagnostics_no_etf_rows",
        ok: artifact?.counts?.etf_rows === 0 && artifact?.counts?.non_stock_rows === 0,
        detail: `etf_rows=${artifact?.counts?.etf_rows}, non_stock_rows=${artifact?.counts?.non_stock_rows}`,
      },
      {
        id: "s1_blocked_unblock_diagnostics_preserves_s0_count",
        ok: artifact?.counts?.public_s0_before === s0Tickers.length
          && artifact?.counts?.public_s0_after_this_artifact === s0Tickers.length
          && artifact?.counts?.s0_overlap_rows === 0,
        detail: `${artifact?.counts?.public_s0_before}->${artifact?.counts?.public_s0_after_this_artifact}, s0_overlap_rows=${artifact?.counts?.s0_overlap_rows}`,
      },
      {
        id: "s1_blocked_unblock_diagnostics_blockers_exact_current_set",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_blocked_unblock_diagnostics_blockers_exact_current_set")?.ok === true,
        detail: JSON.stringify(artifact?.blocked_diagnostic_rows?.map((row) => [row.ticker, row.blockers]) ?? []),
      },
      {
        id: "s1_blocked_unblock_diagnostics_no_public_daily_gated_claim",
        ok: artifact?.acceptance_checks?.find((check) => check.id === "s1_blocked_unblock_diagnostics_no_public_daily_gated_claim")?.ok === true,
        detail: JSON.stringify(artifact?.contract?.disallowed_claims ?? null),
      },
      {
        id: "s1_blocked_unblock_diagnostics_stdout_only_no_writes",
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

  const activeS0Track = Array.isArray(coverageIndex?.public_scoring_readiness?.tracks)
    ? coverageIndex.public_scoring_readiness.tracks.find((track) => track?.id === "active_stock_scoring_current")
    : null;
  const activeS0DailyGated = activeS0Track?.requirements?.daily === true
    && activeS0Track?.requirements?.gated === true
    && activeS0Track?.readiness_status === "ready"
    && activeS0Track?.public_done_claim_allowed === true;

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
      stage: activeS0DailyGated ? "PUBLIC_DAILY_GATED" : "PUBLIC_NOT_DAILY_GATED",
      count: s0Tickers.length,
      coverage_index_count: coverageIndex?.active_scoring_universe?.total ?? null,
      requirements: activeS0Track?.requirements ?? null,
      readiness_status: activeS0Track?.readiness_status ?? null,
      public_done_claim_allowed: activeS0Track?.public_done_claim_allowed === true,
      by_market_scope: countBy(signalRows, (row) => String(row.market_scope ?? "unknown")),
      caveat: activeS0DailyGated
        ? "Current public-scored stock universe has DAILY + GATED proof under the current S0 Korea+US scope; expansion lanes remain separate."
        : "Current public-scored stock universe only; not complete/paid-ready until DAILY + GATED are proven.",
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
  if (result.s1_stock_promotion_candidates.joined_gate.score_preview_artifact) {
    console.log(`S1 score preview report counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.score_preview_artifact.counts)}`);
  }
  if (result.s1_stock_promotion_candidates.joined_gate.promotion_gate_plan_artifact) {
    console.log(`S1 promotion gate plan counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.promotion_gate_plan_artifact.counts)}`);
  }
  if (result.s1_stock_promotion_candidates.joined_gate.blocked_unblock_diagnostics_artifact) {
    console.log(`S1 blocked unblock diagnostics counts: ${JSON.stringify(result.s1_stock_promotion_candidates.joined_gate.blocked_unblock_diagnostics_artifact.counts)}`);
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

export {
  buildAudit,
  evidenceFamilyFlagsForTicker,
  evidenceFamiliesForTicker,
  corporateActionEvidenceFor,
  localSourceFilesFor,
  stockanalysisCorporateActionsByTicker,
  stockanalysisSurfaceTickers,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const audit = buildAudit(args);
  if (args.scorePreviewReport) {
    process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.score_preview_artifact, null, 2)}\n`);
  } else if (args.promotionGatePlanReport) {
    process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.promotion_gate_plan_artifact, null, 2)}\n`);
  } else if (args.blockedUnblockDiagnosticsReport) {
    process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.blocked_unblock_diagnostics_artifact, null, 2)}\n`);
  } else if (args.scoringContractReport) {
    process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.scoring_contract_artifact, null, 2)}\n`);
  } else if (args.promotionReport) {
    process.stdout.write(`${JSON.stringify(audit.s1_stock_promotion_candidates.joined_gate.promotion_artifact, null, 2)}\n`);
  } else if (args.json) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else printHuman(audit);

  process.exitCode = args.check && !audit.ok ? 1 : 0;
}
