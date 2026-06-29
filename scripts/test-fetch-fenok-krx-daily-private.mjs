#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildBridgeIndex,
  buildConfig,
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
  assert.equal(bridge.daily_accumulation.automatic_cron_installed, true);
  assert.equal(bridge.daily_accumulation.latest_daily_manifest_path, "_private/admin/fenok-edge-korea/daily/krx_daily_20260629/manifest.json");
  assert.match(bridge.daily_command, /scripts\/fetch-fenok-krx-daily-private\.mjs/);
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

console.log("test-fetch-fenok-krx-daily-private: ok");
