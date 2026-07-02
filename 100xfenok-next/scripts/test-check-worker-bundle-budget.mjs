import assert from "node:assert/strict";

import {
  BASELINE_DELTA_BYTES,
  BUILD_COMMAND,
  evaluateBudget,
  formatKiB,
  HARD_GZIP_BYTES,
  missingBuildMessage,
  parseWranglerUploadSummary,
  serializeBaseline,
  summarizeMetafileInputs,
  WARN_GZIP_BYTES,
} from "./check-worker-bundle-budget.mjs";

assert.equal(formatKiB(1024), "1.00 KiB");
assert.equal(formatKiB(1536), "1.50 KiB");
assert.equal(WARN_GZIP_BYTES, 2720 * 1024);
assert.equal(HARD_GZIP_BYTES, 2800 * 1024);
assert.equal(BASELINE_DELTA_BYTES, 128 * 1024);

assert.equal(evaluateBudget(2719 * 1024, { baselineGzipBytes: 2600 * 1024 }).status, "pass");
assert.equal(evaluateBudget(2720 * 1024, { baselineGzipBytes: 2600 * 1024 }).status, "warn");
assert.equal(evaluateBudget(2801 * 1024, { baselineGzipBytes: 2800 * 1024 }).status, "fail");
assert.equal(evaluateBudget(2728 * 1024, { baselineGzipBytes: 2600 * 1024 }).exitCode, 0);
assert.equal(evaluateBudget(2729 * 1024, { baselineGzipBytes: 2600 * 1024 }).status, "fail");
assert.equal(evaluateBudget(2729 * 1024, { baselineGzipBytes: 2600 * 1024 }).baselineDeltaBytes, 129 * 1024);

assert.deepEqual(
  parseWranglerUploadSummary("Total Upload: 13142.04 KiB / gzip: 2667.19 KiB"),
  { rawKiB: 13142.04, gzipKiB: 2667.19 },
);

assert.deepEqual(
  JSON.parse(serializeBaseline({
    rawBytes: 13_508_928,
    gzipBytes: 2_737_006,
  }, "2026-07-02T04:01:59.000Z")),
  {
    updated_at: "2026-07-02T04:01:59.000Z",
    raw_bytes: 13_508_928,
    gzip_bytes: 2_737_006,
    gzip_kib: 2672.857421875,
  },
);

assert.deepEqual(
  summarizeMetafileInputs({
    inputs: {
      ".open-next/worker.js": { bytes: 2278 },
      ".open-next/server-functions/default/handler.mjs": { bytes: 9_796_431 },
      ".open-next/middleware/handler.mjs": { bytes: 387_823 },
    },
  }, 2),
  [
    { path: ".open-next/server-functions/default/handler.mjs", bytes: 9_796_431 },
    { path: ".open-next/middleware/handler.mjs", bytes: 387_823 },
  ],
);

assert.match(missingBuildMessage("missing .open-next/worker.js"), /missing \.open-next\/worker\.js/);
assert.match(missingBuildMessage("missing .open-next/worker.js"), new RegExp(BUILD_COMMAND));

console.log("[test-check-worker-bundle-budget] OK");
