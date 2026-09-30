import assert from "node:assert/strict";
import { classifyPreparedReceipts } from "./lib/cloud-data-plane-prepared-receipt-lifecycle.mjs";

const NOW = "2026-08-14T12:00:00Z";
const WINDOW = 6 * 3600;
const prepared = (generation_id, created_at = "2026-08-14T11:00:00Z") => ({ state: "prepared", generation_id, created_at });
const classify = (receipts) => classifyPreparedReceipts({ receipts, now: NOW, resumeWindowSeconds: WINDOW });
assert.throws(() => classifyPreparedReceipts({ receipts: [], now: NOW }), /refusing to guess a resume window/);
for (const resumeWindowSeconds of [0, -1, Infinity]) {
  assert.throws(() => classifyPreparedReceipts({ receipts: [], now: NOW, resumeWindowSeconds }), /must be positive/);
}
assert.throws(() => classifyPreparedReceipts({ receipts: [], resumeWindowSeconds: WINDOW }), /now is required/);
assert.throws(() => classifyPreparedReceipts({ receipts: "invalid", now: NOW, resumeWindowSeconds: WINDOW }), /must be an array/);
assert.deepEqual(classify([
  prepared("live"), prepared("boundary", "2026-08-14T06:00:00Z"),
  prepared("expired", "2026-08-13T00:00:00Z"), prepared("future", "2026-08-20T00:00:00Z"),
  { ...prepared("promoted"), state: "promoted" },
]).live_generations, ["boundary", "future", "live"]);
assert.deepEqual(classify([prepared("shared", "2026-08-12T00:00:00Z"), prepared("shared")]).live_generations, ["shared"]);
assert.throws(() => classify([prepared("")]), /unattributable protection root/);
assert.throws(() => classify([prepared("invalid", "not-a-time")]), /not a parsable instant/);
console.log("test-cloud-data-plane-prepared-receipt-lifecycle: ok");
