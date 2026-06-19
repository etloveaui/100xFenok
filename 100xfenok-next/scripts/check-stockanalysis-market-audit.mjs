#!/usr/bin/env node

import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = process.cwd();

const PUBLIC_RENDERER_PATH = `${ROOT}/public/admin/data-lab/app/renderer.js`;
const FORMATTERS_PATH = `${ROOT}/public/admin/shared/core/formatters.js`;

const JSON_PAIRS = [
  ["ETF universe", "../data/stockanalysis/etf_universe.json", "public/data/stockanalysis/etf_universe.json"],
  ["ETF coverage", "../data/stockanalysis/coverage/etf_detail.json", "public/data/stockanalysis/coverage/etf_detail.json"],
  ["ETF incremental proof", "../data/stockanalysis/backfill/incremental_latest.json", "public/data/stockanalysis/backfill/incremental_latest.json"],
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
  "/stock/[ticker]",
];

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
  "ETF 수집 대기열",
  "지금 재시도 가능",
  "소스 일치성 진단 상세",
];

const REJECTED_RENDERED_COPY = [
  "데이터 묶음 정리",
  "원본 묶음",
  "제외 묶음",
  "Source Parity",
  "Top Stale",
  "Top Sign Divergence",
  "Universe rows",
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

function assertBackfillContract(audit, incremental, pendingLedger, factsIndex, errors) {
  const auditCounts = audit?.incremental_etf?.counts || {};
  const incrementalCounts = incremental?.counts || {};
  const ledgerEntries = pendingLedger?.entries && typeof pendingLedger.entries === "object" && !Array.isArray(pendingLedger.entries)
    ? pendingLedger.entries
    : {};
  const ledgerRows = Object.values(ledgerEntries).filter((row) => row && typeof row === "object");
  const ledgerTracked = Number(pendingLedger?.counts?.tracked ?? auditCounts.pending_ledger_tracked ?? 0);
  const ledgerCooldown = Number(pendingLedger?.counts?.cooldown ?? auditCounts.pending_ledger_cooldown ?? 0);

  assert(audit?.incremental_etf && typeof audit.incremental_etf === "object", "Market audit: incremental_etf block is required", errors);
  assert(audit.incremental_etf.proof_file_exists === true, "Market audit: incremental_etf.proof_file_exists must be true when incremental proof exists", errors);
  assert(Number(incrementalCounts.selected ?? auditCounts.selected ?? -1) >= 0, "ETF incremental proof: selected count is required", errors);
  assert(Number(auditCounts.hard_failed ?? 0) === 0, "Market audit: hard_failed must remain zero for the current QA data pack", errors);
  assert(ledgerRows.length === ledgerTracked, "ETF pending ledger: entries count must match tracked count", errors);
  if (ledgerCooldown > 0) {
    assert(ledgerRows.some((row) => typeof row.next_attempt_after_utc === "string" && row.next_attempt_after_utc.length >= 10), "ETF pending ledger: cooldown rows need next_attempt_after_utc", errors);
  }

  const coverage = factsIndex?.coverage || audit?.market_facts?.coverage || {};
  assert(Number(coverage.etf || 0) > 0, "Market facts: ETF coverage must be present", errors);
  assert("stockanalysis_yf_fallback" in coverage, "Market facts: fallback coverage key must be present", errors);
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
  pendingLedger: readJson("public/data/stockanalysis/backfill/pending_ledger.json"),
  marketFactsIndex: readJson("public/data/computed/market_facts/index.json"),
};
payloads.etfUniverseApi = buildEtfUniverseApiPayload(payloads.etfUniverse, payloads.etfScreener);

assertCoverageContract(payloads.coverage, errors);
assertBackfillContract(payloads.audit, payloads.incremental, payloads.pendingLedger, payloads.marketFactsIndex, errors);
assertSurfaceConsumerContract(payloads.surfaceIndex, payloads.surfaceConsumers, errors);
assertRenderedMarketAudit(payloads, errors);

if (errors.length > 0) {
  console.error("stockanalysis market audit check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("stockanalysis market audit check passed");
