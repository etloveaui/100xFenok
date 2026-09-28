#!/usr/bin/env node
// K1/K3 fixtures for the slim health KPI. All source and output paths stay in a temp root.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildKpiDocuments } from "./build-fenok-data-health-kpi.mjs";
import { validateKpiDocuments } from "./check-fenok-data-health-kpi.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";
import { summarizeDataSetFreshness } from "./lib/fenok-data-health-freshness.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-kpi-k1-k3-"));
const canonicalPath = path.join(root, "data", "macro", "fred-macro.json");
const publicDataRoot = path.join(root, "public", "data");
const now = "2026-09-28T20:00:00Z";
const good = { source_as_of: "2026-09-26", series: [{ date: "2026-09-26", value: 1 }] };
const valid = (doc) => doc !== null && typeof doc === "object" && !Array.isArray(doc)
  && /^\d{4}-\d{2}-\d{2}$/.test(doc.source_as_of ?? "")
  && Array.isArray(doc.series) && doc.series.length > 0;
const sourceAsOf = (doc) => doc.source_as_of;
const run = (id, observedAt) => ({ runId: id, runAttempt: 1, eventName: "schedule", observedAt });
const candidate = (bytes, sourceDate = "2026-09-26") => ({
  key: "fred_macro",
  payloadBytes: Buffer.from(bytes),
  currentRelativePath: "data/macro/fred-macro.json",
  validateDocument: valid,
  deriveSourceAsOf: sourceAsOf,
  sourceAsOf: sourceDate,
  promotion_contract: "legacy_source_marker/v1",
});
const writeJson = (dataRoot, relativePath, value) => {
  const filePath = path.join(dataRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
};

try {
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, `${JSON.stringify(good)}\n`);
  const store = new LaneLkgStore({ repoRoot: root, laneId: "fred_macro" });
  store.recordSuccess({
    artifacts: [candidate(JSON.stringify(good))],
    run: run("1", "2026-09-26T12:00:00Z"),
  });
  const before = store.stateSnapshot();
  const goodBytes = fs.readFileSync(canonicalPath);

  // K1: empty, malformed, and wrong-shape/date inputs cannot replace good data.
  for (const [name, bytes, date] of [
    ["empty", "", "2026-09-27"],
    ["malformed", "{", "2026-09-27"],
    ["wrong shape", JSON.stringify({ source_as_of: "2026-09-27", series: [] }), "2026-09-27"],
    ["wrong date", JSON.stringify(good), "2026-09-27"],
  ]) {
    assert.throws(() => store.recordSuccess({
      artifacts: [candidate(bytes, date)],
      run: run(`bad-${name}`, "2026-09-27T12:00:00Z"),
    }), undefined, `${name} must be rejected`);
    assert.deepEqual(store.stateSnapshot(), before, `${name} must preserve the good LKG state`);
    assert.deepEqual(fs.readFileSync(canonicalPath), goodBytes, `${name} must preserve served bytes`);
  }

  // A fresh source can be served from LKG while its age still meets policy.
  store.recordFailure({
    artifacts: [{
      key: "fred_macro",
      canonicalPath,
      validateDocument: valid,
      sourceAsOf,
    }],
    run: run("failed-fetch", "2026-09-27T12:00:00Z"),
    reason: "http_error",
  });
  const floorPath = path.join(root, "data", "admin", "data-supply-detection-floor.json");
  fs.mkdirSync(path.dirname(floorPath), { recursive: true });
  const dataRoot = path.join(root, "data");
  fs.writeFileSync(floorPath, `${JSON.stringify({
    schema_version: "data-supply-detection-floor/v2",
    lanes: [
      {
        id: "fred_macro",
        status: "unavailable",
        artifact: { status: "ready", source_as_of: "2026-09-26" },
      },
      {
        id: "treasury_tga",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-09-25" },
      },
      {
        id: "fred_banking",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-01-01" },
        source_artifacts: [
          { id: "fred_banking_daily", path: "data/macro/fred-banking-daily.json", source_as_of: "2026-09-01" },
          { id: "fred_banking_weekly", path: "data/macro/fred-banking-weekly.json", source_as_of: "2026-09-16" },
          { id: "fred_banking_monthly", path: "data/macro/fred-banking-monthly.json", source_as_of: "2026-08-01" },
          { id: "fred_banking_quarterly", path: "data/macro/fred-banking-quarterly.json", source_as_of: "2026-01-01" },
        ],
      },
      {
        id: "stockanalysis_stock_financial",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-09-27T23:50:04Z" },
      },
      {
        id: "slickcharts",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-09-27" },
        members: ["daily", "weekly", "monthly", "history", "symbols"].map((id) => ({
          id,
          status: "ready",
          artifact: { status: "ready", source_as_of: id === "daily" || id === "symbols" ? "2026-09-27" : null },
        })),
      },
      { id: "yahoo_etf_fallback", status: "ready", artifact: { status: "ready", source_as_of: null } },
      { id: "stockanalysis_etf_universe", status: "ready", artifact: { status: "ready", source_as_of: null } },
      { id: "stockanalysis_etf_detail", status: "ready", artifact: { status: "ready", source_as_of: null } },
      { id: "stockanalysis_surfaces", status: "ready", artifact: { status: "ready", source_as_of: null } },
      { id: "yahoo_ticker_macro", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-25T20:00:01Z" } },
      { id: "yahoo_batch_quote_history", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-28T02:30:00Z" } },
      { id: "us_indices_daily", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-25" } },
      { id: "nasdaq_giw_sox", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-25" } },
      { id: "finra_short_volume", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-25" } },
      { id: "occ_options_volume", status: "ready", artifact: { status: "ready", source_as_of: "2026-09-25" } },
    ],
  })}\n`);

  writeJson(dataRoot, "admin/yahoo_etf_fallback/index.json", {
    schema_version: "data-supply-lkg-state/v1",
    lane_id: "yahoo_etf_fallback",
    items: {
      tqqq: {
        resolution_state: "fresh_primary",
        current: { path: "data/yf/etf-details/TQQQ.json", source_as_of: "2026-07-27T20:00:00Z" },
      },
    },
  });
  writeJson(dataRoot, "stockanalysis/etf_universe.json", {
    source_as_of: null,
    fetched_at: "2026-09-21T01:14:16Z",
    records: [{ ticker: "AAA" }],
  });
  writeJson(dataRoot, "stockanalysis/etfs/AAA.json", {
    source_as_of: "2026-09-26T20:00:00Z",
    fetched_at: "2026-09-27T01:00:00Z",
  });
  writeJson(dataRoot, "stockanalysis/etfs/BBB.json", {
    source_as_of: "2026-09-25T20:00:00Z",
    fetched_at: "2026-09-26T01:00:00Z",
  });
  writeJson(dataRoot, "stockanalysis/etfs/CCC.json", {
    source_as_of: null,
    fetched_at: "2026-09-27T01:00:00Z",
  });
  writeJson(dataRoot, "stockanalysis/surfaces/index.json", {
    source_as_of: { market_events: null, sectors: null, etf_center: null },
    generated_at: "2026-09-26T02:05:55Z",
    counts: { surfaces_requested: 25, ok: 25, failed: 0 },
    results: Array.from({ length: 25 }, (_, index) => ({ surface: `surface-${index}`, status: "ok" })),
  });
  for (let index = 0; index < 25; index += 1) {
    writeJson(dataRoot, `stockanalysis/surfaces/surface-${index}.json`, {
      source_as_of: null,
      fetched_at: "2026-09-26T02:05:28Z",
    });
  }
  writeJson(dataRoot, "stockanalysis/coverage/etf_detail.json", {
    source_date_summary: {
      total_members: 4,
      newest_source_date: "2026-09-27",
      oldest_source_date: "2026-09-26",
      oldest_source_member: "BBB",
      source_date_histogram: [
        { date: null, basis: null, count: 2 },
        { date: "2026-09-26", basis: "source", count: 1 },
        { date: "2026-09-27", basis: "collected", count: 1 },
      ],
    },
  });
  writeJson(dataRoot, "admin/slickcharts-composite-recovery/index.json", {
    members: Object.fromEntries(["daily", "weekly", "monthly", "history", "symbols"].map((id) => [id, {
      resolution_state: "fresh_primary",
      promoted_run: { observed_at: "2026-09-27T12:00:00Z" },
    }])),
  });
  writeJson(dataRoot, "macro/yahoo-ticker.json", {
    tickers: {
      AAA: { regularMarketTime: Date.parse("2026-09-25T20:00:00Z") / 1000 },
      BBB: { regularMarketTime: Date.parse("2026-09-25T20:00:01Z") / 1000 },
    },
  });
  writeJson(dataRoot, "admin/yahoo-batch-quote-history/index.json", {
    active_universe_scope: "all_sources",
    oldest_source_as_of: "2026-04-10T19:35:04Z",
    oldest_source_ticker: "ZCBE",
    newest_source_as_of: "2026-09-25T20:00:00Z",
    newest_source_ticker: "AAPL",
    counts: { fresh: 95, eligible: 100, active: 100, lifecycle_inactive: 0 },
    catalogue_symbols: [
      ...Array.from({ length: 95 }, (_, index) => `SYM${index}`),
      "ZCBE",
      ...Array.from({ length: 4 }, (_, index) => `UNKNOWN${index}`),
    ],
  });
  for (let index = 0; index < 95; index += 1) {
    writeJson(dataRoot, `admin/yahoo-batch-quote-history/tickers/SYM${index}.json`, {
      resolution_state: "fresh_primary",
      current: { source_as_of: "2026-09-25T20:00:00Z", fetched_at: "2026-09-26T01:00:00Z" },
    });
  }
  writeJson(dataRoot, "admin/yahoo-batch-quote-history/tickers/ZCBE.json", {
    resolution_state: "fresh_primary",
    current: { source_as_of: "2026-04-10T19:35:04Z", fetched_at: "2026-04-11T01:00:00Z" },
  });
  for (const name of ["sp500", "nasdaq", "nasdaq100", "sox"]) {
    writeJson(dataRoot, `indices/${name}.json`, [{ date: "2026-09-25", close: 1 }]);
  }

  // Market-daily data from Friday remains fresh on Monday under the existing US trading calendar.
  const marketIds = ["us_indices_daily", "nasdaq_giw_sox", "finra_short_volume", "occ_options_volume"];
  const missingEvidenceId = LANE_REGISTRY.lanes.find((lane) => (
    lane.lane_class === "detection_floor"
    && !["fred_macro", "treasury_tga", "fred_banking", ...marketIds,
      "stockanalysis_stock_financial", "slickcharts",
      "yahoo_etf_fallback", "stockanalysis_etf_universe", "stockanalysis_etf_detail",
      "stockanalysis_surfaces", "yahoo_ticker_macro", "yahoo_batch_quote_history"].includes(lane.id)
  ))?.id;
  assert.ok(missingEvidenceId, "fixture registry must include a data set without source-date evidence");

  // K3: one source date and one freshness-policy status per set.
  const { rootDoc, publicDoc } = buildKpiDocuments(now, {
    dataRoot: path.join(root, "data"), publicDataRoot,
  });
  assert.ok(Array.isArray(rootDoc.sets) && rootDoc.sets.length > 0);
  const row = rootDoc.sets.find((set) => set.set === "fred_macro");
  assert.ok(row, "FRED fixture must appear as one data set");
  assert.deepEqual(Object.keys(row).sort(), [
    "set", "served_path", "newest_source_date", "max_age", "serving_lkg", "status",
  ].sort());
  assert.equal(row.served_path, "data/macro/fred-macro.json");
  assert.equal(row.newest_source_date, "2026-09-26");
  assert.match(row.max_age, /^\d+d$/);
  assert.equal(row.serving_lkg, true);
  assert.equal(row.status, "fresh", "status follows source age even when the floor reports an unavailable attempt");
  assert.equal(row.date_basis, undefined, "provider dates do not receive a collection-time label");
  const tga = rootDoc.sets.find((set) => set.set === "treasury_tga");
  assert.ok(tga, "Treasury TGA fixture must appear as one data set");
  assert.equal(tga.status, "fresh", "US federal holidays are applied when judging TGA source age");
  const banking = rootDoc.sets.find((set) => set.set === "fred_banking");
  assert.ok(banking, "FRED banking fixture must appear as one data set");
  assert.equal(banking.newest_source_date, "2026-09-16", "a multi-file data set reports its newest member date");
  assert.equal(banking.oldest_source_date, "2026-01-01");
  assert.equal(banking.oldest_source_member, "fred_banking_quarterly");
  assert.equal(banking.fresh_members, 3);
  assert.equal(banking.total_members, 4);
  assert.equal(banking.status, "stopped", "status follows the fresh-member share, below 80% here");
  const fridayMarket = rootDoc.sets.find((set) => set.set === "us_indices_daily");
  assert.equal(fridayMarket.newest_source_date, "2026-09-25");
  assert.equal(fridayMarket.status, "fresh", "Friday source data is one US trading day old on Monday");
  assert.equal(fridayMarket.fresh_members, 4);
  assert.equal(fridayMarket.total_members, 4);
  for (const id of marketIds) {
    assert.equal(rootDoc.sets.find((set) => set.set === id).status, "fresh",
      `${id} uses US trading days for Friday-to-Monday age`);
  }
  const fallback = rootDoc.sets.find((set) => set.set === "yahoo_etf_fallback");
  assert.equal(fallback.newest_source_date, "2026-07-27");
  assert.equal(fallback.status, "stopped", "an old source date must be visible instead of a null stopped row");
  const collectedUniverse = rootDoc.sets.find((set) => set.set === "stockanalysis_etf_universe");
  assert.equal(collectedUniverse.newest_source_date, "2026-09-21");
  assert.equal(collectedUniverse.date_basis, "collected");
  const stockFinancial = rootDoc.sets.find((set) => set.set === "stockanalysis_stock_financial");
  assert.equal(stockFinancial.newest_source_date, "2026-09-27");
  assert.equal(stockFinancial.date_basis, "collected", "attempt observation time is collection evidence");
  const slickcharts = rootDoc.sets.find((set) => set.set === "slickcharts");
  assert.equal(slickcharts.total_members, 5, "composite member count remains explicit");
  assert.equal(slickcharts.newest_source_date, "2026-09-27");
  assert.equal(slickcharts.date_basis, "mixed", "promoted run times fill missing member dates as collected");
  const etfDetails = rootDoc.sets.find((set) => set.set === "stockanalysis_etf_detail");
  assert.equal(etfDetails.newest_source_date, "2026-09-27");
  assert.equal(etfDetails.oldest_source_date, "2026-09-26");
  assert.equal(etfDetails.oldest_source_member, "BBB");
  assert.equal(etfDetails.date_basis, "mixed", "member dates distinguish provider stamps from fetched-at fallbacks");
  assert.equal(etfDetails.fresh_members, 2);
  assert.equal(etfDetails.total_members, 4, "undated expected members remain in the denominator");
  assert.equal(etfDetails.status, "stopped", "unknown ETF members are not counted as fresh");
  const surfaces = rootDoc.sets.find((set) => set.set === "stockanalysis_surfaces");
  assert.equal(surfaces.newest_source_date, "2026-09-26");
  assert.equal(surfaces.oldest_source_date, "2026-09-26");
  assert.equal(surfaces.oldest_source_member, "surface-0");
  assert.equal(surfaces.fresh_members, 25);
  assert.equal(surfaces.total_members, 25);
  assert.equal(surfaces.date_basis, "collected");
  const yahooTickers = rootDoc.sets.find((set) => set.set === "yahoo_ticker_macro");
  assert.equal(yahooTickers.newest_source_date, "2026-09-25");
  assert.equal(yahooTickers.status, "fresh");
  assert.equal(yahooTickers.fresh_members, 2);
  assert.equal(yahooTickers.total_members, 2);
  const yahooBatch = rootDoc.sets.find((set) => set.set === "yahoo_batch_quote_history");
  assert.equal(yahooBatch.newest_source_date, "2026-09-25");
  assert.equal(yahooBatch.oldest_source_date, "2026-04-10");
  assert.equal(yahooBatch.oldest_source_member, "ZCBE");
  assert.equal(yahooBatch.status, "fresh", "a 95% fresh share meets the fresh threshold despite one outlier");
  assert.equal(yahooBatch.fresh_members, 95);
  assert.equal(yahooBatch.total_members, 100);
  assert.equal(yahooBatch.served_path, "data/yf/finance", "the shared Yahoo output has an explicit public serving path");
  const yahooLane = LANE_REGISTRY.lanes.find((lane) => lane.id === "yahoo_batch_quote_history");
  for (let index = 80; index < 95; index += 1) {
    writeJson(dataRoot, `admin/yahoo-batch-quote-history/tickers/SYM${index}.json`, {
      resolution_state: "fresh_primary",
      current: { source_as_of: "2026-04-10T19:35:04Z", fetched_at: "2026-04-11T01:00:00Z" },
    });
  }
  const delayedAt80 = summarizeDataSetFreshness(yahooLane, null, now, undefined, dataRoot);
  assert.equal(delayedAt80.fresh_members, 80);
  assert.equal(delayedAt80.status, "delayed", "an 80% fresh share meets the delayed threshold");
  writeJson(dataRoot, "admin/yahoo-batch-quote-history/tickers/SYM79.json", {
    resolution_state: "fresh_primary",
    current: { source_as_of: "2026-04-10T19:35:04Z", fetched_at: "2026-04-11T01:00:00Z" },
  });
  const stoppedBelow80 = summarizeDataSetFreshness(yahooLane, null, now, undefined, dataRoot);
  assert.equal(stoppedBelow80.fresh_members, 79);
  assert.equal(stoppedBelow80.status, "stopped", "a fresh share below 80% is stopped");
  assert.equal(rootDoc.sets.find((set) => set.set === "nasdaq_giw_sox").served_path,
    "data/indices/nasdaq-giw-sox-constituents.json");
  assert.equal(rootDoc.sets.find((set) => set.set === "finra_short_volume").served_path,
    "data/computed/fenok_flow_proxies.json");
  assert.equal(rootDoc.sets.find((set) => set.set === "occ_options_volume").served_path,
    "data/computed/fenok_occ_options_availability.json");
  assert.equal(rootDoc.sets.find((set) => set.set === "apewisdom_attention").served_path,
    "data/computed/fenok_social_attention_proxy.json");
  assert.equal(rootDoc.sets.find((set) => set.set === "gdelt_news_tone").served_path,
    "data/computed/fenok_news_tone_proxy.json");
  const unknown = rootDoc.sets.find((set) => set.set === missingEvidenceId);
  assert.equal(unknown.newest_source_date, null);
  assert.equal(unknown.status, "unknown", "only a data set with no source date reports unknown");
  const checked = validateKpiDocuments(rootDoc, publicDoc, { dataRoot: path.join(root, "data") });
  assert.deepEqual(checked.errors, [], "the checker accepts the same calendar- and file-policy-aware result");
  const stripDiagnostics = (document) => {
    for (const set of document.sets) {
      for (const key of ["date_basis", "oldest_source_date", "oldest_source_member", "fresh_members", "total_members"]) {
        delete set[key];
      }
    }
  };
  const withoutDiagnostics = structuredClone(rootDoc);
  const publicWithoutDiagnostics = structuredClone(publicDoc);
  stripDiagnostics(withoutDiagnostics);
  stripDiagnostics(publicWithoutDiagnostics);
  const additiveCheck = validateKpiDocuments(
    withoutDiagnostics,
    publicWithoutDiagnostics,
    { dataRoot: path.join(root, "data") },
  );
  assert.deepEqual(additiveCheck.errors, [], "new diagnostic fields remain optional on current-schema artifacts");

  const legacyRoot = structuredClone(withoutDiagnostics);
  const legacyPublic = structuredClone(publicWithoutDiagnostics);
  legacyRoot.schema_version = "fenok-data-health-kpi/v3";
  legacyPublic.schema_version = "fenok-data-health-kpi/v3";
  const legacyYahoo = legacyRoot.sets.find((set) => set.set === "yahoo_batch_quote_history");
  legacyYahoo.served_path = null;
  legacyYahoo.newest_source_date = legacyRoot.generated_at.slice(0, 10);
  legacyYahoo.max_age = "2d";
  const legacyEtf = legacyRoot.sets.find((set) => set.set === "stockanalysis_etf_detail");
  legacyEtf.newest_source_date = null;
  legacyEtf.status = "stopped";
  legacyPublic.sets = structuredClone(legacyRoot.sets);
  const legacyCheck = validateKpiDocuments(legacyRoot, legacyPublic, { dataRoot: path.join(root, "data") });
  assert.deepEqual(legacyCheck.errors, [], "the prior schema remains deploy-safe before hosted regeneration");

  const badTga = structuredClone(rootDoc);
  badTga.sets.find((set) => set.set === "treasury_tga").status = "stopped";
  const rejected = validateKpiDocuments(badTga, publicDoc, { dataRoot: path.join(root, "data") });
  assert.ok(
    rejected.errors.some((error) => error.includes("status does not match source age and freshness-policy")),
    "the checker rejects a declared TGA status that disagrees with source freshness",
  );
  assert.ok(Array.isArray(publicDoc.sets));
  assert.equal(JSON.stringify(publicDoc).includes("data/admin/fred_macro"), false);
  console.log("K1/K3 KPI fixtures passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
