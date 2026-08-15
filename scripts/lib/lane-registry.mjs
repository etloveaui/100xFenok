// Lane Registry SSOT (BACKLOG #366 — active derivation source).
//
// One declarative record per current lane, transcribed from the scattered
// hand-maintained lists (detection config, sync exclusions, KPI arrays, ~14
// workflow git-add allowlists). Detection membership, workflow ownership,
// commit manifests, projections, and related parity gates now derive from these
// records so a new lane cannot silently miss a downstream consumer.
// Conventions mirror scripts/lib/data-supply-detection-config.mjs
// (deepFreeze + canonicalJson + sha256 digest, validating load, fail-closed).

import { createHash } from "node:crypto";
import { canonicalJson } from "./json-canonical.mjs";
import { SLICKCHARTS_MEMBER_PATHS } from "./slickcharts-composite-recovery.mjs";

export const LANE_REGISTRY_SCHEMA = "lane-registry/v3";
export const STORE_KINDS = Object.freeze(["marker", "payload", "artifact_only"]);
export const LANE_CLASSES = Object.freeze(["detection_floor", "auxiliary"]);
export const PROVIDER_CLASSES = Object.freeze([
  "external_data",
  "owner_managed_data",
  "platform_proxy",
  "platform_runtime",
  "platform_storage",
]);
export const PROVIDER_ROLES = Object.freeze(["source", "transport", "runtime", "storage"]);
export const KPI_RECOVERY_SHAPES = Object.freeze(["general", "keyed_v2", "composite_v1", "direct"]);
export const ENFORCEMENTS = Object.freeze(["live", "shadow"]);
export const PRIVACY_CLASSES = Object.freeze(["private", "public_mirror", "public_safe_aggregate"]);
export const CADENCE_KINDS = Object.freeze(["hourly", "daily", "weekly", "monthly", "quarterly", "annual", "mixed", "unknown"]);
export const CADENCE_PROVENANCE_KINDS = Object.freeze(["github_workflow", "owner_contract", "payload_field"]);
export const WORKFLOW_CLASSES = Object.freeze(["platform_no_lane", "platform_central_reconciler", "platform_publisher"]);
export const COMMIT_PATH_KINDS = Object.freeze(["file", "directory", "glob", "dynamic_set"]);
export const COMMIT_STAGE_KEYS = Object.freeze([
  "always_if_exists",
  "success_if_exists",
  "success_verify_not_plan_if_exists",
  "required_on_success",
]);

function fail(message) {
  throw new Error(`lane-registry: ${message}`);
}

function validRepoRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.split("/").includes("..")
    && !value.endsWith("/");
}

function isStrictUtcTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString() === value.replace(/Z$/, ".000Z");
}

function record({
  id,
  label,
  owner_workflow,
  provider_members,
  provider_refs,
  store_kind,
  lane_class,
  cadence,
  activated_at,
  enforcement,
  privacy_class,
  public_mirror_allowed,
  admin_store,
  detection_attempt = null,
  canonical_outputs = [],
  public_mirror = [],
  commit_shards = [],
  recovery_store = null,
  declared_exception = null,
  public_canonical_outputs,
  script_sources,
  caller_workflows,
  kpi_recovery_shape,
}) {
  return {
    id,
    label,
    owner_workflow,
    provider_members,
    provider_refs,
    store_kind,
    lane_class,
    cadence,
    ...(activated_at !== undefined ? { activated_at } : {}),
    enforcement,
    privacy_class,
    ...(public_mirror_allowed !== undefined ? { public_mirror_allowed } : {}),
    roots: {
      admin_store,
      detection_attempt,
      canonical_outputs,
      public_mirror,
    },
    commit_shards,
    recovery_store,
    declared_exception,
    ...(public_canonical_outputs !== undefined ? { public_canonical_outputs } : {}),
    ...(script_sources !== undefined ? { script_sources } : {}),
    ...(caller_workflows !== undefined ? { caller_workflows } : {}),
    ...(kpi_recovery_shape !== undefined ? { kpi_recovery_shape } : {}),
  };
}

const ATTEMPT_ROOT = "data/admin/data-supply-state/detection-attempts";
const attemptShard = (laneId) => `${ATTEMPT_ROOT}/${laneId}.json`;
const PUBLISH_OUTCOME_ROOT = "data/admin/data-supply-state/publish-outcomes";
const publishOutcomeShard = (family) => `${PUBLISH_OUTCOME_ROOT}/${family}.json`;

// One authority for the six acquisition lanes that feed the computed-signals
// coordinator. The manifest builder derives their Update Manifest exclusions
// from the lane records below, while workflow contract tests derive owner file,
// display name and publish family from this registry module and the workflow
// YAML. Keep this deliberately small: it is selection metadata, not another
// coordinator implementation or generated rule layer.
export const COMPUTED_SIGNALS_SOURCE_LANE_IDS = Object.freeze([
  "fred_macro",
  "treasury_tga",
  "defillama_stablecoins",
  "fred_banking",
  "fdic_tier1",
  "sentiment",
]);

// Plane publisher family names are intentionally kept separate from lane ids:
// the publisher CLI uses hyphenated family names while the registry uses
// underscore ids, and SlickCharts has one composite lane with five callers.
export const PLANE_PUBLISH_OUTCOME_BINDINGS = Object.freeze({
  "oecd-cli": { lane_id: "oecd_cli", workflow: ".github/workflows/fetch-oecd-cli.yml" },
  "fred-macro": { lane_id: "fred_macro", workflow: ".github/workflows/fetch-fred-macro.yml" },
  "defillama-stablecoins": { lane_id: "defillama_stablecoins", workflow: ".github/workflows/fetch-defillama.yml" },
  "fdic-tier1": { lane_id: "fdic_tier1", workflow: ".github/workflows/fetch-fdic.yml" },
  "treasury-tga": { lane_id: "treasury_tga", workflow: ".github/workflows/fetch-treasury-tga.yml" },
  "fred-banking": { lane_id: "fred_banking", workflow: ".github/workflows/fetch-fred-banking.yml" },
  "fred-yardeni": { lane_id: "fred_yardeni", workflow: ".github/workflows/fetch-fred-yardeni.yml" },
  damodaran: { lane_id: "damodaran", workflow: ".github/workflows/fetch-damodaran-shadow.yml" },
  sentiment: { lane_id: "sentiment", workflow: ".github/workflows/fetch-sentiment.yml" },
  "yahoo-ticker-macro": { lane_id: "yahoo_ticker_macro", workflow: ".github/workflows/fetch-yahoo-ticker.yml" },
  "nasdaq-giw-sox": { lane_id: "nasdaq_giw_sox", workflow: ".github/workflows/fetch-nasdaq-giw-sox.yml" },
  "slickcharts-daily": { lane_id: "slickcharts", workflow: ".github/workflows/slickcharts-daily.yml" },
  "slickcharts-weekly": { lane_id: "slickcharts", workflow: ".github/workflows/slickcharts-weekly.yml" },
  "slickcharts-monthly": { lane_id: "slickcharts", workflow: ".github/workflows/slickcharts-monthly.yml" },
  "slickcharts-history": { lane_id: "slickcharts", workflow: ".github/workflows/slickcharts-history.yml" },
  "slickcharts-symbols": { lane_id: "slickcharts", workflow: ".github/workflows/slickcharts-symbols.yml" },
  "edgar-korean-summaries": { lane_id: "edgar_filings", workflow: ".github/workflows/fetch-edgar-filings.yml" },
  "us-indices-daily": { lane_id: "us_indices_daily", workflow: ".github/workflows/fetch-us-indices-daily.yml" },
  "finra-short-volume": { lane_id: "finra_short_volume", workflow: ".github/workflows/fenok-edge-daily.yml" },
  "finra-ats-weekly": { lane_id: "finra_ats_weekly", workflow: ".github/workflows/fetch-finra-ats-weekly.yml" },
  "gdelt-news-tone": { lane_id: "gdelt_news_tone", workflow: ".github/workflows/fetch-fenok-news-tone.yml" },
  // One-asset computed-signals pilot coordinator: owns no acquisition lane and
  // commits ONLY the publish-outcome shard (no signals Git commit); the
  // coordinator workflow is a declared platform_publisher, not a lane record.
  "computed-signals": { lane_id: "computed_signals", workflow: ".github/workflows/coordinate-computed-signals.yml" },
});

const providers = [
  { id: "fred", label: "FRED", class: "external_data" },
  { id: "fdic", label: "FDIC", class: "external_data" },
  { id: "treasury_fiscal_data", label: "Treasury FiscalData", class: "external_data" },
  { id: "defillama", label: "DefiLlama", class: "external_data" },
  { id: "yahoo_finance", label: "Yahoo Finance", class: "external_data" },
  { id: "stockanalysis", label: "StockAnalysis", class: "external_data" },
  { id: "cnn_fear_and_greed", label: "CNN Fear & Greed", class: "external_data" },
  { id: "cftc", label: "CFTC", class: "external_data" },
  { id: "alternative_me", label: "Alternative.me", class: "external_data" },
  { id: "nasdaq_indexes", label: "Nasdaq Indexes", class: "external_data" },
  { id: "oecd", label: "OECD", class: "external_data" },
  { id: "krx", label: "KRX", class: "external_data" },
  { id: "slickcharts", label: "Slickcharts", class: "external_data" },
  { id: "sec_edgar", label: "SEC EDGAR", class: "external_data" },
  { id: "bloomberg_terminal", label: "Bloomberg Terminal", class: "external_data" },
  { id: "nyu_stern_damodaran", label: "NYU Stern Damodaran", class: "external_data" },
  { id: "finra", label: "FINRA", class: "external_data" },
  { id: "occ", label: "OCC", class: "external_data" },
  { id: "apewisdom", label: "ApeWisdom", class: "external_data" },
  { id: "gdelt", label: "GDELT", class: "external_data" },
  { id: "mona_life_ssot", label: "Mona Life SSOT", class: "owner_managed_data" },
  { id: "global_scouter", label: "Global Scouter", class: "owner_managed_data" },
  { id: "fenok_ticker_api", label: "Fenok ticker API", class: "platform_proxy" },
  { id: "fenok_cnn_proxy", label: "Fenok CNN proxy", class: "platform_proxy" },
  { id: "local_mac_bridge", label: "Local Mac bridge", class: "platform_runtime" },
  { id: "cloudflare_kv", label: "Cloudflare KV", class: "platform_storage" },
];

// --- Lane records (verified against origin/main, 2026-07-18) -----------------

const lanes = [
  record({
    id: "fred_macro",
    label: "FRED macro",
    owner_workflow: ".github/workflows/fetch-fred-macro.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "fred", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/fred_macro",
    detection_attempt: attemptShard("fred_macro"),
    canonical_outputs: ["data/macro/fred-macro.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("fred_macro"),
      publishOutcomeShard("fred-macro"),
      "data/admin/fred_macro/index.json",
      "data/admin/fred_macro/lkg/fred_macro.json",
      "data/macro/fred-macro.json",
    ],
    recovery_store: "data/admin/fred_macro/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fred_banking",
    label: "FRED banking",
    owner_workflow: ".github/workflows/fetch-fred-banking.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "fred", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "mixed" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/fred_banking",
    detection_attempt: attemptShard("fred_banking"),
    canonical_outputs: [
      "data/macro/fred-banking-daily.json",
      "data/macro/fred-banking-weekly.json",
      "data/macro/fred-banking-monthly.json",
      "data/macro/fred-banking-quarterly.json",
    ],
    public_mirror: [],
    commit_shards: [
      attemptShard("fred_banking"),
      publishOutcomeShard("fred-banking"),
      "data/admin/fred_banking/index.json",
      "data/admin/fred_banking/lkg/daily.json",
      "data/admin/fred_banking/lkg/weekly.json",
      "data/admin/fred_banking/lkg/monthly.json",
      "data/admin/fred_banking/lkg/quarterly.json",
      "data/macro/fred-banking-daily.json",
      "data/macro/fred-banking-weekly.json",
      "data/macro/fred-banking-monthly.json",
      "data/macro/fred-banking-quarterly.json",
    ],
    recovery_store: "data/admin/fred_banking/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fred_yardeni",
    label: "Feno Yardeni model (FRED WAAA/WBAA)",
    owner_workflow: ".github/workflows/fetch-fred-yardeni.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "fred", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "weekly" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/fred_yardeni",
    detection_attempt: attemptShard("fred_yardeni"),
    canonical_outputs: ["data/yardney/yardney_model.json"],
    // Private lane, public-safe aggregate served and plane-enrolled: the
    // bundled git mirror is the worker's ASSETS fallback. The declaration
    // keeps it out of the derived sync exclusions (same pattern as the OCC
    // private lane with a public-safe availability aggregate); the lane
    // stages canonical only, full sync remains the updater.
    public_mirror: ["100xfenok-next/public/data/yardney/yardney_model.json"],
    commit_shards: [
      attemptShard("fred_yardeni"),
      publishOutcomeShard("fred-yardeni"),
      "data/admin/fred_yardeni/index.json",
      "data/admin/fred_yardeni/current/yardney_model.json",
      "data/admin/fred_yardeni/lkg/yardney_model.json",
      "data/yardney/yardney_model.json",
    ],
    recovery_store: "data/admin/fred_yardeni/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fdic_tier1",
    label: "FDIC Tier-1",
    owner_workflow: ".github/workflows/fetch-fdic.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "fdic", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "quarterly" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/fdic_tier1",
    detection_attempt: attemptShard("fdic_tier1"),
    canonical_outputs: ["data/macro/fdic-tier1.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("fdic_tier1"),
      publishOutcomeShard("fdic-tier1"),
      "data/admin/fdic_tier1/index.json",
      "data/admin/fdic_tier1/lkg/fdic_tier1.json",
      "data/macro/fdic-tier1.json",
    ],
    recovery_store: "data/admin/fdic_tier1/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "treasury_tga",
    label: "Treasury FiscalData TGA",
    owner_workflow: ".github/workflows/fetch-treasury-tga.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "treasury_fiscal_data", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/treasury_tga",
    detection_attempt: attemptShard("treasury_tga"),
    canonical_outputs: ["data/macro/tga.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("treasury_tga"),
      publishOutcomeShard("treasury-tga"),
      "data/admin/treasury_tga/index.json",
      "data/admin/treasury_tga/lkg/tga.json",
      "data/macro/tga.json",
    ],
    recovery_store: "data/admin/treasury_tga/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "defillama_stablecoins",
    label: "DefiLlama stablecoins",
    owner_workflow: ".github/workflows/fetch-defillama.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "defillama", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/defillama_stablecoins",
    detection_attempt: attemptShard("defillama_stablecoins"),
    canonical_outputs: ["data/macro/stablecoins.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("defillama_stablecoins"),
      publishOutcomeShard("defillama-stablecoins"),
      "data/admin/defillama_stablecoins/index.json",
      "data/admin/defillama_stablecoins/lkg/stablecoins.json",
      "data/macro/stablecoins.json",
    ],
    recovery_store: "data/admin/defillama_stablecoins/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "yahoo_etf_fallback",
    label: "Yahoo ETF fallback",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "yahoo_finance", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    public_mirror_allowed: false,
    admin_store: "data/admin/yahoo_etf_fallback",
    detection_attempt: attemptShard("yahoo_etf_fallback"),
    canonical_outputs: ["data/yf/etf-details", "data/yf/finance"],
    public_mirror: [],
    commit_shards: [
      attemptShard("yahoo_etf_fallback"),
      "data/admin/yahoo_etf_fallback",
      "data/yf/etf-details",
      "data/yf/finance",
    ],
    recovery_store: "data/admin/yahoo_etf_fallback/index.json",
    kpi_recovery_shape: "general",
    declared_exception: "data/yf/finance is a ticker-partitioned namespace shared with the separate Yahoo batch producer; this workflow stages only its artifact-declared changed ticker files",
    public_canonical_outputs: ["data/yf/finance"],
    script_sources: [
      "scripts/fetch-stockanalysis.py",
      "scripts/yahoo-etf-fallback-recovery.mjs",
    ],
  }),
  record({
    id: "stockanalysis_etf_universe",
    label: "StockAnalysis ETF universe",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "stockanalysis", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_etf_universe"),
    canonical_outputs: ["data/stockanalysis/etf_universe.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("stockanalysis_etf_universe"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with stockanalysis_stock_financial and stockanalysis_surfaces (store is multi-kind: stock/financial/etf/surface/universe)",
  }),
  record({
    id: "stockanalysis_etf_detail",
    label: "StockAnalysis per-ticker ETF detail",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "stockanalysis", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    // Promoted after natural schedule run 31852235035 emitted the complete
    // attempt shard, passed the publish fence and confirmed origin readback.
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_etf_detail"),
    // The 5,605 raw per-ticker payloads are this lane's canonical acquisition
    // output. The public tree is a shard projection built by sync-public-data,
    // not a mirror of these paths, so the shards are a derived projection rather
    // than a public_mirror entry here.
    canonical_outputs: ["data/stockanalysis/etfs"],
    public_mirror: [],
    commit_shards: [
      attemptShard("stockanalysis_etf_detail"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with stockanalysis_etf_universe, stockanalysis_stock_financial and stockanalysis_surfaces; promoted live after natural schedule run 31852235035 committed the complete ETF-detail attempt shard with fence-confirmed origin readback; separated from the universe lane because the universe index and the per-ticker detail payloads are distinct acquisition units with distinct failure modes",
    script_sources: [
      "scripts/fetch-stockanalysis.py",
      "scripts/emit-stockanalysis-attempt.mjs",
    ],
  }),
  record({
    id: "stockanalysis_stock_financial",
    label: "StockAnalysis bounded stock and financial pairs",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "stockanalysis", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_stock_financial"),
    canonical_outputs: ["data/stockanalysis/stocks", "data/stockanalysis/financials"],
    public_mirror: ["100xfenok-next/public/data/stockanalysis/stocks", "100xfenok-next/public/data/stockanalysis/financials"],
    commit_shards: [
      attemptShard("stockanalysis_stock_financial"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the multi-kind StockAnalysis recovery store; promoted live after natural schedule run 29873027563 committed the complete 8-pair attempt shard",
    script_sources: [
      "scripts/fetch-stockanalysis.py",
      "scripts/emit-stockanalysis-attempt.mjs",
    ],
  }),
  record({
    id: "stockanalysis_surfaces",
    label: "StockAnalysis public surfaces",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "stockanalysis", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_surfaces"),
    canonical_outputs: ["data/stockanalysis/surfaces"],
    public_mirror: [],
    commit_shards: [
      attemptShard("stockanalysis_surfaces"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with stockanalysis_etf_universe and stockanalysis_stock_financial (store is multi-kind: stock/financial/etf/surface/universe)",
  }),
  record({
    id: "yahoo_ticker_macro",
    label: "Yahoo hourly ticker snapshot",
    owner_workflow: ".github/workflows/fetch-yahoo-ticker.yml",
    provider_members: null,
    provider_refs: [
      { provider_id: "yahoo_finance", role: "source", members: null },
      { provider_id: "fenok_ticker_api", role: "transport", members: null },
    ],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "hourly" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/yahoo-hourly-ticker",
    detection_attempt: attemptShard("yahoo_ticker_macro"),
    canonical_outputs: ["data/macro/yahoo-ticker.json"],
    // Mirror ownership moved to the merge boundary (sync-public-data full
    // walk + update-manifest materialize) once the plane serving enrollment
    // (ENROLLED_PATHS "/data/macro/yahoo-ticker.json" + hourly publish +
    // serving probe) landed. The lane stages canonical only; the mirror copy
    // stays sync-covered and is refreshed by the boundary. The declaration is
    // load-bearing: without it the derived sync exclusions treat the bundled
    // fallback copy as removable, contradicting the worker-read fallback.
    public_mirror: ["100xfenok-next/public/data/macro/yahoo-ticker.json"],
    commit_shards: [
      attemptShard("yahoo_ticker_macro"),
      publishOutcomeShard("yahoo-ticker-macro"),
      "data/admin/yahoo-hourly-ticker",
      "data/macro/yahoo-ticker.json",
    ],
    recovery_store: "data/admin/yahoo-hourly-ticker/index.json",
    kpi_recovery_shape: "keyed_v2",
    declared_exception: "producer-lkg-index/v2 keyed store (keys/TQQQ.json, keys/SOXL.json), projected via the KPI detectionRecovery map",
  }),
  record({
    id: "sentiment",
    label: "Sentiment bundle (CNN/VIX/MOVE/CFTC/crypto)",
    owner_workflow: ".github/workflows/fetch-sentiment.yml",
    provider_members: ["cnn", "cftc", "vix", "move", "crypto"],
    provider_refs: [
      { provider_id: "cnn_fear_and_greed", role: "source", members: ["cnn"] },
      { provider_id: "fenok_cnn_proxy", role: "transport", members: ["cnn"] },
      { provider_id: "cftc", role: "source", members: ["cftc"] },
      { provider_id: "yahoo_finance", role: "source", members: ["vix", "move"] },
      { provider_id: "alternative_me", role: "source", members: ["crypto"] },
    ],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/sentiment",
    detection_attempt: attemptShard("sentiment"),
    canonical_outputs: ["data/sentiment"],
    public_mirror: ["100xfenok-next/public/data/sentiment"],
    commit_shards: [
      attemptShard("sentiment"),
      publishOutcomeShard("sentiment"),
      "data/admin/sentiment/index.json",
      "data/admin/sentiment/current",
      "data/admin/sentiment/lkg",
      "data/admin/sentiment/source-observations/crypto.json",
      "data/sentiment",
    ],
    recovery_store: "data/admin/sentiment/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "nasdaq_giw_sox",
    label: "Nasdaq GIW SOX constituents",
    owner_workflow: ".github/workflows/fetch-nasdaq-giw-sox.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "nasdaq_indexes", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/nasdaq_giw_sox",
    detection_attempt: attemptShard("nasdaq_giw_sox"),
    canonical_outputs: ["data/indices/nasdaq-giw-sox-constituents.json"],
    public_mirror: ["100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json"],
    commit_shards: [
      attemptShard("nasdaq_giw_sox"),
      publishOutcomeShard("nasdaq-giw-sox"),
      "data/admin/nasdaq_giw_sox/index.json",
      "data/admin/nasdaq_giw_sox/lkg/constituents.json",
      "data/admin/nasdaq_giw_sox/history/constituents.json",
      "data/indices/nasdaq-giw-sox-constituents.json",
    ],
    recovery_store: "data/admin/nasdaq_giw_sox/index.json",
    kpi_recovery_shape: "direct",
  }),
  record({
    id: "us_indices_daily",
    label: "US index daily close (S&P 500 / NASDAQ Composite / Nasdaq 100 / SOX)",
    owner_workflow: ".github/workflows/fetch-us-indices-daily.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "yahoo_finance", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/us-indices-daily",
    detection_attempt: attemptShard("us_indices_daily"),
    canonical_outputs: [
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
      "data/indices/nasdaq100.json",
      "data/indices/sox.json",
    ],
    public_mirror: [],
    commit_shards: [
      attemptShard("us_indices_daily"),
      publishOutcomeShard("us-indices-daily"),
      "data/admin/us-indices-daily",
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
      "data/indices/nasdaq100.json",
      "data/indices/sox.json",
    ],
    recovery_store: "data/admin/us-indices-daily/index.json",
    kpi_recovery_shape: "keyed_v2",
    script_sources: ["scripts/fetch-us-indices-daily.mjs", "scripts/check-us-indices-parity.mjs"],
  }),
  record({
    id: "oecd_cli",
    label: "OECD composite leading indicators",
    owner_workflow: ".github/workflows/fetch-oecd-cli.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "oecd", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "monthly" },
    // First workflow commit: 2026-07-20 23:20:11 +0900.
    activated_at: "2026-07-20T14:20:11Z",
    // Promoted after dispatch run 30260263485 committed a complete HTTP-200
    // attempt, all 22 bounded series, parity evidence, and fresh state.
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/oecd_cli",
    detection_attempt: attemptShard("oecd_cli"),
    canonical_outputs: ["data/admin/oecd_cli/shadow/oecd-cli.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("oecd_cli"),
      publishOutcomeShard("oecd-cli"),
      "data/admin/oecd_cli/index.json",
      "data/admin/oecd_cli/lkg/oecd_cli.json",
      "data/admin/oecd_cli/shadow/oecd-cli.json",
      "data/admin/oecd_cli/parity-report.json",
    ],
    recovery_store: "data/admin/oecd_cli/index.json",
    kpi_recovery_shape: "general",
    declared_exception: "admin-only live lane; raw public mirroring stays disabled across the composite activity-surveys and third-party metadata boundary",
    script_sources: ["scripts/fetch-oecd-cli.mjs"],
  }),
  record({
    id: "krx",
    label: "KRX Open API daily",
    owner_workflow: ".github/workflows/fenok-edge-krx-daily.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "krx", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    // Natural schedule run 30270187601 committed complete attempt evidence,
    // a fresh canonical payload, and attempt-1 provider-advancing recovery.
    enforcement: "live",
    privacy_class: "public_safe_aggregate",
    admin_store: "data/admin/krx",
    detection_attempt: attemptShard("krx"),
    canonical_outputs: [
      "data/admin/fenok-edge-korea-krx-daily-index.json",
      "data/computed/fenok-edge-korea-krx-bridge-history.json",
      "data/computed/fenok-edge-korea-krx-index-daily.json",
      "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    ],
    public_mirror: [
      "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json",
      "100xfenok-next/public/data/computed/fenok-edge-korea-krx-bridge-history.json",
    ],
    commit_shards: [
      attemptShard("krx"),
      "data/admin/krx/index.json",
      "data/admin/krx/lkg/bridge.json",
      "data/admin/fenok-edge-korea-krx-daily-index.json",
      "data/computed/fenok-edge-korea-krx-bridge-history.json",
      "data/computed/fenok-edge-korea-krx-index-daily.json",
      "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    ],
    recovery_store: "data/admin/krx/index.json",
    kpi_recovery_shape: "general",
    script_sources: ["scripts/fetch-fenok-krx-daily-private.mjs", "scripts/emit-fenok-krx-attempt.mjs"],
  }),
  record({
    id: "slickcharts",
    label: "SlickCharts daily delivery (composite lane)",
    owner_workflow: ".github/workflows/slickcharts-daily.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "slickcharts", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/slickcharts-composite-recovery",
    detection_attempt: attemptShard("slickcharts"),
    canonical_outputs: Object.values(SLICKCHARTS_MEMBER_PATHS).flat().map((spec) => spec.path),
    public_mirror: ["100xfenok-next/public/data/slickcharts"],
    commit_shards: [
      attemptShard("slickcharts"),
      publishOutcomeShard("slickcharts-daily"),
      "data/admin/slickcharts-daily-delivery",
      "data/admin/slickcharts-composite-recovery",
      ...SLICKCHARTS_MEMBER_PATHS.daily.map((spec) => spec.path),
    ],
    recovery_store: "data/admin/slickcharts-composite-recovery/index.json",
    kpi_recovery_shape: "composite_v1",
    declared_exception: "hash-bound five-member composite LKG index; daily per-file delivery state remains a separate row-10 compatibility store",
    // Script-side publisher: the commit allowlist lives in the publish script,
    // not the workflow YAML. slickcharts-daily is the primary owner and commits
    // the full admin store; the other four members share the same lane and
    // commit only their merged attempt-shard row via the same script.
    script_sources: ["scripts/publish-slickcharts-attempt.sh"],
    caller_workflows: Object.fromEntries(
      ["weekly", "monthly", "history", "symbols"].map((member) => [
        `.github/workflows/slickcharts-${member}.yml`,
        {
          commit_shards: [
            "data/admin/data-supply-state/detection-attempts/slickcharts.json",
            publishOutcomeShard(`slickcharts-${member}`),
            "data/admin/slickcharts-composite-recovery",
          ],
          script_sources: ["scripts/publish-slickcharts-attempt.sh"],
        },
      ]),
    ),
  }),
  record({
    id: "edgar_filings",
    label: "SEC EDGAR filing timeline",
    owner_workflow: ".github/workflows/fetch-edgar-filings.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "sec_edgar", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "weekly" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/edgar_filings",
    detection_attempt: attemptShard("edgar_filings"),
    canonical_outputs: [
      "data/edgar",
      "data/edgar-korean-summaries",
    ],
    public_mirror: ["100xfenok-next/public/data/edgar-korean-summaries"],
    commit_shards: [
      attemptShard("edgar_filings"),
      publishOutcomeShard("edgar-korean-summaries"),
      "data/admin/edgar_filings/index.json",
      "data/admin/edgar_filings/current/edgar_filings.json",
      "data/admin/edgar_filings/lkg/edgar_filings.json",
      "data/edgar",
      "data/edgar-korean-summaries",
    ],
    recovery_store: "data/admin/edgar_filings/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "sec_13f",
    label: "SEC 13F (ownerless artifact lane)",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [{ provider_id: "sec_edgar", role: "source", members: null }],
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: { kind: "quarterly" },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: null,
    detection_attempt: null,
    canonical_outputs: ["data/sec-13f"],
    public_mirror: ["100xfenok-next/public/data/sec-13f"],
    commit_shards: [],
    recovery_store: null,
    declared_exception: "ownerless artifact_only lane (no producer workflow); correctly kept shadow per the ownership ledger",
  }),
  record({
    id: "admin_live_voice_logs",
    label: "Admin Live conversation logs (Mac mini bridge, local-only)",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [{ provider_id: "local_mac_bridge", role: "runtime", members: null }],
    store_kind: "artifact_only",
    lane_class: "auxiliary",
    cadence: { kind: "unknown" },
    enforcement: "shadow",
    privacy_class: "private",
    admin_store: null,
    canonical_outputs: [],
    public_mirror: [],
    commit_shards: [],
    recovery_store: null,
    declared_exception:
      "no repo artifact exists or is ever committed (gitignored Mac mini bridge local file, "
      + "100xfenok-next/data/voice-logs/); enforcement can never be 'live' because no CI/repo "
      + "signal can observe writer health, freshness, or content — documented at "
      + "100xfenok-next/docs/admin-live-skill-bridge.md:20-24,44",
  }),
  record({
    id: "mona_production_study_state",
    label: "Mona production study state (mona-life SSOT, symlinked)",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [
      { provider_id: "mona_life_ssot", role: "source", members: null },
      { provider_id: "local_mac_bridge", role: "runtime", members: null },
    ],
    store_kind: "artifact_only",
    lane_class: "auxiliary",
    cadence: { kind: "unknown" },
    enforcement: "shadow",
    privacy_class: "private",
    admin_store: null,
    canonical_outputs: [],
    public_mirror: [],
    commit_shards: [],
    recovery_store: null,
    declared_exception:
      "no repo artifact exists or is ever committed (gitignored symlink "
      + "100xfenok-next/data/mona-english -> mona-life SSOT, read-only at runtime by the Mac "
      + "mini bridge); enforcement can never be 'live' for the same reason as admin_live_voice_logs; "
      + "documented at 100xfenok-next/src/lib/server/mona-study-tools.ts:4-7",
  }),
  record({
    id: "mona_vnext_kv",
    label: "Mona vNext KV / local namespace (owner-test only, production writes disabled)",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [{ provider_id: "cloudflare_kv", role: "storage", members: null }],
    store_kind: "artifact_only",
    lane_class: "auxiliary",
    cadence: { kind: "unknown" },
    enforcement: "shadow",
    privacy_class: "private",
    admin_store: null,
    canonical_outputs: [],
    public_mirror: [],
    commit_shards: [],
    recovery_store: null,
    declared_exception:
      "data lives in Cloudflare KV binding MONA_VNEXT_KV (wrangler.jsonc:16-19) or a local dev "
      + "fallback, never in the git tree; enforcement can never be 'live' — no repo/CI signal can "
      + "observe KV content, freshness, or key counts; productionWriteEnabled=false today so "
      + "production Mona data is unaffected; documented at "
      + "100xfenok-next/src/features/mona-vnext/storage/objectStore.ts and "
      + "100xfenok-next/docs/admin-live-skill-bridge.md:82-108",
  }),
  record({
    id: "benchmarks",
    label: "Bloomberg benchmark converter payloads",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [{ provider_id: "bloomberg_terminal", role: "source", members: null }],
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provenance: { kind: "payload_field", evidence: "/metadata/update_frequency" },
    },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: null,
    detection_attempt: null,
    canonical_outputs: [
      "data/benchmarks/us.json",
      "data/benchmarks/us_sectors.json",
      "data/benchmarks/developed.json",
      "data/benchmarks/emerging.json",
      "data/benchmarks/msci.json",
      "data/benchmarks/micro_sectors.json",
    ],
    public_mirror: [
      "100xfenok-next/public/data/benchmarks/us.json",
      "100xfenok-next/public/data/benchmarks/us_sectors.json",
      "100xfenok-next/public/data/benchmarks/developed.json",
      "100xfenok-next/public/data/benchmarks/emerging.json",
      "100xfenok-next/public/data/benchmarks/msci.json",
      "100xfenok-next/public/data/benchmarks/micro_sectors.json",
    ],
    commit_shards: [],
    recovery_store: null,
    declared_exception: "external owner-run converter has no GitHub attempt shard; cadence is evidenced by each canonical payload",
  }),
  record({
    id: "global_scouter",
    label: "Global Scouter converter payload",
    owner_workflow: null,
    provider_members: null,
    provider_refs: [{ provider_id: "global_scouter", role: "source", members: null }],
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provenance: { kind: "payload_field", evidence: "/update_frequency" },
    },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: null,
    detection_attempt: null,
    // The lane owns the whole export bundle, not just the metadata marker. The
    // remaining subpaths — stock detail, raw, indicators, the etfs index, schema
    // and README — are all product- or admin-surface consumed, and the lane
    // record declares no admin store, no detection attempt and no recovery
    // store, so this family carries no control-plane state to separate out.
    // The four derived core outputs keep their own declarations because Update
    // Manifest materializes them; everything here is the owner-run export.
    canonical_outputs: [
      "data/global-scouter/core/metadata.json",
      "data/global-scouter/core/stocks_index.json",
      "data/global-scouter/core/dashboard.json",
      "data/global-scouter/stocks",
      "data/global-scouter/raw",
      "data/global-scouter/indicators",
      "data/global-scouter/etfs",
      "data/global-scouter/schema.json",
      "data/global-scouter/README.md",
    ],
    // The entire owner-run bundle is rebuilt by the generic sync boundary at
    // the existing public URL. Naming the directory makes the 1,081 formerly
    // allow-by-default copies explicit without treating the four workflow-
    // derived core outputs as part of this lane's canonical export roots.
    public_mirror: ["100xfenok-next/public/data/global-scouter"],
    commit_shards: [],
    recovery_store: null,
    declared_exception: "external owner-run converter has no GitHub attempt shard; cadence is evidenced by canonical metadata",
  }),
  record({
    id: "damodaran",
    label: "Damodaran valuation data",
    owner_workflow: ".github/workflows/fetch-damodaran-shadow.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "nyu_stern_damodaran", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provenance: { kind: "github_workflow", evidence: ".github/workflows/fetch-damodaran-shadow.yml" },
    },
    // First workflow commit: 2026-07-20 00:05:41 +0900.
    activated_at: "2026-07-19T15:05:41Z",
    // Promoted after run 30249876677 emitted the healthy current bundle,
    // bounded history, recovery index, attempt shard, and six byte-identical
    // canonical/public pairs.
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/damodaran",
    detection_attempt: attemptShard("damodaran"),
    canonical_outputs: [
      "data/damodaran/industries.json",
      "data/damodaran/historical_erp.json",
      "data/damodaran/credit_ratings.json",
      "data/damodaran/erp.json",
      "data/damodaran/industry_metrics.json",
      "data/damodaran/industry_metrics_regions.json",
    ],
    public_mirror: [],
    commit_shards: [
      attemptShard("damodaran"),
      publishOutcomeShard("damodaran"),
      "data/admin/damodaran/owner-guard.json",
      "data/admin/damodaran/index.json",
      "data/admin/damodaran/current/damodaran.json",
      "data/admin/damodaran/lkg/damodaran.json",
      "data/admin/damodaran/history.json",
      "data/damodaran/industries.json",
      "data/damodaran/historical_erp.json",
      "data/damodaran/credit_ratings.json",
      "data/damodaran/erp.json",
      "data/damodaran/industry_metrics.json",
      "data/damodaran/industry_metrics_regions.json",
    ],
    recovery_store: "data/admin/damodaran/index.json",
    kpi_recovery_shape: "general",
    script_sources: ["scripts/fetch-damodaran-shadow.mjs"],
  }),
  record({
    id: "finra_short_volume",
    label: "FINRA RegSHO daily short volume",
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "finra", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/finra_short_volume",
    detection_attempt: attemptShard("finra_short_volume"),
    canonical_outputs: ["data/admin/finra_short_volume/current/regsho_daily.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("finra_short_volume"),
      publishOutcomeShard("finra-short-volume"),
      "data/admin/finra_short_volume/index.json",
      "data/admin/finra_short_volume/current/regsho_daily.json",
      "data/admin/finra_short_volume/lkg/regsho_daily.json",
      "data/admin/finra_short_volume/history/regsho_daily.json",
    ],
    recovery_store: "data/admin/finra_short_volume/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "finra_ats_weekly",
    label: "FINRA delayed ATS/OTC weekly summary",
    owner_workflow: ".github/workflows/fetch-finra-ats-weekly.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "finra", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "weekly" },
    enforcement: "shadow",
    privacy_class: "private",
    public_mirror_allowed: false,
    admin_store: "data/admin/finra-ats",
    detection_attempt: attemptShard("finra_ats"),
    canonical_outputs: ["data/admin/finra-ats/current/weekly-summary.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("finra_ats"),
      publishOutcomeShard("finra-ats-weekly"),
      "data/admin/finra-ats/index.json",
      "data/admin/finra-ats/current/weekly-summary.json",
      "data/admin/finra-ats/lkg/weekly-summary.json",
      "data/admin/finra-ats/weeks",
    ],
    recovery_store: "data/admin/finra-ats/index.json",
    kpi_recovery_shape: "general",
    script_sources: ["scripts/fetch-finra-ats-weekly.mjs"],
  }),
  record({
    id: "occ_options_volume",
    label: "OCC options volume",
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "occ", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/occ_options_volume",
    detection_attempt: attemptShard("occ_options_volume"),
    canonical_outputs: [
      "data/computed/fenok_occ_options_volume.json",
      "data/computed/fenok_occ_options_volume_history.json",
      "data/computed/fenok_occ_options_availability.json",
    ],
    public_mirror: ["100xfenok-next/public/data/computed/fenok_occ_options_availability.json"],
    commit_shards: [
      attemptShard("occ_options_volume"),
      "data/admin/occ_options_volume/index.json",
      "data/admin/occ_options_volume/current/occ_options_volume.json",
      "data/admin/occ_options_volume/lkg/occ_options_volume.json",
    ],
    recovery_store: "data/admin/occ_options_volume/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "yahoo_private_options",
    label: "Yahoo private options availability",
    owner_workflow: ".github/workflows/fetch-fenok-private-options.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "yahoo_finance", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/yahoo_private_options",
    detection_attempt: attemptShard("yahoo_private_options"),
    canonical_outputs: ["data/computed/fenok_yahoo_private_options_availability.json"],
    // The producer writes the public-safe availability marker to the mirror
    // (public_safe=true, raw_payload_included=false); the declaration keeps
    // it out of the derived sync exclusions so the merge boundary (sync full
    // walk) is its updater. The family stays plane-blocked: its source time
    // is acquisition-derived, so no FAMILIES/publish binding exists.
    public_mirror: ["100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json"],
    commit_shards: [
      attemptShard("yahoo_private_options"),
      "data/admin/yahoo_private_options",
      "data/computed/fenok_yahoo_private_options_availability.json",
    ],
    recovery_store: "data/admin/yahoo_private_options/index.json",
    kpi_recovery_shape: "general",
    declared_exception: "promoted live after natural schedule run 29801392365 committed the complete targeted allowlist attempt shard and fresh_primary provider observation",
  }),
  record({
    id: "apewisdom_attention",
    label: "ApeWisdom attention proxy",
    // Live producer with a bounded LaneLkgStore recovery index. Provider failure
    // retains the last valid derived proxy as LKG; only a natural schedule
    // attempt 1 may promote an advancing provider observation back to fresh.
    // Flip evidence remains committed shard 06df6f18be from scheduled run
    // 29691115685 (DEC-266).
    owner_workflow: ".github/workflows/fetch-fenok-apewisdom.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "apewisdom", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/apewisdom_attention",
    detection_attempt: attemptShard("apewisdom_attention"),
    canonical_outputs: [
      "data/computed/fenok_social_attention_proxy.json",
      "data/computed/fenok_social_attention_proxy_history.json",
    ],
    public_mirror: [],
    commit_shards: [
      attemptShard("apewisdom_attention"),
      "data/admin/apewisdom_attention/index.json",
      "data/admin/apewisdom_attention/lkg/social_attention_proxy.json",
      "data/computed/fenok_social_attention_proxy.json",
      "data/computed/fenok_social_attention_proxy_history.json",
    ],
    recovery_store: "data/admin/apewisdom_attention/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "gdelt_news_tone",
    label: "GDELT news tone proxy",
    // Live after natural run 30208843002 committed a full-reference recovery
    // from failed natural run 30164248573. Current provider failures remain
    // visible as lane-local degraded state without blocking unrelated publication.
    owner_workflow: ".github/workflows/fetch-fenok-news-tone.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "gdelt", role: "source", members: null }],
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/gdelt_news_tone",
    detection_attempt: attemptShard("gdelt_news_tone"),
    canonical_outputs: [
      "data/computed/fenok_news_tone_proxy.json",
      "data/computed/fenok_news_tone_proxy_history.json",
    ],
    public_mirror: [],
    commit_shards: [
      attemptShard("gdelt_news_tone"),
      publishOutcomeShard("gdelt-news-tone"),
      "data/admin/gdelt_news_tone/index.json",
      "data/admin/gdelt_news_tone/lkg/news_tone_proxy.json",
      "data/computed/fenok_news_tone_proxy.json",
      "data/computed/fenok_news_tone_proxy_history.json",
    ],
    recovery_store: "data/admin/gdelt_news_tone/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "yahoo_batch_quote_history",
    label: "Yahoo batch quote/history",
    owner_workflow: ".github/workflows/fetch-yf-finance.yml",
    provider_members: null,
    provider_refs: [{ provider_id: "yahoo_finance", role: "source", members: null }],
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily" },
    // The first standard v2 attempt shard is emitted from the next workflow
    // execution; older batch indexes are not retroactively treated as proof.
    activated_at: "2026-08-01T01:00:13Z",
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: "data/admin/yahoo-batch-quote-history",
    detection_attempt: attemptShard("yahoo_batch_quote_history"),
    canonical_outputs: [],
    public_mirror: [],
    commit_shards: [
      attemptShard("yahoo_batch_quote_history"),
      "data/admin/yahoo-batch-quote-history",
    ],
    recovery_store: "data/admin/yahoo-batch-quote-history/index.json",
    kpi_recovery_shape: "direct",
    script_sources: [
      "scripts/fetch-yf-finance.py",
      "scripts/emit-yahoo-batch-quote-history-attempt.mjs",
    ],
  }),
];

// Declared exceptions for data/admin entries that are NOT lane stores
// (DEC-266 discipline: statically declared, never runtime-inferred).
const declared_exceptions = [
  {
    path: "data/admin/slickcharts-daily-delivery",
    kind: "root",
    reason: "row-10 compatibility per-file delivery LKG; row-9 recovery authority is the separate five-member composite store",
    owner: "slickcharts-daily",
  },
  {
    path: "data/admin/data-supply-state",
    kind: "root",
    reason: "shared detection-floor state root (attempt shards + provider-observation objects); not a lane store",
    owner: "detection-floor",
  },
  {
    path: "data/admin/yahoo-batch-quote-history",
    kind: "root",
    reason: "raw per-ticker Yahoo batch quote/history admin store; canonical-only input to derived lanes with no public consumer or mirror contract - withheld to keep the Cloudflare static asset budget under its hard limit",
    owner: "yahoo-batch-quote-history",
  },
  {
    path: "data/yf/migration-evidence",
    kind: "root",
    reason: "legacy Yahoo-migration evidence root, admin-private; not a lane store",
    owner: "platform",
  },
  {
    path: "data/yf/estimates-archive",
    kind: "root",
    reason: "B-380 change-only Yahoo analyst-estimate history; canonical private retention with no public mirror or product reader",
    owner: "yahoo_batch_quote_history",
    public_sync: "exclude",
  },
  {
    path: "data/admin/data-supply-detection-floor.json",
    kind: "file",
    reason: "ephemeral detection-floor report; referenced in workflow text but intentionally NOT committed (pinned by test-build-data-supply-detection-floor.mjs)",
    owner: "platform",
    may_be_absent: true,
    public_sync: "exclude",
  },
  {
    path: "data/admin/lane-registry-projection.json",
    kind: "file",
    reason: "public-safe lane-metadata projection for the #365 owner dashboard (privacy-filtered by build-lane-registry-projection.mjs; no store roots/paths); not a lane store",
    owner: "platform",
  },
  {
    path: "100xfenok-next/public/data/admin/lane-registry-projection.json",
    kind: "file",
    reason: "public mirror of the #365 lane-metadata projection (metadata-only, KPI-mirror precedent); not a lane store",
    owner: "platform",
  },
  {
    path: "data/admin/lane-commit-manifest.json",
    kind: "file",
    reason: "private deterministic workflow commit/routing manifest; generated from this registry and intentionally excluded from public sync and Update Manifest self-triggering",
    owner: "platform",
    public_sync: "exclude",
  },
  {
    path: "data/admin/damodaran-shadow-parity.json",
    kind: "file",
    reason: "legacy private shadow-parity proof retained after ownership flip; the live owner guard moved under data/admin/damodaran",
    owner: "platform",
    public_sync: "exclude",
  },
  {
    path: "data/admin/sec-13f-shadow-parity.json",
    kind: "file",
    reason: "private fixture-oracle parity proof for the pre-ownership SEC 13F absorption gate; not a lane store or public artifact",
    owner: "platform",
    public_sync: "exclude",
  },
  {
    path: "data/admin/alarm-state.json",
    kind: "file",
    reason: "#365 P3 pipeline alarm state (open incidents / last firing / watched workflows); committed by pipeline-failure-alarm.yml, public-safe run-metadata only; not a lane store",
    owner: "platform",
  },
  {
    path: "100xfenok-next/public/data/admin/alarm-state.json",
    kind: "file",
    reason: "public mirror of the #365 P3 alarm state (run-metadata only, KPI-mirror precedent); not a lane store",
    owner: "platform",
  },
  ...[
    "data/admin/README.md",
    "data/admin/data-usage-manifest.json",    "data/admin/fenok-data-health-kpi.json",
    "data/admin/fenok-edge-coverage-index.json",
    "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
    "data/admin/fenok-edge-etf-daily1y-readiness.json",
    "data/admin/fenok-edge-korea-krx-daily-index.json",
    "data/admin/fenok-etf-core-daily-basket.json",
    "data/admin/fenok-flow-backfill-index.json",
    "data/admin/fenok-s0-finra-occ-mapping-ledger.json",
    "data/admin/fenok-s1-public-mutation-enable-readiness.json",
    "data/admin/fenok-s1-stock-promotion-gate-plan.json",
    "data/admin/fenok-s1-stock-public-promotion-dry-run.json",
    "data/admin/pro-density-baseline.json",
    "data/admin/product-surface-coverage.json",
    "data/admin/stock-field-usage-manifest.json",
    "data/admin/taiwan-data-bridge-index.json",
  ].map((path) => ({
    path,
    kind: "file",
    reason: "platform/generated control-plane artifact; not a lane store",
    owner: "platform",
  })),
];

// Declared workflow classes (DEC-266: declared, never inferred). A workflow
// with no owning lane is legal ONLY via a static declaration here — the gate
// fails closed on any other lane-less workflow instead of silently passing.
const workflow_classes = {
  ".github/workflows/update-manifest.yml": {
    class: "platform_central_reconciler",
    reason: "central manifest reconciler (not a lane producer); commits only registry-declared lane artifacts and platform control-plane files",
    owner: "platform",
  },
  ".github/workflows/build-stocks-analyzer.yml": {
    class: "platform_central_reconciler",
    reason: "platform-owned Stocks Analyzer and SEC 13F materialization publisher",
    owner: "platform",
  },
  ".github/workflows/pipeline-failure-alarm.yml": {
    class: "platform_central_reconciler",
    reason: "platform-owned failure alarm state publisher; always/continue-on-error semantics are load-bearing",
    owner: "platform",
  },
  ".github/workflows/coordinate-computed-signals.yml": {
    class: "platform_publisher",
    reason: "one-asset computed-signals coordinator: workflow_run-driven rebuild + plane publish; commits only the computed-signals publish-outcome shard, never signal files, and never dispatches Update Manifest or Deploy Worker",
    owner: "platform",
  },
};

// Structured workflow-scoped staging policy. This is the registry SSOT for the
// generated manifest; workflows remain literal consumers until their individual
// migration gates pass. The default policy preserves the existing flat shard
// declaration for simple lanes, while the explicit overrides below retain
// path-kind, conditional, dynamic, and exclusion semantics that a flat union
// cannot represent.
function commitSpec(path, kind, required = false) {
  return { path, kind, required };
}

function pathKind(path) {
  if (path.includes("*")) return "glob";
  const basename = path.split("/").at(-1);
  return basename.includes(".") ? "file" : "directory";
}

function defaultWorkflowPolicy(laneIds) {
  const paths = laneIds
    .flatMap((laneId) => lanes.find((laneValue) => laneValue.id === laneId)?.commit_shards ?? []);
  const unique = [...new Set(paths)];
  return {
    lanes: [...laneIds],
    stages: {
      always_if_exists: unique.filter((pathValue) => pathValue.startsWith("data/admin/")).map((pathValue) => commitSpec(pathValue, pathKind(pathValue))),
      success_if_exists: unique.filter((pathValue) => !pathValue.startsWith("data/admin/")).map((pathValue) => commitSpec(pathValue, pathKind(pathValue))),
      success_verify_not_plan_if_exists: [],
      required_on_success: [],
    },
    exclude: [],
  };
}

// Derive a workflow's lane attribution and its lanes' attempt-shard specs from
// the registry, then layer the workflow's hand-written extras on top. The hand
// list was the drift source: a lane could be registry-owned by a workflow and
// missing from that workflow's own `lanes`, and a lane's attempt shard could go
// unstaged while the lane declared it. Both were real on 2026-08-14. Path
// policy beyond attempt evidence stays hand-written, because only the author
// knows which product trees a workflow may write.
function lanePolicy(workflowRel, stages, exclude = []) {
  const owned = lanes.filter((laneValue) => laneValue.owner_workflow === workflowRel);
  const declared = stages.always_if_exists ?? [];
  const derivedShards = [...new Set(owned.flatMap((laneValue) => (laneValue.commit_shards ?? [])
    .filter((shard) => shard.startsWith(`${ATTEMPT_ROOT}/`))))]
    .filter((shard) => !declared.some((spec) => spec.path === shard || shard.startsWith(`${spec.path}/`)))
    .sort()
    .map((shard) => commitSpec(shard, "file"));
  return policy(owned.map((laneValue) => laneValue.id), {
    ...stages,
    always_if_exists: [...declared, ...derivedShards],
  }, exclude);
}

function policy(lanesForWorkflow, stages, exclude = []) {
  return {
    lanes: [...lanesForWorkflow],
    stages: {
      always_if_exists: stages.always_if_exists ?? [],
      success_if_exists: stages.success_if_exists ?? [],
      success_verify_not_plan_if_exists: stages.success_verify_not_plan_if_exists ?? [],
      required_on_success: stages.required_on_success ?? [],
    },
    exclude,
  };
}

const workflow_policies = Object.fromEntries(
  [...new Set(lanes.map((laneValue) => laneValue.owner_workflow).filter(Boolean))]
    .map((workflowRel) => [
      workflowRel,
      defaultWorkflowPolicy(lanes.filter((laneValue) => laneValue.owner_workflow === workflowRel).map((laneValue) => laneValue.id)),
    ]),
);

// Shared SlickCharts publisher callers have their own path policy. The helper
// still owns the actual staging operation; these entries are shadow/check-only
// until each caller is migrated independently.
Object.assign(workflow_policies, {
  ".github/workflows/slickcharts-weekly.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
      commitSpec(publishOutcomeShard("slickcharts-weekly"), "file"),
      commitSpec("data/admin/slickcharts-composite-recovery", "directory"),
    ],
    success_if_exists: [
      commitSpec("data/slickcharts/sp500.json", "file", true),
      commitSpec("data/slickcharts/magnificent7.json", "file", true),
      commitSpec("data/slickcharts/etf.json", "file", true),
      commitSpec("data/slickcharts/berkshire.json", "file", true),
    ],
  }),
  ".github/workflows/slickcharts-symbols.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
      commitSpec(publishOutcomeShard("slickcharts-symbols"), "file"),
      commitSpec("data/admin/slickcharts-composite-recovery", "directory"),
    ],
    success_if_exists: [
      commitSpec("data/slickcharts/symbols.json", "file", true),
      commitSpec("data/slickcharts/symbols-all.json", "file", true),
    ],
  }),
  ".github/workflows/slickcharts-history.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
      commitSpec(publishOutcomeShard("slickcharts-history"), "file"),
      commitSpec("data/admin/slickcharts-composite-recovery", "directory"),
    ],
    success_if_exists: [
      commitSpec("data/slickcharts/stocks-returns.json", "file", true),
      commitSpec("data/slickcharts/stocks-dividends.json", "file", true),
      commitSpec("data/slickcharts/stocks-dividends-recent.json", "file", true),
      commitSpec("data/slickcharts/stocks-dividends-historical.json", "file", true),
      commitSpec("data/slickcharts/stocks", "directory", true),
    ],
  }),
  ".github/workflows/slickcharts-monthly.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
      commitSpec(publishOutcomeShard("slickcharts-monthly"), "file"),
      commitSpec("data/admin/slickcharts-composite-recovery", "directory"),
    ],
    success_if_exists: [
      ...[
        "sp500-returns.json",
        "sp500-returns-details.json",
        "nasdaq100-returns.json",
        "dowjones-returns.json",
        "sp500-drawdown.json",
        "btc-returns.json",
        "eth-returns.json",
        "sp500-performance.json",
        "nasdaq100-performance.json",
        "dowjones-performance.json",
        "sp500-yield.json",
        "nasdaq100-yield.json",
        "dowjones-yield.json",
        "sp500-analysis.json",
        "nasdaq100-analysis.json",
        "dowjones-analysis.json",
        "sp500-marketcap.json",
        "nasdaq100-ratio.json",
        "nasdaq100.json",
        "dowjones.json",
        "inflation.json",
      ].map((name) => commitSpec(`data/slickcharts/${name}`, "file", true)),
      commitSpec("data/slickcharts/1929crash.json", "file", false),
    ],
  }),
});

// Rich producer policies whose current YAML uses directory/glob/dynamic
// pathspecs or explicit restore exclusions.
workflow_policies[".github/workflows/fetch-defillama.yml"] = lanePolicy(".github/workflows/fetch-defillama.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/defillama_stablecoins.json", "file"),
    commitSpec(publishOutcomeShard("defillama-stablecoins"), "file"),
    commitSpec("data/admin/defillama_stablecoins/index.json", "file"),
    commitSpec("data/admin/defillama_stablecoins/lkg/stablecoins.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/macro/stablecoins.json", "file", true),
  ],
});
workflow_policies[".github/workflows/fetch-fenok-apewisdom.yml"] = lanePolicy(".github/workflows/fetch-fenok-apewisdom.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/apewisdom_attention.json", "file"),
    commitSpec("data/admin/apewisdom_attention/index.json", "file"),
    commitSpec("data/admin/apewisdom_attention/lkg/social_attention_proxy.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/computed/fenok_social_attention_proxy.json", "file"),
    commitSpec("data/computed/fenok_social_attention_proxy_history.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-fenok-news-tone.yml"] = lanePolicy(".github/workflows/fetch-fenok-news-tone.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/gdelt_news_tone.json", "file"),
    commitSpec(publishOutcomeShard("gdelt-news-tone"), "file"),
    commitSpec("data/admin/gdelt_news_tone/index.json", "file"),
    commitSpec("data/admin/gdelt_news_tone/lkg/news_tone_proxy.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/computed/fenok_news_tone_proxy.json", "file"),
    commitSpec("data/computed/fenok_news_tone_proxy_history.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-sentiment.yml"] = lanePolicy(".github/workflows/fetch-sentiment.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/sentiment.json", "file"),
    commitSpec(publishOutcomeShard("sentiment"), "file"),
    commitSpec("data/admin/sentiment/index.json", "file"),
    commitSpec("data/admin/sentiment/current/*.json", "glob"),
    commitSpec("data/admin/sentiment/lkg/*.json", "glob"),
    commitSpec("data/admin/sentiment/source-observations/crypto.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/sentiment/*.json", "glob"),
  ],
});
workflow_policies[".github/workflows/fetch-us-indices-daily.yml"] = lanePolicy(".github/workflows/fetch-us-indices-daily.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/us_indices_daily.json", "file"),
    commitSpec(publishOutcomeShard("us-indices-daily"), "file"),
    commitSpec("data/admin/us-indices-daily", "directory"),
  ],
  success_if_exists: [
    commitSpec("data/indices/sp500.json", "file"),
    commitSpec("data/indices/nasdaq.json", "file"),
    commitSpec("data/indices/nasdaq100.json", "file"),
    commitSpec("data/indices/sox.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-oecd-cli.yml"] = lanePolicy(".github/workflows/fetch-oecd-cli.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/oecd_cli.json", "file"),
    commitSpec(publishOutcomeShard("oecd-cli"), "file"),
    commitSpec("data/admin/oecd_cli/index.json", "file"),
    commitSpec("data/admin/oecd_cli/lkg/oecd_cli.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/admin/oecd_cli/shadow/oecd-cli.json", "file"),
    commitSpec("data/admin/oecd_cli/parity-report.json", "file"),
  ],
});
workflow_policies[".github/workflows/fenok-edge-daily.yml"] = lanePolicy(".github/workflows/fenok-edge-daily.yml", {
  always_if_exists: [
    "finra_short_volume",
    "occ_options_volume",
  ].flatMap((laneId) => lanes.find((laneValue) => laneValue.id === laneId)?.commit_shards ?? []).map((pathValue) => commitSpec(pathValue, pathKind(pathValue))),
  success_verify_not_plan_if_exists: [
    commitSpec("data/computed/fenok_flow_proxies*.json", "glob"),
    commitSpec("data/computed/fenok_occ_options_availability.json", "file"),
    commitSpec("data/computed/fenok_occ_options_volume*.json", "glob"),
    commitSpec("data/computed/fenok_signal_lens_proxies*.json", "glob"),
  ],
});
workflow_policies[".github/workflows/fetch-finra-ats-weekly.yml"] = lanePolicy(".github/workflows/fetch-finra-ats-weekly.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/finra_ats.json", "file"),
    commitSpec(publishOutcomeShard("finra-ats-weekly"), "file"),
    commitSpec("data/admin/finra-ats/index.json", "file"),
    commitSpec("data/admin/finra-ats/lkg/weekly-summary.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/admin/finra-ats/current/weekly-summary.json", "file", true),
    commitSpec("data/admin/finra-ats/weeks", "directory", true),
  ],
});
workflow_policies[".github/workflows/fetch-yf-finance.yml"] = lanePolicy(".github/workflows/fetch-yf-finance.yml", {
  always_if_exists: [
    commitSpec("data/yf/finance", "directory", true),
    commitSpec("data/yf/quarter_closes.json", "file", true),
    commitSpec("data/admin/yahoo-batch-quote-history", "directory", true),
    commitSpec("data/yf/estimates-archive", "directory", true),
  ],
}, [
  commitSpec("data/yf/finance/_summary.json", "file"),
  commitSpec("data/yf/estimates-archive/_summary.json", "file"),
]);
workflow_policies[".github/workflows/fetch-stockanalysis.yml"] = lanePolicy(".github/workflows/fetch-stockanalysis.yml", {
  always_if_exists: [
    commitSpec("data/stockanalysis", "directory", true),
    commitSpec("data/yf/etf-details", "directory", true),
    commitSpec("data/admin/data-supply-state/v1", "directory", true),
    commitSpec("data/admin/stockanalysis-recovery", "directory", true),
    commitSpec("data/admin/yahoo_etf_fallback", "directory", false),
    // The five attempt shards this workflow carries are no longer listed here.
    // They are derived from the registry by lanePolicy, because hand-listing
    // them is what let run 31794068491 emit a shard correctly and then fail to
    // pack it: the lane was added to the registry, the detection config and the
    // producer, and missed here. Being a shadow lane governs whether evidence
    // may be counted as ready, never whether it may be carried.
    commitSpec("data/yf/finance", "dynamic_set"),
    commitSpec("100xfenok-next/public/data", "directory", false),
  ],
}, [
  commitSpec("data/stockanalysis/backfill/history_gap_report_latest.json", "file"),
  commitSpec("data/yf/finance/_summary.json", "file"),
]);
workflow_policies[".github/workflows/fenok-edge-krx-daily.yml"] = lanePolicy(".github/workflows/fenok-edge-krx-daily.yml", {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/krx.json", "file"),
    commitSpec("data/admin/krx/index.json", "file"),
    commitSpec("data/admin/krx/lkg/bridge.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/admin/fenok-edge-korea-krx-daily-index.json", "file", true),
    // Bounded, public-safe bridge summaries keyed by provider source date.
    commitSpec("data/computed/fenok-edge-korea-krx-bridge-history.json", "file", true),
    // Slice 1 public-safe aggregate index closes (owner grant 2026-07-19).
    commitSpec("data/computed/fenok-edge-korea-krx-index-daily.json", "file", true),
    // Slice 2 public-safe KOSDAQ top-10 market-cap aggregate; no issuer rows.
    commitSpec("data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json", "file", true),
  ],
});
workflow_policies[".github/workflows/fetch-damodaran-shadow.yml"] = lanePolicy(".github/workflows/fetch-damodaran-shadow.yml", {
  always_if_exists: [
    commitSpec(attemptShard("damodaran"), "file", false),
    commitSpec(publishOutcomeShard("damodaran"), "file", false),
    commitSpec("data/admin/damodaran/index.json", "file", false),
    commitSpec("data/admin/damodaran/current/damodaran.json", "file", false),
    commitSpec("data/admin/damodaran/lkg/damodaran.json", "file", false),
    commitSpec("data/admin/damodaran/history.json", "file", false),
  ],
  required_on_success: [
    commitSpec("data/admin/damodaran/owner-guard.json", "file", true),
    ...[
      "industries.json",
      "historical_erp.json",
      "credit_ratings.json",
      "erp.json",
      "industry_metrics.json",
      "industry_metrics_regions.json",
    ].map((file) => commitSpec(`data/damodaran/${file}`, "file", true)),
  ],
});
workflow_policies[".github/workflows/build-stocks-analyzer.yml"] = policy([], {
  always_if_exists: [
    ...[
      "data/global-scouter/core/stocks_analyzer.json",
      "data/global-scouter/core/per_bands_index.json",
      "data/global-scouter/core/slick_index.json",
      "data/sec-13f/by_ticker.json",
      "data/sec-13f/by_sector.json",
      "data/sec-13f/summary.json",
      "data/sec-13f/investors/*.json",
      "data/sec-13f/analytics/consensus.json",
      "data/sec-13f/analytics/ticker_aliases.json",
      "data/sec-13f/analytics/trades_ranking.json",
      "data/sec-13f/analytics/portfolio_views.json",
      "data/sec-13f/analytics/guru_holders_index.json",
      "data/global-scouter/core/revision_movers.json",
      "data/damodaran/industry_benchmarks.json",
      "data/calendar/prev-values.json",
    ].map((pathValue) => commitSpec(pathValue, pathKind(pathValue))),
  ],
});
workflow_policies[".github/workflows/pipeline-failure-alarm.yml"] = policy([], {
  always_if_exists: [
    commitSpec("data/admin/alarm-state.json", "file"),
  ],
});
workflow_policies[".github/workflows/update-manifest.yml"] = policy([], {
  always_if_exists: [],
});
// The computed-signals coordinator is a platform publisher with exactly one
// owned commit path: the per-family publish-outcome shard. The exporter's
// canonical/public signal files are deliberately NOT staged here — Update
// Manifest reconciliation owns the git copies; the coordinator only publishes
// them to the cloud data plane and cleans them from its ephemeral checkout.
workflow_policies[".github/workflows/coordinate-computed-signals.yml"] = policy([], {
  always_if_exists: [
    commitSpec(publishOutcomeShard("computed-signals"), "file"),
  ],
});

// --- Validation (fail-closed, mirrors the detection config's loader) ---------

const LANE_ID_RE = /^[a-z][a-z0-9_]{0,95}$/;
const LANE_RECORD_KEYS = Object.freeze([
  "id",
  "label",
  "owner_workflow",
  "provider_members",
  "provider_refs",
  "store_kind",
  "lane_class",
  "cadence",
  "enforcement",
  "privacy_class",
  "roots",
  "commit_shards",
  "recovery_store",
  "declared_exception",
]);
const LANE_RECORD_OPTIONAL_KEYS = Object.freeze([
  "activated_at",
  "script_sources",
  "caller_workflows",
  "kpi_recovery_shape",
  "public_mirror_allowed",
  "public_canonical_outputs",
]);

function exactKeys(value, expected, context) {
  const actual = Object.keys(value ?? {}).sort();
  const want = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(want)) {
    fail(`${context} keys must be exactly ${want.join(",")} (got ${actual.join(",")})`);
  }
}

function validatePathList(value, context, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) fail(`${context} must be an array`);
  if (!allowEmpty && value.length === 0) fail(`${context} must not be empty`);
  const seen = new Set();
  for (const entry of value) {
    if (!validRepoRelativePath(entry)) fail(`${context} has an unsafe path: ${String(entry)}`);
    if (seen.has(entry)) fail(`${context} duplicates ${entry}`);
    seen.add(entry);
  }
}

function validateCommitSpec(specValue, context) {
  exactKeys(specValue, ["path", "kind", "required"], context);
  if (!validRepoRelativePath(specValue.path) || /[\u0000-\u001f\u007f]/.test(specValue.path)) {
    fail(`${context}.path is unsafe`);
  }
  if (!COMMIT_PATH_KINDS.includes(specValue.kind)) fail(`${context}.kind is invalid`);
  if (typeof specValue.required !== "boolean") fail(`${context}.required must be boolean`);
}

function validateWorkflowPolicy(policyValue, workflowRel, registry) {
  const context = `workflow policy ${workflowRel}`;
  exactKeys(policyValue, ["lanes", "stages", "exclude"], context);
  if (!Array.isArray(policyValue.lanes)) fail(`${context}.lanes must be an array`);
  const seenLanes = new Set();
  for (const laneId of policyValue.lanes) {
    if (typeof laneId !== "string" || !registry.lanes.some((laneValue) => laneValue.id === laneId)) {
      fail(`${context}.lanes contains unknown lane ${String(laneId)}`);
    }
    if (seenLanes.has(laneId)) fail(`${context}.lanes duplicates ${laneId}`);
    seenLanes.add(laneId);
  }
  // Completeness, not merely membership. Until 2026-08-14 a policy was checked
  // only against the lanes it DID list, so a lane could be registry-owned by a
  // workflow and absent from that workflow's own attribution with nothing
  // noticing. fetch-stockanalysis.yml was in exactly that state.
  const ownedLanes = registry.lanes.filter((laneValue) => laneValue.owner_workflow === workflowRel);
  for (const laneValue of ownedLanes) {
    if (!seenLanes.has(laneValue.id)) {
      fail(`${context}.lanes omits ${laneValue.id}, which the registry attributes to this workflow`);
    }
  }
  exactKeys(policyValue.stages, COMMIT_STAGE_KEYS, `${context}.stages`);
  for (const stage of COMMIT_STAGE_KEYS) {
    const entries = policyValue.stages[stage];
    if (!Array.isArray(entries)) fail(`${context}.stages.${stage} must be an array`);
    const seenPaths = new Set();
    for (const entry of entries) {
      validateCommitSpec(entry, `${context}.stages.${stage}`);
      if (seenPaths.has(entry.path)) fail(`${context}.stages.${stage} duplicates ${entry.path}`);
      seenPaths.add(entry.path);
    }
  }
  if (!Array.isArray(policyValue.exclude)) fail(`${context}.exclude must be an array`);
  const seenExclusions = new Set();
  for (const entry of policyValue.exclude) {
    validateCommitSpec(entry, `${context}.exclude`);
    if (seenExclusions.has(entry.path)) fail(`${context}.exclude duplicates ${entry.path}`);
    seenExclusions.add(entry.path);
  }
  // A workflow that owns a lane must be able to commit that lane's attempt
  // evidence. Run 31794068491 emitted a shard correctly and then failed to pack
  // it because this policy did not own the path, and yahoo_batch_quote_history
  // has never committed its declared shard once for the same reason. Being a
  // shadow lane governs whether evidence may be COUNTED, never whether it may
  // be CARRIED.
  const stagedPaths = COMMIT_STAGE_KEYS.flatMap((stage) => policyValue.stages[stage].map((spec) => spec.path));
  const excludedPaths = new Set(policyValue.exclude.map((spec) => spec.path));
  for (const laneValue of ownedLanes) {
    for (const shard of laneValue.commit_shards ?? []) {
      if (!shard.startsWith(`${ATTEMPT_ROOT}/`)) continue;
      const carried = stagedPaths.some((staged) => staged === shard || shard.startsWith(`${staged}/`));
      if (!carried || excludedPaths.has(shard)) {
        fail(`${context} cannot commit ${shard}, the attempt evidence of ${laneValue.id}`);
      }
    }
  }
}

function validateLaneRecord(laneValue) {
  const context = `lane ${laneValue?.id ?? "<unknown>"}`;
  const expectedKeys = [
    ...LANE_RECORD_KEYS,
    ...LANE_RECORD_OPTIONAL_KEYS.filter((key) => Object.hasOwn(laneValue ?? {}, key)),
  ];
  exactKeys(laneValue, expectedKeys, context);
  if (!LANE_ID_RE.test(laneValue.id)) fail(`${context} id is invalid`);
  if (laneValue.activated_at !== undefined
    && !isStrictUtcTimestamp(laneValue.activated_at)) {
    fail(`${context}.activated_at must be a strict UTC timestamp when present`);
  }
  if (typeof laneValue.label !== "string" || laneValue.label.length === 0) fail(`${context} label is required`);
  if (laneValue.owner_workflow !== null
    && (typeof laneValue.owner_workflow !== "string" || !laneValue.owner_workflow.startsWith(".github/workflows/"))) {
    fail(`${context} owner_workflow must be null or a .github/workflows/ path`);
  }
  let providerMemberSet = null;
  if (laneValue.provider_members !== null) {
    if (!Array.isArray(laneValue.provider_members) || laneValue.provider_members.length === 0) {
      fail(`${context}.provider_members must be null or a non-empty array`);
    }
    providerMemberSet = new Set();
    for (const member of laneValue.provider_members) {
      if (!LANE_ID_RE.test(member)) fail(`${context}.provider_members member is invalid`);
      if (providerMemberSet.has(member)) fail(`${context}.provider_members duplicates ${member}`);
      providerMemberSet.add(member);
    }
  }
  if (!Array.isArray(laneValue.provider_refs) || laneValue.provider_refs.length === 0) {
    fail(`${context}.provider_refs must be a non-empty array`);
  }
  const seenProviderRefs = new Set();
  for (const ref of laneValue.provider_refs) {
    exactKeys(ref, ["provider_id", "role", "members"], `${context}.provider_refs`);
    if (!LANE_ID_RE.test(ref.provider_id)) fail(`${context}.provider_refs provider_id is invalid`);
    if (!PROVIDER_ROLES.includes(ref.role)) fail(`${context}.provider_refs role is invalid`);
    if (seenProviderRefs.has(ref.provider_id)) {
      fail(`${context}.provider_refs duplicates ${ref.provider_id}`);
    }
    seenProviderRefs.add(ref.provider_id);
    if (ref.members !== null) {
      if (!Array.isArray(ref.members) || ref.members.length === 0) {
        fail(`${context}.provider_refs members must be null or a non-empty array`);
      }
      if (providerMemberSet === null) {
        fail(`${context}.provider_refs members require provider_members`);
      }
      const seenMembers = new Set();
      for (const member of ref.members) {
        if (!LANE_ID_RE.test(member)) fail(`${context}.provider_refs member is invalid`);
        if (seenMembers.has(member)) fail(`${context}.provider_refs duplicates member ${member}`);
        if (!providerMemberSet.has(member)) {
          fail(`${context}.provider_refs contains undeclared member ${member}`);
        }
        seenMembers.add(member);
      }
    }
  }
  if (!laneValue.provider_refs.some((ref) => ref.role !== "transport")) {
    fail(`${context}.provider_refs must include a non-transport dependency`);
  }
  if (providerMemberSet !== null) {
    const sourceMemberOwners = new Map();
    for (const ref of laneValue.provider_refs.filter((entry) => entry.role === "source")) {
      if (ref.members === null) {
        fail(`${context}.provider_refs source members must be explicit when provider_members is declared`);
      }
      for (const member of ref.members) {
        if (sourceMemberOwners.has(member)) {
          fail(`${context}.provider_refs source member ${member} has multiple owners`);
        }
        sourceMemberOwners.set(member, ref.provider_id);
      }
    }
    const declaredMembers = [...providerMemberSet].sort();
    const coveredMembers = [...sourceMemberOwners.keys()].sort();
    if (JSON.stringify(declaredMembers) !== JSON.stringify(coveredMembers)) {
      fail(`${context}.provider_refs source members must exactly cover provider_members`);
    }
  }
  if (!STORE_KINDS.includes(laneValue.store_kind)) fail(`${context} store_kind is invalid`);
  if (!LANE_CLASSES.includes(laneValue.lane_class)) fail(`${context} lane_class is invalid`);
  if (laneValue.store_kind === "artifact_only") {
    if (laneValue.roots.admin_store !== null || laneValue.recovery_store !== null || laneValue.commit_shards.length > 0) {
      fail(`${context} artifact_only lanes must not carry store roots, commit shards, or a recovery store`);
    }
  } else {
    if (!validRepoRelativePath(laneValue.roots.admin_store)) fail(`${context} roots.admin_store is required for ${laneValue.store_kind} lanes`);
  }
  if (!ENFORCEMENTS.includes(laneValue.enforcement)) fail(`${context} enforcement is invalid`);
  if (!PRIVACY_CLASSES.includes(laneValue.privacy_class)) fail(`${context} privacy_class is invalid`);
  if (laneValue.public_mirror_allowed !== undefined) {
    if (typeof laneValue.public_mirror_allowed !== "boolean") {
      fail(`${context}.public_mirror_allowed must be a boolean when present`);
    }
    if (laneValue.public_mirror_allowed === false
      && (laneValue.privacy_class !== "private" || laneValue.roots.public_mirror.length !== 0)) {
      fail(`${context}.public_mirror_allowed=false requires privacy_class private and an empty public mirror`);
    }
  }
  if (typeof laneValue.cadence?.kind !== "string" || !CADENCE_KINDS.includes(laneValue.cadence.kind)) {
    fail(`${context} cadence.kind is invalid`);
  }
  exactKeys(
    laneValue.cadence,
    ["kind", ...(laneValue.cadence.provenance !== undefined ? ["provenance"] : [])],
    `${context}.cadence`,
  );
  if (laneValue.cadence.provenance !== undefined) {
    exactKeys(laneValue.cadence.provenance, ["kind", "evidence"], `${context}.cadence.provenance`);
    if (!CADENCE_PROVENANCE_KINDS.includes(laneValue.cadence.provenance.kind)) {
      fail(`${context} cadence.provenance.kind is invalid`);
    }
    if (typeof laneValue.cadence.provenance.evidence !== "string" || laneValue.cadence.provenance.evidence.length === 0) {
      fail(`${context} cadence.provenance.evidence is required`);
    }
  }
  exactKeys(laneValue.roots, ["admin_store", "detection_attempt", "canonical_outputs", "public_mirror"], `${context}.roots`);
  if (laneValue.roots.admin_store !== null && !validRepoRelativePath(laneValue.roots.admin_store)) {
    fail(`${context}.roots.admin_store is invalid`);
  }
  if (laneValue.roots.detection_attempt !== null && !validRepoRelativePath(laneValue.roots.detection_attempt)) {
    fail(`${context}.roots.detection_attempt is invalid`);
  }
  validatePathList(laneValue.roots.canonical_outputs, `${context}.roots.canonical_outputs`);
  validatePathList(laneValue.roots.public_mirror, `${context}.roots.public_mirror`);
  if (laneValue.public_canonical_outputs !== undefined) {
    validatePathList(
      laneValue.public_canonical_outputs,
      `${context}.public_canonical_outputs`,
      { allowEmpty: false },
    );
    if (laneValue.privacy_class !== "private"
      || laneValue.roots.public_mirror.length !== 0
      || laneValue.public_mirror_allowed !== false
      || laneValue.declared_exception === null) {
      fail(`${context}.public_canonical_outputs requires a documented private lane with public_mirror_allowed=false and an empty public mirror`);
    }
    for (const publicOutput of laneValue.public_canonical_outputs) {
      if (!laneValue.roots.canonical_outputs.includes(publicOutput)) {
        fail(`${context}.public_canonical_outputs must be a subset of roots.canonical_outputs`);
      }
    }
  }
  validatePathList(laneValue.commit_shards, `${context}.commit_shards`);
  if (laneValue.recovery_store !== null && !validRepoRelativePath(laneValue.recovery_store)) {
    fail(`${context}.recovery_store is invalid`);
  }
  if (laneValue.recovery_store !== null && laneValue.roots.admin_store !== null
    && !laneValue.recovery_store.startsWith(`${laneValue.roots.admin_store}/`)) {
    fail(`${context}.recovery_store must live under roots.admin_store`);
  }
  if (laneValue.recovery_store !== null && !KPI_RECOVERY_SHAPES.includes(laneValue.kpi_recovery_shape)) {
    fail(`${context}.kpi_recovery_shape is required when recovery_store is present`);
  }
  if (laneValue.recovery_store === null && laneValue.kpi_recovery_shape !== undefined) {
    fail(`${context}.kpi_recovery_shape requires a recovery_store`);
  }
  if (laneValue.declared_exception !== null && typeof laneValue.declared_exception !== "string") {
    fail(`${context}.declared_exception must be null or a string`);
  }
  if (laneValue.script_sources !== undefined) {
    validatePathList(laneValue.script_sources, `${context}.script_sources`);
  }
  if (laneValue.caller_workflows !== undefined) {
    if (!laneValue.caller_workflows || typeof laneValue.caller_workflows !== "object" || Array.isArray(laneValue.caller_workflows)) {
      fail(`${context}.caller_workflows must be an object`);
    }
    for (const [callerRel, caller] of Object.entries(laneValue.caller_workflows)) {
      if (!callerRel.startsWith(".github/workflows/")) fail(`${context}.caller_workflows key must be a .github/workflows/ path: ${callerRel}`);
      if (callerRel === laneValue.owner_workflow) fail(`${context}.caller_workflows must not duplicate owner_workflow: ${callerRel}`);
      exactKeys(caller, ["commit_shards", "script_sources"], `${context}.caller_workflows[${callerRel}]`);
      validatePathList(caller.commit_shards, `${context}.caller_workflows[${callerRel}].commit_shards`);
      validatePathList(caller.script_sources, `${context}.caller_workflows[${callerRel}].script_sources`);
    }
  }
}

export function validateLaneRegistry(registry) {
  exactKeys(registry, ["schema_version", "providers", "lanes", "declared_exceptions", "workflow_classes", "workflow_policies"], "registry");
  if (registry.schema_version !== LANE_REGISTRY_SCHEMA) fail("schema_version is invalid");
  if (!Array.isArray(registry.providers) || registry.providers.length === 0) {
    fail("providers must be a non-empty array");
  }
  const providerById = new Map();
  for (const provider of registry.providers) {
    exactKeys(provider, ["id", "label", "class"], `provider ${provider?.id ?? "<unknown>"}`);
    if (!LANE_ID_RE.test(provider.id)) fail(`provider id is invalid: ${String(provider.id)}`);
    if (providerById.has(provider.id)) fail(`duplicate provider id ${provider.id}`);
    if (typeof provider.label !== "string" || provider.label.length === 0) {
      fail(`provider ${provider.id} label is required`);
    }
    if (!PROVIDER_CLASSES.includes(provider.class)) fail(`provider ${provider.id} class is invalid`);
    providerById.set(provider.id, provider);
  }
  if (!Array.isArray(registry.lanes) || registry.lanes.length === 0) fail("lanes must be a non-empty array");
  const seenIds = new Set();
  const referencedProviderIds = new Set();
  const roleByProviderClass = {
    external_data: "source",
    owner_managed_data: "source",
    platform_proxy: "transport",
    platform_runtime: "runtime",
    platform_storage: "storage",
  };
  for (const laneValue of registry.lanes) {
    validateLaneRecord(laneValue);
    if (seenIds.has(laneValue.id)) fail(`duplicate lane id ${laneValue.id}`);
    seenIds.add(laneValue.id);
    for (const ref of laneValue.provider_refs) {
      const provider = providerById.get(ref.provider_id);
      if (!provider) fail(`lane ${laneValue.id}.provider_refs contains unknown provider ${ref.provider_id}`);
      if (roleByProviderClass[provider.class] !== ref.role) {
        fail(`lane ${laneValue.id}.provider_refs role ${ref.role} is invalid for ${provider.class} provider ${provider.id}`);
      }
      referencedProviderIds.add(ref.provider_id);
    }
  }
  for (const provider of registry.providers) {
    if (!referencedProviderIds.has(provider.id)) fail(`provider ${provider.id} is unreferenced`);
  }
  const directByKey = new Map();
  for (const laneValue of registry.lanes) {
    if (laneValue.kpi_recovery_shape !== "direct") continue;
    const key = laneValue.roots.admin_store.split("/").at(-1).replaceAll("-", "_");
    const prior = directByKey.get(key);
    if (prior !== undefined && prior !== laneValue.recovery_store) {
      fail(`direct recovery lanes disagree on bucket ${key}`);
    }
    directByKey.set(key, laneValue.recovery_store);
  }
  if (!Array.isArray(registry.declared_exceptions)) fail("declared_exceptions must be an array");
  const seenExceptions = new Set();
  for (const entry of registry.declared_exceptions) {
    const expectedKeys = [
      "path",
      "kind",
      "reason",
      "owner",
      ...(entry.may_be_absent === true ? ["may_be_absent"] : []),
      ...(entry.public_sync !== undefined ? ["public_sync"] : []),
    ];
    exactKeys(entry, expectedKeys, `declared exception ${entry?.path ?? "<unknown>"}`);
    if (!validRepoRelativePath(entry.path)) fail(`declared exception path is invalid: ${entry.path}`);
    if (!["root", "file"].includes(entry.kind)) fail(`declared exception kind is invalid: ${entry.path}`);
    if (typeof entry.reason !== "string" || entry.reason.length === 0) fail(`declared exception reason is required: ${entry.path}`);
    if (typeof entry.owner !== "string" || entry.owner.length === 0) fail(`declared exception owner is required: ${entry.path}`);
    if (entry.may_be_absent !== undefined && typeof entry.may_be_absent !== "boolean") {
      fail(`declared exception may_be_absent must be a boolean: ${entry.path}`);
    }
    if (entry.public_sync !== undefined && entry.public_sync !== "exclude") {
      fail(`declared exception public_sync must be exclude when present: ${entry.path}`);
    }
    if (seenExceptions.has(entry.path)) fail(`duplicate declared exception ${entry.path}`);
    seenExceptions.add(entry.path);
  }
  if (!registry.workflow_classes || typeof registry.workflow_classes !== "object" || Array.isArray(registry.workflow_classes)) {
    fail("workflow_classes must be an object");
  }
  for (const [workflowRel, entry] of Object.entries(registry.workflow_classes)) {
    if (!workflowRel.startsWith(".github/workflows/")) fail(`workflow_classes key must be a .github/workflows/ path: ${workflowRel}`);
    exactKeys(entry, ["class", "reason", "owner"], `workflow class ${workflowRel}`);
    if (!WORKFLOW_CLASSES.includes(entry.class)) fail(`workflow class is invalid for ${workflowRel}`);
    if (typeof entry.reason !== "string" || entry.reason.length === 0) fail(`workflow class reason is required for ${workflowRel}`);
    if (typeof entry.owner !== "string" || entry.owner.length === 0) fail(`workflow class owner is required for ${workflowRel}`);
  }
  if (!registry.workflow_policies || typeof registry.workflow_policies !== "object" || Array.isArray(registry.workflow_policies)) {
    fail("workflow_policies must be an object");
  }
  for (const [workflowRel, policyValue] of Object.entries(registry.workflow_policies)) {
    if (!workflowRel.startsWith(".github/workflows/")) fail(`workflow_policies key must be a .github/workflows/ path: ${workflowRel}`);
    validateWorkflowPolicy(policyValue, workflowRel, registry);
  }
  const expectedWorkflowKeys = new Set([
    ...registry.lanes.map((laneValue) => laneValue.owner_workflow).filter(Boolean),
    ...Object.values(registry.lanes).flatMap((laneValue) => Object.keys(laneValue.caller_workflows ?? {})),
    ...Object.keys(registry.workflow_classes),
  ]);
  for (const workflowRel of expectedWorkflowKeys) {
    if (!Object.hasOwn(registry.workflow_policies, workflowRel)) {
      fail(`workflow policy missing for ${workflowRel}`);
    }
  }
  return true;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const registry = {
  schema_version: LANE_REGISTRY_SCHEMA,
  providers,
  lanes,
  declared_exceptions,
  workflow_classes,
  workflow_policies,
};

validateLaneRegistry(registry);

export const LANE_REGISTRY = deepFreeze(registry);

export function registryDigest() {
  validateLaneRegistry(LANE_REGISTRY);
  return createHash("sha256").update(canonicalJson(LANE_REGISTRY), "utf8").digest("hex");
}

export function registryLaneById(id) {
  return LANE_REGISTRY.lanes.find((laneValue) => laneValue.id === id) ?? null;
}

export function registryProviderById(id) {
  return LANE_REGISTRY.providers.find((provider) => provider.id === id) ?? null;
}

export function providerBlastRadius(providerId, registryValue = LANE_REGISTRY) {
  if (!registryValue.providers.some((provider) => provider.id === providerId)) {
    fail(`unknown provider ${String(providerId)}`);
  }
  return registryValue.lanes.flatMap((laneValue) => laneValue.provider_refs
    .filter((ref) => ref.provider_id === providerId)
    .map((ref) => ({
      lane_id: laneValue.id,
      role: ref.role,
      members: ref.members,
    })));
}

// Map of data/admin first-level roots -> owning lane ids (shared stores list all).
export function declaredAdminRoots(registry = LANE_REGISTRY) {
  const roots = new Map();
  for (const laneValue of registry.lanes) {
    const root = laneValue.roots.admin_store;
    if (root === null) continue;
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(laneValue.id);
  }
  return roots;
}

export function declaredExceptionPaths(kind = null, registry = LANE_REGISTRY) {
  // Reads the PASSED registry's exceptions (default: the shipped one) — an
  // injected registry must be honored end to end (the fh-155/fh-168/fh-175
  // seam class; root-fixed here rather than per call site).
  return registry.declared_exceptions
    .filter((entry) => kind === null || entry.kind === kind)
    .map((entry) => entry.path);
}
