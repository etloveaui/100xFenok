import assert from "node:assert/strict";
import { verdictFor, summarise, storageCostUsd, STORAGE_WARN_GB, STORAGE_FAIL_GB } from "./check-r2-free-tier-usage.mjs";
const summary = (gb, a = 0, b = 0) => ({ storage: { peak_bytes: gb * 1e9 },
  class_a: { projected_month: a }, class_b: { projected_month: b } });
const plan = { bytes: 0, class_a: 0, class_b: 0 };
assert.equal(STORAGE_WARN_GB, 40);
assert.equal(STORAGE_FAIL_GB, 70);
for (const [gb, verdict] of [[7, "ok"], [9, "ok"], [39.999, "ok"], [40, "warn"], [69.999, "warn"], [70, "fail"], [76, "fail"]]) {
  assert.equal(verdictFor(summary(gb), plan, false).verdict, verdict, `${gb} GB storage boundary`);
}
assert.equal(verdictFor(summary(39), { ...plan, bytes: 1e9 }, false).verdict, "warn");
assert.equal(verdictFor(summary(69), { ...plan, bytes: 1e9 }, false).verdict, "fail");
for (const [axis, allowance] of [["class_a", 1e6], ["class_b", 1e7]]) {
  for (const [fraction, verdict] of [[0.699, "ok"], [0.7, "warn"], [0.899, "warn"], [0.9, "warn"], [1, "warn"]]) {
    const item = summary(1); item[axis].projected_month = allowance * fraction;
    assert.equal(verdictFor(item, plan, false).verdict, verdict, `${axis} free allowance warning`);
  }
  const item = summary(1); item[axis].projected_month = allowance * 0.89;
  assert.equal(verdictFor(item, { ...plan, [axis]: allowance * 0.01 }, false).verdict, "warn");
}
assert.deepEqual(verdictFor(summary(1), plan, true).breaches, ["measurement_blind"]);
assert.equal(verdictFor(summary(70, 900000), plan, false).breaches.length, 1);
assert.equal(verdictFor(summary(1, 1000001), plan, false).with_plan.estimated_cost_krw, 6750);
assert.equal(verdictFor(summary(1, 2000001), plan, false).verdict, "fail");
assert.equal(storageCostUsd(10), 0);
assert.equal(storageCostUsd(70), 0.9);
assert.equal(storageCostUsd(76), 0.99);
assert.ok(storageCostUsd(76.01) > 1, "billing units round upward; 76 GB is the conservative $1 ceiling");
const bounds = { cycle_start: "2026-10-01", trailing_start: "2026-09-11", cycle_days: 30, elapsed_days: 30 };
const result = summarise({ r2StorageAdaptiveGroups: [{ dimensions: { date: "2026-10-10" }, max: { payloadSize: 41e9, objectCount: 3, uploadCount: 0 } }],
  r2OperationsAdaptiveGroups: [] }, bounds, { bytes: 1e9, objects: 2, truncated: false });
assert.equal(result.storage.peak_bytes, 41e9, "historic peak still bounds the full-cycle projection");
assert.equal(verdictFor(result, plan, false).verdict, "warn");
assert.equal(result.storage.free_gb_month, 10, "the paid storage decision does not relabel the free allowance");
console.log("R2 storage budget: PASS (40/70 GB, planned increments, paid operation cost thresholds, blind measurement, billing rounding)");
