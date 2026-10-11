#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATA_SUPPLY_DETECTION_CONFIG,
} from "./lib/data-supply-detection-config.mjs";
import {
  DetectionFloorError,
  REPO_ROOT,
  REPORT_BASENAME,
  buildDetectionReport,
  evaluateAttemptCadence,
  evaluateFreshness,
  foldGeneratedAt,
  pathsOverlap,
  validateDetectionReport,
} from "./build-data-supply-detection-floor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, "fixtures", "data_supply", "detection_floor");
const CALENDARS_PATH = path.join(FIXTURE_DIR, "calendars.fixture.json");
const ARTIFACTS_PATH = path.join(FIXTURE_DIR, "artifacts.fixture.json");
const EXPECTED_PATH = path.join(FIXTURE_DIR, "cases.expected.json");
const TEST_PREFIX = "fenok-dfloor-test-";
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const calendarsFixture = readJson(CALENDARS_PATH);
const artifactsFixture = readJson(ARTIFACTS_PATH);
const expectedFixture = readJson(EXPECTED_PATH);

const ownedRoots = [];

function makeOwnedRoot(parent = os.tmpdir()) {
  const realParent = fs.realpathSync.native(parent);
  const raw = fs.mkdtempSync(path.join(parent, TEST_PREFIX));
  fs.chmodSync(raw, 0o700);
  const stat = fs.lstatSync(raw);
  const record = { raw, real: fs.realpathSync.native(raw), dev: stat.dev, ino: stat.ino, parentReal: realParent };
  ownedRoots.push(record);
  return record;
}

function safeCleanup(record) {
  if (!record || !path.basename(record.raw).startsWith(TEST_PREFIX)) throw new Error("cleanup refused unknown root");
  const lexical = fs.lstatSync(record.raw);
  const real = fs.realpathSync.native(record.raw);
  if (lexical.isSymbolicLink() || !lexical.isDirectory() || lexical.dev !== record.dev || lexical.ino !== record.ino || real !== record.real) {
    throw new Error("cleanup refused changed root identity");
  }
  if (pathsOverlap(real, fs.realpathSync.native(REPO_ROOT))) throw new Error("cleanup refused repository overlap");
  fs.rmSync(real, { recursive: true, force: false });
}

function documentMap() {
  return new Map(artifactsFixture.documents.map((document) => [document.id, document]));
}

function mergedLayout(layoutId) {
  const baseline = artifactsFixture.layouts.find((layout) => layout.id === "all_valid");
  const selected = artifactsFixture.layouts.find((layout) => layout.id === layoutId);
  assert.ok(baseline && selected, `fixture layout ${layoutId} exists`);
  const nodes = new Map(baseline.nodes.map((node) => [node.path, node]));
  if (selected !== baseline) selected.nodes.forEach((node) => nodes.set(node.path, node));
  return [...nodes.values()];
}

function ensureFixtureParent(root, relativePath) {
  let cursor = root;
  for (const component of relativePath.split("/").slice(0, -1)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
      continue;
    }
    assert.equal(stat.isSymbolicLink(), false, `fixture parent must not be a symlink: ${relativePath}`);
    assert.equal(stat.isDirectory(), true, `fixture parent must be a directory: ${relativePath}`);
  }
}

function materializeArtifacts(layoutId, parent = os.tmpdir()) {
  const record = makeOwnedRoot(parent);
  const documents = documentMap();
  for (const node of mergedLayout(layoutId)) {
    const absolute = path.join(record.raw, ...node.path.split("/"));
    if (node.node_type === "missing") continue;
    ensureFixtureParent(record.raw, node.path);
    if (node.node_type === "directory") {
      let stat;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        fs.mkdirSync(absolute, { mode: 0o700 });
      }
      if (stat) {
        assert.equal(stat.isSymbolicLink(), false, `fixture directory must not be a symlink: ${node.path}`);
        assert.equal(stat.isDirectory(), true, `fixture directory has an incompatible node: ${node.path}`);
      }
    } else if (node.node_type === "symlink") {
      fs.symlinkSync(node.target, absolute);
    } else if (node.node_type === "special") {
      const result = spawnSync("/usr/bin/mkfifo", [absolute], { encoding: "utf8" });
      assert.equal(result.status, 0, `mkfifo fixture: ${result.stderr}`);
    } else {
      assert.equal(node.node_type, "regular");
      const document = documents.get(node.document_id);
      assert.ok(document, `document ${node.document_id} exists`);
      const body = document.encoding === "json" ? JSON.stringify(document.content) : document.content;
      fs.writeFileSync(absolute, body, { encoding: "utf8", mode: 0o600 });
    }
  }
  return record;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function lane(report, id) {
  const row = report.lanes.find((candidate) => candidate.id === id);
  assert.ok(row, `report lane ${id} exists`);
  return row;
}

function assertThrowsCode(callback, code) {
  assert.throws(callback, (error) => error instanceof DetectionFloorError && error.code === code);
}

function runBaselineAndArtifactChecks() {
  const clockRow = (generated_at) => ({ source_as_of: null, status: "ready", generated_at });
  const old = clockRow("2026-07-09T00:00:00Z");
  const recent = clockRow("2026-07-11T00:00:00Z");
  const clockNow = "2026-07-12T00:00:00Z";
  assert.deepEqual(foldGeneratedAt([recent, old], clockNow), { generated_at: old.generated_at }, "a recently generated member cannot mask an older member");
  assert.deepEqual(foldGeneratedAt([old, recent], clockNow), { generated_at: old.generated_at }, "generation folding is independent of tied member ordering");
  assert.deepEqual(foldGeneratedAt([recent, clockRow(null)], clockNow), { generated_at: null }, "a missing member clock cannot imply full generation coverage");
  assert.deepEqual(foldGeneratedAt([recent, clockRow("2026-07-13T00:00:00Z")], clockNow), { generated_at: null }, "future member clocks are not valid coverage");
  assert.deepEqual(foldGeneratedAt([recent, { source_as_of: "2026-07-11", status: "ready" }], clockNow), {}, "a mixed source-dated composite never substitutes generation for source freshness");
  const artifactRoot = materializeArtifacts("all_valid");
  const report = buildDetectionReport({
    artifactRoot: artifactRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(report, "krx").artifact.unit, "business_days");
  assert.equal(lane(report, "gdelt_news_tone").artifact.reason, "ok",
    "GDELT RFC3339 row timestamps must remain valid source evidence");
  assert.equal(lane(report, "gdelt_news_tone").artifact.source_as_of, "2026-07-10T15:02:00Z",
    "GDELT source freshness uses the latest provider row timestamp");
  assert.equal(lane(report, "fred_banking").artifact.reason, "ok",
    "the daily FRED contract must not require a series emitted by the monthly artifact");
  for (const [offset, state, status] of [
    [13, "fresh", "ready"], [14, "delayed", "stale"],
    [20, "delayed", "stale"], [21, "stopped", "stale"],
  ]) {
    const now = new Date(Date.UTC(2026, 6, 10 + offset, 12)).toISOString();
    const ownerReport = buildDetectionReport({ artifactRoot: artifactRoot.raw,
      calendars: calendarsFixture, now });
    const ownerLane = lane(ownerReport, "global_scouter");
    assert.equal(ownerLane.artifact.status, status, `owner source day ${offset}: ${state}`);
    assert.equal(ownerLane.status, status, `owner lane day ${offset}: ${state}`);
  }
  const fredSources = lane(report, "fred_banking").source_artifacts;
  assert.deepEqual(fredSources.map((row) => row.id), [
    "fred_banking_daily", "fred_banking_weekly", "fred_banking_monthly", "fred_banking_quarterly",
  ]);
  assert.equal(fredSources[3].source_as_of, "2026-01-01", "the canonical raw quarter-start date remains visible");
  assert.equal(fredSources[3].source_age_anchor, "2026-03-31", "only age calculation moves to quarter end");
  assert.equal(fredSources[3].source_state, "fresh");
  assert.equal(validateDetectionReport(report), true, "the artifact-derived report self-validates");

  for (const [now, age, status] of [
    ["2026-07-12T09:18:00Z", 2, "ready"],
    ["2026-07-13T09:18:00Z", 3, "stale"],
  ]) {
    const macro = lane(buildDetectionReport({ artifactRoot: artifactRoot.raw,
      calendars: calendarsFixture, now }), "fred_macro");
    assert.equal(macro.artifact.source_as_of, "2026-07-10");
    assert.equal(macro.artifact.age, age, `FRED macro content age at ${now}`);
    assert.equal(macro.artifact.status, status, `FRED macro content status at ${now}`);
  }

  const krxRoot = materializeArtifacts("all_valid");
  const krxPath = path.join(krxRoot.raw, "data", "admin", "fenok-edge-korea-krx-daily-index.json");
  const krxDocument = readJson(krxPath);
  const krxAt = (source, now) => {
    krxDocument.as_of = source;
    fs.writeFileSync(krxPath, JSON.stringify(krxDocument), { encoding: "utf8", mode: 0o600 });
    return lane(buildDetectionReport({ artifactRoot: krxRoot.raw, calendars: calendarsFixture, now }), "krx");
  };
  for (const [source, age, status] of [
    ["2026-09-22", 1, "ready"], ["2026-09-21", 2, "ready"],
    ["2026-09-18", 3, "stale"],
  ]) {
    const row = krxAt(source, "2026-09-27T12:00:00Z");
    assert.equal(row.artifact.age, age, `KRX ${source} source age`);
    assert.equal(row.artifact.status, status, `KRX ${source} source status`);
  }
  for (const source of ["2026-02-30", "2026-09-28"]) {
    const row = krxAt(source, "2026-09-27T12:00:00Z");
    assert.notEqual(row.artifact.status, "ready", `${source} cannot become fresh KRX content`);
  }
  assert.equal(krxAt("2026-09-28", "2026-09-27T14:30:00Z").artifact.reason, "future_source",
    "KRX tomorrow remains future before Seoul midnight");
  assert.equal(krxAt("2026-09-28", "2026-09-27T15:30:00Z").artifact.status, "ready",
    "KRX date-only today is valid after Seoul midnight, before UTC midnight");
  assert.equal(krxAt("2026-09-28", "2026-09-27T14:30:00Z").artifact.reason, "future_source",
    "KRX tomorrow remains future before Seoul midnight");
  assert.equal(krxAt("2026-09-28", "2026-09-27T15:30:00Z").artifact.status, "ready",
    "KRX date-only today is valid after Seoul midnight, before UTC midnight");

  const staleDailyRoot = materializeArtifacts("all_valid");
  const staleDailyPath = path.join(staleDailyRoot.raw, "data", "macro", "fred-banking-daily.json");
  const staleDaily = readJson(staleDailyPath);
  staleDaily.source_as_of = "2026-06-01";
  fs.writeFileSync(staleDailyPath, JSON.stringify(staleDaily), { encoding: "utf8", mode: 0o600 });
  const staleDailyReport = buildDetectionReport({
    artifactRoot: staleDailyRoot.raw,
    calendars: calendarsFixture, now: expectedFixture.baseline.now,
  });
  assert.equal(lane(staleDailyReport, "fred_banking").source_artifacts[0].source_state, "stopped");
  assert.equal(lane(staleDailyReport, "fred_banking").source_artifacts[3].source_state, "fresh");
  assert.equal(lane(staleDailyReport, "fred_banking").artifact.status, "stale",
    "a stale daily file must not hide behind a fresh slow quarterly file");

  for (const invalid of ["2026-02-30", "2026-07-12"]) {
    const invalidRoot = materializeArtifacts("all_valid");
    const invalidPath = path.join(invalidRoot.raw, "data", "macro", "fred-banking-daily.json");
    const document = readJson(invalidPath);
    document.source_as_of = invalid;
    fs.writeFileSync(invalidPath, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
    const invalidReport = buildDetectionReport({
      artifactRoot: invalidRoot.raw,
      calendars: calendarsFixture, now: expectedFixture.baseline.now,
    });
    assert.notEqual(lane(invalidReport, "fred_banking").artifact.status, "ready",
      `${invalid} cannot become fresh`);
  }

  const wrongMonthlyRoot = materializeArtifacts("all_valid");
  const monthlyPath = path.join(wrongMonthlyRoot.raw, "data", "macro", "fred-banking-monthly.json");
  const wrongMonthly = readJson(monthlyPath);
  wrongMonthly.series = { PLACEHOLDER: [{ date: "2026-06-01", value: 1 }] };
  fs.writeFileSync(monthlyPath, JSON.stringify(wrongMonthly), { encoding: "utf8", mode: 0o600 });
  const wrongMonthlyReport = buildDetectionReport({
    artifactRoot: wrongMonthlyRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(wrongMonthlyReport, "fred_banking").artifact.reason, "schema_drift",
    "the monthly FRED contract must reject an artifact without the Korea rate series");

  // B-OUTCOME-CLOCKS: a source-dateless lane (every artifact contract
  // not_applicable) projects its artifact's own generated_at honestly next to
  // source_as_of=null; source-dated lanes and missing artifacts never carry the
  // key, and the validator accepts only canonical UTC or null on dateless rows.
  for (const id of ["stockanalysis_etf_universe", "yahoo_etf_fallback"]) {
    assert.equal(lane(report, id).artifact.source_as_of, null, `${id} stays provider-dateless`);
    assert.equal(lane(report, id).artifact.generated_at, "2026-07-11T00:00:00Z",
      `${id} projects the fixture artifact's generated_at without promoting it into source_as_of`);
  }
  assert.equal(Object.hasOwn(lane(report, "treasury_tga").artifact, "generated_at"), false,
    "a source-dated lane never carries generated_at");
  assert.equal(Object.hasOwn(lane(report, "stockanalysis_etf_detail").artifact, "generated_at"), false,
    "a missing dateless artifact projects no generated_at (nothing is fabricated)");
  const generatedAtNull = clone(report);
  lane(generatedAtNull, "stockanalysis_etf_universe").artifact.generated_at = null;
  assert.equal(validateDetectionReport(generatedAtNull), true, "null generated_at is an honest dateless row");
  const generatedAtMalformed = clone(report);
  lane(generatedAtMalformed, "stockanalysis_etf_universe").artifact.generated_at = "2026-07-11";
  assertThrowsCode(() => validateDetectionReport(generatedAtMalformed), "clock_error");
  const generatedAtOnDated = clone(report);
  lane(generatedAtOnDated, "treasury_tga").artifact.generated_at = "2026-07-11T00:00:00Z";
  assertThrowsCode(() => validateDetectionReport(generatedAtOnDated), "schema_error");

  const staleStockFinancialRoot = materializeArtifacts("all_valid");
  const staleStatePath = path.join(
    staleStockFinancialRoot.raw,
    "data/admin/stockanalysis-recovery/states/stock/AAPL.json",
  );
  const staleState = readJson(staleStatePath);
  staleState.resolution_state = "lkg_primary";
  staleState.retry = true;
  staleState.current.path = "data/admin/stockanalysis-recovery/lkg/stock/AAPL.json";
  staleState.current.fetched_at = "2026-07-01T00:00:00Z";
  staleState.latest_failure = { observed_at: expectedFixture.baseline.now, error: "provider failure" };
  staleState.updated_at = expectedFixture.baseline.now;
  fs.writeFileSync(staleStatePath, JSON.stringify(staleState), { encoding: "utf8", mode: 0o600 });
  const staleStockFinancialReport = buildDetectionReport({
    artifactRoot: staleStockFinancialRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(staleStockFinancialReport, "stockanalysis_stock_financial").artifact.status, "stale",
    "a new failure/update clock cannot refresh old retained collection bytes");

  const stockFinancialContracts = DATA_SUPPLY_DETECTION_CONFIG.lanes
    .find((item) => item.id === "stockanalysis_stock_financial").producer_members[0].artifact_contracts;
  for (const [name, mutate, expectedReason] of [
    ["missing current", (state) => { delete state.current; }, "schema_drift"],
    ["wrong current path", (state) => { state.current.path = "data/stockanalysis/stocks/NVDA.json"; }, "schema_drift"],
    ["missing digest", (state) => { delete state.current.payload_sha256; }, "schema_drift"],
    ["malformed collection clock", (state) => { state.current.fetched_at = "2026-02-30T00:00:00Z"; }, "schema_drift"],
    ["one future collection clock", (state) => { state.current.fetched_at = "2026-07-12T00:00:00Z"; }, "future_source"],
    ["future collection clocks", (state) => { state.current.fetched_at = "2026-07-12T00:00:00Z"; }, "future_source"],
  ]) {
    const variantRoot = materializeArtifacts("all_valid");
    const statePath = path.join(variantRoot.raw, "data/admin/stockanalysis-recovery/states/stock/AAPL.json");
    const state = readJson(statePath);
    mutate(state);
    fs.writeFileSync(statePath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    if (name === "future collection clocks") {
      for (const contract of stockFinancialContracts) {
        const siblingPath = path.join(variantRoot.raw, contract.path);
        const sibling = readJson(siblingPath);
        sibling.current.fetched_at = state.current.fetched_at;
        fs.writeFileSync(siblingPath, JSON.stringify(sibling), { encoding: "utf8", mode: 0o600 });
      }
    }
    const variant = buildDetectionReport({
      artifactRoot: variantRoot.raw, calendars: calendarsFixture, now: expectedFixture.baseline.now,
    });
    assert.equal(lane(variant, "stockanalysis_stock_financial").artifact.reason, expectedReason,
      `${name} must not pass as a fresh collection`);
  }

  for (const [laneId, relativePath, mutate] of [
    ["benchmarks", "data/benchmarks/msci.json", (payload) => { delete payload.metadata.update_frequency; }],
    ["benchmarks", "data/benchmarks/msci.json", (payload) => { payload.metadata.update_frequency = "monthly"; }],
    ["global_scouter", "data/global-scouter/core/metadata.json", (payload) => { delete payload.update_frequency; }],
    ["global_scouter", "data/global-scouter/core/metadata.json", (payload) => { payload.update_frequency = "monthly"; }],
  ]) {
    const cadenceRoot = materializeArtifacts("all_valid");
    const cadencePath = path.join(cadenceRoot.raw, relativePath);
    const payload = readJson(cadencePath);
    mutate(payload);
    fs.writeFileSync(cadencePath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    const cadenceReport = buildDetectionReport({
      artifactRoot: cadenceRoot.raw,
      calendars: calendarsFixture,
      now: expectedFixture.baseline.now,
    });
    assert.equal(lane(cadenceReport, laneId).artifact.reason, "schema_drift",
      `${laneId} cadence evidence must fail closed when missing or wrong`);
  }

  for (const artifactCase of expectedFixture.artifact_cases) {
    if (!artifactCase.expected_reason) continue;
    const variantRoot = materializeArtifacts(artifactCase.layout_id);
    if (artifactCase.expected_reason) {
      const variant = buildDetectionReport({ artifactRoot: variantRoot.raw, calendars: calendarsFixture, now: expectedFixture.baseline.now });
      const variantLane = lane(variant, artifactCase.lane_id ?? "fred_macro");
      assert.equal(variantLane.reason, artifactCase.expected_reason, artifactCase.layout_id);
      if (artifactCase.expected_status) assert.equal(variantLane.status, artifactCase.expected_status, artifactCase.layout_id);

    }
  }
  const inconsistentSoxRoot = materializeArtifacts("all_valid");
  const inconsistentSoxPath = path.join(inconsistentSoxRoot.raw, "data", "indices", "nasdaq-giw-sox-constituents.json");
  const inconsistentSox = JSON.parse(fs.readFileSync(inconsistentSoxPath, "utf8"));
  inconsistentSox.symbols[0] = "MISMATCH";
  fs.writeFileSync(inconsistentSoxPath, JSON.stringify(inconsistentSox));
  const inconsistentSoxReport = buildDetectionReport({
    artifactRoot: inconsistentSoxRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(inconsistentSoxReport, "nasdaq_giw_sox").artifact.reason, "schema_drift",
    "SOX artifact symbols and normalized rows must remain identity-bound");
  const malformedSurfaceCountsRoot = materializeArtifacts("all_valid");
  const malformedSurfaceCountsPath = path.join(malformedSurfaceCountsRoot.raw, "data", "stockanalysis", "surfaces", "index.json");
  const malformedSurfaceCounts = JSON.parse(fs.readFileSync(malformedSurfaceCountsPath, "utf8"));
  malformedSurfaceCounts.counts.ok = "25";
  fs.writeFileSync(malformedSurfaceCountsPath, JSON.stringify(malformedSurfaceCounts), { encoding: "utf8", mode: 0o600 });
  const malformedSurfaceCountsReport = buildDetectionReport({
    artifactRoot: malformedSurfaceCountsRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(malformedSurfaceCountsReport, "stockanalysis_surfaces").artifact.reason, "schema_drift",
    "object_fields rejects a wrong canonical count type instead of silently accepting it");
  const partialSurfaceIndexRoot = materializeArtifacts("all_valid");
  const partialSurfaceIndexPath = path.join(partialSurfaceIndexRoot.raw, "data", "stockanalysis", "surfaces", "index.json");
  const partialSurfaceIndex = JSON.parse(fs.readFileSync(partialSurfaceIndexPath, "utf8"));
  partialSurfaceIndex.results.pop();
  partialSurfaceIndex.counts = { ...partialSurfaceIndex.counts, surfaces_requested: 24, ok: 24 };
  fs.writeFileSync(partialSurfaceIndexPath, JSON.stringify(partialSurfaceIndex), { encoding: "utf8", mode: 0o600 });
  const partialSurfaceIndexReport = buildDetectionReport({
    artifactRoot: partialSurfaceIndexRoot.raw,
    calendars: calendarsFixture,
    now: expectedFixture.baseline.now,
  });
  assert.equal(lane(partialSurfaceIndexReport, "stockanalysis_surfaces").artifact.reason, "schema_drift",
    "partial canonical surface index cannot satisfy full core coverage");
  return { artifactRoot, report };
}

function runCompositeSourceFoldChecks() {
  const artifactRoot = materializeArtifacts("all_valid");
  const symbolsPath = path.join(artifactRoot.raw, "data", "slickcharts", "symbols.json");
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, "utf8"));
  symbols.history[0].date = "2026-06-15";
  fs.writeFileSync(symbolsPath, JSON.stringify(symbols), { encoding: "utf8", mode: 0o600 });
  const readyReport = buildDetectionReport({ artifactRoot: artifactRoot.raw, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const readySlick = lane(readyReport, "slickcharts");
  const symbolsMember = readySlick.members.find((member) => member.id === "symbols");
  assert.equal(readySlick.status, "ready");
  assert.equal(readySlick.artifact.source_as_of, "2026-06-15");
  assert.equal(readySlick.artifact.age, symbolsMember.artifact.age);

  const missingTreasuryRoot = materializeArtifacts("all_valid");
  fs.unlinkSync(path.join(missingTreasuryRoot.raw, "data", "slickcharts", "treasury.json"));
  const missingTreasuryReport = buildDetectionReport({ artifactRoot: missingTreasuryRoot.raw, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const missingTreasuryDaily = lane(missingTreasuryReport, "slickcharts").members.find((member) => member.id === "daily");
  assert.equal(missingTreasuryDaily.reason, "missing_artifact");
  assert.equal(missingTreasuryReport.producer_member_count, DATA_SUPPLY_DETECTION_CONFIG.producer_member_count);

  for (const [key, relativePath] of [
    ["cnn", "data/sentiment/cnn-fear-greed.json"],
    ["cftc", "data/sentiment/cftc-sp500.json"],
    ["crypto", "data/sentiment/crypto-fear-greed.json"],
    ["vix", "data/sentiment/vix.json"],
    ["move", "data/sentiment/move.json"],
  ]) {
    const missingSentimentRoot = materializeArtifacts("all_valid");
    fs.unlinkSync(path.join(missingSentimentRoot.raw, relativePath));
    const missingSentimentReport = buildDetectionReport({
      artifactRoot: missingSentimentRoot.raw,
      calendars: calendarsFixture,
      now: expectedFixture.baseline.now,
    });
    const missingSentiment = lane(missingSentimentReport, "sentiment");
    assert.equal(missingSentiment.status, "unavailable", `${key} missing canonical degrades sentiment`);
    assert.equal(missingSentiment.reason, "missing_artifact", `${key} missing canonical is named honestly`);
  }

  const staleRoot = materializeArtifacts("all_valid");
  const dailyPath = path.join(staleRoot.raw, "data", "slickcharts", "gainers.json");
  const daily = JSON.parse(fs.readFileSync(dailyPath, "utf8"));
  daily.history[0].date = "2026-01-01";
  fs.writeFileSync(dailyPath, JSON.stringify(daily), { encoding: "utf8", mode: 0o600 });
  const report = buildDetectionReport({ artifactRoot: staleRoot.raw, calendars: calendarsFixture, now: expectedFixture.baseline.now });
  const slick = lane(report, "slickcharts");
  assert.equal(slick.status, "stale");
  assert.equal(slick.artifact.reason, "stale");
  assert.equal(slick.artifact.source_as_of, "2026-01-01");
  assert.equal(slick.artifact.age, slick.members.find((member) => member.id === "daily").artifact.age);
}

function runCalendarChecks() {
  for (const fixtureCase of calendarsFixture.cases) {
    if (fixtureCase.kind === "schedule") {
      const schedule = calendarsFixture.schedules.find((row) => row.id === fixtureCase.schedule_id);
      assert.ok(schedule, fixtureCase.schedule_id);
      const result = evaluateAttemptCadence(fixtureCase.observed_at, [schedule.cron], schedule.calendar_id, fixtureCase.now, calendarsFixture);
      assert.equal(result.reason === "ok" ? "ready" : result.reason, fixtureCase.expected, fixtureCase.id);
      continue;
    }
    if (fixtureCase.expected === "workflow_unobserved") {
      const cadence = evaluateAttemptCadence(null, [], fixtureCase.calendar_id, fixtureCase.now, calendarsFixture);
      assert.equal(cadence.reason, "workflow_unobserved", fixtureCase.id);
      const freshness = evaluateFreshness(fixtureCase.source_as_of, { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, due_policy: fixtureCase.due_policy }, fixtureCase.now, calendarsFixture);
      assert.equal(freshness.reason, "ok", `${fixtureCase.id}: artifact age remains independent`);
      continue;
    }
    const policy = fixtureCase.unit === "due_window"
      ? { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, due_policy: fixtureCase.due_policy }
      : { unit: fixtureCase.unit, calendar: fixtureCase.calendar_id, max_staleness: fixtureCase.max_staleness };
    const result = evaluateFreshness(fixtureCase.source_as_of, policy, fixtureCase.now, calendarsFixture);
    assert.equal(result.reason === "ok" ? "ready" : result.reason, fixtureCase.expected, fixtureCase.id);
  }
}

async function main() {
  try {
    runBaselineAndArtifactChecks();
    runCompositeSourceFoldChecks();
    runCalendarChecks();
  } finally {
    for (const record of [...ownedRoots].reverse()) {
      if (fs.existsSync(record.raw)) safeCleanup(record);
    }
  }
  process.stdout.write("test-build-data-supply-detection-floor: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
