#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KRX_LKG_KEY,
  KRX_LANE_ID,
  applyKrxLkgContract,
  buildBridgeIndex,
  buildConfig,
  buildKrxPublicIndexCloses,
  buildKrxPublicKosdaqMarketCapAggregate,
  endpointClass,
  generateWeekdayDates,
  getRowCount,
  parseArgs,
  run,
  validKrxBridge,
  validateRun,
  writeGithubOutputs,
} from "./fetch-fenok-krx-daily-private.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";

assert.deepEqual(generateWeekdayDates("20260629", 3), ["20260625", "20260626", "20260629"]);
assert.equal(endpointClass("stk_bydd_trd"), "daily-history");
assert.equal(endpointClass("stk_isu_base_info"), "snapshot");
assert.equal(endpointClass("sri_bond_info"), "snapshot");
assert.equal(getRowCount({ OutBlock_1: [{ ISU_CD: "005930" }, { ISU_CD: "000660" }] }), 2);
assert.equal(getRowCount({ respCode: "NO_DATA", respMsg: "empty" }), 0);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-github-output-"));
  const outputPath = path.join(root, "output.txt");
  writeGithubOutputs({
    attempt_outcome: "success",
    exit_code: 0,
    recovery: { updated: true, reason: "ok" },
  }, outputPath);
  const output = fs.readFileSync(outputPath, "utf8");
  assert.match(output, /^attempt_outcome=success$/mu);
  assert.match(output, /^recovery_updated=true$/mu);
  assert.match(output, /^recovery_exit_code=0$/mu);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const plan = await run(["--end-date", "20260629", "--days", "1", "--plan-only"]);
  assert.equal(plan.mode, "plan_only");
  assert.equal(plan.ok, true);
  assert.equal(plan.raw_public, false);
  assert.equal(plan.endpoint_count, 31);
  assert.equal(plan.request_budget.estimated_calls, 31);
  assert.equal(plan.request_budget.status, "within_budget");
  assert.match(plan.output_root, /^_private\/admin\/fenok-edge-korea\/daily\/krx_daily_20260629$/);
}

{
  const plan = await run(["--end-date", "20260629", "--days", "2", "--max-calls", "40", "--plan-only"]);
  assert.equal(plan.ok, false);
  assert.equal(plan.request_budget.estimated_calls, 62);
  assert.equal(plan.request_budget.status, "blocked_over_budget");
}

{
  const config = buildConfig(parseArgs([
    "--end-date",
    "20260629",
    "--output-root",
    "_private/admin/fenok-edge-korea/daily/krx_daily_20260629",
    "--bridge-index",
    "data/admin/fenok-edge-korea-krx-daily-index.json",
    "--scheduled-run",
  ]));
  const manifest = {
    backfill_type: "krx-daily-scheduled-accumulation",
    completed_at: "2026-06-29T10:00:00.000Z",
    date_range: {
      date_count: 1,
      dates: ["2026-06-29"],
      end_date: "2026-06-29",
      planned_full_trading_day_count: 252,
    },
    attempted_call_count: 31,
    endpoint_count: 31,
    fetched_at: "2026-06-29T09:00:00.000Z",
    files: [],
    normalized_score_candidates: [],
    request_budget: config.requestBudget,
    summary: { total_files: 31, success_files: 31, empty_files: 0, failed_files: 0, total_rows: 1000, failed_reasons: {} },
  };
  const groupManifests = {
    core_stock_index: { endpoint_count: 9, date_count: 1, files: [], summary: manifest.summary },
  };
  const bridge = buildBridgeIndex(manifest, groupManifests, config);
  assert.equal(validKrxBridge(bridge), true);
  assert.equal(bridge.raw_public, false);
  assert.equal(bridge.derived_rim_inputs.status, "partial_or_unavailable");
  assert.deepEqual(bridge.derived_rim_inputs.missing, ["kospi_weights", "korea_10y"]);
  assert.equal(bridge.daily_accumulation.automatic_cron_installed, true);
  assert.equal(bridge.daily_accumulation.latest_daily_manifest_path, "_private/admin/fenok-edge-korea/daily/krx_daily_20260629/manifest.json");
  assert.match(bridge.daily_command, /scripts\/fetch-fenok-krx-daily-private\.mjs/);
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-derived-test-"));
  fs.mkdirSync(path.join(tmpDir, "raw/core_stock_index/stk_bydd_trd"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "raw/bond_commodity_esg/kts_bydd_trd"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "raw/core_stock_index/stk_bydd_trd/20260629.json"),
    `${JSON.stringify({
      OutBlock_1: [
        { MKT_NM: "KOSPI", ISU_CD: "005930", ISU_NM: "삼성전자", MKTCAP: "2000" },
        { MKT_NM: "KOSPI", ISU_CD: "000660", ISU_NM: "SK하이닉스", MKTCAP: "1000" },
        { MKT_NM: "KOSDAQ", ISU_CD: "123456", ISU_NM: "샘플", MKTCAP: "9999" },
      ],
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "raw/bond_commodity_esg/kts_bydd_trd/20260629.json"),
    `${JSON.stringify({
      OutBlock_1: [
        { ISU_NM: "국고04250-3606(26-6)", BND_EXP_TP_NM: "10", GOVBND_ISU_TP_NM: "지표", CLSPRC_YD: "4.241" },
      ],
    }, null, 2)}\n`,
  );
  const config = buildConfig(parseArgs([
    "--end-date",
    "20260629",
    "--output-root",
    tmpDir,
    "--bridge-index",
    path.join(tmpDir, "bridge.json"),
    "--scheduled-run",
  ]));
  const manifest = {
    backfill_type: "krx-daily-scheduled-accumulation",
    completed_at: "2026-06-29T10:00:00.000Z",
    date_range: {
      date_count: 1,
      dates: ["2026-06-29"],
      end_date: "2026-06-29",
      planned_full_trading_day_count: 252,
    },
    endpoint_count: 31,
    fetched_at: "2026-06-29T09:00:00.000Z",
    files: [],
    normalized_score_candidates: [],
    request_budget: config.requestBudget,
    summary: { total_files: 31, success_files: 31, empty_files: 0, failed_files: 0, total_rows: 1000, failed_reasons: {} },
  };
  const groupManifests = {
    core_stock_index: { endpoint_count: 9, date_count: 1, files: [], summary: manifest.summary },
    bond_commodity_esg: { endpoint_count: 12, date_count: 1, files: [], summary: manifest.summary },
  };
  const bridge = buildBridgeIndex(manifest, groupManifests, config);
  assert.equal(bridge.bridge_scope, "stats_and_public_safe_rim_inputs_private_path_refs_no_raw_rows");
  assert.equal(bridge.derived_rim_inputs.status, "ready");
  assert.equal(bridge.derived_rim_inputs.kospi_weights.row_count, 2);
  assert.equal(bridge.derived_rim_inputs.kospi_weights.rows[0].code, "005930");
  assert.equal(bridge.derived_rim_inputs.kospi_weights.rows[0].weight_pct, 66.6666666667);
  assert.equal(bridge.derived_rim_inputs.korea_10y.value, 0.04241);
  assert.equal(JSON.stringify(bridge).includes("TDD_CLSPRC"), false);
  assert.equal(JSON.stringify(bridge).includes("LIST_SHRS"), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-test-"));
  const result = await run([
    "--end-date",
    "20260629",
    "--output-root",
    tmpDir,
    "--bridge-index",
    path.join(tmpDir, "bridge.json"),
    "--no-fetch",
    "--no-write",
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.wrote, false);
  assert.equal(result.summary.failed_files, 31);
  assert.ok(result.validation_errors.some((item) => item.includes("failed_files=31")));
}

// Slice 1: public-safe aggregate index closes — value-changing exclusion proof.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-public-index-"));
  const dir = (apiId) => path.join(tmpDir, "raw/core_stock_index", apiId);
  for (const apiId of ["krx_dd_trd", "kospi_dd_trd", "kosdaq_dd_trd"]) {
    fs.mkdirSync(dir(apiId), { recursive: true });
  }
  // All-market file carries TWO aggregate index rows AND one per-issuer row that
  // MUST be excluded from the public surface.
  fs.writeFileSync(path.join(dir("krx_dd_trd"), "20260629.json"), `${JSON.stringify({
    OutBlock_1: [
      { IDX_CLSS: "KRX", IDX_NM: "KRX 300", CLSPRC_IDX: "1650.25", CMPPREVDD_IDX: "5.5", FLUC_RT: "0.33", ACC_TRDVOL: "120000", ACC_TRDVAL: "900000" },
      { IDX_CLSS: "KRX", IDX_NM: "KTOP 30", CLSPRC_IDX: "12000.10", CMPPREVDD_IDX: "-30.0", FLUC_RT: "-0.25", ACC_TRDVOL: "80000", ACC_TRDVAL: "700000" },
      // Per-issuer contamination — MUST be rejected (carries ISU_CD / ISU_NM).
      { ISU_CD: "005930", ISU_NM: "삼성전자", MKTCAP: "500000000", CLSPRC_IDX: "71000" },
    ],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir("kospi_dd_trd"), "20260629.json"), `${JSON.stringify({
    OutBlock_1: [
      { IDX_CLSS: "KOSPI", IDX_NM: "코스피", CLSPRC_IDX: "2500.50", CMPPREVDD_IDX: "10.5", FLUC_RT: "0.42", ACC_TRDVOL: "500000", ACC_TRDVAL: "8000000" },
    ],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir("kosdaq_dd_trd"), "20260629.json"), `${JSON.stringify({
    OutBlock_1: [
      { IDX_CLSS: "KOSDAQ", IDX_NM: "코스닥", CLSPRC_IDX: "850.75", CMPPREVDD_IDX: "-2.1", FLUC_RT: "-0.25", ACC_TRDVOL: "300000", ACC_TRDVAL: "3000000" },
    ],
  }, null, 2)}\n`);

  const config = buildConfig(parseArgs(["--end-date", "20260629", "--output-root", tmpDir]));
  const manifest = { completed_at: "2026-06-29T10:00:00.000Z", date_range: { end_date: "2026-06-29" } };
  const artifact = buildKrxPublicIndexCloses(manifest, config);

  // Index rows flow through to the public artifact.
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.row_count, 4, "2 all-market + 1 KOSPI + 1 KOSDAQ index rows");
  assert.equal(artifact.raw_input_row_count, 5, "5 raw rows observed (incl. the issuer row)");
  const kospi = artifact.indices.find((row) => row.index_name === "코스피");
  assert.ok(kospi, "KOSPI index row present");
  assert.equal(kospi.close, 2500.5);
  assert.equal(kospi.change, 10.5);
  assert.equal(kospi.change_pct, 0.42);
  assert.equal(kospi.market, "KOSPI");

  // Per-issuer rows CANNOT flow to the public surface.
  assert.equal(artifact.excluded_issuer_rows, 1, "the issuer row was rejected");
  assert.equal(artifact.per_issuer_rows, false);
  assert.equal(artifact.aggregate_only, true);
  assert.ok(artifact.indices.every((row) => !("market_cap" in row) && !("code" in row)));
  const serialized = JSON.stringify(artifact);
  assert.equal(serialized.includes("005930"), false, "issuer code must not appear");
  assert.equal(serialized.includes("삼성전자"), false, "issuer name must not appear");
  assert.equal(serialized.includes("MKTCAP"), false, "per-issuer market cap must not appear");
  assert.equal(serialized.includes("_private/"), false, "no private path may leak into the public surface");

  // Owner-grant license wording rides this artifact.
  assert.match(artifact.license_or_terms_note, /2026-07-19/);
  assert.match(artifact.license_or_terms_note, /public serving/i);
  assert.equal(artifact.raw_public, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Slice 2: KOSDAQ top-N market-cap concentration — derived aggregate only.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-public-kosdaq-mktcap-"));
  const rawDir = path.join(tmpDir, "raw/core_stock_index/ksq_bydd_trd");
  fs.mkdirSync(rawDir, { recursive: true });
  const kosdaqRows = Array.from({ length: 12 }, (_, index) => ({
    MKT_NM: "KOSDAQ",
    ISU_CD: `KQ${String(index + 1).padStart(4, "0")}`,
    ISU_NM: `비공개종목${index + 1}`,
    MKTCAP: String((12 - index) * 100),
    TDD_CLSPRC: String(10000 + index),
    LIST_SHRS: String(1000000 + index),
  }));
  fs.writeFileSync(path.join(rawDir, "20260629.json"), `${JSON.stringify({
    OutBlock_1: [
      ...kosdaqRows,
      { MKT_NM: "KOSPI", ISU_CD: "005930", ISU_NM: "삼성전자", MKTCAP: "99999" },
      { MKT_NM: "KOSDAQ", ISU_CD: "BAD000", ISU_NM: "무효행", MKTCAP: "0" },
    ],
  }, null, 2)}\n`);

  const config = buildConfig(parseArgs(["--end-date", "20260629", "--output-root", tmpDir]));
  const manifest = { completed_at: "2026-06-29T10:00:00.000Z", date_range: { end_date: "2026-06-29" } };
  const artifact = buildKrxPublicKosdaqMarketCapAggregate(manifest, config);

  assert.equal(artifact.schema_version, "fenok_krx_public_kosdaq_market_cap_aggregate.v1");
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.market, "KOSDAQ");
  assert.equal(artifact.aggregate_only, true);
  assert.equal(artifact.per_issuer_rows, false);
  assert.equal(artifact.issuer_count, 12);
  assert.equal(artifact.top_n, 10);
  assert.equal(artifact.total_market_cap, 7800);
  assert.equal(artifact.top_n_market_cap, 7500);
  assert.equal(artifact.top_n_weight, 0.961538461538);
  assert.equal(artifact.top_n_weight_pct, 96.1538461538);
  assert.equal(artifact.excluded_non_kosdaq_rows, 1);
  assert.equal(artifact.excluded_invalid_market_cap_rows, 1);
  assert.equal(artifact.generated_at, manifest.completed_at);
  assert.equal(artifact.as_of, "2026-06-29");

  // No issuer identity, row, raw field name, or private path may leak.
  const serialized = JSON.stringify(artifact);
  for (const forbidden of [
    "KQ0001",
    "비공개종목1",
    "005930",
    "삼성전자",
    "MKTCAP",
    "TDD_CLSPRC",
    "LIST_SHRS",
    "_private/",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public Slice 2 artifact leaked ${forbidden}`);
  }
  assert.deepEqual(
    Object.keys(artifact).sort(),
    [
      "aggregate_only",
      "as_of",
      "excluded_invalid_market_cap_rows",
      "excluded_non_kosdaq_rows",
      "generated_at",
      "issuer_count",
      "license_or_terms_note",
      "market",
      "notes",
      "per_issuer_rows",
      "public_serving",
      "raw_input_row_count",
      "raw_public",
      "schema_version",
      "source",
      "source_endpoint",
      "status",
      "top_n",
      "top_n_market_cap",
      "top_n_weight",
      "top_n_weight_pct",
      "total_market_cap",
      "unit",
      "weight_method",
    ].sort(),
    "public Slice 2 schema must remain aggregate-only and allowlist-shaped",
  );

  fs.rmSync(path.join(rawDir, "20260629.json"));
  const unavailable = buildKrxPublicKosdaqMarketCapAggregate(manifest, config);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.issuer_count, 0);
  assert.equal(unavailable.total_market_cap, null);
  assert.equal(unavailable.top_n_market_cap, null);
  assert.equal(unavailable.top_n_weight, null);
  assert.equal(unavailable.top_n_weight_pct, null);

  fs.writeFileSync(path.join(rawDir, "20260629.json"), `${JSON.stringify({
    OutBlock_1: [{ MKT_NM: "KOSDAQ", ISU_CD: "ONLY01", ISU_NM: "부족", MKTCAP: "100" }],
  }, null, 2)}\n`);
  const underfilled = buildKrxPublicKosdaqMarketCapAggregate(manifest, config);
  assert.equal(underfilled.status, "unavailable", "fewer than 10 valid issuers cannot claim a top-10 aggregate");
  assert.equal(underfilled.issuer_count, 1);
  assert.equal(underfilled.total_market_cap, null);
  assert.equal(underfilled.top_n_market_cap, null);
  assert.equal(underfilled.top_n_weight, null);
  assert.equal(underfilled.top_n_weight_pct, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// KOSPI rows cannot mask a missing KOSDAQ daily input; Slice 2 requires at
// least 10 valid KOSDAQ rows even though both issuer endpoints are fetched.
{
  const config = buildConfig(parseArgs(["--end-date", "20260629"]));
  const errors = validateRun({
    summary: { failed_files: 0 },
    files: [
      { date: "2026-06-29", api_id: "stk_bydd_trd", row_count: 944 },
      { date: "2026-06-29", api_id: "ksq_bydd_trd", row_count: 0 },
    ],
  }, config);
  assert.ok(errors.some((item) => item.includes("endpoint=ksq_bydd_trd") && item.includes("minimum=10")));
  assert.equal(errors.some((item) => item.includes("endpoint=stk_bydd_trd")), false);
}

function recoveryBridge(asOf, runId) {
  return {
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    generated_at: `${asOf}T10:31:00.000Z`,
    market: "Korea",
    source: "KRX_OPEN_API",
    raw_public: false,
    as_of: asOf,
    freshness: {
      as_of: asOf,
      source_date_min: asOf,
      source_date_max: asOf,
    },
    latest_run: {
      run_id: runId,
      attempted_call_count: 31,
      summary: {
        total_files: 31,
        success_files: 31,
        empty_files: 0,
        failed_files: 0,
      },
    },
  };
}

function recoveryIndex(asOf) {
  return {
    schema_version: "fenok_krx_public_index_daily.v1",
    market: "Korea",
    source: "KRX_OPEN_API",
    aggregate_only: true,
    per_issuer_rows: false,
    raw_public: false,
    status: "ready",
    as_of: asOf,
    row_count: 1,
    indices: [{ market: "KOSPI", index_name: "코스피", date: asOf, close: 2500 }],
  };
}

function recoveryKosdaq(asOf) {
  return {
    schema_version: "fenok_krx_public_kosdaq_market_cap_aggregate.v1",
    market: "KOSDAQ",
    source: "KRX_OPEN_API",
    aggregate_only: true,
    per_issuer_rows: false,
    raw_public: false,
    status: "ready",
    as_of: asOf,
    issuer_count: 10,
    top_n_weight: 0.75,
  };
}

function recoveryPaths(root) {
  return {
    repoRoot: root,
    bridgeIndexPath: path.join(root, "data/admin/fenok-edge-korea-krx-daily-index.json"),
    publicIndexClosesPath: path.join(root, "data/computed/fenok-edge-korea-krx-index-daily.json"),
    publicKosdaqMarketCapPath: path.join(root, "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"),
  };
}

function recoveryRun(runId, observedAt, eventName = "schedule", runAttempt = 1) {
  return { runId, runAttempt, eventName, observedAt };
}

function applyReady(root, asOf, runId, eventName = "schedule", runAttempt = 1, extra = {}) {
  return applyKrxLkgContract({
    ...recoveryPaths(root),
    bridgeDocument: recoveryBridge(asOf, runId),
    publicIndexCloses: recoveryIndex(asOf),
    publicKosdaqMarketCap: recoveryKosdaq(asOf),
    run: recoveryRun(runId, `${asOf}T10:31:01.000Z`, eventName, runAttempt),
    ...extra,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Strict bridge validation rejects an invalid calendar date or a non-zero
// failure count before the candidate can reach any tracked output.
{
  const valid = recoveryBridge("2026-07-14", "valid-run");
  assert.equal(validKrxBridge(valid), true);
  assert.equal(validKrxBridge({ ...valid, as_of: "2026-02-31" }), false);
  assert.equal(validKrxBridge({
    ...valid,
    latest_run: {
      ...valid.latest_run,
      summary: { ...valid.latest_run.summary, success_files: 30, failed_files: 1 },
    },
  }), false);
}

// Exact failure -> retained LKG -> attempt-1 natural advancing recovery.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-lkg-cycle-"));
  const paths = recoveryPaths(root);
  const seed = applyReady(root, "2026-07-14", "seed-run");
  assert.equal(seed.kind, "success");
  const bridgeBefore = fs.readFileSync(paths.bridgeIndexPath);

  const failed = applyKrxLkgContract({
    ...paths,
    run: recoveryRun("chaos-run", "2026-07-15T10:31:01.000Z", "workflow_dispatch"),
    controlledFailure: true,
  });
  assert.equal(failed.kind, "failure");
  assert.equal(failed.reason, "controlled_failure");
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.deepEqual(failed.retry_set, [KRX_LKG_KEY]);
  assert.deepEqual(fs.readFileSync(paths.bridgeIndexPath), bridgeBefore);

  const dispatch = applyReady(root, "2026-07-16", "manual-run", "workflow_dispatch");
  assert.equal(dispatch.kind, "recovery_requires_schedule");
  assert.deepEqual(fs.readFileSync(paths.bridgeIndexPath), bridgeBefore);

  const retryAttempt = applyReady(root, "2026-07-16", "schedule-retry", "schedule", 2);
  assert.equal(retryAttempt.kind, "recovery_requires_schedule");
  assert.deepEqual(fs.readFileSync(paths.bridgeIndexPath), bridgeBefore);

  const sameSource = applyReady(root, "2026-07-14", "same-source-run");
  assert.equal(sameSource.kind, "not_promotable");
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");
  assert.deepEqual(fs.readFileSync(paths.bridgeIndexPath), bridgeBefore);

  const recovered = applyReady(root, "2026-07-16", "natural-recovery-run");
  assert.equal(recovered.kind, "success");
  assert.equal(recovered.recovered, true);
  assert.equal(readJson(paths.bridgeIndexPath).as_of, "2026-07-16");
  const state = readJson(path.join(root, "data/admin", KRX_LANE_ID, "index.json"));
  assert.deepEqual(state.retry_set, []);
  assert.equal(state.items[KRX_LKG_KEY].recovered_from_run_id, "chaos-run");
  assert.equal(state.items[KRX_LKG_KEY].recovery_run_id, "natural-recovery-run");
  assert.equal(state.items[KRX_LKG_KEY].recovery_event_name, "schedule");
  fs.rmSync(root, { recursive: true, force: true });
}

// A partial tracked-output write is rolled back before the failure state is
// recorded. None of the three tracked bytes may advance independently.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-output-rollback-"));
  const paths = recoveryPaths(root);
  applyReady(root, "2026-07-14", "seed-run");
  const protectedPaths = [
    paths.bridgeIndexPath,
    paths.publicIndexClosesPath,
    paths.publicKosdaqMarketCapPath,
  ];
  const before = protectedPaths.map((target) => fs.readFileSync(target));
  let trackedRenames = 0;
  const io = {
    mkdirSync: fs.mkdirSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    renameSync(source, target) {
      if (protectedPaths.includes(path.resolve(target))) {
        trackedRenames += 1;
        if (trackedRenames === 2) throw new Error("injected second-output rename failure");
      }
      return fs.renameSync(source, target);
    },
  };
  const failed = applyReady(root, "2026-07-15", "partial-write-run", "schedule", 1, { io });
  assert.equal(failed.kind, "failure");
  assert.equal(failed.reason, "unexpected_error");
  protectedPaths.forEach((target, index) => assert.deepEqual(fs.readFileSync(target), before[index]));
  const state = readJson(path.join(root, "data/admin", KRX_LANE_ID, "index.json"));
  assert.deepEqual(state.retry_set, [KRX_LKG_KEY]);
  assert.equal(state.items[KRX_LKG_KEY].latest_failure.run_id, "partial-write-run");
  fs.rmSync(root, { recursive: true, force: true });
}

// State-commit failure is in the same rollback boundary as the tracked outputs.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-state-rollback-"));
  const paths = recoveryPaths(root);
  applyReady(root, "2026-07-14", "seed-run");
  const before = [
    paths.bridgeIndexPath,
    paths.publicIndexClosesPath,
    paths.publicKosdaqMarketCapPath,
  ].map((target) => fs.readFileSync(target));
  const store = new LaneLkgStore({ repoRoot: root, laneId: KRX_LANE_ID });
  store.recordSuccess = () => {
    throw new Error("injected recovery-state write failure");
  };
  const failed = applyReady(root, "2026-07-15", "state-write-run", "schedule", 1, { store });
  assert.equal(failed.kind, "failure");
  [
    paths.bridgeIndexPath,
    paths.publicIndexClosesPath,
    paths.publicKosdaqMarketCapPath,
  ].forEach((target, index) => assert.deepEqual(fs.readFileSync(target), before[index]));
  const state = readJson(path.join(root, "data/admin", KRX_LANE_ID, "index.json"));
  assert.equal(state.items[KRX_LKG_KEY].latest_failure.run_id, "state-write-run");
  fs.rmSync(root, { recursive: true, force: true });
}

// The CLI controlled-failure path is dispatch-only and must not require the
// provider credential or touch the existing tracked outputs.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-krx-controlled-cli-"));
  const paths = recoveryPaths(root);
  applyReady(root, "2026-07-14", "seed-run");
  const bridgeBefore = fs.readFileSync(paths.bridgeIndexPath);
  const controlled = await run([
    "--end-date", "20260715",
    "--bridge-index", paths.bridgeIndexPath,
    "--public-index-closes", paths.publicIndexClosesPath,
    "--public-kosdaq-market-cap", paths.publicKosdaqMarketCapPath,
    "--controlled-failure",
  ], {
    lkgRepoRoot: root,
    runId: "controlled-cli-run",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-15T10:31:01.000Z",
  });
  assert.equal(controlled.controlled_failure, true);
  assert.equal(controlled.attempt_outcome, "failure");
  assert.equal(controlled.exit_code, 0);
  assert.deepEqual(fs.readFileSync(paths.bridgeIndexPath), bridgeBefore);
  await assert.rejects(() => run([
    "--end-date", "20260715",
    "--bridge-index", paths.bridgeIndexPath,
    "--public-index-closes", paths.publicIndexClosesPath,
    "--public-kosdaq-market-cap", paths.publicKosdaqMarketCapPath,
    "--controlled-failure",
  ], {
    lkgRepoRoot: root,
    runId: "invalid-controlled-run",
    eventName: "schedule",
    observedAt: "2026-07-15T10:31:01.000Z",
  }), /requires workflow_dispatch/);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("test-fetch-fenok-krx-daily-private: ok");
