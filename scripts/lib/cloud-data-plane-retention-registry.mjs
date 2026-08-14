/**
 * cloud-data-plane-retention-registry.mjs — data the data plane keeps but does
 * not serve.
 *
 * The budget gate could not compute storage because 20,919 of 38,685 estate
 * files had no declared owner. Two fixes were considered and rejected. Declaring
 * everything a canonical output would have labelled acquisition state,
 * last-known-good payloads and recovery journals as servable canonical data,
 * which is false and would have pulled them into the R2 migration scope.
 * Declaring only the largest groups would have left the gate shut while
 * reporting progress.
 *
 * So the estate is split. A file is accounted for when a lane or derived asset
 * owns it, or when it appears here with a reason. Anything else still fails the
 * gate. This widens what can be declared, not what can be skipped: an entry
 * without a reason is rejected, and an entry may not shadow a lane's own
 * canonical output, so retention cannot be used to quietly drop a served family
 * out of the canonical set.
 *
 * Retained is not "safe to delete". Several of these roots are the only record
 * of how an acquisition attempt went, and losing them costs recovery and
 * provenance semantics even where the provider data is re-acquirable.
 */

export const RETENTION_REGISTRY = Object.freeze({
  retained: Object.freeze([
    {
      path: "data/admin/data-supply-state",
      reason:
        "Per-lane acquisition state: attempt shards, detection evidence and publish outcomes. Read by the freshness and recovery machinery, never served to the product.",
    },
    {
      path: "data/admin/yahoo-batch-quote-history",
      reason:
        "Yahoo quote/history lane store: per-ticker progression state, retry state and last-known-good payloads carrying 1-260 history rows each. The provider data is re-acquirable in principle, but this root is the recovery and provenance record, so deleting it is not equivalent to a refetch.",
    },
    {
      path: "data/admin/stockanalysis-recovery",
      reason: "StockAnalysis recovery journal used to resume interrupted acquisition; not a served artifact.",
    },
    {
      path: "data/admin/slickcharts-daily-delivery",
      reason: "SlickCharts daily delivery state and receipts for the composite recovery contract.",
    },
    {
      path: "data/admin/us-indices-daily",
      reason: "US indices lane acquisition state and provider observations.",
    },
    {
      path: "data/admin/sentiment",
      reason: "Sentiment lane acquisition state and retained last-known-good markers.",
    },
    {
      path: "data/admin/finra-ats",
      reason: "FINRA delayed ATS lane state, bounded-persistence markers and provider observations.",
    },
    {
      path: "data/admin/defillama_stablecoins",
      reason: "DefiLlama lane acquisition state and last-known-good markers.",
    },
    {
      path: "data/admin/fred_banking",
      reason: "FRED banking lane acquisition state and last-known-good markers.",
    },
    {
      path: "data/admin/treasury_tga",
      reason: "Treasury TGA lane acquisition state and last-known-good markers.",
    },
    {
      path: "data/admin/damodaran",
      reason: "Damodaran acquisition state and retained source archives supporting the published projection.",
    },
    {
      path: "data/admin/slickcharts-composite-recovery",
      reason: "SlickCharts five-member composite recovery authority; the lane's recovery store, never served.",
    },
    {
      path: "data/factset-earnings-insight",
      reason: "FactSet lane working tree: fetch and parse scripts, a probe log, and the archive directory whose PDFs are gitignored. Control-plane tooling and state, not a served surface. The public archive copies were removed on 2026-08-13 on redistribution grounds.",
    },
    {
      path: "data/stockanalysis/canary",
      reason: "ETF endpoint contract canary. Its own producer comment states it is a latest-state canary, not history, and no consumer exists.",
    },
    {
      path: "data/kf-french",
      reason: "Kenneth French factor research inputs, read only by an offline research script. The public tree copy is deleted before deploy as private research, so this never reaches a served surface.",
    },
    {
      path: "data/global-scouter/etfs/raw",
      reason: "Global Scouter ETF export working files retained beside the served index.",
    },
    {
      path: "data/admin/yahoo-hourly-ticker",
      reason: "Yahoo hourly ticker lane store: per-key progression state, last-known-good payloads, promotion contracts, and 167 content-addressed provider observation records. The lane's canonical output is the macro ticker file; this tree is its acquisition and recovery evidence.",
    },
    {
      path: "data/admin/fred_macro",
      reason: "FRED macro lane acquisition state and last-known-good store; the lane's canonical output is the macro file.",
    },
    {
      path: "data/admin/oecd_cli",
      reason: "OECD CLI lane acquisition state, last-known-good marker and shadow parity proof. The shadow output is declared canonical for enforcement only, with no public mirror and no consumer.",
    },
    {
      path: "data/admin/apewisdom_attention",
      reason: "Social attention lane marker store; the lane is private and its computed outputs are forbidden in the public mirror.",
    },
    {
      path: "data/admin/gdelt_news_tone",
      reason: "News tone lane marker store; computed outputs are forbidden in the public mirror.",
    },
    {
      path: "data/admin/edgar_filings",
      reason: "EDGAR lane marker store; the lane's canonical outputs are the filing and Korean summary trees.",
    },
    {
      path: "data/admin/fdic_tier1",
      reason: "FDIC lane acquisition state and last-known-good marker.",
    },
    {
      path: "data/admin/finra_short_volume",
      reason: "FINRA short volume lane marker store, private, with no public mirror. Its declared current marker is a marker rather than a payload.",
    },
    {
      path: "data/admin/fred_yardeni",
      reason: "Yardeni lane marker store; the canonical output is mirrored separately.",
    },
    {
      path: "data/admin/nasdaq_giw_sox",
      reason: "Index constituent lane acquisition state and history.",
    },
    {
      path: "data/admin/occ_options_volume",
      reason: "OCC options volume lane marker store; computed outputs are mirror-forbidden.",
    },
    {
      path: "data/admin/yahoo_private_options",
      reason: "Yahoo private options availability marker lane.",
    },
    {
      path: "data/admin/yahoo_etf_fallback",
      reason: "Yahoo ETF fallback lane state and last-known-good payload.",
    },
    {
      path: "data/admin/krx",
      reason: "KRX lane acquisition state and bridge last-known-good; the lane's served artifacts live elsewhere.",
    },
    {
      path: "data/admin/fenok-s1-stock-promotion-gate-plan.json",
      reason: "S1 promotion gate plan; its public copy is explicitly deleted before the mirror guard runs.",
    },
    {
      path: "data/admin/fenok-s1-stock-public-promotion-dry-run.json",
      reason: "S1 promotion dry run; mirror-forbidden and deleted from the public tree.",
    },
    {
      path: "data/admin/fenok-s1-public-mutation-enable-readiness.json",
      reason: "S1 public mutation readiness; mirror-forbidden and deleted from the public tree.",
    },
    {
      path: "data/admin/fenok-edge-etf-daily1y-readiness.json",
      reason: "ETF daily-1y readiness state; an input to a derived summary, mirror-forbidden.",
    },
    {
      path: "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
      reason: "ETF daily-1y dispatch plan; mirror-forbidden control state.",
    },
    {
      path: "data/admin/fenok-etf-core-daily-basket.json",
      reason: "ETF core daily basket control state; mirror-forbidden.",
    },
    {
      path: "data/admin/fenok-s0-finra-occ-mapping-ledger.json",
      reason: "FINRA/OCC mapping ledger. The estate README names it private-only because it carries row-level local evidence paths.",
    },
    {
      path: "data/admin/data-supply-detection-floor.json",
      reason: "Detection floor projection; its declared exception excludes it from public sync and allows absence.",
    },
    {
      path: "data/admin/lane-commit-manifest.json",
      reason: "Private deterministic workflow commit and routing manifest; excluded from public sync.",
    },
    {
      path: "data/admin/damodaran-shadow-parity.json",
      reason: "Legacy private shadow parity proof retained after an ownership flip.",
    },
    {
      path: "data/admin/sec-13f-shadow-parity.json",
      reason: "Private fixture-oracle parity proof.",
    },
    {
      path: "data/admin/pro-density-baseline.json",
      reason: "Density audit baseline read only by a CI gate; no app fetch and no public destination.",
    },
    {
      path: "data/admin/fenok-flow-backfill-index.json",
      reason: "Flow backfill index read as an input to the served edge coverage index, not itself served.",
    },
    {
      path: "data/admin/taiwan-data-bridge-index.json",
      reason: "Admin-side Taiwan bridge input, distinct from the computed bridge index that is served.",
    },
    {
      path: "data/admin/README.md",
      reason: "Control-plane estate documentation.",
    },
    {
      path: "data/stockanalysis/backfill",
      reason: "StockAnalysis backfill bookkeeping: history gap reports and coverage state, not a served surface.",
    },
  ]),
  optional_paths: Object.freeze([
    {
      path: "data/slickcharts/1929crash.json",
      reason:
        "Produced only when the SlickCharts workflow is dispatched with an explicit 1929crash selection; the composite contract marks it required: false. Its absence is the normal state, not a missing artifact.",
    },
  ]),
});

/**
 * Serving assets that no acquisition lane produces. Three distinct shapes, kept
 * apart because conflating them is how a false ownership claim gets made:
 *
 *  - platform_outputs: produced by central workflow policy rather than a lane.
 *  - external_artifacts: no in-repo producer at all; an owner-run or third-party
 *    process writes them and the repository holds a read-only mirror. Freshness
 *    is only as current as that external process.
 *  - exposed_no_consumer: published by the generic sync but with no product
 *    reader found. Recorded as a hygiene queue, NOT as canonical serving —
 *    public exposure alone is not evidence of intended serving.
 */
export const OWNERSHIP_REGISTRY = Object.freeze({
  platform_outputs: Object.freeze([
    { path: "data/metadata", reason: "Site metadata materialized by the central Update Manifest projection step; committed under central policy, served, and lane-less by design." },
    { path: "data/manifest.json", reason: "Central data manifest written by the update-manifest projection; consumed by the market-valuation hook." },
    { path: "data/slickcharts/universe.json", reason: "SlickCharts discovery output committed under central policy; consumed by the discovery card." },
    { path: "data/slickcharts/discovery-summary.json", reason: "SlickCharts discovery summary; consumed by the discovery card and connected loaders." },
    { path: "data/slickcharts/membership-changes.json", reason: "SlickCharts membership deltas committed under central policy." },
    { path: "data/calendar/prev-values.json", reason: "Calendar previous-values projection built under central policy; consumed by the week-ahead card." },
    { path: "data/damodaran/industry_benchmarks.json", reason: "Industry benchmark projection committed under central policy; consumed by the stock tabs." },
    { path: "data/stockanalysis/index.json", reason: "StockAnalysis index exposed through the data API." },
    { path: "data/stockanalysis/classification", reason: "StockAnalysis classification summary; public-mirrored and parity-gated." },
    { path: "data/stockanalysis/coverage", reason: "ETF detail coverage projection fetched directly by the ETF list surface." },
    { path: "data/stockanalysis/surface_consumers.json", reason: "Hand-maintained surface consumer contract; gates surface stamping and is parity-checked." },
    { path: "data/winddown/runtime-lkg", reason: "Wind-down published last-known-good projection pinned by the generated LKG contract." },
    { path: "data/admin/fenok-data-health-kpi.json", reason: "Data health KPI projection; a declared public destination and fetched by the admin data-lab surface." },
    { path: "data/admin/lane-registry-projection.json", reason: "Public-safe lane metadata projection; a declared public destination and fetched by the admin data-lab surface." },
    { path: "data/admin/product-surface-coverage.json", reason: "Product surface coverage projection; a declared public destination read by the admin dashboard." },
    { path: "data/admin/data-usage-manifest.json", reason: "Data usage manifest; a declared public destination read by the admin dashboard." },
    { path: "data/admin/fenok-edge-coverage-index.json", reason: "Edge coverage index; a declared public destination whose public copy is a redacted schema enforced by the mirror guard." },
    { path: "data/admin/alarm-state.json", reason: "Pipeline alarm state; carries its own declared public-mirror exception and is fetched by the admin surface." },
    { path: "data/admin/stock-field-usage-manifest.json", reason: "Stock field usage manifest read by the admin data-lab surface." },
    { path: "data/yf/quarter_closes.json", reason: "Quarter close reference produced by a lane workflow step and consumed by downstream closeout, portfolio-view, enrichment and signal work; an active analytical input rather than an archive." },
    { path: "data/global-scouter/core/stocks_analyzer.json", reason: "Derived Global Scouter output built by the stocks-analyzer workflow and materialized into the public tree by Update Manifest; committed under workflow policy rather than owned by an acquisition lane." },
    { path: "data/global-scouter/core/per_bands_index.json", reason: "Derived Global Scouter output built by the stocks-analyzer workflow; materialized by Update Manifest." },
    { path: "data/global-scouter/core/slick_index.json", reason: "Derived Global Scouter output built by the stocks-analyzer workflow; materialized by Update Manifest." },
    { path: "data/global-scouter/core/revision_movers.json", reason: "Derived Global Scouter output built by the revision-movers workflow; materialized by Update Manifest." },
    { path: "data/macro/activity-surveys.json", reason: "Activity survey projection consumed by the market-valuation hook; produced by an owner-run converter and read by the OECD lane only for parity." },
  ]),
  external_artifacts: Object.freeze([
    { path: "data/calendar/usd-calendar.json", reason: "Written by an external Google Calendar process. The folder README names that calendar as the operational source and this tree as a read-only mirror, so no repository lane can claim production. Freshness is only as current as the external source." },
    { path: "data/benchmarks/summaries.json", reason: "Owner-run Bloomberg converter output; no in-repo writer exists. Consumed by the explore dashboard, app shell and data loader." },
    { path: "data/catalog/macro-series.json", reason: "Owner-supplied macro series catalog; no in-repo writer. Read by the data-lab surface and the macro chart contract check." },
    { path: "data/reports-index.json", reason: "Owner-maintained report index mirrored from the alpha-scout tree; no in-repo writer." },
  ]),
  exposed_no_consumer: Object.freeze([
    { path: "data/damodaran/archives", reason: "26 source spreadsheets published by the generic sync with no product reader found. Their writer is unhooked from CI and the receipt is dated 2026-08-06. Queued for a serving-intent decision, not claimed as canonical serving." },
    { path: "data/yf/estimates-archive", reason: "17 archived estimate snapshots published with no product reader found. Committed under lane policy but absent from the lane's canonical outputs." },
    { path: "data/yf/migration-evidence", reason: "Migration evidence retained from an earlier lane change; published with no product reader." },
  ]),
  documentation: Object.freeze([
    { path: "data/README.md", reason: "Estate documentation mirrored to the public tree." },
    { path: "data/.gitkeep", reason: "Directory placeholder mirrored to the public tree." },
    { path: "data/yf/README.md", reason: "Lane documentation." },
    { path: "data/yardney/README.md", reason: "Lane documentation." },
    { path: "data/slickcharts/README.md", reason: "Lane documentation." },
    { path: "data/slickcharts/schema.json", reason: "Lane schema documentation." },
    { path: "data/stockanalysis/README.md", reason: "Lane documentation." },
    { path: "data/stockanalysis/schema.json", reason: "Lane schema documentation." },
    { path: "data/indices/README.md", reason: "Lane documentation." },
    { path: "data/indices/schema.json", reason: "Lane schema documentation." },
    { path: "data/macro/README.md", reason: "Lane documentation." },
    { path: "data/macro/schema.json", reason: "Lane schema documentation." },
    { path: "data/calendar/README.md", reason: "Lane documentation." },
    { path: "data/calendar/schema.json", reason: "Lane schema documentation." },
    { path: "data/benchmarks/README.md", reason: "Lane documentation." },
    { path: "data/benchmarks/schema.json", reason: "Lane schema documentation." },
    { path: "data/damodaran/README.md", reason: "Lane documentation." },
    { path: "data/damodaran/schema.json", reason: "Lane schema documentation." },
    { path: "data/global-scouter/etfs/README.md", reason: "Lane documentation." },
  ]),
});
