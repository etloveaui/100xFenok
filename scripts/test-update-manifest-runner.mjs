#!/usr/bin/env node
// Execute projection exit handling with recording stubs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(repoRoot, "scripts/update-manifest-projections.sh");
const runnerText = fs.readFileSync(runnerPath, "utf8");

// The runner must be valid bash. --------------------------------------
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
  node)
    if [ "$1" = "scripts/slickcharts-composite-recovery.mjs" ] && [ "$2" = "validate-live" ]; then
      [ -n "\${COMPOSITE_VALIDATION_EXIT:-}" ] && exit "$COMPOSITE_VALIDATION_EXIT"
    fi
    ;;
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

const COMPOSITE_GUARD = "node scripts/slickcharts-composite-recovery.mjs validate-live --index data/admin/slickcharts-composite-recovery/index.json";
const SKIP_PUBLIC = "python3 scripts/validate-slickcharts-integrity.py --skip-public --allow-history-coverage-lag";
const FULL_PUBLIC = "python3 scripts/validate-slickcharts-integrity.py --allow-history-coverage-lag";
const SNAPSHOT_RESET = "rm -rf 100xfenok-next/public/data/stockanalysis/etfs/shards/snapshots";
const SYNC_PUBLIC = "node 100xfenok-next/scripts/sync-public-data.mjs --write --etf-shards-only";
const PUSH_SHA = "0123456789abcdef0123456789abcdef01234567";

for (const skipPublic of ["true", "false"]) {
  const checked = runRunner({ VALIDATE_SLICKCHARTS_SKIP_PUBLIC: skipPublic });
  assert.equal(checked.result.status, 0, checked.result.stderr);
  assert.ok(checked.records.includes(COMPOSITE_GUARD), "retained bundle must be validated");
  assert.ok(checked.records.includes(FULL_PUBLIC), "central mirror validation must expose coverage lag");
  assert.equal(checked.records.includes(SKIP_PUBLIC), skipPublic === "true");
  for (const validation of checked.records.filter((line) => line.startsWith("python3 scripts/validate-slickcharts-integrity.py"))) {
    assert.ok(checked.records.indexOf(COMPOSITE_GUARD) < checked.records.indexOf(validation),
      "saved bundle integrity must pass before coverage degradation is allowed");
  }
  const corrupt = runRunner({ VALIDATE_SLICKCHARTS_SKIP_PUBLIC: skipPublic, COMPOSITE_VALIDATION_EXIT: "2" });
  assert.equal(corrupt.result.status, 2, "tampered retained bundle must abort central projection");
  assert.equal(corrupt.records.some((line) => line.startsWith("python3 scripts/validate-slickcharts-integrity.py")), false,
    "bundle failure must not reach relaxed coverage validation");
}

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

// Final retry-loop env: snapshot reset, no --skip-public validation.
{
  const { result, records } = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    RESET_ETF_SNAPSHOTS: "true",
    BEFORE_SHA: "AUTO",
  });
  assert.equal(result.status, 0, `final-path run failed: ${result.stderr}`);
  assert.equal(records.includes(SKIP_PUBLIC), false, "final path must not validate with --skip-public");
  assert.ok(records.includes(SNAPSHOT_RESET), "final path must reset snapshots before re-materializing");
  assert.ok(records.indexOf(SNAPSHOT_RESET) < records.indexOf(SYNC_PUBLIC),
    "final snapshot reset must execute before public sync");
  assert.ok(records.includes("before_sha AUTO"), "final path must propagate BEFORE_SHA to update-manifest.py");
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
