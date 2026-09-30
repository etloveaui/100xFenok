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

const buildStart = buildDeployJob.indexOf("      - name: Build (OpenNext Cloudflare)\n");
const bundleBudgetStart = buildDeployJob.indexOf("      - name: Verify Worker bundle budget\n");
assert.ok(bundleBudgetStart > buildStart,
  "bundle budget requires completed build output and must remain immediately after the build");

console.log("test-deploy-worker-efficiency: ok");
