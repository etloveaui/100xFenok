// Derived/computed asset registry SSOT (BACKLOG #372).
//
// This registry declares every current top-level root under data/computed.
// Provider identity remains owned by lane-registry/v3: active derived assets
// must reach at least one registered lane through their typed input graph.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./json-canonical.mjs";
import { COMPUTED_SIGNALS_SOURCE_LANE_IDS, LANE_REGISTRY } from "./lane-registry.mjs";

export const DERIVED_ASSET_REGISTRY_SCHEMA = "derived-asset-registry/v1";
export const DERIVED_ASSET_LIFECYCLES = Object.freeze(["active", "orphaned"]);
export const DERIVED_INPUT_KINDS = Object.freeze(["lane", "asset", "prior_asset", "path"]);
export const DERIVED_OUTPUT_KINDS = Object.freeze(["file", "directory"]);
export const DERIVED_CADENCE_KINDS = Object.freeze([
  "twice_daily",
  "daily",
  "market_weekdays",
  "build_time",
  "orphaned",
]);
export const DERIVED_RETENTION_KINDS = Object.freeze([
  "snapshot",
  "bounded_history",
  "unbounded_history",
  "generations",
  "orphaned",
]);
export const DERIVED_RECOVERY_KINDS = Object.freeze([
  "rebuild_from_inputs",
  "lane_lkg",
  "generation_store",
  "none",
]);
export const DERIVED_PRIVACY_CLASSES = Object.freeze([
  "private",
  "public_mirror",
  "public_safe_aggregate",
]);
export const DERIVED_PUBLIC_SERVING_STATUSES = Object.freeze([
  "private",
  "active",
  "missing_projection",
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const ID_RE = /^[a-z][a-z0-9_]{0,95}$/;

export const DERIVED_WRITER_RECOVERY_CONTRACTS = Object.freeze({
  "scripts/audit-market-data.py": "rebuild_from_inputs",
  "scripts/build-data-entity-graph.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-etf-action-index.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-etf-core-daily-basket.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-etf-signals.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-flow-proxies.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-rim-index.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-signal-lens-proxies.mjs": "rebuild_from_inputs",
  "scripts/build-fenok-signals.mjs": "rebuild_from_inputs",
  "scripts/build-market-facts.py": "rebuild_from_inputs",
  "scripts/build-market-source-parity.py": "rebuild_from_inputs",
  "scripts/build-phase2-closeout-indexes.mjs": "rebuild_from_inputs",
  "scripts/build-rim-index.mjs": "rebuild_from_inputs",
  "scripts/export-computed-signals.mjs": "rebuild_from_inputs",
  "scripts/fetch-fenok-apewisdom-attention-proxy.mjs": "lane_lkg",
  "scripts/fetch-fenok-krx-daily-private.mjs": "lane_lkg",
  "scripts/fetch-fenok-news-tone-proxy.mjs": "lane_lkg",
  "scripts/fetch-fenok-occ-options-volume.mjs": "lane_lkg",
  "scripts/materialize_data_supply_public.py": "generation_store",
  "scripts/run-fenok-private-options.mjs": "lane_lkg",
});

function fail(message) {
  throw new Error(`derived-asset-registry: ${message}`);
}

function output(pathValue, kind = "file") {
  return { path: pathValue, kind };
}

function input(kind, ref) {
  return { kind, ref };
}

const lane = (id) => input("lane", id);
const derived = (id) => input("asset", id);
const prior = (id) => input("prior_asset", id);
const repoPath = (pathValue) => input("path", pathValue);

function cadence(kind, scheduledRunsPerDay, eventDriven, evidence) {
  return {
    kind,
    scheduled_runs_per_day: scheduledRunsPerDay,
    event_driven: eventDriven,
    evidence,
  };
}

const TWICE_DAILY = cadence("twice_daily", 2, true, ".github/workflows/update-manifest.yml");
const EDGE_DAILY = cadence("market_weekdays", 1, true, ".github/workflows/fenok-edge-daily.yml");
const KRX_DAILY = cadence("market_weekdays", 1, true, ".github/workflows/fenok-edge-krx-daily.yml");
const NEWS_DAILY = cadence("daily", 1, true, ".github/workflows/fetch-fenok-news-tone.yml");
const SOCIAL_DAILY = cadence("daily", 1, true, ".github/workflows/fetch-fenok-apewisdom.yml");
const OPTIONS_DAILY = cadence("market_weekdays", 1, true, ".github/workflows/fetch-fenok-private-options.yml");
const STOCKS_ANALYZER_DAILY = cadence("daily", 1, true, ".github/workflows/build-stocks-analyzer.yml");
const BUILD_TIME = cadence("build_time", 0, true, "100xfenok-next/package.json");
const ORPHANED = cadence("orphaned", 0, false, null);

const SNAPSHOT = Object.freeze({ kind: "snapshot", max_items: 1, basis: "current_version" });
const UNBOUNDED_DATES = Object.freeze({ kind: "unbounded_history", max_items: null, basis: "source_dates" });
const ORPHANED_RETENTION = Object.freeze({ kind: "orphaned", max_items: null, basis: "unknown" });
const boundedDates = (maxItems) => ({ kind: "bounded_history", max_items: maxItems, basis: "source_dates" });

function asset({
  id,
  label,
  outputs,
  owner_workflow,
  writer,
  inputs,
  cadence: cadenceValue,
  privacy_class,
  public_outputs,
  public_serving_status = privacy_class === "private" ? "private" : "active",
  retention,
  recovery,
  recovery_evidence = recovery === "none"
    ? null
    : recovery === "generation_store"
      ? "scripts/data_supply_state.py"
      : recovery === "lane_lkg"
        ? "scripts/lib/lane-registry.mjs"
        : writer,
  lifecycle = "active",
}) {
  return {
    id,
    label,
    lifecycle,
    outputs,
    owner_workflow,
    writer,
    inputs,
    cadence: cadenceValue,
    privacy_class,
    public_outputs,
    public_serving_status,
    retention,
    recovery,
    recovery_evidence,
  };
}

const assets = [
  asset({
    id: "entity_graph",
    label: "Data entity graph and stock indexes",
    outputs: [
      output("data/computed/entity_graph.json"),
      output("data/computed/entity_graph_stock_index.json"),
      output("data/computed/entity_graph_stock_services.json"),
    ],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-data-entity-graph.mjs",
    inputs: [
      lane("global_scouter"),
      lane("sec_13f"),
      lane("stockanalysis_etf_universe"),
      derived("stock_action_index"),
      derived("market_facts"),
      repoPath("data/edgar-korean-summaries"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [
      output("100xfenok-next/public/data/computed/entity_graph.json"),
      output("100xfenok-next/public/data/computed/entity_graph_stock_index.json"),
      output("100xfenok-next/public/data/computed/entity_graph_stock_services.json"),
    ],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "etf_action_index",
    label: "Private ETF action index",
    outputs: [output("data/computed/etf_action_index.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-etf-action-index.mjs",
    inputs: [derived("fenok_etf_signals_summary")],
    cadence: TWICE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "krx_bridge_history",
    label: "KRX public-safe bridge history",
    outputs: [output("data/computed/fenok-edge-korea-krx-bridge-history.json")],
    owner_workflow: ".github/workflows/fenok-edge-krx-daily.yml",
    writer: "scripts/fetch-fenok-krx-daily-private.mjs",
    inputs: [lane("krx")],
    cadence: KRX_DAILY,
    privacy_class: "public_safe_aggregate",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok-edge-korea-krx-bridge-history.json")],
    retention: boundedDates(100),
    recovery: "lane_lkg",
  }),
  asset({
    id: "krx_market_snapshots",
    label: "KRX index and KOSDAQ aggregate snapshots",
    outputs: [
      output("data/computed/fenok-edge-korea-krx-index-daily.json"),
      output("data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"),
    ],
    owner_workflow: ".github/workflows/fenok-edge-krx-daily.yml",
    writer: "scripts/fetch-fenok-krx-daily-private.mjs",
    inputs: [lane("krx")],
    cadence: KRX_DAILY,
    privacy_class: "public_safe_aggregate",
    public_outputs: [
      output("100xfenok-next/public/data/computed/fenok-edge-korea-krx-index-daily.json"),
      output("100xfenok-next/public/data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"),
    ],
    public_serving_status: "active",
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_etf_core_daily_basket_summary",
    label: "ETF core daily basket summary",
    outputs: [output("data/computed/fenok_etf_core_daily_basket_summary.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-etf-core-daily-basket.mjs",
    inputs: [
      lane("stockanalysis_etf_universe"),
      derived("fenok_etf_signals_summary"),
      derived("etf_action_index"),
      repoPath("data/admin/fenok-edge-etf-daily1y-readiness.json"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_etf_signals",
    label: "Private ETF signals",
    outputs: [output("data/computed/fenok_etf_signals.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-etf-signals.mjs",
    inputs: [
      lane("stockanalysis_etf_universe"),
      derived("market_facts"),
      derived("data_supply_etf_detail"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_etf_signals_summary",
    label: "Public ETF signal summary",
    outputs: [output("data/computed/fenok_etf_signals_summary.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-etf-signals.mjs",
    inputs: [derived("fenok_etf_signals")],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok_etf_signals_summary.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_flow_proxies",
    label: "Private flow proxy snapshot",
    outputs: [output("data/computed/fenok_flow_proxies.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/build-fenok-flow-proxies.mjs",
    inputs: [
      lane("finra_short_volume"),
      lane("yahoo_batch_quote_history"),
      prior("fenok_signals"),
    ],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_flow_proxies_history",
    label: "Private flow proxy history",
    outputs: [output("data/computed/fenok_flow_proxies_history.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/build-fenok-flow-proxies.mjs",
    inputs: [derived("fenok_flow_proxies")],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: UNBOUNDED_DATES,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_news_tone_proxy",
    label: "Private GDELT news tone proxy",
    outputs: [output("data/computed/fenok_news_tone_proxy.json")],
    owner_workflow: ".github/workflows/fetch-fenok-news-tone.yml",
    writer: "scripts/fetch-fenok-news-tone-proxy.mjs",
    inputs: [lane("gdelt_news_tone"), prior("fenok_signals")],
    cadence: NEWS_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_news_tone_proxy_history",
    label: "Private GDELT news tone history",
    outputs: [output("data/computed/fenok_news_tone_proxy_history.json")],
    owner_workflow: ".github/workflows/fetch-fenok-news-tone.yml",
    writer: "scripts/fetch-fenok-news-tone-proxy.mjs",
    inputs: [lane("gdelt_news_tone"), derived("fenok_news_tone_proxy")],
    cadence: NEWS_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: boundedDates(100),
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_occ_options_availability",
    label: "OCC public-safe availability marker",
    outputs: [output("data/computed/fenok_occ_options_availability.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/fetch-fenok-occ-options-volume.mjs",
    inputs: [lane("occ_options_volume"), prior("fenok_signals")],
    cadence: EDGE_DAILY,
    privacy_class: "public_safe_aggregate",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok_occ_options_availability.json")],
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_occ_options_volume",
    label: "Private OCC options volume",
    outputs: [output("data/computed/fenok_occ_options_volume.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/fetch-fenok-occ-options-volume.mjs",
    inputs: [lane("occ_options_volume"), prior("fenok_signals")],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_occ_options_volume_history",
    label: "Private OCC options volume history",
    outputs: [output("data/computed/fenok_occ_options_volume_history.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/fetch-fenok-occ-options-volume.mjs",
    inputs: [lane("occ_options_volume"), derived("fenok_occ_options_volume")],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: boundedDates(100),
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_signal_lens_proxies",
    label: "Private signal-lens proxy snapshot and summary",
    outputs: [
      output("data/computed/fenok_signal_lens_proxies.json"),
      output("data/computed/fenok_signal_lens_proxies_summary.json"),
    ],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/build-fenok-signal-lens-proxies.mjs",
    inputs: [
      lane("yahoo_ticker_macro"),
      prior("fenok_signals"),
      derived("fenok_flow_proxies"),
      derived("fenok_occ_options_volume"),
      derived("fenok_news_tone_proxy"),
    ],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_signal_lens_proxies_history",
    label: "Private signal-lens proxy history",
    outputs: [output("data/computed/fenok_signal_lens_proxies_history.json")],
    owner_workflow: ".github/workflows/fenok-edge-daily.yml",
    writer: "scripts/build-fenok-signal-lens-proxies.mjs",
    inputs: [derived("fenok_signal_lens_proxies")],
    cadence: EDGE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: UNBOUNDED_DATES,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_signals",
    label: "Private Fenok stock signals",
    outputs: [output("data/computed/fenok_signals.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-signals.mjs",
    inputs: [
      lane("stockanalysis_stock_financial"),
      lane("yahoo_batch_quote_history"),
      derived("stock_action_index"),
      derived("fenok_flow_proxies"),
      derived("fenok_occ_options_volume"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_signals_summary",
    label: "Public Fenok signal summary",
    outputs: [output("data/computed/fenok_signals_summary.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-fenok-signals.mjs",
    inputs: [derived("fenok_signals")],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok_signals_summary.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_social_attention_proxy",
    label: "Private ApeWisdom attention proxy",
    outputs: [output("data/computed/fenok_social_attention_proxy.json")],
    owner_workflow: ".github/workflows/fetch-fenok-apewisdom.yml",
    writer: "scripts/fetch-fenok-apewisdom-attention-proxy.mjs",
    inputs: [lane("apewisdom_attention")],
    cadence: SOCIAL_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_social_attention_proxy_history",
    label: "Private ApeWisdom attention history",
    outputs: [output("data/computed/fenok_social_attention_proxy_history.json")],
    owner_workflow: ".github/workflows/fetch-fenok-apewisdom.yml",
    writer: "scripts/fetch-fenok-apewisdom-attention-proxy.mjs",
    inputs: [lane("apewisdom_attention"), derived("fenok_social_attention_proxy")],
    cadence: SOCIAL_DAILY,
    privacy_class: "private",
    public_outputs: [],
    retention: boundedDates(100),
    recovery: "lane_lkg",
  }),
  asset({
    id: "fenok_yahoo_private_options_availability",
    label: "Yahoo private-options public-safe availability",
    outputs: [output("data/computed/fenok_yahoo_private_options_availability.json")],
    owner_workflow: ".github/workflows/fetch-fenok-private-options.yml",
    writer: "scripts/run-fenok-private-options.mjs",
    inputs: [lane("yahoo_private_options")],
    cadence: OPTIONS_DAILY,
    privacy_class: "public_safe_aggregate",
    public_outputs: [output("100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json")],
    retention: SNAPSHOT,
    recovery: "lane_lkg",
  }),
  asset({
    id: "market_data_audit",
    label: "Market data audit",
    outputs: [output("data/computed/market_data_audit.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/audit-market-data.py",
    inputs: [
      lane("stockanalysis_stock_financial"),
      derived("market_facts"),
      derived("market_source_parity"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/market_data_audit.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "market_source_parity",
    label: "Market source parity",
    outputs: [output("data/computed/market_source_parity.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-market-source-parity.py",
    inputs: [
      lane("stockanalysis_stock_financial"),
      lane("yahoo_batch_quote_history"),
      derived("market_facts"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/market_source_parity.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "market_structure_index",
    label: "Market structure index",
    outputs: [output("data/computed/market_structure_index.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-phase2-closeout-indexes.mjs",
    inputs: [
      lane("benchmarks"),
      lane("sentiment"),
      lane("slickcharts"),
      derived("signals"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/market_structure_index.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "signals",
    label: "Computed macro and sentiment signals",
    outputs: [output("data/computed/signals.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/export-computed-signals.mjs",
    inputs: COMPUTED_SIGNALS_SOURCE_LANE_IDS.map(lane),
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/signals.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "stock_action_index",
    label: "Stock action index",
    outputs: [output("data/computed/stock_action_index.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-phase2-closeout-indexes.mjs",
    inputs: [
      lane("global_scouter"),
      lane("sec_13f"),
      lane("slickcharts"),
      derived("market_facts"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/stock_action_index.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "stock_action_summary",
    label: "Stock action summary",
    outputs: [output("data/computed/stock_action_summary.json")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-phase2-closeout-indexes.mjs",
    inputs: [derived("stock_action_index")],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/stock_action_summary.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "taiwan_data_bridge_index",
    label: "Historical Taiwan data bridge index",
    outputs: [output("data/computed/taiwan-data-bridge-index.json")],
    owner_workflow: null,
    writer: null,
    inputs: [],
    cadence: ORPHANED,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/taiwan-data-bridge-index.json")],
    retention: ORPHANED_RETENTION,
    recovery: "none",
    lifecycle: "orphaned",
  }),
  asset({
    id: "data_supply_etf_detail",
    label: "Materialized ETF detail generation",
    outputs: [output("data/computed/data-supply", "directory")],
    owner_workflow: ".github/workflows/deploy-worker.yml",
    writer: "scripts/materialize_data_supply_public.py",
    inputs: [
      lane("stockanalysis_etf_universe"),
      lane("yahoo_etf_fallback"),
      repoPath("data/admin/data-supply-state"),
    ],
    cadence: BUILD_TIME,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/data-supply", "directory")],
    retention: { kind: "generations", max_items: 3, basis: "immutable_generations" },
    recovery: "generation_store",
  }),
  asset({
    id: "market_facts",
    label: "Per-entity market facts",
    outputs: [output("data/computed/market_facts", "directory")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-market-facts.py",
    inputs: [
      lane("stockanalysis_stock_financial"),
      lane("yahoo_batch_quote_history"),
      derived("data_supply_etf_detail"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/market_facts", "directory")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "fenok_rim",
    label: "Fenok RIM research and public projections",
    outputs: [output("data/computed/fenok-rim", "directory")],
    owner_workflow: ".github/workflows/build-stocks-analyzer.yml",
    writer: "scripts/build-fenok-rim-index.mjs",
    inputs: [
      lane("fred_macro"),
      lane("krx"),
      lane("nasdaq_giw_sox"),
      lane("yahoo_batch_quote_history"),
      derived("market_facts"),
    ],
    cadence: STOCKS_ANALYZER_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [
      output("100xfenok-next/public/data/computed/fenok-rim/fair-values.json"),
      output("100xfenok-next/public/data/computed/fenok-rim/payout-history.json"),
      output("100xfenok-next/public/data/computed/fenok-rim/sustainable-index-ranges.public.json"),
    ],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  asset({
    id: "rim_index",
    label: "RIM index input bundle",
    outputs: [output("data/computed/rim-index", "directory")],
    owner_workflow: ".github/workflows/update-manifest.yml",
    writer: "scripts/build-rim-index.mjs",
    inputs: [
      lane("fred_macro"),
      lane("krx"),
      lane("nasdaq_giw_sox"),
      lane("yahoo_batch_quote_history"),
      derived("market_facts"),
      derived("stock_action_index"),
      derived("signals"),
    ],
    cadence: TWICE_DAILY,
    privacy_class: "public_mirror",
    public_outputs: [output("100xfenok-next/public/data/computed/rim-index/inputs.json")],
    retention: SNAPSHOT,
    recovery: "rebuild_from_inputs",
  }),
  // Research records, never served. Both directories hold audit trails for retired or
  // quarantined work: frozen criteria, freeze receipts, adjudications and the red-team
  // re-derivations kept beside them. Nothing here is produced by a workflow and nothing
  // here may reach the public mirror -- the RIM public surface is a separate, redacted
  // projection that stays quarantined. Declared so the computed-root coverage check
  // passes; declaring them private is what keeps them out of the mirror.
  asset({
    id: "feno_rim_v2_research",
    label: "FENO RIM v2 research record (private, retired model)",
    outputs: [output("data/computed/feno-rim-v2", "directory")],
    owner_workflow: null,
    writer: null,
    inputs: [],
    cadence: ORPHANED,
    privacy_class: "private",
    public_outputs: [],
    retention: ORPHANED_RETENTION,
    recovery: "none",
    lifecycle: "orphaned",
  }),
  asset({
    id: "feno_rim_recovery_research",
    label: "FENO RIM recovery and ICC release-gate record (private)",
    outputs: [output("data/computed/feno-rim-recovery", "directory")],
    owner_workflow: null,
    writer: null,
    inputs: [],
    cadence: ORPHANED,
    privacy_class: "private",
    public_outputs: [],
    retention: ORPHANED_RETENTION,
    recovery: "none",
    lifecycle: "orphaned",
  }),
];

function exactKeys(value, expected, context) {
  const actualKeys = Object.keys(value ?? {}).sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`${context} keys must be exactly ${expectedKeys.join(",")} (got ${actualKeys.join(",")})`);
  }
}

function validRepoPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.split("/").includes("..");
}

const PUBLIC_MIRROR_PREFIX = "100xfenok-next/public/";

function hasDeclaredCanonicalPublicMirror(assetValue, publicSpec, repoRoot) {
  if (!publicSpec.path.startsWith(PUBLIC_MIRROR_PREFIX)) return false;
  const canonicalPath = publicSpec.path.slice(PUBLIC_MIRROR_PREFIX.length);
  const canonicalSpec = assetValue.outputs.find((outputSpec) => (
    outputSpec.path === canonicalPath && outputSpec.kind === publicSpec.kind
  ));
  if (!canonicalSpec) return false;
  return fs.existsSync(path.join(repoRoot, canonicalSpec.path));
}

function validateOutput(spec, context, prefix) {
  exactKeys(spec, ["path", "kind"], context);
  if (!validRepoPath(spec.path) || !spec.path.startsWith(prefix)) fail(`${context}.path is invalid`);
  if (!DERIVED_OUTPUT_KINDS.includes(spec.kind)) fail(`${context}.kind is invalid`);
}

function topLevelComputedRoots(repoRoot) {
  const computedRoot = path.join(repoRoot, "data", "computed");
  return fs.readdirSync(computedRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => `data/computed/${entry.name}`)
    .sort();
}

function findCurrentAssetCycle(assetById) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, chain) {
    if (visiting.has(id)) return [...chain, id];
    if (visited.has(id)) return null;
    visiting.add(id);
    const assetValue = assetById.get(id);
    for (const ref of assetValue.inputs.filter((entry) => entry.kind === "asset")) {
      const cycle = visit(ref.ref, [...chain, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }
  for (const id of assetById.keys()) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return null;
}

function reachableLaneIds(assetId, assetById, memo = new Map(), visiting = new Set()) {
  if (memo.has(assetId)) return memo.get(assetId);
  if (visiting.has(assetId)) return new Set();
  visiting.add(assetId);
  const found = new Set();
  const assetValue = assetById.get(assetId);
  for (const ref of assetValue.inputs) {
    if (ref.kind === "lane") {
      found.add(ref.ref);
    } else if (ref.kind === "asset" || ref.kind === "prior_asset") {
      for (const laneId of reachableLaneIds(ref.ref, assetById, memo, visiting)) found.add(laneId);
    }
  }
  visiting.delete(assetId);
  memo.set(assetId, found);
  return found;
}

export function validateDerivedAssetRegistry(
  registry,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    laneRegistry = LANE_REGISTRY,
    // KPI fixture mode installs a hard filesystem guard and supplies a
    // synthetic data root. Keep structural registry validation active there,
    // but do not probe the live repository's generated data at module import.
    checkFilesystem = process.env.KPI_HERMETIC_BOOTSTRAPPED !== "1",
  } = {},
) {
  exactKeys(registry, ["schema_version", "assets"], "registry");
  if (registry.schema_version !== DERIVED_ASSET_REGISTRY_SCHEMA) fail("schema_version is invalid");
  if (!Array.isArray(registry.assets) || registry.assets.length === 0) fail("assets must be a non-empty array");

  const laneIds = new Set(laneRegistry.lanes.map((laneValue) => laneValue.id));
  const assetById = new Map();
  const outputOwners = new Map();
  const usedWriterContracts = new Set();
  for (const assetValue of registry.assets) {
    exactKeys(assetValue, [
      "id",
      "label",
      "lifecycle",
      "outputs",
      "owner_workflow",
      "writer",
      "inputs",
      "cadence",
      "privacy_class",
      "public_outputs",
      "public_serving_status",
      "retention",
      "recovery",
      "recovery_evidence",
    ], `asset ${assetValue?.id ?? "<unknown>"}`);
    if (!ID_RE.test(assetValue.id)) fail(`asset id is invalid: ${String(assetValue.id)}`);
    if (assetById.has(assetValue.id)) fail(`duplicate asset id ${assetValue.id}`);
    assetById.set(assetValue.id, assetValue);
    if (typeof assetValue.label !== "string" || assetValue.label.length === 0) fail(`asset ${assetValue.id} label is required`);
    if (!DERIVED_ASSET_LIFECYCLES.includes(assetValue.lifecycle)) fail(`asset ${assetValue.id} lifecycle is invalid`);
    if (!Array.isArray(assetValue.outputs) || assetValue.outputs.length === 0) fail(`asset ${assetValue.id} outputs must be non-empty`);
    for (const spec of assetValue.outputs) {
      validateOutput(spec, `asset ${assetValue.id}.outputs`, "data/computed/");
      if (outputOwners.has(spec.path)) fail(`output ${spec.path} is owned by multiple assets`);
      outputOwners.set(spec.path, assetValue.id);
    }
    if (!Array.isArray(assetValue.inputs)) fail(`asset ${assetValue.id} inputs must be an array`);
    const seenInputs = new Set();
    for (const ref of assetValue.inputs) {
      exactKeys(ref, ["kind", "ref"], `asset ${assetValue.id}.inputs`);
      if (!DERIVED_INPUT_KINDS.includes(ref.kind)) fail(`asset ${assetValue.id} input kind is invalid`);
      if (typeof ref.ref !== "string" || ref.ref.length === 0) fail(`asset ${assetValue.id} input ref is invalid`);
      const inputKey = `${ref.kind}:${ref.ref}`;
      if (seenInputs.has(inputKey)) fail(`asset ${assetValue.id} duplicates input ${inputKey}`);
      seenInputs.add(inputKey);
      if (ref.kind === "lane" && !laneIds.has(ref.ref)) fail(`asset ${assetValue.id} references unknown lane ${ref.ref}`);
      if (ref.kind === "path" && !validRepoPath(ref.ref)) fail(`asset ${assetValue.id} input path is invalid`);
    }
    exactKeys(assetValue.cadence, ["kind", "scheduled_runs_per_day", "event_driven", "evidence"], `asset ${assetValue.id}.cadence`);
    if (!DERIVED_CADENCE_KINDS.includes(assetValue.cadence.kind)) fail(`asset ${assetValue.id} cadence kind is invalid`);
    if (!Number.isInteger(assetValue.cadence.scheduled_runs_per_day)
      || assetValue.cadence.scheduled_runs_per_day < 0) fail(`asset ${assetValue.id} scheduled_runs_per_day is invalid`);
    if (typeof assetValue.cadence.event_driven !== "boolean") fail(`asset ${assetValue.id} event_driven is invalid`);
    if (assetValue.cadence.evidence !== null && !validRepoPath(assetValue.cadence.evidence)) {
      fail(`asset ${assetValue.id} cadence evidence is invalid`);
    }
    if (!DERIVED_PRIVACY_CLASSES.includes(assetValue.privacy_class)) fail(`asset ${assetValue.id} privacy_class is invalid`);
    if (!DERIVED_PUBLIC_SERVING_STATUSES.includes(assetValue.public_serving_status)) {
      fail(`asset ${assetValue.id} public_serving_status is invalid`);
    }
    if (!Array.isArray(assetValue.public_outputs)) fail(`asset ${assetValue.id} public_outputs must be an array`);
    const seenPublic = new Set();
    for (const spec of assetValue.public_outputs) {
      validateOutput(spec, `asset ${assetValue.id}.public_outputs`, "100xfenok-next/public/");
      if (seenPublic.has(spec.path)) fail(`asset ${assetValue.id} duplicates public output ${spec.path}`);
      seenPublic.add(spec.path);
    }
    if (assetValue.privacy_class === "private" && assetValue.public_outputs.length > 0) {
      fail(`asset ${assetValue.id} private assets cannot declare public outputs`);
    }
    if (assetValue.privacy_class === "private" && assetValue.public_serving_status !== "private") {
      fail(`asset ${assetValue.id} private assets require private serving status`);
    }
    if (assetValue.privacy_class !== "private" && assetValue.public_serving_status === "private") {
      fail(`asset ${assetValue.id} public assets cannot use private serving status`);
    }
    if (assetValue.privacy_class !== "private" && assetValue.public_outputs.length === 0) {
      fail(`asset ${assetValue.id} public assets require a public output`);
    }
    exactKeys(assetValue.retention, ["kind", "max_items", "basis"], `asset ${assetValue.id}.retention`);
    if (!DERIVED_RETENTION_KINDS.includes(assetValue.retention.kind)) fail(`asset ${assetValue.id} retention kind is invalid`);
    const boundedRetention = ["snapshot", "bounded_history", "generations"].includes(assetValue.retention.kind);
    if (boundedRetention && (!Number.isInteger(assetValue.retention.max_items) || assetValue.retention.max_items < 1)) {
      fail(`asset ${assetValue.id} bounded retention requires max_items`);
    }
    if (!boundedRetention && assetValue.retention.max_items !== null) fail(`asset ${assetValue.id} unbounded/orphaned retention max_items must be null`);
    if (typeof assetValue.retention.basis !== "string" || assetValue.retention.basis.length === 0) fail(`asset ${assetValue.id} retention basis is required`);
    if (!DERIVED_RECOVERY_KINDS.includes(assetValue.recovery)) fail(`asset ${assetValue.id} recovery is invalid`);
    if (assetValue.recovery_evidence !== null && !validRepoPath(assetValue.recovery_evidence)) {
      fail(`asset ${assetValue.id} recovery_evidence is invalid`);
    }

    if (assetValue.lifecycle === "orphaned") {
      if (assetValue.owner_workflow !== null || assetValue.writer !== null || assetValue.inputs.length !== 0
        || assetValue.cadence.kind !== "orphaned" || assetValue.retention.kind !== "orphaned"
        || assetValue.recovery !== "none" || assetValue.recovery_evidence !== null) {
        fail(`asset ${assetValue.id} orphaned contract is inconsistent`);
      }
    } else {
      if (!validRepoPath(assetValue.owner_workflow) || !assetValue.owner_workflow.startsWith(".github/workflows/")) {
        fail(`asset ${assetValue.id} owner_workflow is required`);
      }
      if (!validRepoPath(assetValue.writer) || !assetValue.writer.startsWith("scripts/")) {
        fail(`asset ${assetValue.id} writer is required`);
      }
      const expectedRecovery = DERIVED_WRITER_RECOVERY_CONTRACTS[assetValue.writer];
      if (expectedRecovery === undefined) {
        fail(`asset ${assetValue.id} writer has no recovery contract: ${assetValue.writer}`);
      }
      usedWriterContracts.add(assetValue.writer);
      if (assetValue.recovery !== expectedRecovery) {
        fail(`asset ${assetValue.id} recovery does not match writer contract ${expectedRecovery}`);
      }
      if (assetValue.inputs.length === 0) fail(`asset ${assetValue.id} active assets require inputs`);
      if (assetValue.cadence.kind === "orphaned" || assetValue.retention.kind === "orphaned") {
        fail(`asset ${assetValue.id} active asset cannot use orphaned policy`);
      }
      if (assetValue.recovery === "none") fail(`asset ${assetValue.id} active asset requires recovery`);
      if (assetValue.recovery === "rebuild_from_inputs") {
        if (assetValue.recovery_evidence !== assetValue.writer || assetValue.retention.kind === "generations") {
          fail(`asset ${assetValue.id} rebuild recovery contract is inconsistent`);
        }
      } else if (assetValue.recovery === "generation_store") {
        if (assetValue.retention.kind !== "generations"
          || assetValue.recovery_evidence !== "scripts/data_supply_state.py") {
          fail(`asset ${assetValue.id} generation recovery contract is inconsistent`);
        }
      } else if (assetValue.recovery === "lane_lkg") {
        const lkgLane = assetValue.inputs
          .filter((ref) => ref.kind === "lane")
          .map((ref) => laneRegistry.lanes.find((laneValue) => laneValue.id === ref.ref))
          .find((laneValue) => laneValue?.recovery_store !== null);
        if (!lkgLane || assetValue.recovery_evidence !== "scripts/lib/lane-registry.mjs") {
          fail(`asset ${assetValue.id} lane LKG recovery contract is inconsistent`);
        }
      }
    }
  }
  const unusedWriterContracts = Object.keys(DERIVED_WRITER_RECOVERY_CONTRACTS)
    .filter((writer) => !usedWriterContracts.has(writer));
  if (unusedWriterContracts.length > 0) {
    fail(`unused writer recovery contracts: ${unusedWriterContracts.join(",")}`);
  }

  for (const assetValue of registry.assets) {
    for (const ref of assetValue.inputs) {
      if ((ref.kind === "asset" || ref.kind === "prior_asset") && !assetById.has(ref.ref)) {
        fail(`asset ${assetValue.id} references unknown asset ${ref.ref}`);
      }
    }
  }
  const cycle = findCurrentAssetCycle(assetById);
  if (cycle) fail(`current-generation asset cycle: ${cycle.join(" -> ")}`);

  const laneMemo = new Map();
  for (const assetValue of registry.assets.filter((entry) => entry.lifecycle === "active")) {
    if (reachableLaneIds(assetValue.id, assetById, laneMemo).size === 0) {
      fail(`asset ${assetValue.id} does not reach a registered lane`);
    }
  }

  if (checkFilesystem) {
    for (const assetValue of registry.assets) {
      for (const spec of assetValue.outputs) {
        const absolute = path.join(repoRoot, spec.path);
        if (!fs.existsSync(absolute)) fail(`declared output is missing: ${spec.path}`);
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) fail(`declared output must not be a symlink: ${spec.path}`);
        if (spec.kind === "file" && !stat.isFile()) fail(`declared output kind mismatch: ${spec.path}`);
        if (spec.kind === "directory" && !stat.isDirectory()) fail(`declared output kind mismatch: ${spec.path}`);
      }
      if (assetValue.lifecycle === "active") {
        for (const sourcePath of [
          assetValue.owner_workflow,
          assetValue.writer,
          assetValue.cadence.evidence,
          assetValue.recovery_evidence,
        ]) {
          if (!fs.existsSync(path.join(repoRoot, sourcePath))) fail(`asset ${assetValue.id} source is missing: ${sourcePath}`);
        }
        for (const ref of assetValue.inputs.filter((entry) => entry.kind === "path")) {
          if (!fs.existsSync(path.join(repoRoot, ref.ref))) fail(`asset ${assetValue.id} input path is missing: ${ref.ref}`);
        }
        const writerSource = fs.readFileSync(path.join(repoRoot, assetValue.writer), "utf8");
        if (assetValue.recovery === "lane_lkg" && !writerSource.includes("LaneLkgStore")) {
          fail(`asset ${assetValue.id} writer does not implement LaneLkgStore recovery`);
        }
        if (assetValue.recovery === "generation_store" && !writerSource.includes("DataSupplyStateStore")) {
          fail(`asset ${assetValue.id} writer does not implement DataSupplyStateStore recovery`);
        }
      }
      for (const spec of assetValue.public_outputs) {
        const absolute = path.join(repoRoot, spec.path);
        const exists = fs.existsSync(absolute);
        const buildTimePublicMirror = !exists
          && assetValue.public_serving_status === "active"
          && hasDeclaredCanonicalPublicMirror(assetValue, spec, repoRoot);
        if (assetValue.public_serving_status === "active" && !exists && !buildTimePublicMirror) {
          fail(`active public output is missing: ${spec.path}`);
        }
        if (assetValue.public_serving_status === "missing_projection" && exists) {
          fail(`missing_projection public output unexpectedly exists: ${spec.path}`);
        }
        if (exists) {
          const stat = fs.lstatSync(absolute);
          if (stat.isSymbolicLink()) fail(`public output must not be a symlink: ${spec.path}`);
          if (spec.kind === "file" && !stat.isFile()) fail(`public output kind mismatch: ${spec.path}`);
          if (spec.kind === "directory" && !stat.isDirectory()) fail(`public output kind mismatch: ${spec.path}`);
        }
      }
    }
    const currentRoots = topLevelComputedRoots(repoRoot);
    const declaredRoots = [...outputOwners.keys()].sort();
    if (JSON.stringify(currentRoots) !== JSON.stringify(declaredRoots)) {
      const currentSet = new Set(currentRoots);
      const declaredSet = new Set(declaredRoots);
      const undeclared = currentRoots.filter((root) => !declaredSet.has(root));
      const stale = declaredRoots.filter((root) => !currentSet.has(root));
      fail(`computed root coverage mismatch (undeclared=${undeclared.join(",")}; stale=${stale.join(",")})`);
    }
  }
  return true;
}

const registry = {
  schema_version: DERIVED_ASSET_REGISTRY_SCHEMA,
  assets,
};

validateDerivedAssetRegistry(registry);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DERIVED_ASSET_REGISTRY = deepFreeze(registry);

export function derivedAssetRegistryDigest(registryValue = DERIVED_ASSET_REGISTRY) {
  validateDerivedAssetRegistry(registryValue);
  return createHash("sha256").update(canonicalJson(registryValue), "utf8").digest("hex");
}

export function derivedAssetById(id) {
  return DERIVED_ASSET_REGISTRY.assets.find((assetValue) => assetValue.id === id) ?? null;
}

export function derivedAssetReachableLaneIds(id, registryValue = DERIVED_ASSET_REGISTRY) {
  validateDerivedAssetRegistry(registryValue);
  const assetById = new Map(registryValue.assets.map((assetValue) => [assetValue.id, assetValue]));
  if (!assetById.has(id)) fail(`unknown asset ${String(id)}`);
  return [...reachableLaneIds(id, assetById)].sort();
}

export function derivedAssetProviderIds(
  id,
  registryValue = DERIVED_ASSET_REGISTRY,
  laneRegistry = LANE_REGISTRY,
) {
  const laneIds = derivedAssetReachableLaneIds(id, registryValue);
  const providers = new Set();
  for (const laneId of laneIds) {
    const laneValue = laneRegistry.lanes.find((entry) => entry.id === laneId);
    if (!laneValue) fail(`asset ${id} ancestry contains unknown lane ${laneId}`);
    for (const ref of laneValue.provider_refs) providers.add(ref.provider_id);
  }
  return [...providers].sort();
}
