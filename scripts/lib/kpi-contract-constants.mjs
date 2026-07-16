/**
 * Canonical KPI v2 contract constants (single source of truth).
 *
 * The builder EMITS definitional values from this module; the checker VALIDATES
 * the artifact against this module. The artifact may only carry OBSERVATIONS
 * (statuses, dates, ages, run identity). Any DEFINITIONAL field embedded in the
 * artifact (cadence thresholds, SLA table, deny keys, tolerance) must deep-equal
 * this module or the checker hard-errors in BOTH Phase A and strict — a definition
 * tamper is never warn-only. This kills the "checker trusts values carried in the
 * artifact" bug class at the root.
 *
 * LEAF MODULE: constants only, ZERO imports (no import cycles). It must NOT import
 * from the builder / checker / projector / market-calendar / basket. Downstream
 * modules import FROM here (arrows point toward this leaf).
 */

// Canonical single source of the ETF Core Daily Basket max quote age. The basket
// builder imports THIS (build-fenok-etf-core-daily-basket.mjs) — the number lives
// in exactly one place (contract §5 "no second number").
export const ETF_CORE_MAX_QUOTE_AGE_DAYS = 7;

// Required RIM indices (OLDEST-of aggregation basis for rim_index_inputs SLA).
export const REQUIRED_RIM_INDICES = Object.freeze(["SPX", "NDX", "KOSPI", "SOX"]);

// Required product surfaces (definitional; used once product_surface_coverage gets
// its true per-surface source stamp — kept here where definitions live).
export const REQUIRED_SURFACE_IDS = Object.freeze([
  "stock_detail",
  "market_valuation",
  "market_events",
  "sectors",
  "etf_center",
  "screener",
]);

export const PRODUCT_SURFACE_STAMP_VERSION = 2;
export const PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS = 50;
export const PRODUCT_SURFACE_DATE_MAX_AGE_BUSINESS_DAYS = 10;
export const PRODUCT_SURFACE_DATELESS_REASON = "provider publishes no date; recency = collection time";
export const PRODUCT_SURFACE_LEGACY_CLASSIFICATION = "legacy-fabricated";
export const PRODUCT_SURFACE_LEGACY_DISPOSITION = "superseded";

// Cadence thresholds (definitional). v2_activated_at + calendar_version are
// per-build state stamped onto the artifact cadence, NOT part of this canonical set.
export const CADENCE = Object.freeze({
  crons_utc: Object.freeze(["30 2 * * *", "30 9 * * *"]),
  slot_grace_minutes: 360,
  hard_max_age_hours: 26,
  slot_retention_days: 14,
});

// Crons accountable as due/satisfied/missed (workflow-namespaced, §2/§3).
export const TRACKED_CRONS = Object.freeze([
  Object.freeze({ workflow_file: "update-manifest.yml", cron: "30 2 * * *" }),
  Object.freeze({ workflow_file: "update-manifest.yml", cron: "30 9 * * *" }),
  Object.freeze({ workflow_file: "fenok-edge-daily.yml", cron: "30 0 * * 2-6" }),
  Object.freeze({ workflow_file: "fenok-edge-krx-daily.yml", cron: "30 10 * * 1-5" }),
]);

// Only owner-approved platform corruption/integrity checks may halt publication
// for every lane. Ordinary source freshness/readiness stays lane-local.
export const PLATFORM_BLOCKING_CHECK_KEYS = Object.freeze([
  "finra_occ_plain_us_and_mapping_policy/ledger_acceptance",
  "finra_occ_plain_us_and_mapping_policy/ledger_private_only",
  "automation_contract/sync_static_builds_kpi",
  "automation_contract/sync_static_checks_kpi",
  "automation_contract/update_manifest_rebuilds_kpi",
  "automation_contract/deploy_worker_checks_kpi",
  "automation_contract/deploy_worker_smokes_kpi",
  "automation_contract/phase_b_checker_strict",
  "automation_contract/phase_b_pending_max_age",
  "automation_contract/deploy_worker_smoke_strict",
  "automation_contract/yf_daily_no_default_cap",
  "automation_contract/stockanalysis_daily1y_scheduled",
  "automation_contract/edge_daily_dispatches_manifest",
  "automation_contract/krx_daily_dispatches_manifest",
  "public_mirror_safety/kpi_public_mirror",
  "public_mirror_safety/rim_public_private_paths_redacted",
  "public_mirror_safety/coverage_public_private_paths_absent",
  "public_mirror_safety/forbidden_tokens_absent",
  "slickcharts_delivery_freshness/json_integrity",
  "slickcharts_delivery_freshness/universe_identity",
]);

export const SLICKCHARTS_DELIVERY_GROUPS = Object.freeze([
  Object.freeze({
    id: "slickcharts_daily_delivery",
    workflow: "slickcharts-daily",
    max_hours: 30,
    files: Object.freeze(["gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json"]),
  }),
  Object.freeze({
    id: "slickcharts_weekly_delivery",
    workflow: "slickcharts-weekly",
    max_hours: 174,
    files: Object.freeze(["sp500.json", "magnificent7.json", "etf.json", "berkshire.json"]),
  }),
  Object.freeze({
    id: "slickcharts_symbols_delivery",
    workflow: "slickcharts-symbols",
    max_hours: 174,
    files: Object.freeze(["symbols.json"]),
  }),
  Object.freeze({
    id: "slickcharts_monthly_delivery",
    workflow: "slickcharts-monthly",
    max_hours: 750,
    files: Object.freeze([
      "sp500-returns.json", "sp500-returns-details.json", "nasdaq100-returns.json", "dowjones-returns.json",
      "sp500-drawdown.json", "btc-returns.json", "eth-returns.json",
      "sp500-performance.json", "nasdaq100-performance.json", "dowjones-performance.json",
      "sp500-yield.json", "nasdaq100-yield.json", "dowjones-yield.json",
      "sp500-analysis.json", "nasdaq100-analysis.json", "dowjones-analysis.json",
      "sp500-marketcap.json", "nasdaq100-ratio.json", "nasdaq100.json", "dowjones.json", "inflation.json",
    ]),
  }),
  Object.freeze({
    id: "slickcharts_history_delivery",
    workflow: "slickcharts-history",
    max_hours: 750,
    files: Object.freeze([
      "stocks-returns.json", "stocks-dividends.json", "stocks-dividends-recent.json", "stocks-dividends-historical.json",
    ]),
    include_current_universe: true,
  }),
]);

// Source workflows allowed to dispatch authoritative rebuilds + their own crons.
export const SOURCE_WORKFLOW_CRONS = Object.freeze({
  "fenok-edge-daily.yml": Object.freeze(["30 0 * * 2-6"]),
  "fenok-edge-krx-daily.yml": Object.freeze(["30 10 * * 1-5"]),
});

// Normative per-source SLA table (contract §5). Every field here is DEFINITIONAL;
// the artifact copies these verbatim and the checker enforces deep-equality.
// etf_core reuses ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays (no second number).
export const SOURCE_SLA_DEF = Object.freeze([
  Object.freeze({ source_id: "s0_finra_occ_mapping_ledger", freshness_basis: ".source_audit.source_dates.finra_source_date/.occ_source_date (OLDEST)", unit: "business_days", calendar: "us_market", max_staleness: 3, required: true }),
  Object.freeze({ source_id: "rim_index_inputs", freshness_basis: ".indices[SPX,NDX,KOSPI,SOX].observed.price.as_of (OLDEST)", unit: "calendar_days", calendar: "us_market", max_staleness: 10, required: true }),
  Object.freeze({ source_id: "etf_core_daily_basket_admin", freshness_basis: ".rows[].proof.quote_date (OLDEST)", unit: "calendar_days", calendar: "us_market", max_staleness: ETF_CORE_MAX_QUOTE_AGE_DAYS, required: true }),
  Object.freeze({ source_id: "fenok_edge_coverage_index", freshness_basis: ".source_as_of", unit: "business_days", calendar: "us_market", max_staleness: 3, required: true }),
  Object.freeze({ source_id: "product_surface_coverage", freshness_basis: "stamp_evidence v2: complete TRUE-date members + collection-fresh dateless members; source floor OLDEST", unit: "business_days", calendar: "us_market", max_staleness: PRODUCT_SURFACE_DATE_MAX_AGE_BUSINESS_DAYS, required: true }),
  Object.freeze({ source_id: "etf_daily1y_readiness_admin", freshness_basis: ".generated_at", unit: "hours", calendar: "wall_clock", max_staleness: 50, required: false }),
  ...SLICKCHARTS_DELIVERY_GROUPS.map((group) => Object.freeze({
    source_id: group.id,
    freshness_basis: ".updated (fetch/write delivery time, OLDEST; not provider publication time)",
    unit: "hours",
    calendar: "wall_clock",
    max_staleness: group.max_hours,
    required: true,
  })),
]);

// The definitional keys of an SLA row (checker deep-equals these against SOURCE_SLA_DEF).
export const SLA_DEFINITIONAL_KEYS = Object.freeze(["source_id", "freshness_basis", "unit", "calendar", "max_staleness", "required"]);

// Keys that must NEVER appear anywhere in the public projection (redaction).
export const PUBLIC_RUNTIME_DENY_KEYS = Object.freeze([
  "producer_context",
  "last_rebuild_context",
  "cadence",
  "slots",
  "successful_snapshot_history",
  "run_id",
  "run_attempt",
  "workflow",
  "sha",
  "actor",
  "origin",
  "slot_key",
  "satisfied_slot_keys",
  "missed_slot_keys",
]);

// Clock-skew tolerance band (minutes) between projector and checker clocks (§4).
export const TOLERANCE_MINUTES = 10;

// Yahoo's mixed daily-stock / weekly-ETF batch must stay within one weekly
// acquisition window. Business-day age avoids weekend/holiday false reds.
export const YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS = 6;

// Max age of a labelled product_surface_coverage pending state (rev5.3). Pending
// carries a sticky pending_since; within this window it is warn-only (even under
// strict), beyond it the exemption expires and becomes a hard error.
export const PENDING_MAX_AGE_DAYS = 14;
