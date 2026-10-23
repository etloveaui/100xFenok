import assert from "node:assert/strict";
import { measureAccountWithRetry, fetchInventory, verdictFor, summarise, storageCostUsd, STORAGE_WARN_GB, STORAGE_FAIL_GB } from "./check-r2-free-tier-usage.mjs";
import { createR2S3Client, createR2S3ClientFromExistingToken } from "./lib/cloud-data-plane-s3.mjs";
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
assert.equal(verdictFor(summary(1), plan, true).verdict, "unverified");
assert.equal(verdictFor(summary(70, 900000), plan, true).breaches.length, 1);
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
// A family-sized inventory would miss retained generations and other buckets.
// Keep the full storage guard while replacing its slow REST object walk.
{
  const buckets = [];
  const request = async route => {
    assert.equal(route, "/r2/buckets");
    return { result: { buckets: [{ name: "first" }, { name: "other" }] } };
  };
  const inventory = await fetchInventory({ request, createClient: async ({ bucket }) => {
    buckets.push(bucket);
    return { listAllObjects: async () => [{ size: bucket === "first" ? 13 : 29 }] };
  } });
  assert.deepEqual(buckets, ["first", "other"]);
  assert.equal(inventory.bytes, 42);
  assert.equal(inventory.objects, 2);
  assert.equal(inventory.truncated, false);
  const paths = [];
  const client = await createR2S3ClientFromExistingToken({
    env: { CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture" },
    bucket: "other",
    fetchImpl: async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/tokens/verify")) {
        return new Response(JSON.stringify({ success: true, result: { id: "fixture", status: "active" } }));
      }
      paths.push(parsed.pathname);
      return new Response("<ListBucketResult><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>");
    },
  });
  assert.deepEqual(await client.listAllObjects(), []);
  assert.deepEqual(paths, ["/other"], "each discovered bucket must be measured, not the default plane repeatedly");
  await assert.rejects(fetchInventory({ request, createClient: async () => ({
    listAllObjects: async () => { throw new Error("S3_LIST_BUDGET"); },
  }) }), /S3_LIST_BUDGET/, "an incomplete inventory must remain unverified");
  await assert.rejects(fetchInventory({ request, createClient: async () => ({
    listAllObjects: async () => [{ size: undefined }],
  }) }), /size is unavailable/);
}
for (const [status, length] of [[200, "42"], [404, null], [200, null], [200, "bad"], [403, null]]) {
  const client = createR2S3Client({ endpoint: "https://example.invalid", accessKeyId: "fixture",
    secretAccessKey: "fixture", bucket: "fixture", fetchImpl: async (url, options) => {
      assert.equal(options.method, "HEAD");
      return new Response(null, { status, headers: length === null ? {} : { "content-length": length } });
    } });
  if (status === 404) assert.equal(await client.headObject("objects/sha256/fixture"), null);
  else if (status === 200 && length === "42") assert.deepEqual(await client.headObject("objects/sha256/fixture"), { size: 42 });
  else await assert.rejects(client.headObject("objects/sha256/fixture"));
}
console.log("R2 storage budget: PASS (40/70 GB, planned increments, paid operation cost thresholds, blind measurement, billing rounding)");

// Owner-approved fail-open applies only after one bounded whole measurement retry.
{
  const resultFor = (gb, blind, calls = 2) => ({ summary: summary(gb), buckets: { list_calls: calls }, errors: blind ? ["network"] : [], blind });
  const run = async (results) => {
    let clock = 0;
    const deadlines = [];
    const measured = await measureAccountWithRetry(bounds, plan, { deadline: 300, now: () => clock,
      measure: async (_, { deadline }) => { deadlines.push(deadline); clock = deadline; return results.shift(); },
    });
    return { measured, deadlines };
  };
  const recovered = await run([resultFor(1, true), resultFor(1, false, 3)]);
  assert.deepEqual(recovered.deadlines, [150, 300], "retry shares one 300-unit budget");
  assert.equal(recovered.measured.blind, false);
  assert.equal(recovered.measured.buckets.list_calls, 5, "both attempts incur listing operations");
  assert.deepEqual(recovered.measured.attempts.map(a => a.verdict), ["unverified", "ok"]);
  const blind = await run([resultFor(1, true), resultFor(1, true)]);
  assert.equal(blind.measured.attempts.length, 2);
  assert.equal(blind.measured.blind, true);
  const breach = await run([resultFor(71, true)]);
  assert.equal(breach.measured.attempts.length, 1, "partial evidence breach cannot be retried away");
  assert.equal(breach.measured.attempts[0].verdict, "fail");
  const clean = await run([resultFor(1, false)]);
  assert.equal(clean.measured.attempts.length, 1, "healthy measurements are not repeated");
  const laterBreach = await run([resultFor(1, true), resultFor(71, true)]);
  assert.equal(laterBreach.measured.attempts[1].verdict, "fail");
  console.log("R2 bounded whole-measurement retry: PASS");
}
