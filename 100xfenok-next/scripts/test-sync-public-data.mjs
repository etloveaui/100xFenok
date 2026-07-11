#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncPublicData } from "./sync-public-data.mjs";
import { inspectCloudflareAssetBudget } from "./check-cloudflare-asset-budget.mjs";

function realBaselineRootArg() {
  const index = process.argv.indexOf("--real-baseline-root");
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error("--real-baseline-root requires a path");
  return path.resolve(process.argv[index + 1]);
}

function copyRealBaselineFixture(targetRoot) {
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const repoRoot = path.resolve(appRoot, "..");
  if (fs.readdirSync(targetRoot).length !== 0) {
    throw new Error(`real baseline fixture root must be empty: ${targetRoot}`);
  }
  const copies = [
    ["data/admin/data-supply-state/v1", "data/admin/data-supply-state/v1"],
    ["data/admin/data-usage-manifest.json", "data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "data/computed/data-supply/etf-detail"],
    ["data/stockanalysis/etfs", "data/stockanalysis/etfs"],
    ["data/admin/data-usage-manifest.json", "100xfenok-next/public/data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "100xfenok-next/public/data/computed/data-supply/etf-detail"],
    ["100xfenok-next/public/data/stockanalysis/etfs", "100xfenok-next/public/data/stockanalysis/etfs"],
  ];
  for (const [sourceRel, targetRel] of copies) {
    const source = path.join(repoRoot, sourceRel);
    const target = path.join(targetRoot, targetRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true });
  }
  console.log(`test-sync-public-data real baseline fixture ready: ${targetRoot}`);
}

const requestedRealBaselineRoot = realBaselineRootArg();
if (requestedRealBaselineRoot) {
  copyRealBaselineFixture(requestedRealBaselineRoot);
  process.exit(0);
}

function write(root, relativePath, body = "{}\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-sync-public-data-"));

try {
  const sourceRoot = path.join(fixtureRoot, "data");
  const destinationRoot = path.join(fixtureRoot, "100xfenok-next", "public", "data");
  write(sourceRoot, "safe/keep.json", '{"safe":true}\n');
  write(sourceRoot, "admin/data-supply-state/v1/private.json", '{"secret":true}\n');
  write(sourceRoot, "yf/etf-details/AAA.json", '{"secret":true}\n');
  write(sourceRoot, "yf/migration-evidence/AAA.json", '{"secret":true}\n');
  write(sourceRoot, "yf/finance/AAA.json", '{"public":true}\n');
  write(destinationRoot, "admin/data-supply-state/stale.json", "{}\n");
  write(destinationRoot, "yf/etf-details/stale.json", "{}\n");
  write(destinationRoot, "yf/migration-evidence/stale.json", "{}\n");
  write(destinationRoot, "destination-only/preserve.json", "{}\n");

  const rehearsal = syncPublicData({ sourceRoot, destinationRoot, dryRun: true, logger: () => {} });
  assert.equal(rehearsal.dryRun, true);
  assert.equal(rehearsal.filesCopied, 2);
  assert.equal(rehearsal.removedDestinationRoots, 3);
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state/stale.json")), true);

  const result = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(result.filesCopied, 2);
  assert.equal(result.excludedSourceRoots, 3);
  assert.equal(result.removedDestinationRoots, 3);
  assert.equal(fs.readFileSync(path.join(destinationRoot, "safe/keep.json"), "utf8"), '{"safe":true}\n');
  assert.equal(fs.readFileSync(path.join(destinationRoot, "yf/finance/AAA.json"), "utf8"), '{"public":true}\n');
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/etf-details")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/migration-evidence")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "destination-only/preserve.json")), true);

  const outside = path.join(fixtureRoot, "outside");
  fs.mkdirSync(outside, { recursive: true });
  write(outside, "secret.json", "{}\n");
  fs.rmSync(path.join(sourceRoot, "yf/etf-details"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(sourceRoot, "yf/etf-details"), "dir");
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /symlink/i,
  );
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), true);

  fs.rmSync(path.join(sourceRoot, "yf/etf-details"));
  fs.mkdirSync(path.join(sourceRoot, "yf/etf-details"));
  const destinationOutside = path.join(fixtureRoot, "destination-outside.json");
  fs.writeFileSync(destinationOutside, "untouched");
  fs.rmSync(path.join(destinationRoot, "safe/keep.json"));
  fs.symlinkSync(destinationOutside, path.join(destinationRoot, "safe/keep.json"));
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /destination public-data path is a symlink/i,
  );
  assert.equal(fs.readFileSync(destinationOutside, "utf8"), "untouched");

  const buildRoot = path.join(fixtureRoot, "100xfenok-next", ".open-next");
  const assetRoot = path.join(buildRoot, "assets");
  const reportPath = path.join(buildRoot, "asset-budget-report.json");
  write(assetRoot, "index.html", "ok");
  write(assetRoot, "data/computed/data-supply/etf-detail/enrollment.json", "{}\n");
  write(assetRoot, "data/computed/data-supply/etf-detail/index.json", '{"selected_count":1}\n');
  write(assetRoot, "data/computed/data-supply/etf-detail/payloads/AAA.json", "{}\n");

  const budget = inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 5 });
  assert.equal(budget.status, "pass");
  assert.equal(budget.regular_file_count, 4);
  assert.equal(budget.headroom, 1);
  assert.deepEqual(budget.data_supply_projection, {
    enrollment_files: 1,
    index_files: 1,
    payload_files: 1,
    total_files: 3,
  });
  assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).regular_file_count, 4);
  assert.equal(path.relative(assetRoot, reportPath).startsWith(".."), true);

  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 4 }),
    /asset limit/i,
  );
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath: path.join(assetRoot, "report.json"), limit: 5 }),
    /outside/i,
  );

  fs.symlinkSync(path.join(assetRoot, "index.html"), path.join(assetRoot, "linked.html"));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 10 }),
    /symlink/i,
  );
  fs.rmSync(path.join(assetRoot, "linked.html"));
  write(assetRoot, "generated/data-json-files-manifest.json", JSON.stringify({
    computed: [{ name: "same.json" }, { name: "same.json" }],
  }));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 10 }),
    /duplicate manifest path/i,
  );

  console.log("test-sync-public-data: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
