#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const buildDeployJob = workflow.split("  build-deploy:\n", 2)[1];
assert.ok(buildDeployJob, "build-deploy job is missing");

const checkoutStart = buildDeployJob.indexOf("      - name: Checkout\n");
const setupNodeStart = buildDeployJob.indexOf("      - name: Setup Node\n", checkoutStart);
const buildCheckout = buildDeployJob.slice(checkoutStart, setupNodeStart);
assert.match(buildCheckout, /fetch-depth:\s*0/,
  "the source-lineage fence compares live and candidate ancestry and therefore requires full history");

const installStart = buildDeployJob.indexOf("      - name: Install dependencies\n");
const tokenPreflightStart = buildDeployJob.indexOf("      - name: Verify source token policy\n");
const detectionFloorStart = buildDeployJob.indexOf("      - name: Build data supply detection floor\n");
const buildStart = buildDeployJob.indexOf("      - name: Build (OpenNext Cloudflare)\n");
assert.ok(
  installStart >= 0 && tokenPreflightStart > installStart
    && detectionFloorStart > tokenPreflightStart && buildStart > detectionFloorStart,
  "token policy must fail after install but before projection and bundling",
);
assert.match(
  buildDeployJob.slice(tokenPreflightStart, detectionFloorStart),
  /working-directory: 100xfenok-next\s+run: npm run qa:tokens/,
  "the early gate must execute the canonical token policy",
);
assert.match(packageJson.scripts["cf:build:steps"], /npm run qa:tokens/,
  "the build must retain its post-sync token check");

const bundleBudgetStart = buildDeployJob.indexOf("      - name: Verify Worker bundle budget\n");
assert.ok(bundleBudgetStart > buildStart,
  "bundle budget requires completed build output and must remain immediately after the build");

console.log("test-deploy-worker-efficiency: ok");
