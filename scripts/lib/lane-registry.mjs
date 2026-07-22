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

export const LANE_REGISTRY_SCHEMA = "lane-registry/v2";
export const STORE_KINDS = Object.freeze(["marker", "payload", "artifact_only"]);
export const LANE_CLASSES = Object.freeze(["detection_floor", "auxiliary"]);
export const KPI_RECOVERY_SHAPES = Object.freeze(["general", "keyed_v2", "direct"]);
export const ENFORCEMENTS = Object.freeze(["live", "shadow"]);
export const PRIVACY_CLASSES = Object.freeze(["private", "public_mirror", "public_safe_aggregate"]);
export const CADENCE_KINDS = Object.freeze(["hourly", "daily", "weekly", "monthly", "quarterly", "mixed", "unknown"]);
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

function record({
  id,
  label,
  owner_workflow,
  store_kind,
  lane_class,
  cadence,
  enforcement,
  privacy_class,
  admin_store,
  detection_attempt = null,
  canonical_outputs = [],
  public_mirror = [],
  commit_shards = [],
  recovery_store = null,
  declared_exception = null,
  script_sources,
  caller_workflows,
  kpi_recovery_shape,
}) {
  return {
    id,
    label,
    owner_workflow,
    store_kind,
    lane_class,
    cadence,
    enforcement,
    privacy_class,
    roots: {
      admin_store,
      detection_attempt,
      canonical_outputs,
      public_mirror,
    },
    commit_shards,
    recovery_store,
    declared_exception,
    ...(script_sources !== undefined ? { script_sources } : {}),
    ...(caller_workflows !== undefined ? { caller_workflows } : {}),
    ...(kpi_recovery_shape !== undefined ? { kpi_recovery_shape } : {}),
  };
}

const ATTEMPT_ROOT = "data/admin/data-supply-state/detection-attempts";
const attemptShard = (laneId) => `${ATTEMPT_ROOT}/${laneId}.json`;

// --- Lane records (verified against origin/main, 2026-07-18) -----------------

const lanes = [
  record({
    id: "fred_macro",
    label: "FRED macro",
    owner_workflow: ".github/workflows/fetch-fred-macro.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "fred" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/fred_macro",
    detection_attempt: attemptShard("fred_macro"),
    canonical_outputs: ["data/macro/fred-macro.json"],
    public_mirror: ["100xfenok-next/public/data/macro/fred-macro.json"],
    commit_shards: [
      attemptShard("fred_macro"),
      "data/admin/fred_macro/index.json",
      "data/admin/fred_macro/lkg/fred_macro.json",
      "data/macro/fred-macro.json",
      "100xfenok-next/public/data/macro/fred-macro.json",
    ],
    recovery_store: "data/admin/fred_macro/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fred_banking",
    label: "FRED banking",
    owner_workflow: ".github/workflows/fetch-fred-banking.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "mixed", provider: "fred (daily/weekly/monthly/quarterly series)" },
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
    public_mirror: [
      "100xfenok-next/public/data/macro/fred-banking-daily.json",
      "100xfenok-next/public/data/macro/fred-banking-weekly.json",
      "100xfenok-next/public/data/macro/fred-banking-monthly.json",
      "100xfenok-next/public/data/macro/fred-banking-quarterly.json",
    ],
    commit_shards: [
      attemptShard("fred_banking"),
      "data/admin/fred_banking/index.json",
      "data/admin/fred_banking/lkg/daily.json",
      "data/admin/fred_banking/lkg/weekly.json",
      "data/admin/fred_banking/lkg/monthly.json",
      "data/admin/fred_banking/lkg/quarterly.json",
      "data/macro/fred-banking-daily.json",
      "data/macro/fred-banking-weekly.json",
      "data/macro/fred-banking-monthly.json",
      "data/macro/fred-banking-quarterly.json",
      "100xfenok-next/public/data/macro/fred-banking-daily.json",
      "100xfenok-next/public/data/macro/fred-banking-weekly.json",
      "100xfenok-next/public/data/macro/fred-banking-monthly.json",
      "100xfenok-next/public/data/macro/fred-banking-quarterly.json",
    ],
    recovery_store: "data/admin/fred_banking/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fred_yardeni",
    label: "Feno Yardeni model (FRED WAAA/WBAA)",
    owner_workflow: ".github/workflows/fetch-fred-yardeni.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "weekly", provider: "fred weekly (Friday observations)" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/fred_yardeni",
    detection_attempt: attemptShard("fred_yardeni"),
    canonical_outputs: ["data/yardney/yardney_model.json"],
    public_mirror: ["100xfenok-next/public/data/yardney/yardney_model.json"],
    commit_shards: [
      attemptShard("fred_yardeni"),
      "data/admin/fred_yardeni/index.json",
      "data/admin/fred_yardeni/current/yardney_model.json",
      "data/admin/fred_yardeni/lkg/yardney_model.json",
      "data/yardney/yardney_model.json",
      "100xfenok-next/public/data/yardney/yardney_model.json",
    ],
    recovery_store: "data/admin/fred_yardeni/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "fdic_tier1",
    label: "FDIC Tier-1",
    owner_workflow: ".github/workflows/fetch-fdic.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "quarterly", provider: "fdic (first-Monday cron)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/fdic_tier1",
    detection_attempt: attemptShard("fdic_tier1"),
    canonical_outputs: ["data/macro/fdic-tier1.json"],
    public_mirror: ["100xfenok-next/public/data/macro/fdic-tier1.json"],
    commit_shards: [
      attemptShard("fdic_tier1"),
      "data/admin/fdic_tier1/index.json",
      "data/admin/fdic_tier1/lkg/fdic_tier1.json",
      "data/macro/fdic-tier1.json",
      "100xfenok-next/public/data/macro/fdic-tier1.json",
    ],
    recovery_store: "data/admin/fdic_tier1/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "treasury_tga",
    label: "Treasury FiscalData TGA",
    owner_workflow: ".github/workflows/fetch-treasury-tga.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "fiscaldata.treasury.gov" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/treasury_tga",
    detection_attempt: attemptShard("treasury_tga"),
    canonical_outputs: ["data/macro/tga.json"],
    public_mirror: ["100xfenok-next/public/data/macro/tga.json"],
    commit_shards: [
      attemptShard("treasury_tga"),
      "data/admin/treasury_tga/index.json",
      "data/admin/treasury_tga/lkg/tga.json",
      "data/macro/tga.json",
      "100xfenok-next/public/data/macro/tga.json",
    ],
    recovery_store: "data/admin/treasury_tga/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "defillama_stablecoins",
    label: "DefiLlama stablecoins",
    owner_workflow: ".github/workflows/fetch-defillama.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "defillama" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/defillama_stablecoins",
    detection_attempt: attemptShard("defillama_stablecoins"),
    canonical_outputs: ["data/macro/stablecoins.json"],
    public_mirror: ["100xfenok-next/public/data/macro/stablecoins.json"],
    commit_shards: [
      attemptShard("defillama_stablecoins"),
      "data/admin/defillama_stablecoins/index.json",
      "data/admin/defillama_stablecoins/lkg/stablecoins.json",
      "data/macro/stablecoins.json",
      "100xfenok-next/public/data/macro/stablecoins.json",
    ],
    recovery_store: "data/admin/defillama_stablecoins/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "yahoo_etf_fallback",
    label: "Yahoo ETF fallback candidate",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "yahoo/stockanalysis (shared workflow)" },
    enforcement: "live",
    // privacy_class describes ADMIN-STORE routing (what EXCLUDED_PUBLIC_DATA_ROOTS
    // withholds): the shared StockAnalysis store syncs to public today. The lane's
    // private canonical (data/yf/etf-details) is withheld separately — visible in
    // roots.public_mirror being empty — outside this gate's admin/* scope.
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("yahoo_etf_fallback"),
    canonical_outputs: ["data/yf/etf-details"],
    public_mirror: [],
    commit_shards: [
      attemptShard("yahoo_etf_fallback"),
      "data/yf/etf-details",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with stockanalysis_etf_universe, stockanalysis_stock_financial, and stockanalysis_surfaces (store is multi-kind: stock/financial/surface/universe)",
  }),
  record({
    id: "stockanalysis_etf_universe",
    label: "StockAnalysis ETF universe",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "stockanalysis (shared workflow)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_etf_universe"),
    canonical_outputs: ["data/stockanalysis/etf_universe.json"],
    public_mirror: ["100xfenok-next/public/data/stockanalysis/etf_universe.json"],
    commit_shards: [
      attemptShard("stockanalysis_etf_universe"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with yahoo_etf_fallback, stockanalysis_stock_financial, and stockanalysis_surfaces (store is multi-kind: stock/financial/surface/universe)",
  }),
  record({
    id: "stockanalysis_stock_financial",
    label: "StockAnalysis bounded stock and financial pairs",
    owner_workflow: ".github/workflows/fetch-stockanalysis.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "stockanalysis (bounded 8-pair shared workflow schedule)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_stock_financial"),
    canonical_outputs: ["data/stockanalysis/stocks", "data/stockanalysis/financials"],
    public_mirror: [
      "100xfenok-next/public/data/stockanalysis/stocks",
      "100xfenok-next/public/data/stockanalysis/financials",
    ],
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
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "stockanalysis (shared workflow surface schedules)" },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: "data/admin/stockanalysis-recovery",
    detection_attempt: attemptShard("stockanalysis_surfaces"),
    canonical_outputs: ["data/stockanalysis/surfaces/index.json"],
    public_mirror: ["100xfenok-next/public/data/stockanalysis/surfaces/index.json"],
    commit_shards: [
      attemptShard("stockanalysis_surfaces"),
      "data/stockanalysis",
      "data/admin/stockanalysis-recovery",
    ],
    recovery_store: "data/admin/stockanalysis-recovery/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "shares the StockAnalysis recovery store with yahoo_etf_fallback, stockanalysis_etf_universe, and stockanalysis_stock_financial (store is multi-kind: stock/financial/surface/universe)",
  }),
  record({
    id: "yahoo_ticker_macro",
    label: "Yahoo hourly ticker snapshot",
    owner_workflow: ".github/workflows/fetch-yahoo-ticker.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "hourly", provider: "yahoo (TQQQ/SOXL keys)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/yahoo-hourly-ticker",
    detection_attempt: attemptShard("yahoo_ticker_macro"),
    canonical_outputs: ["data/macro/yahoo-ticker.json"],
    public_mirror: ["100xfenok-next/public/data/macro/yahoo-ticker.json"],
    commit_shards: [
      attemptShard("yahoo_ticker_macro"),
      "data/admin/yahoo-hourly-ticker",
      "data/macro/yahoo-ticker.json",
      "100xfenok-next/public/data/macro/yahoo-ticker.json",
    ],
    recovery_store: "data/admin/yahoo-hourly-ticker/index.json",
    kpi_recovery_shape: "keyed_v2",
    declared_exception: "producer-lkg-index/v2 keyed store (keys/TQQQ.json, keys/SOXL.json), projected via the KPI detectionRecovery map",
  }),
  record({
    id: "sentiment",
    label: "Sentiment bundle (CNN/VIX/MOVE/CFTC/crypto)",
    owner_workflow: ".github/workflows/fetch-sentiment.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "multi-source sentiment" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/sentiment",
    detection_attempt: attemptShard("sentiment"),
    canonical_outputs: ["data/sentiment"],
    public_mirror: ["100xfenok-next/public/data/sentiment"],
    commit_shards: [
      attemptShard("sentiment"),
      "data/admin/sentiment/index.json",
      "data/admin/sentiment/current",
      "data/admin/sentiment/lkg",
      "data/sentiment",
      "100xfenok-next/public/data/sentiment",
    ],
    recovery_store: "data/admin/sentiment/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "nasdaq_giw_sox",
    label: "Nasdaq GIW SOX constituents",
    owner_workflow: ".github/workflows/fetch-nasdaq-giw-sox.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "nasdaq GIW (us_trading_days)" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/nasdaq_giw_sox",
    detection_attempt: attemptShard("nasdaq_giw_sox"),
    canonical_outputs: ["data/indices/nasdaq-giw-sox-constituents.json"],
    public_mirror: ["100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json"],
    commit_shards: [
      attemptShard("nasdaq_giw_sox"),
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
    label: "US index daily close (S&P 500 / NASDAQ)",
    owner_workflow: ".github/workflows/fetch-us-indices-daily.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "yahoo chart v8 (^GSPC/^IXIC, us_trading_days)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/us-indices-daily",
    detection_attempt: attemptShard("us_indices_daily"),
    canonical_outputs: [
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
    ],
    public_mirror: [
      "100xfenok-next/public/data/indices/sp500.json",
      "100xfenok-next/public/data/indices/nasdaq.json",
    ],
    commit_shards: [
      attemptShard("us_indices_daily"),
      "data/admin/us-indices-daily",
      "data/indices/sp500.json",
      "data/indices/nasdaq.json",
      "100xfenok-next/public/data/indices/sp500.json",
      "100xfenok-next/public/data/indices/nasdaq.json",
    ],
    recovery_store: "data/admin/us-indices-daily/index.json",
    kpi_recovery_shape: "keyed_v2",
    script_sources: ["scripts/fetch-us-indices-daily.mjs", "scripts/check-us-indices-parity.mjs"],
  }),
  record({
    id: "oecd_cli",
    label: "OECD composite leading indicators",
    owner_workflow: ".github/workflows/fetch-oecd-cli.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "monthly", provider: "OECD SDMX DF_CLI" },
    enforcement: "shadow",
    privacy_class: "private",
    admin_store: "data/admin/oecd_cli",
    detection_attempt: attemptShard("oecd_cli"),
    canonical_outputs: ["data/admin/oecd_cli/shadow/oecd-cli.json"],
    public_mirror: [],
    commit_shards: [attemptShard("oecd_cli"), "data/admin/oecd_cli/shadow/oecd-cli.json", "data/admin/oecd_cli/parity-report.json"],
    recovery_store: null,
    declared_exception: "admin-only shadow until composite activity-surveys ownership and OECD redistribution terms are resolved",
    script_sources: ["scripts/fetch-oecd-cli.mjs"],
  }),
  record({
    id: "krx",
    label: "KRX Open API daily",
    owner_workflow: ".github/workflows/fenok-edge-krx-daily.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "KRX Open API (Korea trading days)" },
    enforcement: "shadow",
    privacy_class: "public_safe_aggregate",
    admin_store: "data/admin/fenok-edge-korea-krx",
    detection_attempt: attemptShard("krx"),
    canonical_outputs: [
      "data/admin/fenok-edge-korea-krx-daily-index.json",
      "data/computed/fenok-edge-korea-krx-index-daily.json",
      "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    ],
    public_mirror: ["100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json"],
    commit_shards: [
      attemptShard("krx"),
      "data/admin/fenok-edge-korea-krx-daily-index.json",
      "data/computed/fenok-edge-korea-krx-index-daily.json",
      "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    ],
    recovery_store: null,
    declared_exception: "emitter-first shadow lane; promote only after a natural workflow run commits valid attempt evidence",
    script_sources: ["scripts/fetch-fenok-krx-daily-private.mjs", "scripts/emit-fenok-krx-attempt.mjs"],
  }),
  record({
    id: "slickcharts",
    label: "SlickCharts daily delivery (composite lane)",
    owner_workflow: ".github/workflows/slickcharts-daily.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "slickcharts (us_trading_days)" },
    enforcement: "live",
    privacy_class: "public_mirror",
    admin_store: "data/admin/slickcharts-daily-delivery",
    detection_attempt: attemptShard("slickcharts"),
    canonical_outputs: [
      "data/slickcharts/gainers.json",
      "data/slickcharts/losers.json",
      "data/slickcharts/treasury.json",
      "data/slickcharts/currency.json",
      "data/slickcharts/mortgage.json",
    ],
    public_mirror: ["100xfenok-next/public/data/slickcharts"],
    commit_shards: [
      attemptShard("slickcharts"),
      "data/admin/slickcharts-daily-delivery",
      "data/slickcharts/gainers.json",
      "data/slickcharts/losers.json",
      "data/slickcharts/treasury.json",
      "data/slickcharts/currency.json",
      "data/slickcharts/mortgage.json",
    ],
    recovery_store: "data/admin/slickcharts-daily-delivery/index.json",
    kpi_recovery_shape: "keyed_v2",
    declared_exception: "producer-lkg-index/v2 keyed store (5 delivery keys), committed via scripts/publish-slickcharts-attempt.sh; projected via the KPI detectionRecovery map",
    // Script-side publisher: the commit allowlist lives in the publish script,
    // not the workflow YAML. slickcharts-daily is the primary owner and commits
    // the full admin store; the other four members share the same lane and
    // commit only their merged attempt-shard row via the same script.
    script_sources: ["scripts/publish-slickcharts-attempt.sh"],
    caller_workflows: Object.fromEntries(
      ["weekly", "monthly", "history", "symbols"].map((member) => [
        `.github/workflows/slickcharts-${member}.yml`,
        {
          commit_shards: ["data/admin/data-supply-state/detection-attempts/slickcharts.json"],
          script_sources: ["scripts/publish-slickcharts-attempt.sh"],
        },
      ]),
    ),
  }),
  record({
    id: "edgar_filings",
    label: "SEC EDGAR filing timeline",
    owner_workflow: ".github/workflows/fetch-edgar-filings.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "weekly", provider: "sec edgar (Monday 00:40Z poll)" },
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
      "data/admin/edgar_filings/index.json",
      "data/admin/edgar_filings/current/edgar_filings.json",
      "data/admin/edgar_filings/lkg/edgar_filings.json",
      "data/edgar",
      "data/edgar-korean-summaries",
      "100xfenok-next/public/data/edgar-korean-summaries",
    ],
    recovery_store: "data/admin/edgar_filings/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "sec_13f",
    label: "SEC 13F (ownerless artifact lane)",
    owner_workflow: null,
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: { kind: "quarterly", provider: "sec 13f" },
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
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provider: "owner-run fenok-benchmarks converter",
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
    store_kind: "artifact_only",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provider: "owner-run global-scouter converter",
      provenance: { kind: "payload_field", evidence: "/update_frequency" },
    },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: null,
    detection_attempt: null,
    canonical_outputs: ["data/global-scouter/core/metadata.json"],
    public_mirror: ["100xfenok-next/public/data/global-scouter/core/metadata.json"],
    commit_shards: [],
    recovery_store: null,
    declared_exception: "external owner-run converter has no GitHub attempt shard; cadence is evidenced by canonical metadata",
  }),
  record({
    id: "damodaran",
    label: "Damodaran valuation data",
    owner_workflow: ".github/workflows/fetch-damodaran-shadow.yml",
    store_kind: "payload",
    lane_class: "detection_floor",
    cadence: {
      kind: "weekly",
      provider: "NYU Stern Damodaran owner guard",
      provenance: { kind: "github_workflow", evidence: ".github/workflows/fetch-damodaran-shadow.yml" },
    },
    // Registry enforcement is the detection-floor switch, not producer
    // ownership. This shadow lane has a fail-closed owner guard instead.
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: "data/admin/damodaran",
    detection_attempt: null,
    canonical_outputs: [
      "data/damodaran/industries.json",
      "data/damodaran/historical_erp.json",
      "data/damodaran/credit_ratings.json",
      "data/damodaran/erp.json",
      "data/damodaran/industry_metrics.json",
      "data/damodaran/industry_metrics_regions.json",
    ],
    public_mirror: [
      "100xfenok-next/public/data/damodaran/industries.json",
      "100xfenok-next/public/data/damodaran/historical_erp.json",
      "100xfenok-next/public/data/damodaran/credit_ratings.json",
      "100xfenok-next/public/data/damodaran/erp.json",
      "100xfenok-next/public/data/damodaran/industry_metrics.json",
      "100xfenok-next/public/data/damodaran/industry_metrics_regions.json",
    ],
    commit_shards: [
      "data/admin/damodaran/owner-guard.json",
      "data/damodaran/industries.json",
      "data/damodaran/historical_erp.json",
      "data/damodaran/credit_ratings.json",
      "data/damodaran/erp.json",
      "data/damodaran/industry_metrics.json",
      "data/damodaran/industry_metrics_regions.json",
      "100xfenok-next/public/data/damodaran/industries.json",
      "100xfenok-next/public/data/damodaran/historical_erp.json",
      "100xfenok-next/public/data/damodaran/credit_ratings.json",
      "100xfenok-next/public/data/damodaran/erp.json",
      "100xfenok-next/public/data/damodaran/industry_metrics.json",
      "100xfenok-next/public/data/damodaran/industry_metrics_regions.json",
    ],
    recovery_store: null,
    declared_exception: "owner-guard honesty store has no LKG promotion path; exact six-file producer and canonical/public parity are fail-closed",
    script_sources: ["scripts/fetch-damodaran-shadow.mjs"],
  }),
  record({
    id: "finra_short_volume",
    label: "FINRA RegSHO daily short volume",
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "finra (us_trading_days)" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/finra_short_volume",
    detection_attempt: attemptShard("finra_short_volume"),
    canonical_outputs: ["data/admin/finra_short_volume/current/regsho_daily.json"],
    public_mirror: [],
    commit_shards: [
      attemptShard("finra_short_volume"),
      "data/admin/finra_short_volume/index.json",
      "data/admin/finra_short_volume/current/regsho_daily.json",
      "data/admin/finra_short_volume/lkg/regsho_daily.json",
      "data/admin/finra_short_volume/history/regsho_daily.json",
    ],
    recovery_store: "data/admin/finra_short_volume/index.json",
    kpi_recovery_shape: "general",
  }),
  record({
    id: "occ_options_volume",
    label: "OCC options volume",
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "occ (us_trading_days)" },
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
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "yahoo finance targeted options (us_trading_days)" },
    enforcement: "live",
    privacy_class: "private",
    admin_store: "data/admin/yahoo_private_options",
    detection_attempt: attemptShard("yahoo_private_options"),
    canonical_outputs: ["data/computed/fenok_yahoo_private_options_availability.json"],
    public_mirror: ["100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json"],
    commit_shards: [
      attemptShard("yahoo_private_options"),
      "data/admin/yahoo_private_options",
      "data/computed/fenok_yahoo_private_options_availability.json",
      "100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json",
    ],
    recovery_store: "data/admin/yahoo_private_options/index.json",
    kpi_recovery_shape: "general",
    declared_exception: "promoted live after natural schedule run 29801392365 committed the complete targeted allowlist attempt shard and fresh_primary provider observation",
  }),
  record({
    id: "apewisdom_attention",
    label: "ApeWisdom attention proxy",
    // Owned shard-only producer (#366 wiring). No LKG recovery store: the proxy
    // recomputes derived attention scores from the live ApeWisdom aggregate each
    // run, so there is no upstream payload to promote — republishing a stale
    // computed file as "recovery" would serve stale attention as current. The
    // honest attempt shard is the detection-floor evidence; admin_store is
    // reserved (private-withheld) for future recovery state. Flip evidence:
    // committed shard 06df6f18be from scheduled run 29691115685 (DEC-266).
    owner_workflow: ".github/workflows/fetch-fenok-apewisdom.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "apewisdom" },
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
      "data/computed/fenok_social_attention_proxy.json",
      "data/computed/fenok_social_attention_proxy_history.json",
    ],
    recovery_store: null,
  }),
  record({
    id: "gdelt_news_tone",
    label: "GDELT news tone proxy",
    // Owned shard-only producer (#366 wiring). Shard-only for the same reason as
    // apewisdom_attention: the tone proxy recomputes from live GDELT headlines
    // each run. See that lane's note.
    owner_workflow: ".github/workflows/fetch-fenok-news-tone.yml",
    store_kind: "marker",
    lane_class: "detection_floor",
    cadence: { kind: "daily", provider: "gdelt" },
    enforcement: "shadow",
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
      "data/computed/fenok_news_tone_proxy.json",
      "data/computed/fenok_news_tone_proxy_history.json",
    ],
    recovery_store: null,
  }),
  record({
    id: "yahoo_batch_quote_history",
    label: "Yahoo batch quote/history",
    owner_workflow: ".github/workflows/fetch-yf-finance.yml",
    store_kind: "payload",
    lane_class: "auxiliary",
    cadence: { kind: "daily", provider: "yahoo" },
    enforcement: "shadow",
    privacy_class: "public_mirror",
    admin_store: "data/admin/yahoo-batch-quote-history",
    detection_attempt: null,
    canonical_outputs: [],
    public_mirror: [],
    commit_shards: ["data/admin/yahoo-batch-quote-history"],
    recovery_store: "data/admin/yahoo-batch-quote-history/index.json",
    kpi_recovery_shape: "direct",
    declared_exception: "not a detection-floor lane; KPI surfaces it as a warn-only base lane (pre-existing 2026-05-06 staleness)",
  }),
];

// Declared exceptions for data/admin entries that are NOT lane stores
// (DEC-266 discipline: statically declared, never runtime-inferred).
const declared_exceptions = [
  {
    path: "data/admin/data-supply-state",
    kind: "root",
    reason: "shared detection-floor state root (attempt shards + provider-observation objects); not a lane store",
    owner: "detection-floor",
  },
  {
    path: "data/yf/migration-evidence",
    kind: "root",
    reason: "legacy Yahoo-migration evidence root, admin-private; not a lane store",
    owner: "platform",
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
      commitSpec("data/slickcharts/sp500.json", "file", true),
      commitSpec("data/slickcharts/magnificent7.json", "file", true),
      commitSpec("data/slickcharts/etf.json", "file", true),
      commitSpec("data/slickcharts/berkshire.json", "file", true),
    ],
  }),
  ".github/workflows/slickcharts-symbols.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
      commitSpec("data/slickcharts/symbols.json", "file", true),
    ],
  }),
  ".github/workflows/slickcharts-history.yml": policy(["slickcharts"], {
    always_if_exists: [
      commitSpec("data/admin/data-supply-state/detection-attempts/slickcharts.json", "file"),
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
workflow_policies[".github/workflows/fetch-defillama.yml"] = policy(["defillama_stablecoins"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/defillama_stablecoins.json", "file"),
    commitSpec("data/admin/defillama_stablecoins/index.json", "file"),
    commitSpec("data/admin/defillama_stablecoins/lkg/stablecoins.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/macro/stablecoins.json", "file", true),
    commitSpec("100xfenok-next/public/data/macro/stablecoins.json", "file", true),
  ],
});
workflow_policies[".github/workflows/fetch-fenok-apewisdom.yml"] = policy(["apewisdom_attention"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/apewisdom_attention.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/computed/fenok_social_attention_proxy.json", "file"),
    commitSpec("data/computed/fenok_social_attention_proxy_history.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-fenok-news-tone.yml"] = policy(["gdelt_news_tone"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/gdelt_news_tone.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/computed/fenok_news_tone_proxy.json", "file"),
    commitSpec("data/computed/fenok_news_tone_proxy_history.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-sentiment.yml"] = policy(["sentiment"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/sentiment.json", "file"),
    commitSpec("data/admin/sentiment/index.json", "file"),
    commitSpec("data/admin/sentiment/current/*.json", "glob"),
    commitSpec("data/admin/sentiment/lkg/*.json", "glob"),
  ],
  success_if_exists: [
    commitSpec("data/sentiment/*.json", "glob"),
    commitSpec("100xfenok-next/public/data/sentiment/*.json", "glob"),
  ],
});
workflow_policies[".github/workflows/fetch-us-indices-daily.yml"] = policy(["us_indices_daily"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/us_indices_daily.json", "file"),
    commitSpec("data/admin/us-indices-daily", "directory"),
  ],
  success_if_exists: [
    commitSpec("data/indices/sp500.json", "file"),
    commitSpec("data/indices/nasdaq.json", "file"),
    commitSpec("100xfenok-next/public/data/indices/sp500.json", "file"),
    commitSpec("100xfenok-next/public/data/indices/nasdaq.json", "file"),
  ],
});
workflow_policies[".github/workflows/fetch-oecd-cli.yml"] = policy(["oecd_cli"], {
  always_if_exists: [commitSpec("data/admin/data-supply-state/detection-attempts/oecd_cli.json", "file")],
  success_if_exists: [
    commitSpec("data/admin/oecd_cli/shadow/oecd-cli.json", "file"),
    commitSpec("data/admin/oecd_cli/parity-report.json", "file"),
  ],
});
workflow_policies[".github/workflows/fenok-edge-daily.yml"] = policy(["finra_short_volume", "occ_options_volume"], {
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
workflow_policies[".github/workflows/fetch-yf-finance.yml"] = policy(["yahoo_batch_quote_history"], {
  always_if_exists: [
    commitSpec("data/yf/finance", "directory", true),
    commitSpec("data/yf/quarter_closes.json", "file", true),
    commitSpec("data/admin/yahoo-batch-quote-history", "directory", true),
    commitSpec("100xfenok-next/public/data/yf/quarter_closes.json", "file", true),
  ],
}, [commitSpec("data/yf/finance/_summary.json", "file")]);
workflow_policies[".github/workflows/fetch-stockanalysis.yml"] = policy(["yahoo_etf_fallback", "stockanalysis_etf_universe", "stockanalysis_stock_financial", "stockanalysis_surfaces"], {
  always_if_exists: [
    commitSpec("data/stockanalysis", "directory", true),
    commitSpec("data/yf/etf-details", "directory", true),
    commitSpec("data/admin/data-supply-state/v1", "directory", true),
    commitSpec("data/admin/stockanalysis-recovery", "directory", true),
    commitSpec("data/admin/data-supply-state/detection-attempts/yahoo_etf_fallback.json", "file"),
    commitSpec("data/admin/data-supply-state/detection-attempts/stockanalysis_etf_universe.json", "file"),
    commitSpec("data/admin/data-supply-state/detection-attempts/stockanalysis_stock_financial.json", "file"),
    commitSpec("data/admin/data-supply-state/detection-attempts/stockanalysis_surfaces.json", "file"),
    commitSpec("data/yf/finance", "dynamic_set"),
  ],
}, [
  commitSpec("data/stockanalysis/backfill/history_gap_report_latest.json", "file"),
  commitSpec("data/yf/finance/_summary.json", "file"),
]);
workflow_policies[".github/workflows/fenok-edge-krx-daily.yml"] = policy(["krx"], {
  always_if_exists: [
    commitSpec("data/admin/data-supply-state/detection-attempts/krx.json", "file"),
  ],
  success_if_exists: [
    commitSpec("data/admin/fenok-edge-korea-krx-daily-index.json", "file", true),
    // Slice 1 public-safe aggregate index closes (owner grant 2026-07-19).
    commitSpec("data/computed/fenok-edge-korea-krx-index-daily.json", "file", true),
    // Slice 2 public-safe KOSDAQ top-10 market-cap aggregate; no issuer rows.
    commitSpec("data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json", "file", true),
  ],
});
workflow_policies[".github/workflows/fetch-damodaran-shadow.yml"] = policy(["damodaran"], {
  required_on_success: [
    commitSpec("data/admin/damodaran/owner-guard.json", "file", true),
    ...[
      "industries.json",
      "historical_erp.json",
      "credit_ratings.json",
      "erp.json",
      "industry_metrics.json",
      "industry_metrics_regions.json",
    ].flatMap((file) => [
      commitSpec(`data/damodaran/${file}`, "file", true),
      commitSpec(`100xfenok-next/public/data/damodaran/${file}`, "file", true),
    ]),
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
      "100xfenok-next/public/data/calendar/prev-values.json",
      "100xfenok-next/public/data/global-scouter/core/revision_movers.json",
      "100xfenok-next/public/data/damodaran/industry_benchmarks.json",
      "100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json",
      "100xfenok-next/public/data/global-scouter/core/per_bands_index.json",
      "100xfenok-next/public/data/global-scouter/core/slick_index.json",
      "100xfenok-next/public/data/global-scouter/README.md",
      "100xfenok-next/public/data/global-scouter/schema.json",
      "100xfenok-next/public/data/sec-13f/by_ticker.json",
      "100xfenok-next/public/data/sec-13f/by_sector.json",
      "100xfenok-next/public/data/sec-13f/summary.json",
      "100xfenok-next/public/data/sec-13f/analytics/consensus.json",
      "100xfenok-next/public/data/sec-13f/analytics/ticker_aliases.json",
      "100xfenok-next/public/data/sec-13f/analytics/trades_ranking.json",
      "100xfenok-next/public/data/sec-13f/analytics/portfolio_views.json",
      "100xfenok-next/public/data/sec-13f/analytics/guru_holders_index.json",
      "100xfenok-next/public/data/sec-13f/investors/*.json",
    ].map((pathValue) => commitSpec(pathValue, pathKind(pathValue))),
  ],
}, [commitSpec("100xfenok-next/public/data/sec-13f/investors/griffin.json", "file")]);
workflow_policies[".github/workflows/pipeline-failure-alarm.yml"] = policy([], {
  always_if_exists: [
    commitSpec("data/admin/alarm-state.json", "file"),
    commitSpec("100xfenok-next/public/data/admin/alarm-state.json", "file"),
  ],
});
workflow_policies[".github/workflows/update-manifest.yml"] = policy([], {
  always_if_exists: [],
});

// --- Validation (fail-closed, mirrors the detection config's loader) ---------

const LANE_ID_RE = /^[a-z][a-z0-9_]{0,95}$/;
const LANE_RECORD_KEYS = Object.freeze([
  "id",
  "label",
  "owner_workflow",
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
const LANE_RECORD_OPTIONAL_KEYS = Object.freeze(["script_sources", "caller_workflows", "kpi_recovery_shape"]);

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
}

function validateLaneRecord(laneValue) {
  const context = `lane ${laneValue?.id ?? "<unknown>"}`;
  const expectedKeys = [
    ...LANE_RECORD_KEYS,
    ...LANE_RECORD_OPTIONAL_KEYS.filter((key) => Object.hasOwn(laneValue ?? {}, key)),
  ];
  exactKeys(laneValue, expectedKeys, context);
  if (!LANE_ID_RE.test(laneValue.id)) fail(`${context} id is invalid`);
  if (typeof laneValue.label !== "string" || laneValue.label.length === 0) fail(`${context} label is required`);
  if (laneValue.owner_workflow !== null
    && (typeof laneValue.owner_workflow !== "string" || !laneValue.owner_workflow.startsWith(".github/workflows/"))) {
    fail(`${context} owner_workflow must be null or a .github/workflows/ path`);
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
  if (typeof laneValue.cadence?.kind !== "string" || !CADENCE_KINDS.includes(laneValue.cadence.kind)) {
    fail(`${context} cadence.kind is invalid`);
  }
  if (laneValue.cadence.provider !== undefined && typeof laneValue.cadence.provider !== "string") {
    fail(`${context} cadence.provider must be a string when present`);
  }
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
  exactKeys(registry, ["schema_version", "lanes", "declared_exceptions", "workflow_classes", "workflow_policies"], "registry");
  if (registry.schema_version !== LANE_REGISTRY_SCHEMA) fail("schema_version is invalid");
  if (!Array.isArray(registry.lanes) || registry.lanes.length === 0) fail("lanes must be a non-empty array");
  const seenIds = new Set();
  for (const laneValue of registry.lanes) {
    validateLaneRecord(laneValue);
    if (seenIds.has(laneValue.id)) fail(`duplicate lane id ${laneValue.id}`);
    seenIds.add(laneValue.id);
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
