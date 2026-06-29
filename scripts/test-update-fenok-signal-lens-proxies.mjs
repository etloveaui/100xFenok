#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  buildPlan,
  parseArgs,
} from "./update-fenok-signal-lens-proxies.mjs";

{
  const args = parseArgs([]);
  const plan = buildPlan(args);
  assert.equal(plan.length, 5);
  assert.equal(plan[0].label, "FINRA private source/backfill registry");
  assert.equal(plan[1].label, "FINRA daily flow proxies");
  assert.equal(plan[2].label, "OCC listed-options volume skew proxy");
  assert.equal(plan[3].label, "GDELT headline tone proxy");
  assert.equal(plan[4].label, "all-axis Signal Lens consolidation");
  assert.ok(plan[0].args.includes("--dataset"));
  assert.ok(plan[0].args.includes("regsho-daily"));
  assert.ok(plan[0].args.includes("--retries"));
  assert.ok(plan[0].args.includes("2"));
  assert.ok(plan[0].args.includes("--retry-backoff-ms"));
  assert.ok(plan[0].args.includes("2000"));
  assert.ok(plan[2].args.includes("--reference-only"));
  assert.ok(plan[2].args.includes("--max-walkback-days"));
  assert.ok(plan[3].args.includes("--reference-only"));
  assert.ok(plan[3].args.includes("--retries"));
  assert.ok(plan[3].args.includes("2"));
  assert.ok(!plan[4].args.includes("--reference-only"));
}

{
  const args = parseArgs(["--tickers", "NVDA,MU", "--skip-news", "--lens-reference-only", "--no-fetch"]);
  const plan = buildPlan(args);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((step) => step.label), [
    "FINRA private source/backfill registry",
    "FINRA daily flow proxies",
    "OCC listed-options volume skew proxy",
    "all-axis Signal Lens consolidation",
  ]);
  assert.ok(plan[0].args.includes("--no-fetch"));
  assert.ok(plan[1].args.includes("--tickers"));
  assert.ok(plan[1].args.includes("--no-fetch"));
  assert.ok(plan[2].args.includes("NVDA,MU"));
  assert.ok(plan[2].args.includes("--no-fetch"));
  assert.ok(!plan[3].args.includes("--reference-only"));
}

{
  const args = parseArgs([
    "--skip-finra-collector",
    "--finra-date",
    "2026-06-26",
    "--finra-from",
    "2026-06-20",
  ]);
  const plan = buildPlan(args);
  assert.equal(plan.length, 4);
  assert.equal(plan[0].label, "FINRA daily flow proxies");
}

{
  const args = parseArgs([
    "--finra-date",
    "2026-06-26",
    "--finra-input-file",
    "/tmp/CNMSshvol20260626.txt",
    "--finra-no-write",
    "--finra-plan-only",
    "--skip-options",
    "--skip-news",
    "--skip-lens",
  ]);
  const plan = buildPlan(args);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0].args, [
    "scripts/fetch-fenok-finra-daily-private.mjs",
    "--dataset",
    "regsho-daily",
    "--date",
    "2026-06-26",
    "--input-file",
    "/tmp/CNMSshvol20260626.txt",
    "--no-write",
    "--plan-only",
    "--retries",
    "2",
    "--retry-backoff-ms",
    "2000",
    "--sleep-ms",
    "0",
  ]);
}

{
  const args = parseArgs([
    "--options-all-eligible",
    "--options-batch-size",
    "50",
    "--options-batch-index",
    "2",
    "--options-max-requests",
    "100",
    "--options-fail-threshold",
    "5",
    "--no-fetch",
    "--skip-news",
    "--skip-lens",
  ]);
  const plan = buildPlan(args);
  const optionStep = plan.find((step) => step.label === "OCC listed-options volume skew proxy");
  assert.ok(optionStep);
  assert.ok(optionStep.args.includes("--all-eligible"));
  assert.ok(optionStep.args.includes("--max-walkback-days"));
  assert.ok(optionStep.args.includes("0"));
  assert.ok(optionStep.args.includes("--batch-size"));
  assert.ok(optionStep.args.includes("50"));
  assert.ok(optionStep.args.includes("--batch-index"));
  assert.ok(optionStep.args.includes("2"));
  assert.ok(optionStep.args.includes("--max-requests"));
  assert.ok(optionStep.args.includes("100"));
  assert.ok(optionStep.args.includes("--fail-threshold"));
  assert.ok(optionStep.args.includes("5"));
  assert.ok(optionStep.args.includes("--no-fetch"));
  assert.ok(!optionStep.args.includes("--reference-only"));
}

console.log("test-update-fenok-signal-lens-proxies: ok");
