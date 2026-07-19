#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(root, "scripts/stage-update-manifest-central.mjs");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/update-manifest.yml"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/admin/lane-commit-manifest.json"), "utf8"));
const EXPECTED_PATHS = [
  "data/computed/signals.json", "data/computed/stock_action_index.json", "data/computed/stock_action_summary.json",
  "data/computed/fenok_signals.json", "data/computed/fenok_signals_summary.json", "data/computed/fenok_etf_signals.json",
  "data/computed/fenok_etf_signals_summary.json", "data/computed/etf_action_index.json", "data/computed/fenok_etf_core_daily_basket_summary.json",
  "data/computed/market_facts", "data/computed/market_source_parity.json", "data/computed/market_data_audit.json",
  "data/computed/entity_graph.json", "data/computed/entity_graph_stock_index.json", "data/computed/entity_graph_stock_services.json",
  "data/computed/market_structure_index.json", "data/computed/rim-index/inputs.json", "data/yf/finance/_summary.json",
  "data/stockanalysis/backfill/history_gap_report_latest.json", "data/slickcharts/discovery-summary.json", "data/slickcharts/membership-changes.json",
  "data/slickcharts/universe.json", "data/admin/fenok-s1-stock-public-promotion-dry-run.json", "data/admin/fenok-edge-coverage-index.json",
  "data/admin/fenok-s0-finra-occ-mapping-ledger.json", "data/admin/fenok-edge-etf-daily1y-readiness.json", "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
  "data/admin/fenok-etf-core-daily-basket.json", "data/admin/data-usage-manifest.json", "data/admin/product-surface-coverage.json",
  "data/admin/fenok-data-health-kpi.json", "data/admin/lane-registry-projection.json", "data/manifest.json",
  "100xfenok-next/public/data/computed/signals.json", "100xfenok-next/public/data/computed/stock_action_index.json",
  "100xfenok-next/public/data/computed/stock_action_summary.json", "100xfenok-next/public/data/computed/fenok_signals_summary.json",
  "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json", "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json",
  "100xfenok-next/public/data/computed/fenok_occ_options_availability.json", "100xfenok-next/public/data/computed/market_facts/index.json",
  "100xfenok-next/public/data/computed/market_source_parity.json", "100xfenok-next/public/data/computed/market_data_audit.json",
  "100xfenok-next/public/data/computed/entity_graph.json", "100xfenok-next/public/data/computed/entity_graph_stock_index.json",
  "100xfenok-next/public/data/computed/entity_graph_stock_services.json", "100xfenok-next/public/data/computed/market_structure_index.json",
  "100xfenok-next/public/data/computed/rim-index/inputs.json", "100xfenok-next/public/data/yf/finance",
  "100xfenok-next/public/data/stockanalysis", "100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json",
  "100xfenok-next/public/data/slickcharts", "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json",
  "100xfenok-next/public/data/admin/fenok-edge-coverage-index.json", "100xfenok-next/public/data/admin/data-usage-manifest.json",
  "100xfenok-next/public/data/admin/product-surface-coverage.json", "100xfenok-next/public/data/admin/fenok-data-health-kpi.json",
  "100xfenok-next/public/data/admin/lane-registry-projection.json", "100xfenok-next/public/data/manifest.json",
  "100xfenok-next/src/generated/static-route-manifest.ts",
];

assert.equal(EXPECTED_PATHS.length, 60);
assert.deepEqual(manifest.update_manifest.central_commit_paths, EXPECTED_PATHS);
const centralSpecs = manifest.workflows[".github/workflows/update-manifest.yml"].stages.always_if_exists;
assert.deepEqual(centralSpecs.map((spec) => spec.path), EXPECTED_PATHS);
assert.deepEqual(centralSpecs.filter((spec) => spec.kind === "directory").map((spec) => spec.path), [
  "data/computed/market_facts",
  "100xfenok-next/public/data/yf/finance",
  "100xfenok-next/public/data/stockanalysis",
  "100xfenok-next/public/data/slickcharts",
]);
assert.equal(centralSpecs.filter((spec) => spec.kind === "file").length, 56);
assert.equal(centralSpecs.every((spec) => spec.required === false), true);
assert.equal(fs.existsSync(helperPath), true);
assert.equal((workflow.match(/node scripts\/stage-update-manifest-central\.mjs/g) ?? []).length, 4);
assert.equal((workflow.match(/node scripts\/test-update-manifest-central-staging\.mjs/g) ?? []).length, 2);
assert.match(workflow, /- name: Check if manifest changed[\s\S]*?stage-update-manifest-central\.mjs --check[\s\S]*?3\) echo "changed=false"/);
const retry = workflow.slice(workflow.indexOf("for attempt in 1 2 3; do"));
assert.match(retry, /git reset --hard origin\/main[\s\S]*?test-update-manifest-central-staging\.mjs[\s\S]*?stage-update-manifest-central\.mjs --assert-clean-after-reset/);
assert.match(retry, /stage-update-manifest-central\.mjs --check[\s\S]*?central_status[\s\S]*?stage-update-manifest-central\.mjs --stage[\s\S]*?git commit/);
assert.doesNotMatch(workflow, /git diff --quiet \\/);
assert.doesNotMatch(workflow, /git add -- \\/);
for (const pathValue of EXPECTED_PATHS) {
  assert.equal(workflow.includes(`${pathValue} \\`), false, `legacy central hand-list remains: ${pathValue}`);
}

function write(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function cached(repoRoot) {
  return git(repoRoot, ["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean).sort();
}

function makeFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-central-"));
  git(repoRoot, ["init", "-q", "--initial-branch=main"]);
  git(repoRoot, ["config", "user.email", "test@example.invalid"]);
  git(repoRoot, ["config", "user.name", "central-staging-test"]);
  const manifestPath = path.join(repoRoot, "data/admin/lane-commit-manifest.json");
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  write(path.join(repoRoot, "data/computed/signals.json"), "baseline signals\n");
  write(path.join(repoRoot, "data/computed/market_facts/index.json"), "baseline facts\n");
  write(path.join(repoRoot, "100xfenok-next/public/data/slickcharts/base.json"), "baseline slick\n");
  write(path.join(repoRoot, "unrelated.txt"), "unrelated baseline\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-qm", "fixture baseline"]);
  return { repoRoot, manifestPath };
}

function runHelper(fixture, mode) {
  return spawnSync(process.execPath, [helperPath, "--repo-root", fixture.repoRoot, "--manifest", fixture.manifestPath, mode], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
  });
}

// A Git/validation error remains fatal and cannot be reported as "changed".
{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-central-not-git-"));
  const manifestPath = path.join(repoRoot, "data/admin/lane-commit-manifest.json");
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = runHelper({ repoRoot, manifestPath }, "--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git diff failed/);
}

{
  const fixture = makeFixture();
  const result = runHelper(fixture, "--check");
  assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /declared=60 changed=0 staged=0/);
  assert.notEqual(runHelper(fixture, "--stage").status, 0);
}

{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, "data/computed/signals.json"), "changed signals\n");
  write(path.join(fixture.repoRoot, "unrelated.txt"), "unrelated unstaged\n");
  assert.equal(runHelper(fixture, "--check").status, 0);
  const staged = runHelper(fixture, "--stage");
  assert.equal(staged.status, 0, `${staged.stderr}\n${staged.stdout}`);
  assert.deepEqual(cached(fixture.repoRoot), ["data/computed/signals.json"]);
  assert.match(git(fixture.repoRoot, ["diff", "--name-only"]), /unrelated\.txt/);
}

for (const relative of ["data/computed/signals.json", "data/computed/market_facts"]) {
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.repoRoot, relative), { recursive: true });
  assert.equal(runHelper(fixture, "--check").status, 0);
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.ok(cached(fixture.repoRoot).some((candidate) => candidate === relative || candidate.startsWith(`${relative}/`)));
}

{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, "100xfenok-next/public/data/slickcharts/new.json"), "new\n");
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.deepEqual(cached(fixture.repoRoot), ["100xfenok-next/public/data/slickcharts/new.json"]);
}

// Reject unrelated pre-staged work before touching central paths.
{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, "unrelated.txt"), "pre-staged unrelated\n");
  git(fixture.repoRoot, ["add", "unrelated.txt"]);
  write(path.join(fixture.repoRoot, "data/computed/signals.json"), "central unstaged\n");
  const result = runHelper(fixture, "--stage");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /out-of-policy staged paths: unrelated\.txt/);
  assert.deepEqual(cached(fixture.repoRoot), ["unrelated.txt"]);
}

// reset restores tracked files but leaves untracked central residue; preflight rejects it.
{
  const fixture = makeFixture();
  const tracked = path.join(fixture.repoRoot, "data/computed/signals.json");
  const untracked = path.join(fixture.repoRoot, "100xfenok-next/public/data/slickcharts/pre-reset.json");
  write(tracked, "tracked mutation\n");
  write(untracked, "untracked residue\n");
  git(fixture.repoRoot, ["reset", "--hard", "HEAD"]);
  assert.equal(fs.readFileSync(tracked, "utf8"), "baseline signals\n");
  assert.equal(fs.existsSync(untracked), true);
  assert.notEqual(runHelper(fixture, "--assert-clean-after-reset").status, 0);
  fs.rmSync(untracked);
  assert.equal(runHelper(fixture, "--assert-clean-after-reset").status, 0);
  write(tracked, "retry rebuild\n");
  write(path.join(fixture.repoRoot, "100xfenok-next/public/data/slickcharts/rebuilt.json"), "retry public rebuild\n");
  assert.equal(runHelper(fixture, "--check").status, 0);
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.deepEqual(cached(fixture.repoRoot), [
    "100xfenok-next/public/data/slickcharts/rebuilt.json",
    "data/computed/signals.json",
  ]);
}

{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, ".gitignore"), "100xfenok-next/public/data/slickcharts/ignored.json\n");
  git(fixture.repoRoot, ["add", ".gitignore"]);
  git(fixture.repoRoot, ["commit", "-qm", "ignore fixture"]);
  write(path.join(fixture.repoRoot, "100xfenok-next/public/data/slickcharts/ignored.json"), "ignored residue\n");
  git(fixture.repoRoot, ["reset", "--hard", "HEAD"]);
  assert.notEqual(runHelper(fixture, "--assert-clean-after-reset").status, 0);
}

{
  const fixture = makeFixture();
  const drifted = structuredClone(manifest);
  drifted.update_manifest.central_commit_paths.pop();
  write(fixture.manifestPath, `${JSON.stringify(drifted, null, 2)}\n`);
  const result = runHelper(fixture, "--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /central_commit_paths are stale/);
}

console.log("test-update-manifest-central-staging: ok");
