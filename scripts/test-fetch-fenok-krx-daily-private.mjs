#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildBridgeIndex,
  buildConfig,
  buildKrxPublicIndexCloses,
  endpointClass,
  generateWeekdayDates,
  getRowCount,
  parseArgs,
  run,
} from "./fetch-fenok-krx-daily-private.mjs";

assert.deepEqual(generateWeekdayDates("20260629", 3), ["20260625", "20260626", "20260629"]);
assert.equal(endpointClass("stk_bydd_trd"), "daily-history");
assert.equal(endpointClass("stk_isu_base_info"), "snapshot");
assert.equal(endpointClass("sri_bond_info"), "snapshot");
assert.equal(getRowCount({ OutBlock_1: [{ ISU_CD: "005930" }, { ISU_CD: "000660" }] }), 2);
assert.equal(getRowCount({ respCode: "NO_DATA", respMsg: "empty" }), 0);

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

console.log("test-fetch-fenok-krx-daily-private: ok");
