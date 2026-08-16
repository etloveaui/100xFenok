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
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { businessDayAge, isRealCalendarDate } from "./lib/market-calendar.mjs";
import {
  PRODUCT_SURFACE_DATELESS_REASON,
  PRODUCT_SURFACE_COVERAGE_SCHEMA_VERSION,
  PRODUCT_SURFACE_STAMP_VERSION,
} from "./lib/kpi-contract-constants.mjs";
import { deriveProductSurfaceStampEvidence } from "./lib/product-surface-stamp-v2.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Injectable data root so fixtures can run the REAL generator against a temp root
// (env PS_DATA_ROOT or --data-root <dir>). When set: reads <dir>/data, writes both
// <dir>/data and <dir>/public/data. Default = live repo layout.
function resolveDataRootArg() {
  const flagIdx = process.argv.indexOf("--data-root");
  if (flagIdx >= 0 && flagIdx + 1 < process.argv.length) return process.argv[flagIdx + 1];
  const eq = process.argv.find((a) => a.startsWith("--data-root="));
  if (eq) return eq.slice("--data-root=".length);
  return process.env.PS_DATA_ROOT || null;
}
const DATA_ROOT_ARG = resolveDataRootArg();
const DATA_ROOT = DATA_ROOT_ARG ? path.join(DATA_ROOT_ARG, "data") : path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = DATA_ROOT_ARG
  ? path.join(DATA_ROOT_ARG, "public", "data")
  : path.join(ROOT, "100xfenok-next", "public", "data");

function readJson(relPath) {
  const fullPath = path.join(DATA_ROOT, relPath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read valid JSON from ${fullPath}: ${error?.message || error}`, { cause: error });
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
const NO_AGGREGATE_SOURCE_DATE = "provider publishes no aggregate source date";
const SOURCE_FLOOR_UNAVAILABLE = "producer has not emitted a complete source-date floor";
const INTERNAL_ARTIFACT_CLOCK = "internal artifact uses generation time; no upstream source date";

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

// TRUE source stamp (KPI v2 §5): OLDEST of a surface's genuine nested SOURCE dates.
// Fail-closed — if ANY listed input is missing OR not a REAL-CALENDAR date (full
// YYYY-MM-DD, real month/day, no trailing junk — rev5.5), the stamp is null (the KPI
// keeps the surface pending; no guessing). NEVER pass a rebuild generated_at here.
function oldestSourceDate(values) {
  const cleaned = values.map((value) => (typeof value === "string" ? value.trim() : value));
  if (cleaned.length === 0 || cleaned.some((value) => !isRealCalendarDate(value))) return null;
  return [...cleaned].sort()[0];
}

function ageDays(value, now = Date.now()) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

function freshness(label, asOf, maxAgeDays, { warnOnly = false, calendar = null, missingReason = SOURCE_FLOOR_UNAVAILABLE } = {}) {
  // Keep fixture and production evaluations on the same clock. The generator
  // already accepts PS_GENERATED_AT for deterministic stamp evidence; using
  // wall-clock time here made a fully fresh fixture appear stale as the test
  // date aged, while the emitted generated_at claimed the injected clock.
  const clockMs = new Date(generatedAt).getTime();
  const clockDate = new Date(clockMs).toISOString().slice(0, 10);
  const days = calendar
    ? businessDayAge(dateOnly(asOf), clockDate, calendar)
    : ageDays(asOf, clockMs);
  if (!asOf || days === null) {
    return check(
      label,
      warnOnly ? "pending" : "unavailable",
      warnOnly ? "원천 기준일 없음(경고)" : "기준일 없음",
      warnOnly
        ? { as_of: asOf ?? null, age_days: null, max_age_days: maxAgeDays, calendar, warn_only: true, reason: missingReason }
        : { as_of: asOf ?? null, age_days: null, max_age_days: maxAgeDays, calendar, reason: missingReason },
    );
  }
  const stale = days > maxAgeDays;
  return check(
    label,
    stale ? "stale" : "ready",
    `기준 ${dateOnly(asOf) ?? asOf} · ${days}일 전${stale && warnOnly ? ` (경고: ${maxAgeDays}일 초과 노후화)` : ""}`,
    { as_of: asOf, age_days: days, max_age_days: maxAgeDays, calendar, warn_only: warnOnly || undefined },
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

function sourceStamp(sourceAsOf, missingReason = SOURCE_FLOOR_UNAVAILABLE) {
  return {
    source_as_of: sourceAsOf ?? null,
    source_as_of_reason: sourceAsOf ? null : missingReason,
  };
}

function dateMember(id, sourceAsOf) {
  return { id, stamp_class: "date_bearing", source_as_of: sourceAsOf ?? null };
}

function datelessMembers(names) {
  return names.map((name) => {
    const payload = readJson(`stockanalysis/surfaces/${name}.json`);
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, "source_as_of")) {
      throw new Error(`${name}: dateless_by_provider payload must carry source_as_of:null`);
    }
    if (payload?.source_as_of != null) {
      throw new Error(`${name}: provider now publishes a date; reclassify surface to date_bearing`);
    }
    return {
      id: `stockanalysis:${name}`,
      stamp_class: "dateless_by_provider",
      source_as_of: null,
      source_as_of_reason: payload?.source_as_of_reason ?? null,
      collected_at: payload?.fetched_at ?? null,
      recency_label: PRODUCT_SURFACE_DATELESS_REASON,
    };
  });
}

function trueSourceDate(value) {
  if (value == null) return null;
  if (isRealCalendarDate(value)) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime())) {
    const day = value.slice(0, 10);
    if (isRealCalendarDate(day)) return day;
  }
  return value;
}

function stampEvidence(members) {
  return deriveProductSurfaceStampEvidence(members, generatedAt);
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

function contractedSurfaceNamesForRoute(consumers, routePrefix) {
  const names = [];
  for (const [name, routes] of surfaceConsumerMap(consumers)) {
    if (routes.some((route) => route === routePrefix || route.startsWith(`${routePrefix}/`))) names.push(name);
  }
  return names.sort();
}

const marketFactsIndex = readJson("computed/market_facts/index.json");
const marketAudit = readJson("computed/market_data_audit.json");
const sourceParity = readJson("computed/market_source_parity.json");
const etfCoverage = readJson("stockanalysis/coverage/etf_detail.json");
const dataSupplyEtfIndex = readJson("computed/data-supply/etf-detail/index.json");
const surfaceIndex = readJson("stockanalysis/surfaces/index.json");
const surfaceConsumers = readJson("stockanalysis/surface_consumers.json");
const stockanalysisIndex = readJson("stockanalysis/index.json");
const etfUniverse = readJson("stockanalysis/etf_universe.json");
const dataUsage = readJson("admin/data-usage-manifest.json");
const stockFieldManifest = readJson("admin/stock-field-usage-manifest.json");
const stocksAnalyzer = readJson("global-scouter/core/stocks_analyzer.json");
const actionSummary = readJson("computed/stock_action_summary.json");
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
const r2EtfCounts = dataSupplyEtfIndex?.schema_version === "data-supply-etf-detail-public-index/v1"
  ? {
      enrolled: number(dataSupplyEtfIndex.enrolled_count),
      selected: number(dataSupplyEtfIndex.selected_count),
      unavailable: number(dataSupplyEtfIndex.unavailable_count),
    }
  : null;
const effectiveEtfDetail = r2EtfCounts
  ? {
      available: counts.stockanalysisEtfs + r2EtfCounts.selected,
      total: counts.stockanalysisEtfs + r2EtfCounts.enrolled,
      unavailable: r2EtfCounts.unavailable,
    }
  : {
      available: number(etfCounts.covered_detail_files),
      total: number(etfCounts.candidate_total),
      unavailable: number(etfCounts.missing_detail_files),
    };
effectiveEtfDetail.coveragePct = pct(effectiveEtfDetail.available, effectiveEtfDetail.total);
const paritySummary = sourceParity?.summary || marketAudit?.market_source_parity?.summary || {};
const returnCoverage = marketAudit?.market_facts?.return_field_coverage || {};
const generatedAt = process.env.PS_GENERATED_AT || new Date().toISOString();
if (!Number.isFinite(new Date(generatedAt).getTime())) {
  throw new Error(`PS_GENERATED_AT must be a valid timestamp, got ${JSON.stringify(generatedAt)}`);
}
const eventSurfaceAsOf = latestDate(surfaceIndex?.generated_at, surfaceIndex?.fetched_at);
const etfAsOf = latestDate(etfUniverse?.generated_at, etfUniverse?.fetched_at, etfCoverage?.generated_at);
const screenerAsOf = latestDate(stocksAnalyzer?.generated_at, stocksAnalyzer?.source_date, actionSummary?.generated_at);
const marketFactsAsOf = latestDate(marketFactsIndex?.generated_at, sourceParity?.generated_at, marketAudit?.generated_at);
const edgarAsOf = latestDate(edgarIndex?.generated_at, edgarIndex?.generatedAt, edgarIndex?.updated_at, edgarIndex?.updated);
const yardneyRows = Array.isArray(yardneyModel?.data) ? yardneyModel.data : [];
const yardneyLatest = yardneyRows.at(-1) ?? null;
const yardneyAsOf = latestDate(
  yardneyLatest?.date,
  yardneyModel?.meta?.last_update?.last_public_date,
  yardneyModel?.meta?.generated_at,
);
const yardeniMaxAgeDays = DATA_SUPPLY_DETECTION_CONFIG.lanes
  .find((lane) => lane.id === "fred_yardeni")?.freshness?.max_staleness ?? 10;
// Weekly converter lanes are judged against their DECLARED cadence + grace
// (detection-config freshness.max_staleness), never a tighter hardcoded
// constant: a weekly Friday export is legitimately ~7 days old mid-week, and
// the surface still trips stale once the source outlives its declared rhythm.
const benchmarksMaxAgeDays = DATA_SUPPLY_DETECTION_CONFIG.lanes
  .find((lane) => lane.id === "benchmarks")?.freshness?.max_staleness ?? 14;
const globalScouterMaxAgeDays = DATA_SUPPLY_DETECTION_CONFIG.lanes
  .find((lane) => lane.id === "global_scouter")?.freshness?.max_staleness ?? 14;
// Per-surface TRUE source stamps (contract §5). Only surfaces whose data inputs
// carry genuine nested source dates get a real stamp; the rest stay null until
// their upstream artifacts expose one (the KPI reports them pending, not fresh).
//  - market_valuation: RIM observed price as_of (KOSPI/SOX) + Yardeni published date.
//  - screener: stocks_analyzer.source_date.
//  - stock_detail / market_events / sectors / etf_center: dedicated collection-date
//    stamps cross-checked against their fetch-owned payloads and index mirror.
const rimSourceAsOf = oldestSourceDate([
  rimIndexInputs?.indices?.KOSPI?.observed?.price?.as_of,
  rimIndexInputs?.indices?.SOX?.observed?.price?.as_of,
]);
const yardeniSourceAsOf = oldestSourceDate([
  yardneyLatest?.date ?? yardneyModel?.meta?.last_update?.last_public_date,
]);
const screenerSourceAsOf = oldestSourceDate([stocksAnalyzer?.source_date]);

// Market facts exposes the oldest true per-fact source date. StockAnalysis aggregate
// products intentionally remain null because the provider publishes no aggregate date.
const marketFactsCoreSourceAsOf = oldestSourceDate([marketFactsIndex?.core_surface_source_as_of]);
const marketFactsFullUniverseFloor = oldestSourceDate([marketFactsIndex?.full_universe_floor_as_of]);
const marketFactsSourceDiagnostics = marketFactsIndex?.source_stamp_diagnostics || {};
const marketFactsCoreMemberCount = number(marketFactsSourceDiagnostics.core_member_count);
const marketFactsCoreStampedCount = number(marketFactsSourceDiagnostics.core_price_stamped_count);
const marketFactsCoreMissingCount = number(marketFactsSourceDiagnostics.core_price_missing_count);
const marketFactsCoreMissingTickers = Array.isArray(marketFactsSourceDiagnostics.core_price_missing_tickers)
  ? marketFactsSourceDiagnostics.core_price_missing_tickers.filter((ticker) => typeof ticker === "string" && ticker.trim())
  : [];
const marketFactsCoreAbsentFromIndexCount = number(marketFactsSourceDiagnostics.core_price_absent_from_index_count);
const marketFactsCoreAbsentFromIndexTickers = Array.isArray(marketFactsSourceDiagnostics.core_price_absent_from_index_tickers)
  ? marketFactsSourceDiagnostics.core_price_absent_from_index_tickers.filter((ticker) => typeof ticker === "string" && ticker.trim())
  : [];
if (
  marketFactsCoreStampedCount
  + marketFactsCoreMissingCount
  + marketFactsCoreAbsentFromIndexCount
  !== marketFactsCoreMemberCount
) {
  throw new Error(
    "market_facts core price diagnostic invariant violated: "
    + `stamped=${marketFactsCoreStampedCount} + missing=${marketFactsCoreMissingCount} `
    + `+ absent_from_index=${marketFactsCoreAbsentFromIndexCount} `
    + `!= members=${marketFactsCoreMemberCount}`,
  );
}
const marketFactsCoreComplete = marketFactsSourceDiagnostics.core_price_source_complete === true;
const stockDetailSourceAsOf = marketFactsCoreSourceAsOf;
const marketValuationSourceAsOf = oldestSourceDate([rimSourceAsOf, yardeniSourceAsOf, marketFactsCoreSourceAsOf]);
// StockAnalysis publishes quote-level dates, but no aggregate publication date.
// Legacy aggregate stamps were collection dates promoted into source_as_of.
const marketEventsSourceAsOf = null;
const sectorsSourceAsOf = marketFactsCoreSourceAsOf;
const etfDetailEntries = dataSupplyEtfIndex?.entries && typeof dataSupplyEtfIndex.entries === "object"
  ? Object.values(dataSupplyEtfIndex.entries)
  : [];
const DEFERRED_RECONCILIATION_REASONS = new Set([
  "quote_deferred_initial_reconcile",
  "history_deferred_initial_reconcile",
]);
const etfDetailDateRows = etfDetailEntries.map((entry) => {
  const ticker = String(entry?.ticker ?? "").trim();
  const unavailable = entry?.resolution_state === "unavailable";
  // An unavailable R2 member has no published detail. Its retained provider
  // file may still carry an old source_as_of, but that legacy date is not an
  // effective member and must not become the ETF center source floor.
  const safeTicker = /^[A-Za-z0-9._^=-]+$/.test(ticker);
  const resolvedPayloadPath = !unavailable && safeTicker && typeof entry?.payload_path === "string"
    && entry.payload_path.trim() === `payloads/${ticker}.json`
    ? entry.payload_path.trim()
    : "";
  const resolvedPayload = resolvedPayloadPath
    ? readJson(`computed/data-supply/etf-detail/${resolvedPayloadPath}`)
    : null;
  const resolvedSourceAsOf = resolvedPayload ? trueSourceDate(resolvedPayload?.source_as_of) : null;
  const livePayload = safeTicker ? readJson(`stockanalysis/etfs/${ticker}.json`) : null;
  const liveSourceAsOf = !unavailable && !resolvedPayload && livePayload
    ? trueSourceDate(livePayload?.source_as_of)
    : null;
  const frozenSourceAsOf = unavailable || resolvedPayload ? null : trueSourceDate(entry?.source_as_of);
  const sourceAsOf = resolvedSourceAsOf ?? liveSourceAsOf ?? frozenSourceAsOf;
  const partialReasonCodes = Array.isArray(livePayload?.partial_reason_codes)
    ? livePayload.partial_reason_codes
    : [];
  return {
    ticker: ticker || "unknown",
    source_as_of: sourceAsOf,
    source: resolvedSourceAsOf != null
      ? "resolved_payload"
      : liveSourceAsOf != null
        ? "live_payload"
        : frozenSourceAsOf != null
          ? "frozen_index_fallback"
          : "missing",
    recovered_from_live: !unavailable && frozenSourceAsOf == null && liveSourceAsOf != null,
    deferred_reconciliation: partialReasonCodes.some((reason) => DEFERRED_RECONCILIATION_REASONS.has(reason)),
  };
});
const etfDetailAgeRows = etfDetailDateRows
  .map((row) => ({ ...row, age_days: ageDays(row.source_as_of, new Date(generatedAt).getTime()) }))
  .filter((row) => row.age_days != null)
  .sort((a, b) => a.age_days - b.age_days || a.ticker.localeCompare(b.ticker));
const etfDetailAges = etfDetailAgeRows.map((row) => row.age_days);
const medianAgeDays = etfDetailAges.length === 0
  ? null
  : etfDetailAges.length % 2 === 1
    ? etfDetailAges[Math.floor(etfDetailAges.length / 2)]
    : (etfDetailAges[etfDetailAges.length / 2 - 1] + etfDetailAges[etfDetailAges.length / 2]) / 2;
const oldestEtfDetailMember = etfDetailAgeRows.length
  ? [...etfDetailAgeRows].sort((a, b) => (
      b.age_days - a.age_days
      || String(a.source_as_of).localeCompare(String(b.source_as_of))
      || a.ticker.localeCompare(b.ticker)
    ))[0]
  : null;
const etfDetailDateResolution = {
  enrollment_count: etfDetailDateRows.length,
  live_date_count: etfDetailDateRows.filter((row) => ["resolved_payload", "live_payload"].includes(row.source)).length,
  fallback_date_count: etfDetailDateRows.filter((row) => row.source === "frozen_index_fallback").length,
  recovered_from_live_count: etfDetailDateRows.filter((row) => row.recovered_from_live).length,
  missing_date_count: etfDetailDateRows.filter((row) => row.source === "missing").length,
  age_histogram: {
    days_0_7: etfDetailAgeRows.filter((row) => row.age_days <= 7).length,
    days_8_30: etfDetailAgeRows.filter((row) => row.age_days >= 8 && row.age_days <= 30).length,
    days_31_90: etfDetailAgeRows.filter((row) => row.age_days >= 31 && row.age_days <= 90).length,
    over_90_days: etfDetailAgeRows.filter((row) => row.age_days > 90).length,
  },
  median_age_days: medianAgeDays,
  oldest_member: oldestEtfDetailMember
    ? { ticker: oldestEtfDetailMember.ticker, source_as_of: oldestEtfDetailMember.source_as_of }
    : null,
  deferred_reconciliation_member_count: etfDetailDateRows.filter((row) => row.deferred_reconciliation).length,
};

function marketFactsCompletenessCheck(label = "가격 원천 완전성") {
  if (marketFactsCoreComplete) {
    return check(label, "ready", `${marketFactsCoreMemberCount.toLocaleString("ko-KR")}개 핵심 티커 모두 기준일 확인`, {
      count: marketFactsCoreMemberCount,
      missing: 0,
    });
  }
  if (marketFactsCoreMemberCount > 0) {
    const missingSamples = marketFactsCoreMissingTickers.slice(0, 10);
    const absentSamples = marketFactsCoreAbsentFromIndexTickers.slice(0, 10);
    const detailParts = [];
    if (marketFactsCoreMissingCount > 0) {
      detailParts.push(
        `${marketFactsCoreMissingCount.toLocaleString("ko-KR")}개 기준일 미확인`
        + `${missingSamples.length ? `: ${missingSamples.join(", ")}` : ""}`,
      );
    }
    if (marketFactsCoreAbsentFromIndexCount > 0) {
      detailParts.push(
        `${marketFactsCoreAbsentFromIndexCount.toLocaleString("ko-KR")}개 인덱스 행 없음`
        + `${absentSamples.length ? `: ${absentSamples.join(", ")}` : ""}`,
      );
    }
    return check(
      label,
      "partial",
      detailParts.join(" · ") || "핵심 티커 가격 원천 완전성 플래그 불일치",
      {
        count: marketFactsCoreMemberCount,
        missing: marketFactsCoreMissingCount,
        missing_tickers: marketFactsCoreMissingTickers,
        absent_from_index: marketFactsCoreAbsentFromIndexCount,
        absent_from_index_tickers: marketFactsCoreAbsentFromIndexTickers,
        reason: "one or more core tickers have no provider source date or no market-facts index row",
      },
    );
  }
  return check(label, "unavailable", "핵심 티커 기준일 완전성 진단 없음", {
    count: 0,
    missing: null,
    reason: SOURCE_FLOOR_UNAVAILABLE,
  });
}

const eventSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/market/events");
const sectorSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/sectors");
const stockSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/stock/[ticker]");
const etfSurfaces = surfaceRowsForRoute(surfaceIndex, surfaceConsumers, "/etfs");
const contractedEventSurfaceNames = contractedSurfaceNamesForRoute(surfaceConsumers, "/market/events");
const contractedSectorSurfaceNames = contractedSurfaceNamesForRoute(surfaceConsumers, "/sectors");
const contractedStockSurfaceNames = contractedSurfaceNamesForRoute(surfaceConsumers, "/stock/[ticker]");
const contractedEtfSurfaceNames = contractedSurfaceNamesForRoute(surfaceConsumers, "/etfs");

const productStampEvidence = {
  stock_detail: stampEvidence([
    dateMember("market_facts:core_surface", stockDetailSourceAsOf),
    ...datelessMembers(contractedStockSurfaceNames),
  ]),
  market_valuation: stampEvidence([
    dateMember("rim:KOSPI_SOX", rimSourceAsOf),
    dateMember("yardeni:published", yardeniSourceAsOf),
    dateMember("market_facts:core_surface", marketFactsCoreSourceAsOf),
  ]),
  market_events: stampEvidence(datelessMembers(contractedEventSurfaceNames)),
  sectors: stampEvidence([
    dateMember("market_facts:core_surface", sectorsSourceAsOf),
    ...datelessMembers(contractedSectorSurfaceNames),
  ]),
  etf_center: stampEvidence([
    ...etfDetailDateRows.map((row) => dateMember(`etf_detail:${row.ticker}`, row.source_as_of)),
    ...datelessMembers(contractedEtfSurfaceNames),
  ]),
  screener: stampEvidence([dateMember("stocks_analyzer", screenerSourceAsOf)]),
};
const etfCenterSourceAsOf = productStampEvidence.etf_center.date_bearing.source_floor_as_of;

function rimIndexReadyCheck(indexId, label) {
  const item = rimIndexInputs?.indices?.[indexId];
  const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
  const ready = item?.public_status === "ready_inputs_and_forecast_grid" && blockers.length === 0;
  const diagnostics = rimIndexInputs?.coverage_diagnostics?.stock_action?.[indexId] ?? null;
  const detailParts = [];
  if (indexId === "SOX" && diagnostics) {
    detailParts.push(`${number(diagnostics.methodology_weight_rows).toLocaleString("ko-KR")}개 구성`);
    detailParts.push(`매칭 ${pct(number(diagnostics.matched_weight_ratio), 1) ?? 0}%`);
    detailParts.push(`cap 위반 ${number(diagnostics.cap_violation_count)}`);
  } else if (indexId === "KOSPI" && diagnostics?.krx_kospi_weights) {
    detailParts.push(`${number(diagnostics.krx_kospi_weights.krx_rows).toLocaleString("ko-KR")}개 구성`);
    detailParts.push(`매칭 ${pct(number(diagnostics.krx_kospi_weights.matched_weight_ratio), 1) ?? 0}%`);
  }
  return check(
    `${label} RIM 입력`,
    ready ? "ready" : item ? "partial" : "unavailable",
    detailParts.length ? detailParts.join(" · ") : (item?.public_status ?? "payload 없음"),
    {
      index_id: indexId,
      role: item?.role ?? null,
      public_status: item?.public_status ?? null,
      blockers: blockers.map((blocker) => blocker?.code ?? blocker),
      forecast_grid_status: item?.derived?.forecast_grid_v1?.public_status ?? null,
      source_tier: diagnostics?.source_tier ?? diagnostics?.krx_kospi_weights?.source_tier ?? null,
      official_weight_columns_available: diagnostics?.official_weight_columns_available,
      proxy_inputs_present: Boolean(item?.derived?.proxy_inputs_v1),
      matched_weight_ratio: diagnostics?.matched_weight_ratio ?? diagnostics?.krx_kospi_weights?.matched_weight_ratio ?? null,
      methodology_weight_rows: diagnostics?.methodology_weight_rows ?? null,
      cap_violation_count: diagnostics?.cap_violation_count ?? null,
    },
  );
}

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
      marketFactsCompletenessCheck(),
      freshness("가격 원천 기준일", stockDetailSourceAsOf, 7, { calendar: "us_market", missingReason: SOURCE_FLOOR_UNAVAILABLE }),
      freshness("야후 원천 기준일", null, 8, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
      freshness("공시 원천 기준일", null, 14, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
    ],
    "가격, 기본 분석, 공시, 기관 데이터를 같은 화면에서 연결한다. 재무 검산·한글 공시는 커버리지 제한을 명시한다.",
    { as_of: latestDate(marketFactsAsOf, edgarAsOf, screenerAsOf), ...sourceStamp(productStampEvidence.stock_detail.date_bearing.source_floor_as_of), stamp_evidence: productStampEvidence.stock_detail },
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
      rimIndexReadyCheck("KOSPI", "KOSPI"),
      rimIndexReadyCheck("SOX", "SOX"),
      freshness("RIM 입력 기준일", rimSourceAsOf, benchmarksMaxAgeDays, { missingReason: SOURCE_FLOOR_UNAVAILABLE }),
      freshness("Yardeni 기준일", yardeniSourceAsOf, yardeniMaxAgeDays, { missingReason: SOURCE_FLOOR_UNAVAILABLE }),
      freshness("야후 원천 기준일", null, 8, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
      marketFactsCompletenessCheck("시장 데이터 원천 완전성"),
      freshness("시장 데이터 기준일", marketFactsCoreSourceAsOf, 7, { calendar: "us_market", missingReason: SOURCE_FLOOR_UNAVAILABLE }),
    ],
    "시장 화면은 값 자체보다 기준일, 커버리지, 소스 차이를 함께 보여야 한다.",
    { as_of: marketFactsAsOf, ...sourceStamp(productStampEvidence.market_valuation.date_bearing.source_floor_as_of), stamp_evidence: productStampEvidence.market_valuation },
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
      freshness("이벤트 표면 원천 기준일", marketEventsSourceAsOf, 7, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
    ],
    "시장 이벤트는 수집 표면별 준비 상태가 곧 화면 준비 상태다.",
    { as_of: eventSurfaceAsOf, ...sourceStamp(null, NO_AGGREGATE_SOURCE_DATE), stamp_evidence: productStampEvidence.market_events },
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
      freshness("야후 원천 기준일", null, 8, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
      marketFactsCompletenessCheck("섹터 가격 원천 완전성"),
      freshness("섹터 데이터 기준일", sectorsSourceAsOf, 14, { missingReason: SOURCE_FLOOR_UNAVAILABLE }),
    ],
    "섹터 화면은 섹터 ETF 흐름, 산업 분류, 기관 보유를 한 책임 화면으로 묶는다.",
    { as_of: latestDate(eventSurfaceAsOf, marketFactsAsOf), ...sourceStamp(productStampEvidence.sectors.date_bearing.source_floor_as_of), stamp_evidence: productStampEvidence.sectors },
  ),
  surface(
    "etf_center",
    "/etfs",
    "ETF 센터",
    "ETF center",
    [
      check("ETF 전체 목록", number(etfUniverse?.counts?.records) > 0 ? "ready" : "unavailable", `${number(etfUniverse?.counts?.records).toLocaleString("ko-KR")}개 ETF`, { count: number(etfUniverse?.counts?.records) }),
      check("ETF 상세", effectiveEtfDetail.available > 0 ? (effectiveEtfDetail.unavailable > 0 ? "partial" : "ready") : "unavailable", `${effectiveEtfDetail.available.toLocaleString("ko-KR")} / ${effectiveEtfDetail.total.toLocaleString("ko-KR")}개`, { count: effectiveEtfDetail.available, total: effectiveEtfDetail.total, missing: effectiveEtfDetail.unavailable, coverage_pct: effectiveEtfDetail.coveragePct, authority: r2EtfCounts ? "data_supply_r2_plus_strict_unenrolled_primary" : "legacy_coverage" }),
      check("기간 수익률", number(returnCoverage.return_1y?.etf) > 0 ? "ready" : "pending", `1Y ${number(returnCoverage.return_1y?.etf).toLocaleString("ko-KR")}개`, { count: number(returnCoverage.return_1y?.etf) }),
      check("신규·전략 ETF", etfSurfaces.surfaceCount > 0 ? "ready" : "pending", `${etfSurfaces.surfaceCount}개 항목 · ${etfSurfaces.rowCount.toLocaleString("ko-KR")}행`, { count: etfSurfaces.surfaceCount, rows: etfSurfaces.rowCount }),
      freshness("ETF 상세 전체 구성원 원천 기준일", etfCenterSourceAsOf, 7, { warnOnly: true, missingReason: NO_AGGREGATE_SOURCE_DATE }),
    ],
    "ETF는 제품 준비도가 높다. 남은 누락은 재시도/분류 대기 상태로 공개 화면과 Data Lab에 같이 드러낸다.",
    { as_of: etfAsOf, ...sourceStamp(productStampEvidence.etf_center.date_bearing.source_floor_as_of, NO_AGGREGATE_SOURCE_DATE), stamp_evidence: productStampEvidence.etf_center },
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
      freshness("스크리너 기준일", screenerSourceAsOf, globalScouterMaxAgeDays, { missingReason: SOURCE_FLOOR_UNAVAILABLE }),
    ],
    "스크리너는 종목 발견 화면이며 필드 사용 감사와 함께 미사용 데이터를 줄여간다.",
    { as_of: screenerAsOf, ...sourceStamp(productStampEvidence.screener.date_bearing.source_floor_as_of), stamp_evidence: productStampEvidence.screener },
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
      freshness("준비도 원천 기준일", null, 1, { warnOnly: true, missingReason: INTERNAL_ARTIFACT_CLOCK }),
    ],
    "Data Lab은 파일 기준 감사에서 제품 화면 기준 감사까지 이어지는 운영 화면이다.",
    { as_of: generatedAt, ...sourceStamp(null, INTERNAL_ARTIFACT_CLOCK) },
  ),
];

const summary = surfaces.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});

const payload = {
  schema_version: PRODUCT_SURFACE_COVERAGE_SCHEMA_VERSION,
  // Deterministic source-stamp marker (KPI v2 rev5.6): its PRESENCE means this
  // artifact was produced by the stamp-aware generator, so EVERY surface carries an
  // own-property source_as_of. Its ABSENCE means a genuine pre-stamp-era artifact
  // (bootstrap pending). The KPI never guesses bootstrap from row absence alone.
  source_stamp_version: PRODUCT_SURFACE_STAMP_VERSION,
  generated_at: generatedAt,
  source: "local DataPack coverage files",
  raw_policy: {
    public_mirror_allowed: true,
    raw_rows_included: false,
    private_artifact_paths_included: false,
    derived_counts_and_status_only: true,
  },
  source_stamp_diagnostics: {
    market_facts_core_surface_source_as_of: marketFactsCoreSourceAsOf,
    market_facts_full_universe_floor_as_of: marketFactsFullUniverseFloor,
    market_facts_core_price_source_complete: marketFactsCoreComplete,
    market_facts_core_price_missing_count: marketFactsCoreMissingCount,
    market_facts_core_price_missing_tickers: marketFactsCoreMissingTickers,
    market_facts_core_price_absent_from_index_count: marketFactsCoreAbsentFromIndexCount,
    market_facts_core_price_absent_from_index_tickers: marketFactsCoreAbsentFromIndexTickers,
    full_universe_floor_sla_bound: false,
    stockanalysis_surface_domains: surfaceIndex?.source_as_of ?? null,
    stockanalysis_index_mirror: stockanalysisIndex?.source_as_of ?? null,
    etf_universe_source_as_of: etfCenterSourceAsOf,
    etf_detail_date_resolution: etfDetailDateResolution,
  },
  source_files: [
    "computed/market_facts/index.json",
    "computed/market_data_audit.json",
    "computed/market_source_parity.json",
    "computed/data-supply/etf-detail/index.json",
    "stockanalysis/etfs/*.json",
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
