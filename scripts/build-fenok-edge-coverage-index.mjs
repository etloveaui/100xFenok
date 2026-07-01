#!/usr/bin/env node
/**
 * Build a derived admin-only coverage index for Fenok Edge daily sources.
 *
 * This script does not fetch external data. It reads existing computed/admin
 * payloads plus private manifests and writes derived counts only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEtfSignalGateChecks } from "../100xfenok-next/scripts/check-fenok-etf-signal-gate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.join(REPO_ROOT, "data");
const OUT_PATH = path.join(DATA_ROOT, "admin", "fenok-edge-coverage-index.json");
const PUBLIC_OUT_PATH = path.join(
  REPO_ROOT,
  "100xfenok-next",
  "public",
  "data",
  "admin",
  "fenok-edge-coverage-index.json",
);
const MAX_COUNTED_DAILY_SOURCE_AGE_DAYS = 4;

function readJson(relPath, fallback = null) {
  const absPath = path.join(REPO_ROOT, relPath);
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return fallback;
  }
}

function repoRelPath(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const marker = "source/100xFenok/";
  if (text.startsWith(marker)) return text.slice(marker.length);
  if (path.isAbsolute(text)) return path.relative(REPO_ROOT, text);
  return text;
}

function readJsonFirst(paths, fallback = null) {
  for (const candidate of paths.map(repoRelPath).filter(Boolean)) {
    const payload = readJson(candidate, null);
    if (payload) return payload;
  }
  return fallback;
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function pct(count, total) {
  if (!Number(total)) return null;
  return Number(((Number(count) / Number(total)) * 100).toFixed(2));
}

function normTicker(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function krCode(value) {
  return String(value ?? "").replace(/[^0-9A-Z]/gi, "").slice(0, 6).toUpperCase();
}

function toIsoDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function ymd(value) {
  return toIsoDate(value)?.replaceAll("-", "") ?? null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rowTickerSet(payload) {
  return new Set((Array.isArray(payload?.rows) ? payload.rows : []).map((row) => normTicker(row.ticker_normalized ?? row.ticker)).filter(Boolean));
}

function rowTicker(row) {
  return normTicker(row?.ticker_normalized ?? row?.ticker);
}

function rowTickerMap(payload) {
  return new Map((Array.isArray(payload?.rows) ? payload.rows : [])
    .map((row) => [rowTicker(row), row])
    .filter(([ticker]) => ticker));
}

function countByCategory(rows, classifier) {
  const counts = {};
  for (const row of rows) {
    const category = classifier(row);
    counts[category] = (counts[category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function classShareTicker(row) {
  return /^BRK-[AB]$/.test(rowTicker(row));
}

function plainUsOccEligible(row) {
  const ticker = rowTicker(row);
  return row?.market === "US" && /^[A-Z][A-Z0-9]{0,11}$/.test(ticker);
}

function hasNonPlainOrForeignSuffix(row) {
  const ticker = rowTicker(row);
  return row?.market === "US_CLASS"
    || ticker.includes("-")
    || ticker.includes("/")
    || /\d/.test(ticker[0] ?? "");
}

function finraMetricReady(row) {
  return Boolean(row)
    && row.confidence === "high"
    && Number(row.coverage_ratio) > 0
    && row.short_pressure_proxy?.score_0_100 != null
    && row.off_exchange_activity_proxy?.score_0_100 != null;
}

function classifyFinraRowGap(row) {
  if (hasNonPlainOrForeignSuffix(row)) {
    return "non_plain_or_foreign_suffix_requires_universe_mapping";
  }
  return "plain_us_finra_collection_gap";
}

function classifyFinraStrictGap(row, flowRow) {
  if (!flowRow) return classifyFinraRowGap(row);
  if (classShareTicker(row)) {
    return "class_share_placeholder_requires_finra_symbol_policy";
  }
  if (hasNonPlainOrForeignSuffix(row)) {
    return "non_plain_placeholder_requires_universe_mapping";
  }
  return "plain_us_finra_metric_gap";
}

function classifyOccGap(row) {
  if (classShareTicker(row)) {
    return "class_share_symbol_normalization_or_source_gap";
  }
  if (!plainUsOccEligible(row)) {
    return "non_plain_or_foreign_suffix_requires_universe_mapping";
  }
  return "plain_us_collection_or_no_options_policy_required";
}

function normalizeOccAttemptStatus(status, error = "") {
  const text = String(status ?? "").trim();
  if (text === "no_record" || (text === "failed" && /No record\(s\) found/i.test(String(error ?? "")))) {
    return "no_record";
  }
  if (text === "partial_no_record_or_form_gap") return "partial_no_record_or_form_gap";
  if (text === "transient_failed") return "transient_failed";
  if (text && text !== "options_activity_available") return "failed";
  return null;
}

function occAttemptStatusByTickerFromAttempts(payload) {
  const byTicker = new Map();
  for (const attempt of Array.isArray(payload?.attempts) ? payload.attempts : []) {
    const ticker = normTicker(attempt?.ticker);
    if (!ticker) continue;
    const status = normalizeOccAttemptStatus(attempt?.status, attempt?.error);
    if (status) byTicker.set(ticker, status);
  }
  return byTicker;
}

function occAttemptStatusByTickerFromAvailability(payload, sourceDate) {
  const targetDate = ymd(sourceDate);
  const latestRows = new Map();
  for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
    const ticker = normTicker(row?.ticker);
    if (!ticker) continue;
    const rowDate = ymd(row?.source_date);
    if (targetDate && rowDate && rowDate !== targetDate) continue;
    const normalizedStatus = normalizeOccAttemptStatus(row?.status);
    if (!normalizedStatus) continue;
    const previous = latestRows.get(ticker);
    if (!previous || String(rowDate ?? "").localeCompare(String(previous.rowDate ?? "")) >= 0) {
      latestRows.set(ticker, { rowDate, status: normalizedStatus });
    }
  }
  return new Map([...latestRows].map(([ticker, row]) => [ticker, row.status]));
}

function occAttemptStatusByTicker({ occ, availability, sourceDate }) {
  const byTicker = occAttemptStatusByTickerFromAttempts(occ);
  for (const [ticker, status] of occAttemptStatusByTickerFromAvailability(availability, sourceDate)) {
    byTicker.set(ticker, status);
  }
  return byTicker;
}

function sourceDateFromRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const dates = unique(rows.map((row) => toIsoDate(row.source_date ?? row.as_of)));
  return dates.at(-1) ?? null;
}

function ageDays(date, now = Date.now()) {
  const iso = toIsoDate(date);
  if (!iso) return null;
  const time = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / 86400000));
}

function countedDailySourceFresh(date) {
  const age = ageDays(date);
  return age !== null && age <= MAX_COUNTED_DAILY_SOURCE_AGE_DAYS;
}

function countedDailySourceStatus({ coverageReady, sourceDate }) {
  if (!coverageReady) return "blocked";
  return countedDailySourceFresh(sourceDate) ? "ready" : "stale";
}

function ageHours(timestamp, now = Date.now()) {
  const text = String(timestamp ?? "").trim();
  if (!text) return null;
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Number(((now - time) / 3600000).toFixed(2)));
}

function marketCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.market] = (counts[row.market] || 0) + 1;
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([market, count]) => ({ market, count }));
}

function coverageRow({ id, label, count, denominator, sourceDate, status, caveat, claimScope, denominatorLabel, activeTotal, extra = {} }) {
  return {
    id,
    label,
    covered_count: count,
    denominator,
    denominator_label: denominatorLabel,
    coverage_pct: pct(count, denominator),
    active_scoring_coverage_pct: pct(count, activeTotal),
    source_date: sourceDate,
    availability_status: status,
    claim_scope: claimScope,
    not_public_scoring: true,
    caveat,
    ...extra,
  };
}

function findById(rows, id) {
  return Array.isArray(rows) ? rows.find((row) => row?.id === id) ?? null : null;
}

function replaceById(rows, id, replacement) {
  if (!Array.isArray(rows) || !replacement) return;
  const index = rows.findIndex((row) => row?.id === id);
  if (index >= 0) rows[index] = replacement;
}

function hasManifestPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function compactPublicSourceRow(row) {
  return {
    id: row.id,
    label: row.label,
    covered_count: row.covered_count,
    denominator: row.denominator,
    denominator_label: row.denominator_label,
    coverage_pct: row.coverage_pct,
    active_scoring_coverage_pct: row.active_scoring_coverage_pct,
    source_date: row.source_date,
    availability_status: row.availability_status,
    claim_scope: row.claim_scope,
    not_public_scoring: row.not_public_scoring === true,
    caveat: row.caveat,
  };
}

function compactPublicCoverageIndex(index) {
  return {
    schema_version: "fenok-edge-coverage-index-public/v0.1",
    source_schema_version: index.schema_version,
    generated_at: index.generated_at,
    purpose: "Compact public admin readiness mirror. Contains derived counts/status only; no raw rows, private manifests, target ticker lists, or private artifact paths.",
    raw_policy: {
      raw_public: index.raw_policy?.raw_public === true,
      raw_rows_included: index.raw_policy?.raw_rows_included === true,
      private_artifact_paths_included: false,
    },
    active_scoring_universe: {
      generated_at: index.active_scoring_universe?.generated_at ?? null,
      current_only: index.active_scoring_universe?.current_only === true,
      total: index.active_scoring_universe?.total ?? null,
      by_market: index.active_scoring_universe?.by_market ?? [],
      buckets: index.active_scoring_universe?.buckets ?? {},
    },
    expanded_stock_candidate_universe: {
      generated_at: index.expanded_stock_candidate_universe?.generated_at ?? null,
      collected_asset_total: index.expanded_stock_candidate_universe?.collected_asset_total ?? null,
      collected_stock_candidates: index.expanded_stock_candidate_universe?.collected_stock_candidates ?? null,
      scored_public_stock: index.expanded_stock_candidate_universe?.scored_public_stock ?? null,
      stock_promotion_audit_gap: index.expanded_stock_candidate_universe?.stock_promotion_audit_gap ?? null,
      stage: index.expanded_stock_candidate_universe?.stage ?? null,
      public_done_claim_allowed: index.expanded_stock_candidate_universe?.public_done_claim_allowed === true,
      caveat: index.expanded_stock_candidate_universe?.caveat ?? null,
    },
    etf_universe: {
      collected_etf_candidates: index.etf_universe?.collected_etf_candidates ?? null,
      eligible_etf_count: index.etf_universe?.eligible_etf_count ?? null,
      stage: index.etf_universe?.stage ?? null,
      scored_public_etf: index.etf_universe?.scored_public_etf ?? null,
      public_done_claim_allowed: index.etf_universe?.public_done_claim_allowed === true,
      evidence_based_readiness: index.etf_universe?.evidence_based_readiness ?? null,
      core_daily_basket: index.etf_universe?.core_daily_basket ?? null,
      caveat: index.etf_universe?.caveat ?? null,
    },
    source_availability: {
      not_public_scoring: index.source_availability?.not_public_scoring === true,
      caveat: index.source_availability?.caveat ?? null,
      source_count: (index.source_availability?.sources ?? []).length,
      sources: (index.source_availability?.sources ?? []).map(compactPublicSourceRow),
    },
    source_availability_composites: index.source_availability_composites ?? null,
    public_scoring_readiness: index.public_scoring_readiness ?? null,
    freshness_gate: index.freshness_gate ?? null,
  };
}

function recomputeSourceComposites(index) {
  const sources = index.source_availability?.sources ?? [];
  const activeTotal = Number(index.active_scoring_universe?.total) || 0;
  const krxCount = Number(findById(sources, "krx_issuer_daily_latest_full_proof")?.covered_count) || 0;
  const finraCount = Number(findById(sources, "us_finra_flow_proxy")?.covered_count) || 0;
  const occCount = Number(findById(sources, "us_occ_options_proxy")?.covered_count) || 0;
  const latestUsCount = Number(findById(sources, "us_latest_bounded_backfill_run")?.covered_count) || 0;
  const composites = index.source_availability_composites ?? {};

  if (composites.latest_available_kr_plus_us_flow) {
    composites.latest_available_kr_plus_us_flow.covered_count = krxCount + finraCount;
    composites.latest_available_kr_plus_us_flow.coverage_pct = pct(krxCount + finraCount, activeTotal);
  }
  if (composites.latest_available_kr_plus_us_occ) {
    composites.latest_available_kr_plus_us_occ.covered_count = krxCount + occCount;
    composites.latest_available_kr_plus_us_occ.coverage_pct = pct(krxCount + occCount, activeTotal);
  }
  if (composites.strict_new_bounded_run_plus_kr) {
    composites.strict_new_bounded_run_plus_kr.covered_count = krxCount + latestUsCount;
    composites.strict_new_bounded_run_plus_kr.coverage_pct = pct(krxCount + latestUsCount, activeTotal);
  }
}

function preservePriorPrivateBackedEvidence(index, priorIndex, conditions) {
  const priorSources = priorIndex.source_availability?.sources ?? [];
  const currentSources = index.source_availability?.sources ?? [];
  const priorFreshnessChecks = priorIndex.freshness_gate?.checks ?? [];
  const currentFreshnessChecks = index.freshness_gate?.checks ?? [];

  if (conditions.koreaProofMissing) {
    replaceById(currentSources, "krx_issuer_daily_latest_full_proof", findById(priorSources, "krx_issuer_daily_latest_full_proof"));
    replaceById(currentFreshnessChecks, "korea_counted_source_date", findById(priorFreshnessChecks, "korea_counted_source_date"));
  }
  if (conditions.latestUsRunMissing) {
    replaceById(currentSources, "us_latest_bounded_backfill_run", findById(priorSources, "us_latest_bounded_backfill_run"));
  }
  if (conditions.taiwanHistoricalMissing) {
    replaceById(currentSources, "taiwan_current_universe", findById(priorSources, "taiwan_current_universe"));
  }

  recomputeSourceComposites(index);
}

const signals = readJson("data/computed/fenok_signals.json", {});
const marketFacts = readJson("data/computed/market_facts/index.json", {});
const etfSignals = readJson("data/computed/fenok_etf_signals_summary.json", {});
const etfHistoryGap = readJson("data/stockanalysis/backfill/history_gap_report_latest.json", {});
const etfCoreDailyBasket = readJson("data/admin/fenok-etf-core-daily-basket.json", {});
const priorIndex = readJson("data/admin/fenok-edge-coverage-index.json", {});
const universeRows = Array.isArray(signals.rows) ? signals.rows : [];
const activeScoringTotal = universeRows.length;
const etfScoredPublic = Number(etfSignals?.coverage?.scored_public_etf) || 0;
const etfEligible = Number(etfSignals?.coverage?.eligible_etf_count) || Number(marketFacts?.coverage?.etf) || 0;
const usRows = universeRows.filter((row) => row.market === "US" || row.market === "US_CLASS");
const koreaRows = universeRows.filter((row) => row.market === "KRX" || row.market === "KOSDAQ");
const asiaExTwRows = universeRows.filter((row) => row.market === "HKEX" || row.market === "SSE" || row.market === "SZSE");
const s0DailyEligibleRows = [...usRows, ...koreaRows];
const explicitTaiwanRows = universeRows.filter((row) => /^(TW|TAIWAN|TPE|TPEX)$/i.test(String(row.market ?? "")) || /taiwan/i.test(String(row.market_scope ?? "")));
const finraEligibleRows = usRows.filter((row) => row.market === "US");
const taiwanTickerAnomalies = universeRows
  .filter((row) => /\.(TW|TWO)$/i.test(String(row.ticker ?? "")) || /-(TW|TWO)$/i.test(String(row.ticker_normalized ?? "")))
  .filter((row) => !explicitTaiwanRows.includes(row))
  .map((row) => ({
    ticker: row.ticker,
    ticker_normalized: row.ticker_normalized,
    market: row.market,
    market_scope: row.market_scope,
    company: row.company,
  }));

const usUniverse = new Set(usRows.map((row) => normTicker(row.ticker_normalized ?? row.ticker)));
const krUniverseCodes = new Set(koreaRows.map((row) => krCode(row.ticker_normalized ?? row.ticker)).filter(Boolean));

const flow = readJson("data/computed/fenok_flow_proxies.json", {});
const flowSet = rowTickerSet(flow);
const flowRowsByTicker = rowTickerMap(flow);
const flowIntersection = [...flowSet].filter((ticker) => usUniverse.has(ticker));
const flowSourceDate = sourceDateFromRows(flow) ?? toIsoDate(flow.source_files?.finra_daily_short_sale_volume?.match(/CNMSshvol(\d{8})/)?.[1]);

const occ = readJson("data/computed/fenok_occ_options_volume.json", {});
const occAvailability = readJson("data/computed/fenok_occ_options_availability.json", {});
const occRows = Array.isArray(occ.rows) ? occ.rows : [];
const occSet = rowTickerSet(occ);
const occIntersection = [...occSet].filter((ticker) => usUniverse.has(ticker));
const occSourceDate = sourceDateFromRows(occ) ?? toIsoDate(occ.query_contract?.reportDate);

const usBridge = readJson("data/admin/fenok-flow-backfill-index.json", {});
const latestUsRun = usBridge.latest_us_daily_run ?? usBridge.latest_us_daily_smoke ?? {};
const latestUsManifest = readJson(latestUsRun.private_manifest_file ?? "", {});
const latestUsTargetUniverse = latestUsRun.target_universe ?? latestUsManifest.target_universe ?? null;
const latestUsTickers = new Set((latestUsTargetUniverse?.tickers ?? []).map(normTicker));
const latestUsIntersection = [...latestUsTickers].filter((ticker) => usUniverse.has(ticker));
const latestUsSourceDate = toIsoDate(latestUsRun.dates?.at(-1) ?? latestUsRun.end_date);
const usFull252FirstBatch = readJson("_private/admin/fenok-flow/backfill/20260629-full252/manifests/us_daily_backfill_smoke_5d_20250702.json", {});

const koreaBridge = readJson("data/admin/fenok-edge-korea-krx-daily-index.json", {});
const koreaLatestRun = koreaBridge.latest_run ?? {};
const koreaProofManifestPath = repoRelPath(koreaBridge.private_artifacts?.top_manifest_path)
  ?? "_private/admin/fenok-edge-korea/backfill/20260629/krx_daily_smoke_5d/manifest.json";
const koreaProofManifest = readJson(koreaProofManifestPath, {});
const koreaLatestCalendarManifest = readJson(
  repoRelPath(koreaBridge.daily_accumulation?.latest_daily_manifest_path)
    ?? "_private/admin/fenok-edge-korea/backfill/20260629/krx_daily_20260629/manifest.json",
  {},
);
const koreaProofDates = unique((koreaProofManifest.files ?? [])
  .filter((file) => Number(file.row_count) > 0)
  .map((file) => toIsoDate(file.source_date ?? file.date ?? file.basDd)));
const koreaCountedSourceDate = koreaProofDates.at(-1) ?? null;
const koreaCountedSourceYmd = ymd(koreaCountedSourceDate) ?? "20260626";
const koreaLatestCalendarDailyHistoryRows = (koreaLatestCalendarManifest.files ?? [])
  .filter((file) => file.endpoint_class === "daily-history")
  .reduce((sum, file) => sum + (Number(file.row_count) || 0), 0);
const koreaProofRoot = repoRelPath(koreaProofManifest.runtime?.output_root ?? koreaBridge.private_artifacts?.output_root);
const koreaStk = readJsonFirst([
  koreaProofRoot ? `${koreaProofRoot}/raw/core_stock_index/stk_bydd_trd/${koreaCountedSourceYmd}.json` : null,
  "_private/admin/fenok-edge-korea/backfill/20260629/krx_daily_smoke_5d/raw/core_stock_index/stk_bydd_trd/20260626.json",
], {});
const koreaKsq = readJsonFirst([
  koreaProofRoot ? `${koreaProofRoot}/raw/core_stock_index/ksq_bydd_trd/${koreaCountedSourceYmd}.json` : null,
  "_private/admin/fenok-edge-korea/backfill/20260629/krx_daily_smoke_5d/raw/core_stock_index/ksq_bydd_trd/20260626.json",
], {});
const koreaIssueCodes = new Set([
  ...(Array.isArray(koreaStk.OutBlock_1) ? koreaStk.OutBlock_1 : []),
  ...(Array.isArray(koreaKsq.OutBlock_1) ? koreaKsq.OutBlock_1 : []),
].map((row) => krCode(row.ISU_CD)).filter(Boolean));
const koreaIntersection = [...krUniverseCodes].filter((code) => koreaIssueCodes.has(code));

const taiwanBridge = readJson("data/admin/taiwan-data-bridge-index.json", readJson("data/computed/taiwan-data-bridge-index.json", {}));
const taiwanHistorical = readJson("_private/admin/fenok-edge-taiwan/backfill/20260629/historical_smoke/historical_manifest.json", {});
const koreaProofMissing = koreaIntersection.length === 0 && koreaProofDates.length === 0 && !hasManifestPayload(koreaProofManifest);
const latestUsRunMissing = latestUsIntersection.length === 0 && !latestUsTargetUniverse && !hasManifestPayload(latestUsManifest);
const taiwanHistoricalMissing = !hasManifestPayload(taiwanHistorical);

const combinedKrUsFlow = koreaIntersection.length + flowIntersection.length;
const combinedKrUsOcc = koreaIntersection.length + occIntersection.length;
const combinedKrUsLatestBounded = koreaIntersection.length + latestUsIntersection.length;
const marketFactsCoverage = marketFacts.coverage ?? {};
const etfSignalGate = runEtfSignalGateChecks({ repoRoot: REPO_ROOT });

const finraEligibleMetricReadyRows = finraEligibleRows.filter((row) => finraMetricReady(flowRowsByTicker.get(rowTicker(row))));
const finraEligibleMetricMissingRows = finraEligibleRows.filter((row) => !finraMetricReady(flowRowsByTicker.get(rowTicker(row))));
const finraMissingRows = usRows.filter((row) => !flowSet.has(rowTicker(row)));
const finraStrictMetricReadyRows = usRows.filter((row) => finraMetricReady(flowRowsByTicker.get(rowTicker(row))));
const finraStrictGapRows = usRows.filter((row) => !finraMetricReady(flowRowsByTicker.get(rowTicker(row))));
const finraPlaceholderRows = usRows.filter((row) => {
  const flowRow = flowRowsByTicker.get(rowTicker(row));
  return Boolean(flowRow) && !finraMetricReady(flowRow);
});
const occMissingRows = usRows.filter((row) => !occSet.has(rowTicker(row)));
const occPlainMissingRows = occMissingRows.filter(plainUsOccEligible);
const occClassShareMissingRows = occMissingRows.filter(classShareTicker);
const occAttemptStatuses = occAttemptStatusByTicker({ occ, availability: occAvailability, sourceDate: occSourceDate });
const occPlainAttemptedRows = occPlainMissingRows.filter((row) => occAttemptStatuses.has(rowTicker(row)));
const occPlainNoRecordRows = occPlainMissingRows.filter((row) => occAttemptStatuses.get(rowTicker(row)) === "no_record");
const occPlainPartialNoRecordRows = occPlainMissingRows.filter((row) => occAttemptStatuses.get(rowTicker(row)) === "partial_no_record_or_form_gap");
const occPlainTransientFailedRows = occPlainMissingRows.filter((row) => occAttemptStatuses.get(rowTicker(row)) === "transient_failed");
const occPlainFailedRows = occPlainMissingRows.filter((row) => occAttemptStatuses.get(rowTicker(row)) === "failed");
const occPlainUnattemptedRows = occPlainMissingRows.filter((row) => !occAttemptStatuses.has(rowTicker(row)));
const occDailyEligibleRows = usRows.filter(plainUsOccEligible);
const occPlainPresentRows = occDailyEligibleRows.filter((row) => occSet.has(rowTicker(row)));
const occPlainNoListedOptionsRows = occDailyEligibleRows.filter((row) => !occSet.has(rowTicker(row)) && occAttemptStatuses.get(rowTicker(row)) === "no_record");
const occPlainSourceReadyRows = [...occPlainPresentRows, ...occPlainNoListedOptionsRows];
const occPlainBlockingRows = occDailyEligibleRows.filter((row) => !occSet.has(rowTicker(row)) && occAttemptStatuses.get(rowTicker(row)) !== "no_record");
const occPartialZeroSideRows = occRows.filter((row) => row?.accepted_form_policy === "one_side_loaded_one_side_no_record_zero_volume_side");
const occBothSidesLoadedOrLegacyRows = occRows.filter((row) => row?.accepted_form_policy !== "one_side_loaded_one_side_no_record_zero_volume_side");

function computeEtfReadinessEvidence() {
  const maxAgeHours = 48;
  const signalAgeHours = ageHours(etfSignals.generated_at);
  const historyGapAgeHours = ageHours(etfHistoryGap.generated_at);
  const fetchableGap = Number(etfHistoryGap.fetchable_required_history) || 0;
  const missingGap = Number(etfHistoryGap.missing_required_history) || 0;
  const inceptionLimitedGap = Number(etfHistoryGap.inception_limited_required_history) || 0;
  const daily1yGap = asObject(etfHistoryGap.daily_1y_gap);
  const scoredDaily1yGap = asObject(daily1yGap.scored_etfs);
  const fetchableDaily1yGap = Number(scoredDaily1yGap.fetchable) || 0;
  const inceptionLimitedDaily1yGap = Number(scoredDaily1yGap.inception_limited) || 0;
  const publicReady = Boolean(etfSignalGate.public_surface_proof?.ready && etfScoredPublic > 0);
  const dailyChecks = [
    {
      id: "etf_signal_summary_fresh",
      ok: signalAgeHours != null && signalAgeHours <= maxAgeHours,
      generated_at: etfSignals.generated_at ?? null,
      age_hours: signalAgeHours,
      max_age_hours: maxAgeHours,
    },
    {
      id: "etf_history_gap_report_fresh",
      ok: historyGapAgeHours != null && historyGapAgeHours <= maxAgeHours,
      generated_at: etfHistoryGap.generated_at ?? null,
      age_hours: historyGapAgeHours,
      max_age_hours: maxAgeHours,
    },
    {
      id: "etf_no_fetchable_required_history_gap",
      ok: fetchableGap === 0,
      fetchable_required_history: fetchableGap,
      missing_required_history: missingGap,
      inception_limited_required_history: inceptionLimitedGap,
      caveat: "Inception-limited gaps are allowed; fetchable required-history gaps keep daily=false.",
    },
    {
      id: "etf_no_fetchable_daily_1y_gap",
      ok: fetchableDaily1yGap === 0,
      fetchable_daily_1y_gap: fetchableDaily1yGap,
      inception_limited_daily_1y_gap: inceptionLimitedDaily1yGap,
      claim_scope: "full_scored_etf_universe_diagnostic",
      service_gate: false,
      caveat: "Full scored-ETF daily 1Y continuity is a rolling diagnostic/backfill track. It must not block ETF Core Daily Basket service readiness; fetchable gaps keep only the full-universe diagnostic lane daily=false.",
    },
  ];
  const dailyReady = dailyChecks.every((check) => check.ok);
  const gatedReady = publicReady && dailyReady && etfSignalGate.ok;
  return {
    public_ready: publicReady,
    daily_ready: dailyReady,
    gated_ready: gatedReady,
    gate_ok: etfSignalGate.ok,
    public_surface_proof: etfSignalGate.public_surface_proof ?? null,
    public_surface_errors: etfSignalGate.errors ?? [],
    service_gate_scope: "ETF Core Daily Basket owns ETF service DAILY/GATED readiness; full scored-ETF daily 1Y continuity stays diagnostic until explicitly promoted.",
    daily_checks: dailyChecks,
    blockers: [
      ...(!publicReady ? ["public_surface_proof"] : []),
      ...dailyChecks.filter((check) => !check.ok).map((check) => check.id),
      ...(!etfSignalGate.ok ? ["qa_fenok_etf_signal_gate"] : []),
      ...(!gatedReady ? ["gated_ready"] : []),
    ],
    counts: {
      scored_public_etf: etfScoredPublic,
      eligible_etf_count: etfEligible,
      public_summary_rows: etfSignalGate.counts?.public_summary?.rows ?? null,
      internal_summary_rows: etfSignalGate.counts?.internal_summary?.rows ?? null,
      fetchable_required_history: fetchableGap,
      inception_limited_required_history: inceptionLimitedGap,
      fetchable_daily_1y_gap: fetchableDaily1yGap,
      inception_limited_daily_1y_gap: inceptionLimitedDaily1yGap,
    },
  };
}

const etfReadinessEvidence = computeEtfReadinessEvidence();
const etfReadinessStage = etfReadinessEvidence.public_ready ? "PUBLIC" : etfScoredPublic > 0 ? "SCORED" : "NORMALIZED";

function computeEtfCoreDailyBasketEvidence() {
  const exists = hasManifestPayload(etfCoreDailyBasket);
  const readiness = etfCoreDailyBasket.readiness ?? {};
  const coverage = etfCoreDailyBasket.coverage ?? {};
  const generatedAgeHours = ageHours(etfCoreDailyBasket.generated_at);
  const sourceCount = Number(coverage.source_scored_etf_count) || etfScoredPublic || 0;
  const selectedCount = Number(coverage.selected_count) || 0;
  const freshSelectedCount = Number(coverage.fresh_selected_count) || 0;
  const staleSelectedCount = Number(coverage.stale_selected_count) || 0;
  const minSelectedCount = Number(readiness.min_selected_count) || 0;
  const coreReady = Boolean(readiness.core_daily_basket_ready);
  const generatedFresh = generatedAgeHours != null && generatedAgeHours <= 48;
  const blockers = [
    ...(!exists ? ["core_daily_basket_artifact_missing"] : []),
    ...(exists && !generatedFresh ? ["core_daily_basket_artifact_stale"] : []),
    ...asArray(readiness.blockers),
  ];

  return {
    evidence_origin: "derived_counts_only",
    artifact_present: exists,
    generated_at: etfCoreDailyBasket.generated_at ?? null,
    generated_age_hours: generatedAgeHours,
    generated_fresh: generatedFresh,
    core_daily_basket_ready: coreReady,
    daily_ready: coreReady,
    gated_ready: coreReady,
    public_ready: false,
    public_done_claim_allowed: false,
    no_full_etf_done_claim: true,
    counts: {
      source_scored_etf_count: sourceCount,
      structural_candidate_count: Number(coverage.structural_candidate_count) || 0,
      selected_count: selectedCount,
      fresh_selected_count: freshSelectedCount,
      stale_selected_count: staleSelectedCount,
      min_selected_count: minSelectedCount,
      selected_by_category: coverage.selected_by_category ?? {},
      freshness_blocker_counts: coverage.freshness_blocker_counts ?? {},
    },
    status: !exists
      ? "missing"
      : coreReady && generatedFresh
        ? "ready"
        : "blocked_refresh_needed",
    blockers: [...new Set(blockers.filter(Boolean))],
    caveat: "Core Daily Basket is a smaller ETF sublane. It does not flip full etf_scoring_lane daily/gated readiness.",
  };
}

const etfCoreDailyBasketEvidence = computeEtfCoreDailyBasketEvidence();

function readinessTrack({ id, label, denominator, stage, booleans, caveat, extra = {} }) {
  const requirements = {
    source_available: false,
    normalized: false,
    joined_to_target_universe: false,
    scored: false,
    public: false,
    daily: false,
    gated: false,
    ...booleans,
  };
  const ready = Object.values(requirements).every(Boolean);
  return {
    id,
    label,
    denominator,
    stage,
    readiness_status: ready ? "ready" : "not_ready",
    public_done_claim_allowed: ready,
    requirements,
    caveat,
    ...extra,
  };
}

function activeS0BlockingEvidence() {
  const finraRowBreakdown = countByCategory(finraMissingRows, classifyFinraRowGap);
  const finraStrictBreakdown = countByCategory(finraStrictGapRows, (row) => classifyFinraStrictGap(row, flowRowsByTicker.get(rowTicker(row))));
  const occBreakdown = countByCategory(occMissingRows, classifyOccGap);
  const krxCoverageReady = koreaIntersection.length === koreaRows.length;
  const finraCoverageReady = finraEligibleMetricReadyRows.length === finraEligibleRows.length;
  const occDailyReady = occPlainSourceReadyRows.length === occDailyEligibleRows.length;
  const checks = [
    {
      id: "krx_full_daily_source_ready",
      status: countedDailySourceStatus({ coverageReady: krxCoverageReady, sourceDate: koreaCountedSourceDate }),
      covered_count: koreaIntersection.length,
      denominator: koreaRows.length,
      missing_count: Math.max(0, koreaRows.length - koreaIntersection.length),
      source_date: koreaCountedSourceDate,
      age_days: ageDays(koreaCountedSourceDate),
      max_age_days: MAX_COUNTED_DAILY_SOURCE_AGE_DAYS,
      eligibility_policy: "active_scoring_universe rows where market=KRX or KOSDAQ; counted date is the latest fully populated issuer daily proof date.",
      caveat: "Empty KRX calendar runs are not counted as issuer daily coverage.",
    },
    {
      id: "finra_full_us_source_ready",
      status: countedDailySourceStatus({ coverageReady: finraCoverageReady, sourceDate: flowSourceDate }),
      covered_count: finraEligibleMetricReadyRows.length,
      denominator: finraEligibleRows.length,
      missing_count: Math.max(0, finraEligibleRows.length - finraEligibleMetricReadyRows.length),
      source_date: flowSourceDate,
      age_days: ageDays(flowSourceDate),
      max_age_days: MAX_COUNTED_DAILY_SOURCE_AGE_DAYS,
      eligibility_policy: "active_scoring_universe rows where market=US; US_CLASS foreign/class rows stay in active US bucket but are excluded from FINRA plain-US readiness until mapped or rebucketed.",
      excluded_us_class_count: usRows.length - finraEligibleRows.length,
      row_existence_count: flowIntersection.length,
      strict_metric_ready_count: finraStrictMetricReadyRows.length,
      strict_metric_missing_or_placeholder_count: finraStrictGapRows.length,
      low_confidence_placeholder_count: finraPlaceholderRows.length,
      derived_gap_breakdown: {
        row_existence_criterion: {
          covered_count: flowIntersection.length,
          missing_count: finraMissingRows.length,
          missing_categories: finraRowBreakdown,
        },
        strict_metric_ready_criterion: {
          covered_count: finraStrictMetricReadyRows.length,
          missing_or_placeholder_count: finraStrictGapRows.length,
          missing_or_placeholder_categories: finraStrictBreakdown,
        },
        active_plain_us_metric_ready_criterion: {
          covered_count: finraEligibleMetricReadyRows.length,
          denominator: finraEligibleRows.length,
          missing_count: finraEligibleMetricMissingRows.length,
        },
      },
      semantic_warning: "Row-existence FINRA coverage is not the same as metric-ready FINRA coverage when low-confidence placeholders exist.",
      next_action: "Keep US_CLASS foreign/class rows out of FINRA readiness until mapped or rebucketed; do not refetch FINRA for those rows.",
    },
    {
      id: "occ_full_us_source_ready",
      status: countedDailySourceStatus({ coverageReady: occDailyReady, sourceDate: occSourceDate }),
      covered_count: occPlainSourceReadyRows.length,
      denominator: occDailyEligibleRows.length,
      missing_count: occPlainBlockingRows.length,
      source_date: occSourceDate,
      age_days: ageDays(occSourceDate),
      max_age_days: MAX_COUNTED_DAILY_SOURCE_AGE_DAYS,
      eligibility_policy: "active_scoring_universe rows where market=US and ticker is a plain OCC underlying; US_CLASS foreign/class rows stay in active US bucket but are excluded from OCC plain-underlying readiness until mapped or rebucketed.",
      derived_gap_breakdown: {
        missing_categories: {
          ...countByCategory(occPlainBlockingRows, classifyOccGap),
          excluded_non_plain_or_foreign_suffix_count: occBreakdown.non_plain_or_foreign_suffix_requires_universe_mapping ?? 0,
          excluded_class_share_symbol_count: occClassShareMissingRows.length,
          plain_us_attempted_unresolved_count: occPlainAttemptedRows.length,
          plain_us_no_record_attempt_count: occPlainNoRecordRows.length,
          plain_us_no_listed_options_source_ready_count: occPlainNoListedOptionsRows.length,
          plain_us_partial_no_record_or_form_gap_count: occPlainPartialNoRecordRows.length,
          plain_us_transient_failed_attempt_count: occPlainTransientFailedRows.length,
          plain_us_failed_attempt_count: occPlainFailedRows.length,
          plain_us_unattempted_count: occPlainUnattemptedRows.length,
        },
        active_plain_us_occ_ready_criterion: {
          covered_count: occPlainSourceReadyRows.length,
          denominator: occDailyEligibleRows.length,
          present_options_activity_rows: occPlainPresentRows.length,
          no_listed_options_evidence_rows: occPlainNoListedOptionsRows.length,
          blocking_missing_count: occPlainBlockingRows.length,
        },
        plain_us_collection_or_no_options_policy_required: {
          count: occPlainMissingRows.length,
          attempted_unresolved_count: occPlainAttemptedRows.length,
          no_record_attempt_count: occPlainNoRecordRows.length,
          no_listed_options_source_ready_count: occPlainNoListedOptionsRows.length,
          partial_no_record_or_form_gap_count: occPlainPartialNoRecordRows.length,
          transient_failed_attempt_count: occPlainTransientFailedRows.length,
          failed_attempt_count: occPlainFailedRows.length,
          unattempted_count: occPlainUnattemptedRows.length,
          accepted_form_policy: {
            partial_zero_side_row_policy: "implemented_for_future_collection_when_one_side_loaded_and_the_other_side_no_record",
            no_listed_options_policy: "accepted_for_source_readiness_when_both_call_and_put_queries_return_no_record_for_the_counted_source_date; scoring proxy remains null/zero-evidence rather than fabricated activity",
            current_partial_rows_without_output_row_count: occPlainPartialNoRecordRows.length,
            current_no_record_source_ready_count: occPlainNoListedOptionsRows.length,
          },
        },
        non_plain_or_foreign_suffix_requires_universe_mapping: {
          count: occBreakdown.non_plain_or_foreign_suffix_requires_universe_mapping ?? 0,
          blocks_current_plain_occ_readiness: false,
        },
        class_share_symbol_normalization_or_source_gap: {
          count: occClassShareMissingRows.length,
          blocks_current_plain_occ_readiness: false,
        },
      },
      next_action: "Do not broad-fetch. Keep non-plain/foreign/class rows as mapping/denominator policy work outside the current plain-OCC readiness denominator; continue BRK accepted-form research separately.",
    },
    {
      id: "no_asia_ex_taiwan_gap",
      status: "ready",
      covered_count: 0,
      denominator: asiaExTwRows.length,
      missing_count: 0,
      excluded_count: asiaExTwRows.length,
      markets: marketCounts(asiaExTwRows),
      claim_scope: "explicit_s0_daily_scope_exclusion",
      blocks_daily_ready: false,
      daily_gated_scope_denominator: s0DailyEligibleRows.length,
      daily_gated_scope_policy: "Current S0 daily/gated source scope is Korea + US only; HKEX/SSE/SZSE need a separate Asia daily-source workstream before an all-1066 daily/gated claim.",
      next_action: "Build HKEX/SSE/SZSE daily-source workstream before claiming all active 1066 stocks as daily/gated.",
    },
  ];
  return {
    evidence_origin: "derived_counts_only",
    daily_ready: checks.every((check) => check.status === "ready"),
    gated_ready: checks.every((check) => check.status === "ready"),
    checks,
    blockers: checks.filter((check) => check.status !== "ready"),
    caveat: "Readiness blocker counts only; no raw rows, private manifests, target ticker lists, or public scoring claims.",
  };
}

const activeS0Evidence = activeS0BlockingEvidence();
const generatedAt = new Date().toISOString();
const index = {
  schema_version: "fenok-edge-coverage-index/v0.2",
  generated_at: generatedAt,
  purpose: "Derived admin-only readiness index. Separates current active scoring universe, collected candidate denominators, source availability, and public scoring readiness.",
  raw_policy: {
    raw_public: false,
    raw_rows_included: false,
    private_manifest_pointer_only: true,
  },
  feno_data_read: {
    category: "admin",
    file: "fenok-edge-coverage-index.json",
    jq_example: "jq '{generated_at, active_scoring_universe, expanded_stock_candidate_universe, etf_universe, source_availability, public_scoring_readiness}' \"$DATA_ROOT/admin/fenok-edge-coverage-index.json\"",
  },
  active_scoring_universe: {
    source_file: "data/computed/fenok_signals.json",
    generated_at: signals.generated_at ?? null,
    current_only: true,
    total: activeScoringTotal,
    by_market: marketCounts(universeRows),
    buckets: {
      us: usRows.length,
      korea: koreaRows.length,
      asia_ex_taiwan: asiaExTwRows.length,
      explicit_taiwan: explicitTaiwanRows.length,
    },
    s0_daily_gated_scope: {
      policy: "korea_plus_us_current_daily_sources",
      eligible_count: s0DailyEligibleRows.length,
      eligible_buckets: {
        us: usRows.length,
        korea: koreaRows.length,
      },
      excluded_count: asiaExTwRows.length,
      excluded_markets: marketCounts(asiaExTwRows),
      excluded_reason: "HKEX/SSE/SZSE rows are active/public scored rows, but they are outside the current Korea+US daily-source workstream.",
      public_scoring_total_remains: activeScoringTotal,
    },
    taiwan_ticker_anomalies: taiwanTickerAnomalies,
  },
  expanded_stock_candidate_universe: {
    source_file: "data/computed/market_facts/index.json",
    generated_at: marketFacts.generated_at ?? null,
    collected_asset_total: Number(marketFacts.count) || null,
    collected_stock_candidates: Number(marketFactsCoverage.stock) || null,
    scored_public_stock: activeScoringTotal,
    stock_promotion_audit_gap: Number(marketFactsCoverage.stock) ? Math.max(0, Number(marketFactsCoverage.stock) - activeScoringTotal) : null,
    stage: "NORMALIZED",
    public_done_claim_allowed: false,
    caveat: "market_facts is a normalized collected/candidate layer. It does not expand scored/public stock coverage until candidates are joined, scored, published, refreshed, and gated.",
  },
  etf_universe: {
    source_file: "data/computed/market_facts/index.json",
    stockanalysis_index_file: "data/stockanalysis/index.json",
    etf_signals_summary_file: "data/computed/fenok_etf_signals_summary.json",
    collected_etf_candidates: Number(marketFactsCoverage.etf) || null,
    eligible_etf_count: etfEligible || null,
    stage: etfReadinessStage,
    scored_public_etf: etfScoredPublic,
    public_done_claim_allowed: false,
    evidence_based_readiness: etfReadinessEvidence,
    core_daily_basket: {
      stage: etfCoreDailyBasketEvidence.artifact_present ? "GATED_INTERNAL" : "PLANNED",
      public_done_claim_allowed: false,
      evidence_based_readiness: etfCoreDailyBasketEvidence,
    },
    caveat: "ETF scoring is a separate asset_type=etf lane. Public surface proof is separate from DAILY/GATED readiness and does not permit a paid-ready done claim.",
  },
  source_availability: {
    not_public_scoring: true,
    caveat: "These rows prove source/proxy/run-health availability only. They are not paid-service readiness and must not be reported as final public scoring coverage.",
    sources: [
    coverageRow({
      id: "krx_issuer_daily_latest_full_proof",
      label: "Korea KRX issuer daily coverage, latest fully populated proof",
      count: koreaIntersection.length,
      denominator: koreaRows.length,
      denominatorLabel: "active_scoring_universe.korea",
      sourceDate: koreaCountedSourceDate,
      status: koreaIntersection.length === koreaRows.length ? "ready" : "partial",
      claimScope: "source_available",
      activeTotal: activeScoringTotal,
      caveat: "Counted from the latest KRX daily stock/KOSDAQ raw files with non-empty rows. Empty calendar runs are not counted as issuer daily coverage.",
      extra: {
        private_manifest_file: koreaProofManifestPath,
        counted_batch: {
          run_id: koreaLatestRun.run_id ?? null,
          as_of: koreaBridge.as_of ?? null,
          summary: koreaLatestRun.summary ?? null,
          date_count: koreaProofManifest.date_range?.date_count ?? koreaBridge.freshness?.date_count ?? null,
          attempted_call_count: koreaLatestRun.attempted_call_count ?? koreaProofManifest.attempted_call_count ?? null,
        },
        latest_calendar_run: {
          run_id: koreaLatestCalendarManifest.run_id ?? null,
          as_of: koreaLatestCalendarManifest.date_range?.end_date ?? koreaBridge.as_of ?? null,
          summary: koreaLatestCalendarManifest.summary ?? null,
          daily_history_rows: koreaLatestCalendarDailyHistoryRows,
          countable_for_issuer_daily: koreaLatestCalendarDailyHistoryRows > 0,
        },
      },
    }),
    coverageRow({
      id: "us_finra_flow_proxy",
      label: "US FINRA flow proxy coverage, active plain-US metric-ready",
      count: finraEligibleMetricReadyRows.length,
      denominator: finraEligibleRows.length,
      denominatorLabel: "active_scoring_universe.us where market=US",
      sourceDate: flowSourceDate,
      status: finraEligibleMetricReadyRows.length === finraEligibleRows.length ? "ready" : "partial",
      claimScope: "proxy_source_available",
      activeTotal: activeScoringTotal,
      caveat: "FINRA short-sale/off-exchange metric-ready coverage for active plain-US rows only; not full all-axis scoring and not directional flow. US_CLASS foreign/class rows are tracked as mapping policy work, not FINRA fetch gaps.",
      extra: {
        source_file: "data/computed/fenok_flow_proxies.json",
        rows: Array.isArray(flow.rows) ? flow.rows.length : 0,
        row_existence_count: flowIntersection.length,
        strict_metric_ready_count: finraStrictMetricReadyRows.length,
        low_confidence_placeholder_count: finraPlaceholderRows.length,
        excluded_us_class_count: usRows.length - finraEligibleRows.length,
        eligibility_policy: "active rows where market=US and FINRA proxy metrics are high-confidence/non-placeholder",
      },
    }),
    coverageRow({
      id: "us_occ_options_proxy",
      label: "US OCC listed-options proxy coverage",
      count: occPlainSourceReadyRows.length,
      denominator: occDailyEligibleRows.length,
      denominatorLabel: "active_scoring_universe.us where market=US and ticker is a plain OCC underlying",
      sourceDate: occSourceDate,
      status: occPlainSourceReadyRows.length === occDailyEligibleRows.length ? "ready" : occPlainSourceReadyRows.length > 0 ? "partial" : "missing",
      claimScope: "proxy_source_available",
      activeTotal: activeScoringTotal,
      caveat: "OCC listed-options volume proxy or counted no-listed-options evidence for active plain-US rows only; not OPRA, premium, greeks, or buyer/seller direction. US_CLASS foreign/class rows are mapping policy work, not broad OCC fetch gaps.",
      extra: {
        source_file: "data/computed/fenok_occ_options_volume.json",
        rows: occRows.length,
        accepted_form_policy: {
          counted_present_rows: occPlainSourceReadyRows.length,
          options_activity_rows: occPlainPresentRows.length,
          no_listed_options_source_ready_rows: occPlainNoListedOptionsRows.length,
          excluded_us_class_or_non_plain_rows: usRows.length - occDailyEligibleRows.length,
          both_sides_loaded_or_legacy_rows: occBothSidesLoadedOrLegacyRows.length,
          partial_zero_side_rows: occPartialZeroSideRows.length,
          partial_zero_side_rule: "A ticker row may count when exactly one OCC side is loaded and the other side is no_record; the no_record side is represented as zero volume.",
          no_listed_options_rule: "Both-side no_record for the counted source date counts as source-ready no-listed-options evidence for daily/gated readiness; it does not fabricate options activity.",
        },
      },
    }),
    coverageRow({
      id: "us_latest_bounded_backfill_run",
      label: "US latest bounded backfill run coverage",
      count: latestUsIntersection.length,
      denominator: usRows.length,
      denominatorLabel: "active_scoring_universe.us",
      sourceDate: latestUsSourceDate,
      status: latestUsIntersection.length > 0 ? "ready" : "missing",
      claimScope: "run_health",
      activeTotal: activeScoringTotal,
      caveat: "The latest bounded run covers the explicit reference ticker set only; it is a run-health proof, not full US coverage.",
      extra: {
        private_manifest_file: latestUsRun.private_manifest_file ?? null,
        target_universe: latestUsTargetUniverse,
        status_counts: latestUsRun.status_counts ?? null,
      },
    }),
    coverageRow({
      id: "taiwan_current_universe",
      label: "Taiwan current active-universe numerator",
      count: explicitTaiwanRows.length,
      denominator: activeScoringTotal,
      denominatorLabel: "active_scoring_universe.total",
      sourceDate: toIsoDate(taiwanBridge.latest_source_date),
      status: explicitTaiwanRows.length > 0 ? "ready" : "not_in_universe",
      claimScope: "not_current_numerator",
      activeTotal: activeScoringTotal,
      caveat: "Taiwan source collection is active, but the current active scoring universe has no explicit Taiwan bucket. It does not increase the current numerator until universe mapping is fixed.",
      extra: {
        bridge_file: "data/admin/taiwan-data-bridge-index.json",
        bridge_version: taiwanBridge.bridge_version ?? null,
        historical_limitation: taiwanBridge.historical_limitation ?? null,
        historical_smoke: {
          manifest_file: "_private/admin/fenok-edge-taiwan/backfill/20260629/historical_smoke/historical_manifest.json",
          dates_attempted: taiwanHistorical.dates_attempted ?? [],
          endpoint_count: taiwanHistorical.endpoint_count ?? null,
          summary: taiwanHistorical.summary ?? null,
        },
      },
    }),
    ],
  },
  source_availability_composites: {
    not_public_scoring: true,
    caveat: "Composite counts are useful for source availability progress only. They are not public scoring coverage.",
    latest_available_kr_plus_us_flow: {
      covered_count: combinedKrUsFlow,
      denominator: activeScoringTotal,
      denominator_label: "active_scoring_universe.total",
      coverage_pct: pct(combinedKrUsFlow, activeScoringTotal),
      claim_scope: "source_availability_composite",
      not_public_scoring: true,
      formula: "KRX latest fully populated issuer daily proof + US FINRA flow proxy",
    },
    latest_available_kr_plus_us_occ: {
      covered_count: combinedKrUsOcc,
      denominator: activeScoringTotal,
      denominator_label: "active_scoring_universe.total",
      coverage_pct: pct(combinedKrUsOcc, activeScoringTotal),
      claim_scope: "source_availability_composite",
      not_public_scoring: true,
      formula: "KRX latest fully populated issuer daily proof + US OCC options proxy",
    },
    strict_new_bounded_run_plus_kr: {
      covered_count: combinedKrUsLatestBounded,
      denominator: activeScoringTotal,
      denominator_label: "active_scoring_universe.total",
      coverage_pct: pct(combinedKrUsLatestBounded, activeScoringTotal),
      claim_scope: "run_health_composite",
      not_public_scoring: true,
      formula: "KRX latest fully populated issuer daily proof + latest US bounded reference-ticker run",
    },
    remaining_asia_ex_taiwan: {
      count: asiaExTwRows.length,
      denominator: activeScoringTotal,
      denominator_label: "active_scoring_universe.total",
      pct: pct(asiaExTwRows.length, activeScoringTotal),
      claim_scope: "explicit_s0_daily_scope_exclusion",
      not_public_scoring: true,
      excluded_from_s0_daily_gated_scope: true,
      blocks_daily_ready: false,
      daily_gated_scope_denominator: s0DailyEligibleRows.length,
      daily_gated_scope_label: "active_scoring_universe.us + active_scoring_universe.korea",
      excluded_markets: marketCounts(asiaExTwRows),
      caveat: "HKEX/SSE/SZSE rows remain active/public scored rows, but are explicitly excluded from the current Korea+US S0 daily/gated source scope until a separate Asia daily-source workstream exists.",
    },
  },
  public_scoring_readiness: {
    completion_ladder: ["COLLECTED", "NORMALIZED", "JOINED", "SCORED", "PUBLIC", "DAILY", "GATED"],
    done_rule: "Only PUBLIC + DAILY + GATED can be called done. Source/admin/smoke rows are not done.",
    tracks: [
      readinessTrack({
        id: "active_stock_scoring_current",
        label: "Current active stock scoring chain",
        denominator: activeScoringTotal,
        stage: "PUBLIC",
        booleans: {
          source_available: true,
          normalized: true,
          joined_to_target_universe: true,
          scored: true,
          public: true,
          daily: activeS0Evidence.daily_ready,
          gated: activeS0Evidence.gated_ready,
        },
        caveat: activeS0Evidence.gated_ready
          ? "The current active stock chain is public-scored and has Korea+US daily/gated source proof under the current S0 scope; HKEX/SSE/SZSE and US_CLASS mapping remain separate expansion work."
          : "The current active stock chain is public-scored, but daily accumulation and fail-closed readiness gates are not fully proven by this index.",
        extra: {
          blocking_evidence: activeS0Evidence,
        },
      }),
      readinessTrack({
        id: "expanded_stock_candidates",
        label: "Expanded stock candidate promotion",
        denominator: Number(marketFactsCoverage.stock) || null,
        stage: "NORMALIZED",
        booleans: {
          source_available: Boolean(marketFactsCoverage.stock),
          normalized: Boolean(marketFactsCoverage.stock),
        },
        caveat: "112 stock candidates need promotion audit before they can increase scored/public stock coverage.",
      }),
      readinessTrack({
        id: "etf_scoring_lane",
        label: "ETF scoring lane",
        denominator: etfEligible || Number(marketFactsCoverage.etf) || null,
        stage: etfReadinessStage,
        booleans: {
          source_available: Boolean(marketFactsCoverage.etf),
          normalized: Boolean(marketFactsCoverage.etf),
          joined_to_target_universe: etfEligible > 0,
          scored: etfScoredPublic > 0,
          public: etfReadinessEvidence.public_ready,
          daily: etfReadinessEvidence.daily_ready,
          gated: etfReadinessEvidence.gated_ready,
        },
        caveat: "ETF scores are public-surfaced by the named ETF gate. Full-universe DAILY/GATED remains a diagnostic/backlog track; ETF service DAILY/GATED is evaluated by the Core Daily Basket sublane.",
        extra: {
          evidence_based_readiness: etfReadinessEvidence,
        },
      }),
      readinessTrack({
        id: "etf_core_daily_basket",
        label: "ETF Core Daily Basket",
        denominator: etfCoreDailyBasketEvidence.counts.selected_count || null,
        stage: etfCoreDailyBasketEvidence.artifact_present ? "GATED_INTERNAL" : "PLANNED",
        booleans: {
          source_available: etfCoreDailyBasketEvidence.artifact_present,
          normalized: etfCoreDailyBasketEvidence.counts.structural_candidate_count > 0,
          joined_to_target_universe: etfCoreDailyBasketEvidence.counts.selected_count > 0,
          scored: etfCoreDailyBasketEvidence.counts.selected_count > 0,
          public: false,
          daily: etfCoreDailyBasketEvidence.daily_ready,
          gated: etfCoreDailyBasketEvidence.gated_ready,
        },
        caveat: "Core Basket is an internal daily-refresh target list and compact public summary. It cannot be reported as full ETF lane completion.",
        extra: {
          evidence_based_readiness: etfCoreDailyBasketEvidence,
        },
      }),
      readinessTrack({
        id: "taiwan_current_numerator",
        label: "Taiwan current active-universe numerator",
        denominator: activeScoringTotal,
        stage: explicitTaiwanRows.length > 0 ? "JOINED" : "COLLECTED",
        booleans: {
          source_available: Boolean(taiwanHistorical.summary?.success_files || taiwanBridge.bridge_version),
          normalized: Boolean(taiwanBridge.bridge_version),
          joined_to_target_universe: explicitTaiwanRows.length > 0,
        },
        caveat: "Taiwan source work cannot improve the current numerator until Taiwan symbols are in the active scoring universe.",
      }),
    ],
  },
  supervised_backfill_progress: {
    korea_252_queue: {
      status: koreaLatestRun.run_id === "krx_backfill_20d_20260626" ? "started_bounded_supervised" : "not_started",
      completed_trading_dates: koreaLatestRun.run_id === "krx_backfill_20d_20260626" ? 20 : 0,
      total_trading_dates: 252,
      completed_endpoint_calls: Number(koreaLatestRun.attempted_call_count) || 0,
      estimated_full_endpoint_calls: Number(koreaBridge.request_budget?.estimated_full_252_calls) || 7812,
      latest_batch_manifest: koreaProofManifestPath,
      latest_batch_dates: koreaProofManifest.date_range?.dates ?? [],
      latest_batch_summary: koreaLatestRun.summary ?? null,
      caveat: "This is Korea 20-trading-day bounded progress. It does not change the latest fully populated proof beyond the batch end date.",
    },
    us_252_reference_ticker_queue: {
      status: usFull252FirstBatch.run_id ? "started_bounded_supervised" : "not_started",
      completed_batches: usFull252FirstBatch.run_id ? 1 : 0,
      total_batches: 51,
      completed_trading_dates: Number(usFull252FirstBatch.date_count) || 0,
      total_trading_dates: 252,
      completed_finra_requests: Number(usFull252FirstBatch.date_count) || 0,
      total_finra_requests: 252,
      completed_occ_side_requests: Number(usFull252FirstBatch.sources?.find((source) => source.source_id === "occ_listed_options_volume")?.side_request_count) || 0,
      total_occ_side_requests: 4032,
      latest_batch_manifest: usFull252FirstBatch.outputs?.manifest_file ?? null,
      latest_batch_dates: usFull252FirstBatch.dates ?? [],
      latest_batch_status_counts: usFull252FirstBatch.status_counts ?? null,
      caveat: "This is 252-history progress for the 8 reference tickers only. It does not expand current active coverage beyond the existing computed US rows.",
    },
  },
  freshness_gate: {
    max_calendar_age_days_for_counted_daily_sources: MAX_COUNTED_DAILY_SOURCE_AGE_DAYS,
    checks: [
      {
        id: "coverage_index_generated",
        status: "ready",
        generated_at: generatedAt,
      },
      {
        id: "korea_counted_source_date",
        source_date: koreaCountedSourceDate,
        age_days: ageDays(koreaCountedSourceDate),
        status: countedDailySourceFresh(koreaCountedSourceDate) ? "ready" : "stale",
        caveat: "20260629 KRX run exists but is mostly empty; gate uses latest fully populated proof date.",
      },
      {
        id: "us_flow_source_date",
        source_date: flowSourceDate,
        age_days: ageDays(flowSourceDate),
        status: countedDailySourceFresh(flowSourceDate) ? "ready" : "stale",
      },
      {
        id: "us_occ_source_date",
        source_date: occSourceDate,
        age_days: ageDays(occSourceDate),
        status: countedDailySourceFresh(occSourceDate) ? "ready" : "stale",
      },
      {
        id: "etf_public_surface",
        status: etfReadinessEvidence.public_ready ? "ready" : "blocked",
        scored_public_etf: etfScoredPublic,
        proof: etfReadinessEvidence.public_surface_proof,
        caveat: "Requires compact public summary mirror, no public full ETF signal payload, API route, and ETF detail UI card.",
      },
      {
        id: "etf_signal_summary_freshness",
        generated_at: etfSignals.generated_at ?? null,
        age_hours: ageHours(etfSignals.generated_at),
        max_age_hours: 48,
        status: etfReadinessEvidence.daily_checks.find((check) => check.id === "etf_signal_summary_fresh")?.ok ? "ready" : "stale",
      },
      {
        id: "etf_required_history_gap",
        generated_at: etfHistoryGap.generated_at ?? null,
        age_hours: ageHours(etfHistoryGap.generated_at),
        max_age_hours: 48,
        fetchable_required_history: Number(etfHistoryGap.fetchable_required_history) || 0,
        inception_limited_required_history: Number(etfHistoryGap.inception_limited_required_history) || 0,
        status: etfReadinessEvidence.daily_checks.find((check) => check.id === "etf_no_fetchable_required_history_gap")?.ok ? "ready" : "blocked_fetchable_gap",
        caveat: "Fetchable required-history gaps keep ETF daily=false. Inception-limited gaps are tracked but do not block daily readiness by themselves.",
      },
      {
        id: "etf_daily_1y_gap",
        generated_at: etfHistoryGap.generated_at ?? null,
        fetchable_daily_1y_gap: Number(etfHistoryGap.daily_1y_gap?.scored_etfs?.fetchable) || 0,
        inception_limited_daily_1y_gap: Number(etfHistoryGap.daily_1y_gap?.scored_etfs?.inception_limited) || 0,
        status: etfReadinessEvidence.daily_checks.find((check) => check.id === "etf_no_fetchable_daily_1y_gap")?.ok ? "ready" : "blocked_fetchable_daily_gap",
        claim_scope: "full_scored_etf_universe_diagnostic",
        service_gate: false,
        caveat: "Full scored-ETF daily 1Y continuity is a diagnostic/backfill track, not the ETF Core Daily Basket service gate.",
      },
      {
        id: "etf_core_daily_basket",
        generated_at: etfCoreDailyBasketEvidence.generated_at,
        age_hours: etfCoreDailyBasketEvidence.generated_age_hours,
        selected_count: etfCoreDailyBasketEvidence.counts.selected_count,
        fresh_selected_count: etfCoreDailyBasketEvidence.counts.fresh_selected_count,
        stale_selected_count: etfCoreDailyBasketEvidence.counts.stale_selected_count,
        status: etfCoreDailyBasketEvidence.status,
        caveat: "This is the ETF service daily/gated target. Full ETF daily 1Y gaps stay in the separate rolling diagnostic/backfill lane.",
      },
      {
        id: "taiwan_universe_mapping",
        status: explicitTaiwanRows.length > 0 ? "ready" : "blocked_for_numerator",
        explicit_taiwan_count: explicitTaiwanRows.length,
        anomaly_count: taiwanTickerAnomalies.length,
        caveat: "Source readiness is separate from current active-universe numerator coverage.",
      },
    ],
  },
};

preservePriorPrivateBackedEvidence(index, priorIndex, {
  koreaProofMissing,
  latestUsRunMissing,
  taiwanHistoricalMissing,
});

const publicIndex = compactPublicCoverageIndex(index);
writeJson(OUT_PATH, index);
writeJson(PUBLIC_OUT_PATH, publicIndex);
console.log(JSON.stringify({
  wrote: path.relative(REPO_ROOT, OUT_PATH),
  public_wrote: path.relative(REPO_ROOT, PUBLIC_OUT_PATH),
  generated_at: index.generated_at,
  active_scoring_universe_total: index.active_scoring_universe.total,
  expanded_stock_candidate_universe: index.expanded_stock_candidate_universe,
  etf_universe: index.etf_universe,
  etf_readiness_evidence: etfReadinessEvidence,
  latest_available_kr_plus_us_flow: index.source_availability_composites.latest_available_kr_plus_us_flow,
  taiwan_explicit_count: explicitTaiwanRows.length,
  taiwan_anomaly_count: taiwanTickerAnomalies.length,
}, null, 2));
