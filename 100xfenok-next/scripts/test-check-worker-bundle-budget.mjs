import assert from "node:assert/strict";

import {
  BUILD_COMMAND,
  evaluateBudget,
  formatKiB,
  missingBuildMessage,
  parseWranglerUploadSummary,
  summarizeMetafileInputs,
} from "./check-worker-bundle-budget.mjs";

assert.equal(formatKiB(1024), "1.00 KiB");
assert.equal(formatKiB(1536), "1.50 KiB");

assert.deepEqual(
  evaluateBudget(2799 * 1024),
  { status: "pass", exitCode: 0 },
);
assert.deepEqual(
  evaluateBudget(2800 * 1024),
  { status: "warn", exitCode: 0 },
);
assert.deepEqual(
  evaluateBudget(2951 * 1024),
  { status: "fail", exitCode: 1 },
);

assert.deepEqual(
  parseWranglerUploadSummary("Total Upload: 13142.04 KiB / gzip: 2667.19 KiB"),
  { rawKiB: 13142.04, gzipKiB: 2667.19 },
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
