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
    BEFORE_SHA: "AUTO",
    ...env,
  };
  for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC", "BEFORE_SHA"]) {
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
for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC", "BEFORE_SHA"]) {
  const missing = runRunner({ [name]: undefined });
  assert.equal(missing.result.status, 2, `${name} must be required`);
  assert.deepEqual(missing.records, [], `${name} validation must fail before S1`);
}
for (const name of ["REBUILD_SLICKCHARTS", "VALIDATE_SLICKCHARTS_SKIP_PUBLIC"]) {
  const invalid = runRunner({ [name]: "yes" });
  assert.equal(invalid.result.status, 2, `${name} must reject non-boolean values`);
  assert.deepEqual(invalid.records, [], `${name} validation must fail before S1`);
}
const invalidSha = runRunner({ BEFORE_SHA: "0123abcd" });
assert.equal(invalidSha.result.status, 2, "BEFORE_SHA must reject malformed values");
assert.deepEqual(invalidSha.records, [], "BEFORE_SHA validation must fail before S1");

// Final producer env: no --skip-public validation.
{
  const { result, records } = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    BEFORE_SHA: "AUTO",
  });
  assert.equal(result.status, 0, `final-path run failed: ${result.stderr}`);
  assert.equal(records.includes(SKIP_PUBLIC), false, "final path must not validate with --skip-public");
  assert.ok(records.includes("before_sha AUTO"), "final path must propagate BEFORE_SHA to update-manifest.py");
}

// update-manifest.py exit 1 (warnings only) is tolerated; exit >1 aborts.
{
  const tolerated = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
    BEFORE_SHA: "AUTO",
    UPDATE_MANIFEST_PY_EXIT: "1",
  });
  assert.equal(tolerated.result.status, 0, "exit 1 must be tolerated");
  assert.ok(tolerated.records.includes("npm --prefix 100xfenok-next run build:static-route-manifest"),
    "exit 1 must continue through S14");

  const aborted = runRunner({
    REBUILD_SLICKCHARTS: "true",
    VALIDATE_SLICKCHARTS_SKIP_PUBLIC: "false",
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

// Run the real publication wrapper against isolated input/publisher fixtures.
// The logged incident was an input generation advancing during the rebuild.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "umr-source-race-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "run"));
    fs.writeFileSync(path.join(root, "scripts/materialize-cloud-data-plane-family.mjs"), `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const record = value => fs.appendFileSync('calls.log', value + '\\n');
const count = () => fs.existsSync('build-count') ? Number(fs.readFileSync('build-count', 'utf8')) : 0;
const catalogueGeneration = () => process.env.TEST_MODE === 'always-moving' ? 'catalogue-' + count()
  : process.env.TEST_MODE === 'moves-once' && count() > 0 ? 'catalogue-new' : 'stable';
export const createDefaultMaterializePlane = options => options;
export async function materializeCloudDataPlaneFamily(options) { return { output_root: options.outputRoot }; }
export async function installMaterializedTree() {}
export async function readActiveFamilyIdentity({family}) {
  if (process.env.TEST_MODE === 'read-error') throw new Error('identity unavailable');
  return { identity: { generation_id: family === 'stockanalysis-catalogue' ? catalogueGeneration() : 'stable' } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--hydrate-stockanalysis')) {
    record('hydrate-stockanalysis');
    console.log(JSON.stringify({ etf: 'stable', catalogue: catalogueGeneration() }));
  } else if (process.argv.includes('--family')) {
    const family = process.argv[process.argv.indexOf('--family') + 1];
    record('hydrate-' + family);
    console.log(JSON.stringify({ generation_id: 'basis-' + count(), manifest_sha256: 'hash-' + count() }));
  }
}
`);
    fs.writeFileSync(path.join(root, "scripts/update-manifest-projections.sh"), `#!/usr/bin/env bash
set -e
count=0
if [ -f build-count ]; then count="$(cat build-count)"; fi
printf '%s' "$((count + 1))" > build-count
printf 'rebuild\\n' >> calls.log
if [ "$TEST_MODE" = build-error ]; then exit 13; fi
`);
    fs.writeFileSync(path.join(root, "scripts/publish-cloud-data-generation.mjs"), `
import fs from 'node:fs';
fs.appendFileSync('calls.log', 'publish:' + process.env.PUBLISH_EXPECTED_ACTIVE_GENERATION_ID + ':' + process.env.PUBLISH_EXPECTED_ACTIVE_MANIFEST_SHA256 + '\\n');
`);
    const wrapper = path.join(repoRoot, "scripts/publish-update-manifest.sh");
    for (const [mode, expectedExit, builds, publishes] of [
      ["stable", 0, 1, 1],
      ["moves-once", 0, 2, 1],
      ["always-moving", 75, 3, 0],
      ["build-error", 13, 1, 0],
      ["read-error", 1, 1, 0],
    ]) {
      for (const file of ["calls.log", "build-count"]) fs.rmSync(path.join(root, file), { force: true });
      const result = spawnSync("bash", [wrapper], {
        cwd: root, encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: path.join(root, "run"), TEST_MODE: mode },
      });
      assert.equal(result.status, expectedExit, `${mode}: ${result.stderr}`);
      const calls = fs.readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n");
      assert.equal(calls.filter(call => call === "rebuild").length, builds, mode);
      assert.equal(calls.filter(call => call === "hydrate-stockanalysis").length, builds, mode);
      assert.equal(calls.filter(call => call === "hydrate-platform-projections").length, builds, mode);
      assert.equal(calls.filter(call => call.startsWith("publish:")).length, publishes, mode);
      if (publishes) assert.equal(calls.at(-1), `publish:basis-${builds - 1}:hash-${builds - 1}`, "publish must use refreshed CAS basis");
      if (mode === "moves-once") assert.match(result.stdout, /rehydrating and rebuilding/);
      if (mode === "always-moving") assert.match(result.stderr, /no generation published/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("test-update-manifest-runner: ok");
