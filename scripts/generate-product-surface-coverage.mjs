#!/usr/bin/env node
/**
 * Build product-surface readiness from current DataPack files.
 *
 * This is the product-facing bridge over Data Spine: it does not fetch external
 * data and it does not decide valuation authority. It translates existing
 * coverage/freshness/provenance files into screen-level readiness.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(ROOT, "100xfenok-next", "public", "data");

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, relPath), "utf8"));
  } catch {
    return null;
  }
}

function countJsonFiles(relDir, { recursive = false } = {}) {
  const dir = path.join(DATA_ROOT, relDir);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      count += countJsonFiles(path.relative(DATA_ROOT, full), { recursive: true });
    } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "schema.json") {
      count += 1;
    }
  }
  return count;
}

function exists(relPath) {
  return fs.existsSync(path.join(DATA_ROOT, relPath));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(done, total) {
  const numerator = number(done);
  const denominator = number(total);
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function statusLabel(status) {
  return {
    ready: "준비됨",
    partial: "부분 준비",
    stale: "오래됨",
    pending: "대기",
    unavailable: "미수집",
    error: "오류",
  }[status] || "점검";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function firstDate(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function dateOnly(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function latestDate(...values) {
  return values
    .map((value) => ({ raw: firstDate(value), key: dateOnly(value) }))
    .filter((item) => item.raw && item.key)
    .sort((a, b) => a.key.localeCompare(b.key))
    .at(-1)?.raw ?? null;
}

function ageDays(value, now = Date.now()) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

function freshness(label, asOf, maxAgeDays, { warnOnly = false } = {}) {
  const days = ageDays(asOf);
  if (!asOf || days === null) {
    return check(
      label,
      warnOnly ? "ready" : "unavailable",
      warnOnly ? "수집 요약 없음(경고)" : "기준일 없음",
      warnOnly
        ? { as_of: asOf ?? null, age_days: null, max_age_days: maxAgeDays, warn_only: true }
        : { as_of: asOf ?? null, max_age_days: maxAgeDays },
    );
  }
  const stale = days > maxAgeDays;
  return check(
    label,
    warnOnly ? "ready" : stale ? "stale" : "ready",
    stale && warnOnly
      ? `기준 ${dateOnly(asOf) ?? asOf} · ${days}일 전 (경고: ${maxAgeDays}일 초과 노후화)`
      : `기준 ${dateOnly(asOf) ?? asOf} · ${days}일 전`,
    { as_of: asOf, age_days: days, max_age_days: maxAgeDays, warn_only: warnOnly ? stale : undefined },
  );
}

function check(label, status, detail, extra = {}) {
  return {
    label,
    status,
    status_label: statusLabel(status),
    detail,
    ...extra,
  };
}

function surfaceStatus(checks) {
  if (checks.some((item) => item.status === "error")) return "error";
  if (checks.some((item) => item.status === "unavailable")) return "unavailable";
  if (checks.some((item) => item.status === "stale")) return "stale";
  if (checks.some((item) => item.status === "pending")) return "pending";
  if (checks.some((item) => item.status === "partial")) return "partial";
  return "ready";
}

function surface(id, route, label, owner, checks, summary, meta = {}) {
  const status = surfaceStatus(checks);
  const connected = checks.filter((item) => item.status === "ready").length;
  return {
    id,
    route,
    label,
    owner,
    status,
    status_label: statusLabel(status),
    coverage_score: pct(connected, checks.length),
    summary,
    checks,
    ...meta,
  };
}

function surfaceConsumerMap(consumers) {
  const map = new Map();
  const rows = Array.isArray(consumers?.surfaces) ? consumers.surfaces : [];
  for (const row of rows) {
    const surfaceName = String(row?.surface || "").trim();
    if (!surfaceName) continue;
    const routes = (Array.isArray(row?.consumers) ? row.consumers : [])
      .map((consumer) => String(consumer?.route || "").trim())
      .filter(Boolean);
    map.set(surfaceName, routes);
  }
  return map;
}

function surfaceRowsForRoute(surfaceIndex, consumers, routePrefix) {
  const map = surfaceConsumerMap(consumers);
  const rows = Array.isArray(surfaceIndex?.results) ? surfaceIndex.results : [];
  const matched = rows.filter((row) => {
    const routes = map.get(String(row?.surface || "")) || [];
    return routes.some((route) => route === routePrefix || route.startsWith(`${routePrefix}/`));
  });
  return {
    surfaceCount: matched.length,
    rowCount: matched.reduce((sum, row) => sum + number(row?.rows), 0),
    names: matched.map((row) => String(row?.surface || "")).filter(Boolean).sort(),
  };
}

const marketFactsIndex = readJson("computed/market_facts/index.json");
const marketAudit = readJson("computed/market_data_audit.json");
const sourceParity = readJson("computed/market_source_parity.json");
const etfCoverage = readJson("stockanalysis/coverage/etf_detail.json");
const surfaceIndex = readJson("stockanalysis/surfaces/index.json");
const surfaceConsumers = readJson("stockanalysis/surface_consumers.json");
const etfUniverse = readJson("stockanalysis/etf_universe.json");
const dataUsage = readJson("admin/data-usage-manifest.json");
const stockFieldManifest = readJson("admin/stock-field-usage-manifest.json");
const stocksAnalyzer = readJson("global-scouter/core/stocks_analyzer.json");
const actionSummary = readJson("computed/stock_action_summary.json");
const yfSummary = readJson("yf/finance/_summary.json");
const edgarIndex = readJson("edgar-korean-summaries/index.json");
const rimIndexInputs = readJson("computed/rim-index/inputs.json");
const yardneyModel = readJson("yardney/yardney_model.json");

const counts = {
  marketFactsTickers: number(marketFactsIndex?.count) || countJsonFiles("computed/market_facts/tickers"),
  marketFactsEtfs: number(marketFactsIndex?.coverage?.etf),
  marketFactsStocks: number(marketFactsIndex?.coverage?.stock),
  yfFinance: countJsonFiles("yf/finance"),
  globalScouterDetails: countJsonFiles("global-scouter/stocks/detail"),
  stockanalysisEtfs: countJsonFiles("stockanalysis/etfs"),
  stockanalysisStocks: countJsonFiles("stockanalysis/stocks"),
  stockanalysisFinancials: countJsonFiles("stockanalysis/financials"),
  sec13fJson: countJsonFiles("sec-13f", { recursive: true }),
  edgarByTicker: countJsonFiles("edgar-korean-summaries/by-ticker"),
  slickchartsJson: countJsonFiles("slickcharts", { recursive: true }),
  dataUsageRootJson: number(dataUsage?.totals?.rootJsonCount),
  dataUsagePublicJson: number(dataUsage?.totals?.publicJsonCount),
};

const etfCounts = etfCoverage?.counts || {};
const paritySummary = sourceParity?.summary || marketAudit?.market_source_parity?.summary || {};
const returnCoverage = marketAudit?.market_facts?.return_field_coverage || {};
const generatedAt = new Date().toISOString();
const eventSurfaceAsOf = latestDate(surfaceIndex?.generated_at, surfaceIndex?.fetched_at);
const etfAsOf = latestDate(etfUniverse?.generated_at, etfUniverse?.fetched_at, etfCoverage?.generated_at);
const screenerAsOf = latestDate(stocksAnalyzer?.generated_at, stocksAnalyzer?.source_date, actionSummary?.generated_at);
const yfAsOf = yfSummary?.generated_at ?? null;
const marketFactsAsOf = latestDate(marketFactsIndex?.generated_at, sourceParity?.generated_at, marketAudit?.generated_at);
const edgarAsOf = latestDate(edgarIndex?.generated_at, edgarIndex?.generatedAt, edgarIndex?.updated_at, edgarIndex?.updated);
const rimIndexAsOf = latestDate(rimIndexInputs?.generated_at, rimIndexInputs?.meta?.generated_at);
const yardneyRows = Array.isArray(yardneyModel?.data) ? yardneyModel.data : [];
const yardneyLatest = yardneyRows.at(-1) ?? null;
const yardneyAsOf = latestDate(
  yardneyLatest?.date,
  yardneyModel?.meta?.last_update?.last_public_date,
  yardneyModel?.meta?.generated_at,
);
const eventSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/market/events");
const sectorSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/sectors");
const stockSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/stock/[ticker]");
const etfSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/etfs");

const surfaces = [
  surface(
    "stock_detail",
    "/stock/[ticker]",
    "종목 상세",
    "Stock detail",
    [
      check("통합 시세", counts.marketFactsTickers > 0 ? "ready" : "unavailable", `${counts.marketFactsTickers.toLocaleString("ko-KR")}개 티커`, { count: counts.marketFactsTickers }),
      check("기본 분석", counts.globalScouterDetails > 0 ? "ready" : "unavailable", `${counts.globalScouterDetails.toLocaleString("ko-KR")}개 상세`, { count: counts.globalScouterDetails }),
      check("가격·재무 캐시", counts.yfFinance > 0 ? "ready" : "unavailable", `${counts.yfFinance.toLocaleString("ko-KR")}개 캐시`, { count: counts.yfFinance }),
      check("보조 재무 검산", counts.stockanalysisFinancials >= 100 ? "ready" : counts.stockanalysisFinancials > 0 ? "partial" : "unavailable", `${counts.stockanalysisFinancials.toLocaleString("ko-KR")}개 후보`, { count: counts.stockanalysisFinancials, reason: "검산 후보이며 가치평가 SSOT가 아님" }),
      check("기관 공시", counts.sec13fJson > 0 ? "ready" : "unavailable", `${counts.sec13fJson.toLocaleString("ko-KR")}개 13F JSON`, { count: counts.sec13fJson }),
      check("한글 공시", counts.edgarByTicker > 0 ? "partial" : "unavailable", `${counts.edgarByTicker.toLocaleString("ko-KR")}개 by-ticker`, { count: counts.edgarByTicker, reason: "요약 보유 티커만 표시" }),
      check("이벤트 보강", stockSurfaces.surfaceCount > 0 ? "ready" : "pending", `${stockSurfaces.surfaceCount}개 화면 연결`, { count: stockSurfaces.surfaceCount }),
      freshness("가격 기준일", marketFactsAsOf, 7),
      freshness("야후 파이낸스 수집일", yfAsOf, 8),
      freshness("공시 요약 기준일", edgarAsOf, 14),
    ],
    "가격, 기본 분석, 공시, 기관 데이터를 같은 화면에서 연결한다. 재무 검산·한글 공시는 커버리지 제한을 명시한다.",
    { as_of: latestDate(marketFactsAsOf, edgarAsOf, screenerAsOf) },
  ),
  surface(
    "market_valuation",
    "/market-valuation",
    "시장 밸류에이션",
    "Market valuation",
    [
      check("밸류에이션 시계열", exists("benchmarks/summaries.json") ? "ready" : "unavailable", "벤치마크 요약"),
      check("거시·심리", counts.dataUsageRootJson > 0 ? "ready" : "pending", `${counts.dataUsageRootJson.toLocaleString("ko-KR")}개 루트 JSON`, { count: counts.dataUsageRootJson }),
      check("시장 구조", exists("computed/market_structure_index.json") ? "ready" : "pending", "시장 구조 인덱스"),
      check("소스 일치성", number(paritySummary.multi_candidate_fields) > 0 ? "partial" : "pending", `${number(paritySummary.multi_candidate_fields).toLocaleString("ko-KR")}개 복수 후보`, { count: number(paritySummary.multi_candidate_fields), reason: "차이·오래됨·부호 차이를 Data Lab에서 계속 노출" }),
      freshness("RIM 입력 기준일", rimIndexAsOf, 2),
      freshness("Yardeni 기준일", yardneyAsOf, 7),
      freshness("야후 파이낸스 수집일", yfAsOf, 8),
      freshness("시장 데이터 기준일", marketFactsAsOf, 7),
    ],
    "시장 화면은 값 자체보다 기준일, 커버리지, 소스 차이를 함께 보여야 한다.",
    { as_of: marketFactsAsOf },
  ),
  surface(
    "market_events",
    "/market/events",
    "시장 이벤트",
    "Market events",
    [
      check("이벤트 수집 표면", eventSurfaces.surfaceCount > 0 ? "ready" : "unavailable", `${eventSurfaces.surfaceCount}개 항목 · ${eventSurfaces.rowCount.toLocaleString("ko-KR")}행`, { count: eventSurfaces.surfaceCount, rows: eventSurfaces.rowCount }),
      check("어닝 일정", eventSurfaces.names.includes("earnings_calendar") ? "ready" : "unavailable", "어닝 캘린더"),
      check("기업 이벤트", eventSurfaces.names.includes("actions_recent") ? "ready" : "pending", "액션/분할"),
      check("IPO", eventSurfaces.names.some((name) => name.startsWith("ipos_")) ? "ready" : "pending", "IPO 표면"),
      check("급등락", eventSurfaces.names.some((name) => name.startsWith("market_")) ? "ready" : "pending", "무버 표면"),
      freshness("이벤트 표면 기준일", eventSurfaceAsOf, 7),
    ],
    "시장 이벤트는 수집 표면별 준비 상태가 곧 화면 준비 상태다.",
    { as_of: eventSurfaceAsOf },
  ),
  surface(
    "sectors",
    "/sectors",
    "섹터",
    "Sectors",
    [
      check("섹터 흐름", exists("benchmarks/summaries.json") ? "ready" : "pending", "섹터 모멘텀"),
      check("산업 세분화", sectorSurfaces.surfaceCount > 0 ? "ready" : "pending", `${sectorSurfaces.surfaceCount}개 항목 · ${sectorSurfaces.rowCount.toLocaleString("ko-KR")}행`, { count: sectorSurfaces.surfaceCount, rows: sectorSurfaces.rowCount }),
      check("기관 보유", counts.sec13fJson > 0 ? "ready" : "pending", `${counts.sec13fJson.toLocaleString("ko-KR")}개 13F JSON`, { count: counts.sec13fJson }),
      freshness("야후 파이낸스 수집일", yfAsOf, 8),
      freshness("섹터 데이터 기준일", latestDate(eventSurfaceAsOf, marketFactsAsOf), 14),
    ],
    "섹터 화면은 섹터 ETF 흐름, 산업 분류, 기관 보유를 한 책임 화면으로 묶는다.",
    { as_of: latestDate(eventSurfaceAsOf, marketFactsAsOf) },
  ),
  surface(
    "etf_center",
    "/etfs",
    "ETF 센터",
    "ETF center",
    [
      check("ETF 전체 목록", number(etfUniverse?.counts?.records) > 0 ? "ready" : "unavailable", `${number(etfUniverse?.counts?.records).toLocaleString("ko-KR")}개 ETF`, { count: number(etfUniverse?.counts?.records) }),
      check("ETF 상세", number(etfCounts.covered_detail_files) > 0 ? (number(etfCounts.missing_detail_files) > 0 ? "partial" : "ready") : "unavailable", `${number(etfCounts.covered_detail_files).toLocaleString("ko-KR")} / ${number(etfCounts.candidate_total).toLocaleString("ko-KR")}개`, { count: number(etfCounts.covered_detail_files), total: number(etfCounts.candidate_total), missing: number(etfCounts.missing_detail_files), coverage_pct: number(etfCounts.coverage_pct) }),
      check("기간 수익률", number(returnCoverage.return_1y?.etf) > 0 ? "ready" : "pending", `1Y ${number(returnCoverage.return_1y?.etf).toLocaleString("ko-KR")}개`, { count: number(returnCoverage.return_1y?.etf) }),
      check("신규·전략 ETF", etfSurfaces.surfaceCount > 0 ? "ready" : "pending", `${etfSurfaces.surfaceCount}개 항목 · ${etfSurfaces.rowCount.toLocaleString("ko-KR")}행`, { count: etfSurfaces.surfaceCount, rows: etfSurfaces.rowCount }),
      freshness("ETF 기준일", etfAsOf, 7),
    ],
    "ETF는 제품 준비도가 높다. 남은 누락은 재시도/분류 대기 상태로 공개 화면과 Data Lab에 같이 드러낸다.",
    { as_of: etfAsOf },
  ),
  surface(
    "screener",
    "/screener",
    "스크리너",
    "Screener",
    [
      check("기본 종목 테이블", exists("global-scouter/core/stocks_analyzer.json") ? "ready" : "unavailable", "stocks_analyzer"),
      check("필드 사용 감사", stockFieldManifest?.totals ? "ready" : "pending", `${number(stockFieldManifest?.totals?.fieldCount || stockFieldManifest?.totals?.fields).toLocaleString("ko-KR")}개 필드`, { count: number(stockFieldManifest?.totals?.fieldCount || stockFieldManifest?.totals?.fields) }),
      check("상세 패널", counts.globalScouterDetails > 0 ? "ready" : "pending", `${counts.globalScouterDetails.toLocaleString("ko-KR")}개 상세`, { count: counts.globalScouterDetails }),
      freshness("스크리너 기준일", screenerAsOf, 7),
    ],
    "스크리너는 종목 발견 화면이며 필드 사용 감사와 함께 미사용 데이터를 줄여간다.",
    { as_of: screenerAsOf },
  ),
  surface(
    "admin_data_lab",
    "/admin/data-lab",
    "Admin Data Lab",
    "Admin data lab",
    [
      check("미러/사용 현황", dataUsage ? "ready" : "unavailable", `${counts.dataUsageRootJson.toLocaleString("ko-KR")} / ${counts.dataUsagePublicJson.toLocaleString("ko-KR")} JSON`, { root: counts.dataUsageRootJson, public: counts.dataUsagePublicJson }),
      check("시장 데이터 감사", marketAudit ? "ready" : "unavailable", "market_data_audit"),
      check("화면 연결 지도", surfaceConsumers ? "ready" : "pending", `${Array.isArray(surfaceConsumers?.surfaces) ? surfaceConsumers.surfaces.length : 0}개 표면`, { count: Array.isArray(surfaceConsumers?.surfaces) ? surfaceConsumers.surfaces.length : 0 }),
      check("제품 화면 준비도", "ready", "product-surface-coverage"),
      freshness("준비도 기준일", generatedAt, 1),
    ],
    "Data Lab은 파일 기준 감사에서 제품 화면 기준 감사까지 이어지는 운영 화면이다.",
    { as_of: generatedAt },
  ),
];

const summary = surfaces.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});

const payload = {
  schema_version: "product-surface-coverage/v1",
  generated_at: generatedAt,
  source: "local DataPack coverage files",
  source_files: [
    "computed/market_facts/index.json",
    "computed/market_data_audit.json",
    "computed/market_source_parity.json",
    "global-scouter/core/stocks_analyzer.json",
    "computed/stock_action_summary.json",
    "computed/rim-index/inputs.json",
    "yardney/yardney_model.json",
    "yf/finance/_summary.json",
    "edgar-korean-summaries/index.json",
    "stockanalysis/index.json",
    "stockanalysis/coverage/etf_detail.json",
    "stockanalysis/surfaces/index.json",
    "stockanalysis/surface_consumers.json",
    "admin/data-usage-manifest.json",
    "admin/stock-field-usage-manifest.json",
  ],
  totals: {
    surfaces: surfaces.length,
    ready: summary.ready || 0,
    partial: summary.partial || 0,
    stale: summary.stale || 0,
    pending: summary.pending || 0,
    unavailable: summary.unavailable || 0,
    error: summary.error || 0,
  },
  counts,
  surfaces,
};

for (const targetRoot of [DATA_ROOT, PUBLIC_DATA_ROOT]) {
  const outPath = path.join(targetRoot, "admin", "product-surface-coverage.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

console.log(`product surface coverage written: ${surfaces.length} surfaces`);
