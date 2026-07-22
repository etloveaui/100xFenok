#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  build,
  OCC_FAILURE_DIAGNOSTIC_KEYS,
  OCC_FAILURE_DIAGNOSTIC_LIMIT,
  parseArgs,
  reportOccThresholdStopDiagnostic,
} from "./fetch-fenok-occ-options-volume.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const producerPath = path.join(repoRoot, "scripts/fetch-fenok-occ-options-volume.mjs");
const producerSource = fs.readFileSync(producerPath, "utf8");
const THRESHOLD_GATE = "if (dateAttempt?.stopped_fail_threshold !== true) return false;";
const EXPECTED_KEYS = [
  "ticker", "symbol", "side", "endpoint", "endpointKind", "url_kind",
  "status", "reason", "expectedUnavailable", "expectedKind",
  "statusCode", "status_code", "http_status", "decode", "payload",
  "returned", "observed_at", "exceptionKind",
];

function captureThresholdDiagnostic(input) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return {
      fired: reportOccThresholdStopDiagnostic(input),
      lines,
    };
  } finally {
    console.error = original;
  }
}

async function captureErrors(run) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { result: await run(), lines };
  } finally {
    console.error = original;
  }
}

function diagnosticKeysFromSource(source) {
  const block = source.match(/const OCC_FAILURE_DIAGNOSTIC_KEYS = \[([\s\S]*?)\];/)?.[1];
  assert(block, "OCC diagnostic key allowlist must exist");
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function assertThresholdSourceContracts(source) {
  assert.match(
    source,
    /if \(dateAttempt\?\.stopped_fail_threshold !== true\) return false;/,
    "threshold diagnostics must fire only for an explicit threshold stop",
  );
  assert.match(
    source,
    /const dateAttempt = summarizeDateAttempt\(result\);[\s\S]*?dateAttempts\.push\(dateAttempt\);[\s\S]*?reportOccThresholdStopDiagnostic\(\{[\s\S]*?dateAttempt,[\s\S]*?endpointResults: result\.endpoint_diagnostics/,
    "each date attempt must invoke the threshold diagnostic with its own endpoint results",
  );
  assert.match(
    source,
    /const parseFailureDiagnostic = endpointDiagnostic \?\? buildOccEndpointDiagnostic\(/,
    "cached parse failures must retain a synthetic ticker/side diagnostic",
  );
  assert.equal(
    [...source.matchAll(/if \(!thresholdDiagnosticSourceDates\.has\(isoFromYmd\(ymd\)\)\) \{\s*reportOccCorruptFailure/g)].length,
    2,
    "a threshold-reported source date must not emit duplicate corrupt identity rows",
  );
  assert.deepEqual(
    diagnosticKeysFromSource(source),
    EXPECTED_KEYS,
    "threshold diagnostics must reuse the exact bounded identity allowlist",
  );
  assert.doesNotMatch(
    source.match(/const OCC_FAILURE_DIAGNOSTIC_KEYS = \[([\s\S]*?)\];/)?.[0] ?? "",
    /["']body["']/,
    "provider bodies must never enter the diagnostic allowlist",
  );
}

assert.deepEqual(OCC_FAILURE_DIAGNOSTIC_KEYS, EXPECTED_KEYS);
assert.equal(OCC_FAILURE_DIAGNOSTIC_LIMIT, 8);

const privateBody = "PRIVATE_OCC_BODY_MUST_NOT_LEAK";
const endpointResults = Array.from({ length: 10 }, (_, index) => ({
  ticker: `T${index}`,
  side: index % 2 === 0 ? "C" : "P",
  endpoint: "https://marketdata.theocc.com/volume-query",
  status: "unavailable",
  reason: "http_error",
  http_status: 503,
  decode: "not_attempted",
  payload: "not_available",
  body: `${privateBody}_${index}`,
  response: { body: `${privateBody}_nested_${index}` },
}));

const threshold = captureThresholdDiagnostic({
  dateAttempt: {
    source_date: "2026-07-22",
    stopped_fail_threshold: true,
  },
  endpointResults,
  batchIndex: 2,
});
assert.equal(threshold.fired, true);
assert.match(threshold.lines[0], /OCC threshold stop/);
assert.match(threshold.lines[0], /source_date=2026-07-22/);
assert.match(threshold.lines[0], /batch_index=2/);
assert.equal(
  threshold.lines.filter((line) => line.includes("OCC failing endpoint {")).length,
  OCC_FAILURE_DIAGNOSTIC_LIMIT,
  "threshold diagnostics must retain the existing endpoint cap",
);
assert.match(threshold.lines.join("\n"), /"ticker":"T0"/);
assert.match(threshold.lines.join("\n"), /list truncated: 2 more/);
assert.doesNotMatch(threshold.lines.join("\n"), new RegExp(privateBody));
assert.doesNotMatch(threshold.lines.join("\n"), /"body"/);

const clean = captureThresholdDiagnostic({
  dateAttempt: {
    source_date: "2026-07-22",
    stopped_fail_threshold: false,
  },
  endpointResults,
  batchIndex: 2,
});
assert.equal(clean.fired, false);
assert.deepEqual(clean.lines, []);

const integrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-threshold-diagnostic-"));
try {
  const failedBuild = await captureErrors(() => build(parseArgs([
    "--tickers", "AAPL",
    "--date", "20260722",
    "--max-walkback-days", "1",
    "--fail-threshold", "1",
    "--no-write",
  ]), {
    request: async () => ({ statusCode: 503, body: privateBody }),
    cacheDir: path.join(integrationRoot, "failed-cache"),
    attemptShardPath: path.join(integrationRoot, "failed-attempt.json"),
    observedAt: "2026-07-22T00:30:00Z",
    attemptId: "occ-threshold-failed-test",
  }));
  assert.equal(failedBuild.result.date_attempts.length, 2);
  assert(failedBuild.result.date_attempts.every((attempt) => attempt.stopped_fail_threshold === true));
  assert.equal(
    failedBuild.lines.filter((line) => line.includes("OCC threshold stop")).length,
    2,
    "each stopped date attempt must emit exactly one identity report",
  );
  assert.match(failedBuild.lines.join("\n"), /source_date=2026-07-22/);
  assert.match(failedBuild.lines.join("\n"), /source_date=2026-07-21/);
  assert.match(failedBuild.lines.join("\n"), /"ticker":"AAPL"/);
  assert.match(failedBuild.lines.join("\n"), /"side":"[CP]"/);
  assert.doesNotMatch(failedBuild.lines.join("\n"), new RegExp(privateBody));

  const cachedBody = `${privateBody}_CACHED_MALFORMED`;
  const cachedDir = path.join(integrationRoot, "cached-malformed", "20260722");
  fs.mkdirSync(cachedDir, { recursive: true });
  fs.writeFileSync(path.join(cachedDir, "AAPL_C.csv"), cachedBody, "utf8");
  fs.writeFileSync(path.join(cachedDir, "AAPL_P.csv"), cachedBody, "utf8");
  const cachedFailure = await captureErrors(() => build(parseArgs([
    "--tickers", "AAPL",
    "--date", "20260722",
    "--max-walkback-days", "0",
    "--fail-threshold", "1",
    "--no-write",
  ]), {
    request: async () => {
      throw new Error("cached malformed fixture must not call the provider");
    },
    cacheDir: path.join(integrationRoot, "cached-malformed"),
    attemptShardPath: path.join(integrationRoot, "cached-malformed-attempt.json"),
    observedAt: "2026-07-22T00:31:00Z",
    attemptId: "occ-threshold-cached-malformed-test",
  }));
  assert.equal(cachedFailure.result.date_attempts[0].stopped_fail_threshold, true);
  assert.match(cachedFailure.lines.join("\n"), /"ticker":"AAPL"/);
  assert.match(cachedFailure.lines.join("\n"), /"side":"[CP]"/);
  assert.match(cachedFailure.lines.join("\n"), /"reason":"decode_error"/);
  assert.doesNotMatch(cachedFailure.lines.join("\n"), new RegExp(privateBody));

  const readyCsv = [
    "quantity,underlying,symbol,actype,porc,exchange,actdate",
    "10,AAPL,AAPL,OSTK,C,CBOE,20260722",
    "",
  ].join("\n");
  const cleanBuild = await captureErrors(() => build(parseArgs([
    "--tickers", "AAPL",
    "--date", "20260722",
    "--max-walkback-days", "0",
    "--fail-threshold", "1",
    "--no-write",
  ]), {
    request: async () => ({ statusCode: 200, body: readyCsv }),
    cacheDir: path.join(integrationRoot, "clean-cache"),
    attemptShardPath: path.join(integrationRoot, "clean-attempt.json"),
    observedAt: "2026-07-22T08:30:00Z",
    attemptId: "occ-threshold-clean-test",
  }));
  assert.equal(cleanBuild.result.date_attempts[0].stopped_fail_threshold, false);
  assert.equal(
    cleanBuild.lines.filter((line) => line.includes("OCC threshold stop")).length,
    0,
    "a clean date attempt must not emit threshold diagnostics",
  );
} finally {
  fs.rmSync(integrationRoot, { recursive: true, force: true });
}

assertThresholdSourceContracts(producerSource);

const thresholdNeverFires = producerSource.replace(
  THRESHOLD_GATE,
  "if (dateAttempt?.stopped_fail_threshold === true) return false;",
);
assert.throws(
  () => assertThresholdSourceContracts(thresholdNeverFires),
  /must fire only for an explicit threshold stop/,
  "a mutation that suppresses threshold-stop diagnostics must fail",
);

const cleanAlsoFires = producerSource.replace(THRESHOLD_GATE, "");
assert.throws(
  () => assertThresholdSourceContracts(cleanAlsoFires),
  /must fire only for an explicit threshold stop/,
  "a mutation that emits on clean attempts must fail",
);

const bodyLeak = producerSource.replace(
  '"returned", "observed_at", "exceptionKind",',
  '"returned", "observed_at", "exceptionKind", "body",',
);
assert.throws(
  () => assertThresholdSourceContracts(bodyLeak),
  /exact bounded identity allowlist|must never enter/,
  "a mutation that allows provider bodies must fail",
);

const duplicateCorruptIdentity = producerSource.replace(
  "if (!thresholdDiagnosticSourceDates.has(isoFromYmd(ymd))) {",
  "if (true) {",
);
assert.throws(
  () => assertThresholdSourceContracts(duplicateCorruptIdentity),
  /must not emit duplicate corrupt identity rows/,
  "a mutation that re-enables duplicate corrupt identity output must fail",
);

const cachedParseIdentityDropped = producerSource.replace(
  "const parseFailureDiagnostic = endpointDiagnostic ?? buildOccEndpointDiagnostic(",
  "const parseFailureDiagnostic = endpointDiagnostic || null; void buildOccEndpointDiagnostic(",
);
assert.throws(
  () => assertThresholdSourceContracts(cachedParseIdentityDropped),
  /cached parse failures must retain a synthetic ticker\/side diagnostic/,
  "a mutation that drops cached parse-failure identity must fail",
);

console.log("test-fetch-fenok-occ-threshold-diagnostics: ok");
