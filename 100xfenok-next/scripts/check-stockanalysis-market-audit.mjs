#!/usr/bin/env node

import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = process.cwd();

const PUBLIC_RENDERER_PATH = `${ROOT}/public/admin/data-lab/app/renderer.js`;
const FORMATTERS_PATH = `${ROOT}/public/admin/shared/core/formatters.js`;
const DATA_LAB_DEV_SOURCE_PATH = "../admin/data-lab/DEV.md";
const DATA_LAB_DEV_PUBLIC_PATH = "public/admin/data-lab/DEV.md";

const JSON_PAIRS = [
  ["ETF universe", "../data/stockanalysis/etf_universe.json", "public/data/stockanalysis/etf_universe.json"],
  ["ETF coverage", "../data/stockanalysis/coverage/etf_detail.json", "public/data/stockanalysis/coverage/etf_detail.json"],
  ["ETF incremental proof", "../data/stockanalysis/backfill/incremental_latest.json", "public/data/stockanalysis/backfill/incremental_latest.json"],
  ["ETF incremental plan", "../data/stockanalysis/backfill/incremental_plan_latest.json", "public/data/stockanalysis/backfill/incremental_plan_latest.json"],
  ["ETF history gap report", "../data/stockanalysis/backfill/history_gap_report_latest.json", "public/data/stockanalysis/backfill/history_gap_report_latest.json"],
  ["ETF pending ledger", "../data/stockanalysis/backfill/pending_ledger.json", "public/data/stockanalysis/backfill/pending_ledger.json"],
  ["StockAnalysis index", "../data/stockanalysis/index.json", "public/data/stockanalysis/index.json"],
  ["StockAnalysis classification", "../data/stockanalysis/classification/latest.json", "public/data/stockanalysis/classification/latest.json"],
  ["StockAnalysis surfaces index", "../data/stockanalysis/surfaces/index.json", "public/data/stockanalysis/surfaces/index.json"],
  ["StockAnalysis surface consumers", "../data/stockanalysis/surface_consumers.json", "public/data/stockanalysis/surface_consumers.json"],
  ["StockAnalysis ETF screener", "../data/stockanalysis/surfaces/etf_screener.json", "public/data/stockanalysis/surfaces/etf_screener.json"],
  ["StockAnalysis new ETFs", "../data/stockanalysis/surfaces/new_etfs.json", "public/data/stockanalysis/surfaces/new_etfs.json"],
  ["Market data audit", "../data/computed/market_data_audit.json", "public/data/computed/market_data_audit.json"],
  ["Market source parity", "../data/computed/market_source_parity.json", "public/data/computed/market_source_parity.json"],
  ["Market facts index", "../data/computed/market_facts/index.json", "public/data/computed/market_facts/index.json"],
];

const ACTIVE_ROUTE_PREFIXES = [
  "/admin/data-lab",
  "/api/data/stockanalysis",
  "/etfs",
  "/market/events",
  "/sectors",
  "/stock/[ticker]",
];

const ALLOWED_HISTORY_PERIODS = new Set(["daily_1y", "weekly_1y", "monthly_1y", "weekly_3y", "monthly_3y", "monthly_5y"]);

const REQUIRED_RENDERED_SECTIONS = [
  "ETF 상세 수집",
  "가격 제공",
  "거래량 제공",
  "보유종목 제공",
  "ETF 상세 누락 샘플",
  "ETF로 인식되지 않음",
  "재시도 예약됨",
  "다음 수집 후보",
  "보조 가격 임시 적용",
  "시장 데이터 수집 현황",
  "최근 ETF 상세 갱신",
  "ETF 수집 대기열",
  "계획 파일",
  "계획 후보",
  "ETF 히스토리 사전 점검",
  "직접 스캔",
  "수량 계획 일치",
  "기간 계획 일치",
  "실행/계획",
  "실행 증거 + 보강 계획",
  "계획: 다년 히스토리",
  "최근 실행: 다년 히스토리",
  "상세 히스토리",
  "성과표",
  "지금 재시도 가능",
  "가장 빠른 재시도일",
  "반복 미확인",
  "소스 일치성 진단 상세",
  "10년 CAGR",
  "상장 이후 CAGR",
];

const REJECTED_RENDERED_COPY = [
  "데이터 묶음 정리",
  "원본 묶음",
  "제외 묶음",
  "Source Parity",
  "Top Stale",
  "Top Sign Divergence",
  "Universe rows",
  "신규 ETF 상세 수집",
];

function pathOf(relPath) {
  return `${ROOT}/${relPath}`;
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(relPath) {
  return JSON.parse(readText(pathOf(relPath)));
}

function sumObjectValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0);
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function assertMirror(label, sourceRelPath, publicRelPath, errors) {
  const source = readText(pathOf(sourceRelPath));
  const mirror = readText(pathOf(publicRelPath));
  assert(source === mirror, `${label}: source and public mirror differ`, errors);
}

function assertDataLabDevVersion(errors) {
  const dev = readText(pathOf(DATA_LAB_DEV_PUBLIC_PATH));
  const headerVersion = dev.match(/^\> \*\*Version\*\*: ([^\s]+) /m)?.[1] || "";
  const latestChangelogVersion = dev.match(/^\| ([0-9]+\.[0-9]+\.[0-9]+) \| [0-9-]+ \|/m)?.[1] || "";

  assert(headerVersion.length > 0, "Data Lab DEV: header version is required", errors);
  assert(latestChangelogVersion.length > 0, "Data Lab DEV: latest changelog version is required", errors);
  assert(
    headerVersion === latestChangelogVersion,
    `Data Lab DEV: header version ${headerVersion || "(missing)"} must match latest changelog ${latestChangelogVersion || "(missing)"}`,
    errors,
  );
}

function assertCoverageContract(coverage, errors) {
  const counts = coverage?.counts || {};
  const missing = Number(counts.missing_detail_files || 0);
  const covered = Number(counts.covered_detail_files || counts.detail_files || 0);
  const total = Number(counts.candidate_total || 0);
  const coveragePct = Number(counts.coverage_pct);

  assert(total > 0, "ETF coverage: candidate_total must be positive", errors);
  assert(covered >= 0 && covered <= total, "ETF coverage: covered detail count must fit candidate_total", errors);
  assert(missing === total - covered, "ETF coverage: missing_detail_files must equal candidate_total - covered_detail_files", errors);
  assert(Number.isFinite(coveragePct) && coveragePct >= 0 && coveragePct <= 100, "ETF coverage: coverage_pct must be 0..100", errors);
  assert(coverage?.missing_reason_summary && typeof coverage.missing_reason_summary === "object", "ETF coverage: missing_reason_summary is required", errors);
  assert(coverage?.missing_status_summary && typeof coverage.missing_status_summary === "object", "ETF coverage: missing_status_summary is required", errors);

  if (missing > 0) {
    assert(sumObjectValues(coverage.missing_reason_summary) === missing, "ETF coverage: missing_reason_summary must sum to missing_detail_files", errors);
    assert(sumObjectValues(coverage.missing_status_summary) === missing, "ETF coverage: missing_status_summary must sum to missing_detail_files", errors);
    assert(Array.isArray(coverage?.samples?.missing) && coverage.samples.missing.length > 0, "ETF coverage: missing samples are required when missing_detail_files > 0", errors);
  }

  if (Number(counts.yahoo_fallback_files || 0) > 0) {
    assert(Array.isArray(coverage?.samples?.yahoo_fallback) && coverage.samples.yahoo_fallback.length > 0, "ETF coverage: fallback samples are required when fallback files exist", errors);
  }
}

function assertBackfillContract(audit, incremental, incrementalPlan, pendingLedger, factsIndex, errors) {
  const auditCounts = audit?.incremental_etf?.counts || {};
  const incrementalCounts = incremental?.counts || {};
  const planCounts = incrementalPlan?.counts || {};
  const ledgerEntries = pendingLedger?.entries && typeof pendingLedger.entries === "object" && !Array.isArray(pendingLedger.entries)
    ? pendingLedger.entries
    : {};
  const ledgerRows = Object.values(ledgerEntries).filter((row) => row && typeof row === "object");
  const ledgerTracked = Number(pendingLedger?.counts?.tracked ?? auditCounts.pending_ledger_tracked ?? 0);
  const ledgerCooldown = Number(pendingLedger?.counts?.cooldown ?? auditCounts.pending_ledger_cooldown ?? 0);

  assert(audit?.incremental_etf && typeof audit.incremental_etf === "object", "Market audit: incremental_etf block is required", errors);
  assert(audit.incremental_etf.proof_file_exists === true, "Market audit: incremental_etf.proof_file_exists must be true when incremental proof exists", errors);
  assert(audit.incremental_etf.plan_file_exists === true, "Market audit: incremental_etf.plan_file_exists must be true when incremental plan exists", errors);
  assert(Number(incrementalCounts.selected ?? auditCounts.selected ?? -1) >= 0, "ETF incremental proof: selected count is required", errors);
  assert(Number(planCounts.incremental_selected ?? auditCounts.plan_selected ?? -1) >= 0, "ETF incremental plan: selected count is required", errors);
  assert(Number(planCounts.history_gap ?? auditCounts.plan_history_gap ?? -1) >= 0, "ETF incremental plan: history_gap count is required", errors);
  assert(Number(auditCounts.hard_failed ?? 0) === 0, "Market audit: hard_failed must remain zero for the current QA data pack", errors);
  assert(ledgerRows.length === ledgerTracked, "ETF pending ledger: entries count must match tracked count", errors);
  if (ledgerCooldown > 0) {
    assert(ledgerRows.some((row) => typeof row.next_attempt_after_utc === "string" && row.next_attempt_after_utc.length >= 10), "ETF pending ledger: cooldown rows need next_attempt_after_utc", errors);
  }

  const coverage = factsIndex?.coverage || audit?.market_facts?.coverage || {};
  assert(Number(coverage.etf || 0) > 0, "Market facts: ETF coverage must be present", errors);
  assert("stockanalysis_yf_fallback" in coverage, "Market facts: fallback coverage key must be present", errors);
}

function assertIncrementalPlanContract(audit, incrementalPlan, errors) {
  const auditCounts = audit?.incremental_etf?.counts || {};
  const planCounts = incrementalPlan?.counts || {};
  const nestedCounts = incrementalPlan?.incremental_etf_backfill?.counts || {};
  const plannedEtfs = Array.isArray(incrementalPlan?.etfs) ? incrementalPlan.etfs : [];
  const requiredPeriods = Array.isArray(incrementalPlan?.required_history_periods)
    ? incrementalPlan.required_history_periods
    : [];

  assert(incrementalPlan?.operation === "incremental_etf_backfill_plan", "ETF incremental plan: operation must be incremental_etf_backfill_plan", errors);
  assert(incrementalPlan?.mode === "history_gaps_only", "ETF incremental plan: mode must be history_gaps_only", errors);
  assert(incrementalPlan?.policy?.network === "none", "ETF incremental plan: policy.network must remain none", errors);
  assert(requiredPeriods.length > 0, "ETF incremental plan: at least one history period must be required", errors);
  for (const period of requiredPeriods) {
    assert(ALLOWED_HISTORY_PERIODS.has(period), `ETF incremental plan: unsupported required history period ${period}`, errors);
  }
  assert(plannedEtfs.length === Number(planCounts.etfs_planned || 0), "ETF incremental plan: etfs length must match etfs_planned", errors);
  assert(Number(planCounts.incremental_selected || 0) === Number(planCounts.etfs_planned || 0), "ETF incremental plan: incremental_selected must match etfs_planned", errors);
  assert(Number(nestedCounts.selected || 0) === Number(planCounts.incremental_selected || 0), "ETF incremental plan: nested selected count must match top-level selected count", errors);
  assert(Number(nestedCounts.history_gap || 0) === Number(planCounts.history_gap || 0), "ETF incremental plan: nested history_gap count must match top-level history_gap count", errors);
  assert(Number(nestedCounts.inception_limited_history_gap || 0) === Number(planCounts.inception_limited_history_gap || 0), "ETF incremental plan: nested inception_limited_history_gap count must match top-level count", errors);
  assert(Number(planCounts.total_history_gap ?? planCounts.history_gap ?? 0) >= Number(planCounts.history_gap || 0), "ETF incremental plan: total_history_gap must cover fetchable history_gap", errors);
  assert(Number(auditCounts.plan_selected ?? -1) === Number(planCounts.incremental_selected || 0), "Market audit: plan_selected must match incremental plan selected count", errors);
  assert(Number(auditCounts.plan_history_gap ?? -1) === Number(planCounts.history_gap || 0), "Market audit: plan_history_gap must match incremental plan history_gap count", errors);
  assert(Number(auditCounts.plan_inception_limited_history_gap ?? 0) === Number(planCounts.inception_limited_history_gap || 0), "Market audit: plan_inception_limited_history_gap must match incremental plan", errors);
  assert(Number(auditCounts.plan_total_history_gap ?? -1) === Number(planCounts.total_history_gap ?? planCounts.history_gap ?? 0), "Market audit: plan_total_history_gap must match incremental plan", errors);
  assert(audit?.incremental_etf?.plan_generated_at === incrementalPlan?.generated_at, "Market audit: plan_generated_at must match incremental plan generated_at", errors);
}

function assertHistoryGapReportContract(report, incrementalPlan, audit, errors) {
  const requiredPeriods = Array.isArray(report?.required_history_periods) ? report.required_history_periods : [];
  const planRequiredPeriods = Array.isArray(incrementalPlan?.required_history_periods) ? incrementalPlan.required_history_periods : [];
  const missingByPeriod = report?.missing_by_period || {};
  const fetchableByPeriod = report?.fetchable_by_period || {};
  const inceptionLimitedByPeriod = report?.inception_limited_by_period || {};
  const planCounts = incrementalPlan?.counts || {};
  const auditCounts = audit?.incremental_etf?.counts || {};

  assert(report?.schema_version === "stockanalysis-history-gap-report/v1", "ETF history gap report: schema version is required", errors);
  assert(typeof report?.generated_at === "string" && report.generated_at.length >= 10, "ETF history gap report: generated_at is required", errors);
  assert(requiredPeriods.length > 0, "ETF history gap report: at least one required history period is required", errors);
  assert(requiredPeriods.join(",") === planRequiredPeriods.join(","), "ETF history gap report: required periods must match incremental plan", errors);
  assert(Number(report?.primary_stockanalysis_detail_files || 0) > 0, "ETF history gap report: primary detail count must be positive", errors);
  assert(Number(report?.missing_required_history ?? -1) >= 0, "ETF history gap report: missing history count is required", errors);
  assert(Number(report?.fetchable_required_history ?? -1) >= 0, "ETF history gap report: fetchable history count is required", errors);
  assert(Number(report?.inception_limited_required_history ?? -1) >= 0, "ETF history gap report: inception-limited history count is required", errors);
  assert(
    Number(report?.missing_required_history || 0) ===
      Number(report?.fetchable_required_history || 0) + Number(report?.inception_limited_required_history || 0),
    "ETF history gap report: missing history must split into fetchable + inception-limited",
    errors,
  );
  for (const period of requiredPeriods) {
    assert(ALLOWED_HISTORY_PERIODS.has(period), `ETF history gap report: unsupported required history period ${period}`, errors);
    assert(Number(missingByPeriod[period] ?? -1) >= 0, `ETF history gap report: ${period} missing count is required`, errors);
    assert(Number(fetchableByPeriod[period] ?? -1) >= 0, `ETF history gap report: ${period} fetchable count is required`, errors);
    assert(Number(inceptionLimitedByPeriod[period] ?? -1) >= 0, `ETF history gap report: ${period} inception-limited count is required`, errors);
  }
  assert(report?.incremental_plan?.matches_current_gap === true, "ETF history gap report: plan must match current direct scan", errors);
  assert(report?.incremental_plan?.matches_total_gap === true, "ETF history gap report: plan must match total current gap", errors);
  assert(report?.incremental_plan?.matches_inception_limited === true, "ETF history gap report: plan must match inception-limited gap", errors);
  assert(Number(report?.fetchable_required_history || 0) === Number(planCounts.history_gap || 0), "ETF history gap report: fetchable count must match incremental plan history_gap", errors);
  assert(Number(report?.missing_required_history || 0) === Number(planCounts.total_history_gap ?? planCounts.history_gap ?? 0), "ETF history gap report: missing count must match incremental plan total_history_gap", errors);
  assert(Number(report?.inception_limited_required_history || 0) === Number(planCounts.inception_limited_history_gap || 0), "ETF history gap report: inception-limited count must match incremental plan", errors);
  assert(Number(report?.fetchable_required_history || 0) === Number(auditCounts.plan_history_gap || 0), "ETF history gap report: fetchable count must match market audit plan_history_gap", errors);
  if (Number(report?.fetchable_required_history || 0) > 0) {
    assert(report?.recommended_dispatch?.inputs?.history_gaps_only === "true", "ETF history gap report: fetchable gaps need history_gaps_only dispatch inputs", errors);
  } else {
    assert(report?.recommended_dispatch?.status === "not_recommended", "ETF history gap report: no fetchable gaps must disable dispatch recommendation", errors);
  }
}

function assertReturnCoverageContract(audit, errors) {
  const returnCoverage = audit?.market_facts?.return_field_coverage || {};
  const requiredFields = [
    "return_1m",
    "return_3m",
    "return_ytd",
    "return_1y",
    "return_3y_avg",
    "return_5y_avg",
    "return_10y_avg",
    "return_max_avg",
  ];

  for (const field of requiredFields) {
    assert(returnCoverage[field] && typeof returnCoverage[field] === "object", `Market facts: ${field} coverage is required`, errors);
    assert(Number(returnCoverage[field]?.etf || 0) >= 0, `Market facts: ${field} ETF coverage count is required`, errors);
  }
  assert(Number(returnCoverage.return_3m?.stockanalysis_history || 0) > 0, "Market facts: return_3m must include StockAnalysis history coverage", errors);
  assert(Number(returnCoverage.return_10y_avg?.stockanalysis_performance || 0) > 0, "Market facts: return_10y_avg must include StockAnalysis performance coverage", errors);
  assert(Number(returnCoverage.return_max_avg?.stockanalysis_performance || 0) > 0, "Market facts: return_max_avg must include StockAnalysis performance coverage", errors);
}

function assertSurfaceConsumerContract(surfaceIndex, consumers, errors) {
  const indexSurfaces = new Set((Array.isArray(surfaceIndex?.results) ? surfaceIndex.results : [])
    .map((row) => String(row?.surface || "").trim())
    .filter(Boolean));
  const rows = Array.isArray(consumers?.surfaces) ? consumers.surfaces : [];

  assert(indexSurfaces.size > 0, "Surface consumers: surfaces/index.json must have rows", errors);
  assert(rows.length === indexSurfaces.size, "Surface consumers: consumer row count must match surface index count", errors);

  for (const row of rows) {
    const surface = String(row?.surface || "").trim();
    const rowConsumers = Array.isArray(row?.consumers) ? row.consumers : [];
    assert(indexSurfaces.has(surface), `${surface || "(blank)"}: consumer surface must exist in surfaces/index.json`, errors);
    assert(rowConsumers.length > 0, `${surface}: at least one active consumer is required`, errors);
    for (const consumer of rowConsumers) {
      const route = String(consumer?.route || "").trim();
      const label = String(consumer?.label || "").trim();
      assert(label.length > 0, `${surface}: consumer label is required`, errors);
      assert(ACTIVE_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`)), `${surface}: inactive or unknown consumer route '${route}'`, errors);
    }
  }
}

function asRows(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const tableRecords = Array.isArray(payload?.tables)
    ? payload.tables.flatMap((table) => Array.isArray(table?.records) ? table.records : [])
    : [];
  return [...records, ...tableRecords].filter((row) => row && typeof row === "object");
}

function cleanTicker(value) {
  return String(value ?? "").replace(/^\$/, "").trim().toUpperCase();
}

function buildEtfUniverseApiPayload(universe, screener) {
  const rows = new Map();
  for (const row of asRows(universe)) {
    const ticker = cleanTicker(row.ticker ?? row.s ?? row.symbol);
    if (ticker) rows.set(ticker, { ticker });
  }
  let screenerOnly = 0;
  for (const row of asRows(screener)) {
    const ticker = cleanTicker(row.s ?? row.ticker ?? row.symbol);
    if (!ticker) continue;
    if (!rows.has(ticker)) screenerOnly += 1;
    rows.set(ticker, {
      ...(rows.get(ticker) || {}),
      ticker,
      price: row.price,
      volume: row.volume,
      holdings: row.holdings,
    });
  }
  const mergedRows = [...rows.values()];
  return {
    generated_at: universe?.generated_at ?? screener?.fetched_at ?? null,
    screener_fetched_at: screener?.fetched_at ?? null,
    counts: {
      records: mergedRows.length,
      with_price: mergedRows.filter((row) => typeof row.price === "number").length,
      with_volume: mergedRows.filter((row) => typeof row.volume === "number").length,
      with_holdings: mergedRows.filter((row) => typeof row.holdings === "number").length,
      screener_only: screenerOnly,
    },
  };
}

function renderMarketAuditHtml(payloads) {
  const context = {
    console: {
      log() {},
      warn: console.warn,
      error: console.error,
    },
    window: {},
    marketAuditContainer: { innerHTML: "" },
  };
  const formattersCode = `${readText(FORMATTERS_PATH)}\nglobalThis.Formatters = Formatters;`;
  const rendererCode = `${readText(PUBLIC_RENDERER_PATH)}\nglobalThis.Renderer = Renderer;`;
  vm.runInNewContext(formattersCode, context, { filename: FORMATTERS_PATH });
  vm.runInNewContext(rendererCode, context, { filename: PUBLIC_RENDERER_PATH });
  context.Renderer.init({ marketAuditContainer: context.marketAuditContainer });
  context.Renderer.renderMarketDataAudit(
    payloads.audit,
    payloads.sourceParity,
    payloads.stockanalysisIndex,
    payloads.coverage,
    payloads.classification,
    payloads.surfaceIndex,
    payloads.surfaceConsumers,
    payloads.etfUniverse,
    payloads.etfUniverseApi,
    payloads.newEtfs,
    payloads.incremental,
    payloads.incrementalPlan,
    payloads.historyGapReport,
    payloads.pendingLedger,
    payloads.marketFactsIndex,
  );
  return context.marketAuditContainer.innerHTML;
}

function assertRenderedMarketAudit(payloads, errors) {
  const html = renderMarketAuditHtml(payloads);
  assert(html.length > 1000, "Rendered Data Lab market audit HTML is unexpectedly short", errors);
  for (const label of REQUIRED_RENDERED_SECTIONS) {
    assert(html.includes(label), `Rendered Data Lab market audit is missing '${label}'`, errors);
  }
  for (const label of REJECTED_RENDERED_COPY) {
    assert(!html.includes(label), `Rendered Data Lab market audit exposes rejected copy '${label}'`, errors);
  }
}

const errors = [];

assertMirror("Data Lab dashboard", "../admin/data-lab/app/dashboard.js", "public/admin/data-lab/app/dashboard.js", errors);
assertMirror("Data Lab renderer", "../admin/data-lab/app/renderer.js", "public/admin/data-lab/app/renderer.js", errors);
assertMirror("Data Lab DEV", DATA_LAB_DEV_SOURCE_PATH, DATA_LAB_DEV_PUBLIC_PATH, errors);
assertDataLabDevVersion(errors);
for (const [label, sourceRelPath, publicRelPath] of JSON_PAIRS) {
  assertMirror(label, sourceRelPath, publicRelPath, errors);
}

const payloads = {
  audit: readJson("public/data/computed/market_data_audit.json"),
  sourceParity: readJson("public/data/computed/market_source_parity.json"),
  stockanalysisIndex: readJson("public/data/stockanalysis/index.json"),
  coverage: readJson("public/data/stockanalysis/coverage/etf_detail.json"),
  classification: readJson("public/data/stockanalysis/classification/latest.json"),
  surfaceIndex: readJson("public/data/stockanalysis/surfaces/index.json"),
  surfaceConsumers: readJson("public/data/stockanalysis/surface_consumers.json"),
  etfUniverse: readJson("public/data/stockanalysis/etf_universe.json"),
  etfScreener: readJson("public/data/stockanalysis/surfaces/etf_screener.json"),
  newEtfs: readJson("public/data/stockanalysis/surfaces/new_etfs.json"),
  incremental: readJson("public/data/stockanalysis/backfill/incremental_latest.json"),
  incrementalPlan: readJson("public/data/stockanalysis/backfill/incremental_plan_latest.json"),
  historyGapReport: readJson("public/data/stockanalysis/backfill/history_gap_report_latest.json"),
  pendingLedger: readJson("public/data/stockanalysis/backfill/pending_ledger.json"),
  marketFactsIndex: readJson("public/data/computed/market_facts/index.json"),
};
payloads.etfUniverseApi = buildEtfUniverseApiPayload(payloads.etfUniverse, payloads.etfScreener);

assertCoverageContract(payloads.coverage, errors);
assertBackfillContract(payloads.audit, payloads.incremental, payloads.incrementalPlan, payloads.pendingLedger, payloads.marketFactsIndex, errors);
assertIncrementalPlanContract(payloads.audit, payloads.incrementalPlan, errors);
assertHistoryGapReportContract(payloads.historyGapReport, payloads.incrementalPlan, payloads.audit, errors);
assertReturnCoverageContract(payloads.audit, errors);
assertSurfaceConsumerContract(payloads.surfaceIndex, payloads.surfaceConsumers, errors);
assertRenderedMarketAudit(payloads, errors);

if (errors.length > 0) {
  console.error("stockanalysis market audit check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("stockanalysis market audit check passed");
