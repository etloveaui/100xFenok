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

assert.match(buildCheckout, /\/scripts\/lib\//, "typechecked app tests import the root compatibility modules");

const buildStart = buildDeployJob.indexOf("      - name: Build (OpenNext Cloudflare)\n");
const bundleBudgetStart = buildDeployJob.indexOf("      - name: Verify Worker bundle budget\n");
assert.ok(bundleBudgetStart > buildStart,
  "bundle budget requires completed build output and must remain immediately after the build");

const quality = fs.readFileSync(new URL("../.github/workflows/app-quality.yml", import.meta.url), "utf8");
const recoveryJob = workflow.split("  recovery-gate:\n")[1].split("  build-deploy:\n")[0];
assert.match(recoveryJob, /sparse-checkout: \|[\s\S]*\/scripts\/check-recovery-deploy-gate\.mjs/);
assert.ok(buildDeployJob.indexOf("npm run typecheck") < buildDeployJob.indexOf("git sparse-checkout set"),
  "type errors must stop before the large data checkout and materialization");
assert.match(quality, /push:\n    branches: \[main\]/);
assert.match(quality, /run: npm test/);
assert.doesNotMatch(workflow, /key: next-build-.*github\.sha/,
  "each commit must not allocate another 400 MB cache");
assert.ok(buildDeployJob.indexOf("Save current Next build cache") > buildDeployJob.indexOf("Deploy to Cloudflare Workers"));
assert.match(workflow, /check-deploy-source-fence\.mjs/);
assert.match(workflow, /write-deploy-provenance\.mjs/);
console.log("test-deploy-worker-efficiency: ok");
