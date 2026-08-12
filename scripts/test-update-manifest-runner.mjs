#!/usr/bin/env node
// Update Manifest projection-stack extraction gate (slim).
//
// Proves the extraction contract WITHOUT re-specifying the runner's command
// inventory: the full generation-order contract is owned by
// test-update-manifest-workflow.mjs (ETF/KPI order) and
// test-update-manifest-materializations.mjs (mirror projection order).
//  1. both workflow call sites invoke exactly one shared runner;
//  2. the workflow embeds none of the runner's projection commands (the list
//     is DERIVED from the runner itself, so no parallel inventory can drift);
//  3. the runner is valid bash;
//  4. one compact behavioral check with recording stubs (no repo writes):
//     initial/retry flag differences plus update-manifest.py exit-1
//     (tolerated) vs exit>1 (abort) semantics.
//
// The S15 "Check if manifest changed" probe is intentionally NOT in the
// runner: its consumers differ (step outputs vs retry branching) and it is a
// status probe, not a projection command.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github/workflows/update-manifest.yml");
const runnerPath = path.join(repoRoot, "scripts/update-manifest-projections.sh");
const workflowText = fs.readFileSync(workflowPath, "utf8");
const runnerText = fs.readFileSync(runnerPath, "utf8");
const workflowLines = workflowText.split("\n").map((line) => line.trim());
const runnerLines = runnerText.split("\n").map((line) => line.trim());

// --- 1) Exactly one runner per call site. -----------------------------------
assert.equal(workflowLines.filter((line) => line === "run: bash scripts/update-manifest-projections.sh").length, 1,
  "initial path must invoke the runner exactly once");
assert.equal(workflowLines.filter((line) => line === "bash scripts/update-manifest-projections.sh").length, 1,
  "retry loop must invoke the runner exactly once");
const initialCall = workflowLines.indexOf("run: bash scripts/update-manifest-projections.sh");
const retryCall = workflowLines.indexOf("bash scripts/update-manifest-projections.sh");
const retryStart = workflowLines.indexOf("for attempt in 1 2 3; do");
assert.ok(initialCall < retryStart, "initial call site must precede the retry loop");
assert.ok(retryCall > retryStart, "retry call site must live inside the push-retry loop");

// --- 2) One concise S1-S14 anchor table pins order and extraction. ----------
// This is one representative command per stage, not a parallel runner spec.
const STAGE_ANCHORS = [
  ["S1", "python scripts/scrapers/membership-tracker.py --quiet"],
  ["S2", "python3 scripts/rebuild-yf-finance-summary.py"],
  ["S3", "node scripts/materialize-update-manifest-routes.mjs --all"],
  ["S4", "node scripts/export-computed-signals.mjs"],
  ["S5", "node scripts/build-phase2-closeout-indexes.mjs"],
  ["S6", "node scripts/build-fenok-signals.mjs"],
  ["S7", "node scripts/build-fenok-etf-signals.mjs"],
  ["S8", "node scripts/build-fenok-edge-coverage-index.mjs"],
  ["S9", "python3 scripts/update-manifest.py || status=$?"],
  ["S10", "npm --prefix 100xfenok-next run build:data-entity-graph"],
  ["S11", "node scripts/generate-product-surface-coverage.mjs"],
  ["S12", "(cd 100xfenok-next && node sync-static-overrides.mjs)"],
  ["S13", "repo_root=\"$(pwd -P)\""],
  ["S14", "npm --prefix 100xfenok-next run build:fenok-data-health-kpi"],
];
let previousAnchor = -1;
for (const [stage, anchor] of STAGE_ANCHORS) {
  const position = runnerLines.indexOf(anchor);
  assert.ok(position > previousAnchor, `${stage} anchor must exist in order: ${anchor}`);
  assert.equal(workflowLines.includes(anchor), false, `${stage} projection must not be embedded in the workflow`);
  previousAnchor = position;
}

const allMaterialization = "node scripts/materialize-update-manifest-routes.mjs --all";
const basketProducer = "node scripts/build-fenok-etf-core-daily-basket.mjs --check";
const basketRouteArgument = "--route-source data/computed/fenok_etf_core_daily_basket_summary.json";
const allMaterializationIndex = runnerLines.indexOf(allMaterialization);
const basketProducerIndex = runnerLines.indexOf(basketProducer);
const basketRouteIndex = runnerLines.indexOf(basketRouteArgument);
assert.equal(runnerLines.filter((line) => line === allMaterialization).length, 1,
  "runner must materialize all routes exactly once at S3");
assert.equal(runnerLines.filter((line) => line === basketRouteArgument).length, 1,
  "runner must materialize the exact basket route exactly once");
assert.ok(allMaterializationIndex < basketProducerIndex,
  "S3 full materialization must precede the S7 basket producer");
assert.ok(basketProducerIndex < basketRouteIndex,
  "bounded basket materialization must follow its S7 producer");
assert.ok(basketRouteIndex < runnerLines.indexOf("# --- S8: Build Fenok edge projections ---------------------------------------"),
  "bounded basket materialization must finish before S8");

// Both call sites explicitly provide the complete fail-closed environment.
for (const line of [
  "VALIDATE_SLICKCHARTS_SKIP_PUBLIC: 'true'",
  "VALIDATE_SLICKCHARTS_SKIP_PUBLIC: 'false'",
  "RESET_ETF_SNAPSHOTS: 'true'",
  "RESET_ETF_SNAPSHOTS: 'false'",
]) {
  assert.equal(workflowLines.filter((candidate) => candidate === line).length, 1, `workflow must set ${line} exactly once`);
}
assert.equal(workflowLines.filter((line) => line.startsWith("REBUILD_SLICKCHARTS:")).length, 2,
  "both call sites must set REBUILD_SLICKCHARTS");
assert.equal(workflowLines.filter((line) => line.startsWith("BEFORE_SHA:")).length, 2,
  "both call sites must set BEFORE_SHA");
assert.equal(runnerLines.includes("set -eo pipefail"), true, "runner must match GitHub bash -e -o pipefail semantics");
assert.equal(runnerLines.includes("set -euo pipefail"), true, "S13 must retain its additional -u behavior");

// --- 3) The runner must be valid bash. --------------------------------------
{
  const syntax = spawnSync("bash", ["-n", runnerPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, `bash -n failed: ${syntax.stderr}`);
}

// --- 4) Behavioral: flags + exit semantics with recording stubs. ------------
const STUB_NAMES = ["python", "python3", "node", "npm", "diff", "mktemp", "mkdir", "chmod", "install", "rm"];
const stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "umr-stubs-"));
const mktempDir = fs.mkdtempSync(path.join(os.tmpdir(), "umr-mktemp-"));
const recordPath = path.join(stubBin, "record.txt");
for (const name of STUB_NAMES) {
  fs.writeFileSync(path.join(stubBin, name), `#!/bin/sh
printf '%s' "\${0##*/}" >> "$STUB_RECORD"
for arg in "$@"; do printf ' %s' "$arg" >> "$STUB_RECORD"; done
printf '\\n' >> "$STUB_RECORD"
case "\${0##*/}" in
  python3)
    if [ "$1" = "scripts/update-manifest.py" ]; then
      printf 'before_sha %s\n' "$BEFORE_SHA" >> "$STUB_RECORD"
      [ -n "\${UPDATE_MANIFEST_PY_EXIT:-}" ] && exit "$UPDATE_MANIFEST_PY_EXIT"
    fi
    ;;
  mktemp) printf '%s\\n' "$MKTEMP_OUTPUT_DIR" ;;
esac
exit 0
`);
  fs.chmodSync(path.join(stubBin, name), 0o755);
}

function runRunner(env) {
  const childEnv = {
    ...process.env,
    REBUILD_SLICKCHARTS: "false",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    RESET_ETF_SNAPSHOTS: "false",
    BEFORE_SHA: "AUTO",
    ...env,
  };
  for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC", "RESET_ETF_SNAPSHOTS", "BEFORE_SHA"]) {
    if (childEnv[name] === undefined) delete childEnv[name];
  }
  const result = spawnSync("bash", [runnerPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...childEnv,
      PATH: `${stubBin}:${process.env.PATH}`,
      STUB_RECORD: recordPath,
      MKTEMP_OUTPUT_DIR: mktempDir,
      GITHUB_RUN_ID: "TESTRUN",
      GITHUB_RUN_ATTEMPT: "1",
    },
  });
  const records = fs.existsSync(recordPath) ? fs.readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean) : [];
  fs.rmSync(recordPath, { force: true });
  return { result, records };
}

const SKIP_PUBLIC = "python3 scripts/validate-slickcharts-integrity.py --skip-public";
const SNAPSHOT_RESET = "rm -rf 100xfenok-next/public/data/stockanalysis/etfs/shards/snapshots";
const SYNC_PUBLIC = "node 100xfenok-next/scripts/sync-public-data.mjs --write --etf-shards-only";
const PUSH_SHA = "0123456789abcdef0123456789abcdef01234567";

// Missing/non-boolean mode flags and malformed BEFORE_SHA fail before S1.
for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC", "RESET_ETF_SNAPSHOTS", "BEFORE_SHA"]) {
  const missing = runRunner({ [name]: undefined });
  assert.equal(missing.result.status, 2, `${name} must be required`);
  assert.deepEqual(missing.records, [], `${name} validation must fail before S1`);
}
for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC", "RESET_ETF_SNAPSHOTS"]) {
  const invalid = runRunner({ [name]: "yes" });
  assert.equal(invalid.result.status, 2, `${name} must reject non-boolean values`);
  assert.deepEqual(invalid.records, [], `${name} validation must fail before S1`);
}
const invalidSha = runRunner({ BEFORE_SHA: "0123abcd" });
assert.equal(invalidSha.result.status, 2, "BEFORE_SHA must reject malformed values");
assert.deepEqual(invalidSha.records, [], "BEFORE_SHA validation must fail before S1");

// Initial-path env: --skip-public validation, no snapshot reset.
{
  const { result, records } = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "true",
    RESET_ETF_SNAPSHOTS: "false",
    BEFORE_SHA: PUSH_SHA,
  });
  assert.equal(result.status, 0, `initial-path run failed: ${result.stderr}`);
  assert.ok(records.includes(SKIP_PUBLIC), "initial path must validate with --skip-public");
  assert.equal(records.includes(SNAPSHOT_RESET), false, "initial path must not reset snapshots");
  assert.ok(records.includes(`before_sha ${PUSH_SHA}`), "initial path must propagate BEFORE_SHA to update-manifest.py");
}

// Retry-loop env: snapshot reset, no --skip-public validation.
{
  const { result, records } = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    RESET_ETF_SNAPSHOTS: "true",
    BEFORE_SHA: "AUTO",
  });
  assert.equal(result.status, 0, `retry-path run failed: ${result.stderr}`);
  assert.equal(records.includes(SKIP_PUBLIC), false, "retry path must not validate with --skip-public");
  assert.ok(records.includes(SNAPSHOT_RESET), "retry path must reset snapshots before re-materializing");
  assert.ok(records.indexOf(SNAPSHOT_RESET) < records.indexOf(SYNC_PUBLIC),
    "retry snapshot reset must execute before public sync");
  assert.ok(records.includes("before_sha AUTO"), "retry path must propagate BEFORE_SHA to update-manifest.py");
}

// update-manifest.py exit 1 (warnings only) is tolerated; exit >1 aborts.
{
  const tolerated = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    RESET_ETF_SNAPSHOTS: "true",
    BEFORE_SHA: "AUTO",
    UPDATE_MANIFEST_PY_EXIT: "1",
  });
  assert.equal(tolerated.result.status, 0, "exit 1 must be tolerated");
  assert.ok(tolerated.records.includes("npm --prefix 100xfenok-next run build:static-route-manifest"),
    "exit 1 must continue through S14");

  const aborted = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    RESET_ETF_SNAPSHOTS: "true",
    BEFORE_SHA: "AUTO",
    UPDATE_MANIFEST_PY_EXIT: "2",
  });
  assert.equal(aborted.result.status, 2, "exit 2 must abort the runner with the same code");
  assert.match(aborted.result.stderr, /update-manifest\.py exited with 2/, "abort must report the failing exit code");
  assert.ok(aborted.records.includes("python3 scripts/update-manifest.py"), "abort must happen at the update-manifest.py call");
  assert.equal(aborted.records.includes("npm --prefix 100xfenok-next run build:data-entity-graph"), false,
    "abort must stop before S10");
}

fs.rmSync(stubBin, { recursive: true, force: true });
fs.rmSync(mktempDir, { recursive: true, force: true });

console.log("test-update-manifest-runner: ok");
