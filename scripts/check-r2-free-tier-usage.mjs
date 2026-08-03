#!/usr/bin/env node
// Measure real Cloudflare R2 usage against the free allowance and fail closed
// before anything can be billed.
//
// The owner's constraint is absolute: this account must never incur an R2
// charge. Cloudflare offers no hard spend stop for R2, so the only real
// protection is a measurement that runs before we write at scale and refuses
// to go on when the projection approaches the free ceiling.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... node scripts/check-r2-free-tier-usage.mjs [--json]
//
// Exit codes: 0 = ok, 1 = warn threshold crossed, 2 = fail threshold crossed
// or the measurement itself could not be trusted.

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "aeeb5ea3affe55a2219d08ea02dad9e1";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// Cloudflare R2 free allowance, per calendar month.
const FREE = {
  storage_gb_month: 10,
  class_a_operations: 1_000_000,
  class_b_operations: 10_000_000,
};

// Fractions of the free allowance at which we warn and at which we refuse.
const WARN_AT = 0.7;
const FAIL_AT = 0.9;

// Cloudflare's published operation classes. Anything not listed here is counted
// as Class A on purpose: an unknown action must never make the projection look
// cheaper than it is.
const CLASS_A = new Set([
  "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
  "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy",
  "ListMultipartUploads", "PutBucketEncryption", "PutBucketCors",
  "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition",
]);
const CLASS_B = new Set([
  "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption",
  "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
]);
const FREE_ACTIONS = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

function monthBounds(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    start: iso(start),
    today: iso(now),
    daysInMonth: end.getUTCDate(),
    dayOfMonth: now.getUTCDate(),
  };
}

const QUERY = `query($acc:String!,$start:Date!,$end:Date!){
  viewer{ accounts(filter:{accountTag:$acc}){
    r2StorageAdaptiveGroups(limit:100, filter:{date_geq:$start, date_leq:$end}){
      max{ payloadSize objectCount } dimensions{ date }
    }
    r2OperationsAdaptiveGroups(limit:1000, filter:{date_geq:$start, date_leq:$end}){
      sum{ requests } dimensions{ actionType }
    }
  }}
}`;

async function fetchUsage(bounds) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { acc: ACCOUNT_ID, start: bounds.start, end: bounds.today },
    }),
  });
  if (!response.ok) throw new Error(`graphql http ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(`graphql: ${JSON.stringify(body.errors)}`);
  const account = body?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("graphql returned no account row");
  return account;
}

function summarise(account, bounds) {
  const storageDays = account.r2StorageAdaptiveGroups ?? [];
  const peakBytes = storageDays.reduce((max, row) => Math.max(max, row?.max?.payloadSize ?? 0), 0);
  const peakObjects = storageDays.reduce((max, row) => Math.max(max, row?.max?.objectCount ?? 0), 0);

  // Conservative storage projection: assume today's peak is sustained for the
  // whole month. Under-projecting is the only failure mode that can cost money.
  const projectedGbMonth = peakBytes / 1e9;

  let classA = 0;
  let classB = 0;
  const unknown = [];
  for (const row of account.r2OperationsAdaptiveGroups ?? []) {
    const action = row?.dimensions?.actionType ?? "";
    const requests = row?.sum?.requests ?? 0;
    if (FREE_ACTIONS.has(action)) continue;
    if (CLASS_B.has(action)) { classB += requests; continue; }
    if (!CLASS_A.has(action)) unknown.push({ action, requests });
    classA += requests;
  }

  // Month-to-date operations projected to a full month at the observed rate.
  const elapsed = Math.max(1, bounds.dayOfMonth);
  const rate = bounds.daysInMonth / elapsed;
  return {
    window: { start: bounds.start, through: bounds.today, days_elapsed: elapsed, days_in_month: bounds.daysInMonth },
    storage: {
      peak_bytes: peakBytes,
      peak_objects: peakObjects,
      projected_gb_month: projectedGbMonth,
      free_gb_month: FREE.storage_gb_month,
      used_fraction: projectedGbMonth / FREE.storage_gb_month,
    },
    class_a: {
      month_to_date: classA,
      projected_month: Math.ceil(classA * rate),
      free: FREE.class_a_operations,
      used_fraction: (classA * rate) / FREE.class_a_operations,
      unknown_actions_counted_as_class_a: unknown,
    },
    class_b: {
      month_to_date: classB,
      projected_month: Math.ceil(classB * rate),
      free: FREE.class_b_operations,
      used_fraction: (classB * rate) / FREE.class_b_operations,
    },
  };
}

function verdictFor(summary) {
  const axes = [
    ["storage", summary.storage.used_fraction],
    ["class_a", summary.class_a.used_fraction],
    ["class_b", summary.class_b.used_fraction],
  ];
  const breaches = axes.filter(([, f]) => f >= FAIL_AT).map(([name]) => name);
  const warnings = axes.filter(([, f]) => f >= WARN_AT && f < FAIL_AT).map(([name]) => name);
  if (breaches.length) return { verdict: "fail", breaches, warnings };
  if (warnings.length) return { verdict: "warn", breaches, warnings };
  return { verdict: "ok", breaches, warnings };
}

async function main() {
  const json = process.argv.includes("--json");
  if (!TOKEN) {
    console.error("check-r2-free-tier-usage: CLOUDFLARE_API_TOKEN is not set — refusing to report ok on an unmeasured account");
    process.exit(2);
  }
  const bounds = monthBounds(new Date());
  let summary;
  try {
    summary = summarise(await fetchUsage(bounds), bounds);
  } catch (error) {
    console.error(`check-r2-free-tier-usage: measurement failed (${error.message}) — treating as fail, not as ok`);
    process.exit(2);
  }
  const { verdict, breaches, warnings } = verdictFor(summary);
  const report = { schema_version: "r2-free-tier-usage/v1", verdict, breaches, warnings, thresholds: { warn_at: WARN_AT, fail_at: FAIL_AT }, ...summary };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = (f) => `${(f * 100).toFixed(2)}%`;
    console.log(`check-r2-free-tier-usage: ${verdict.toUpperCase()}  (${bounds.start} → ${bounds.today}, day ${bounds.dayOfMonth}/${bounds.daysInMonth})`);
    console.log(`  storage  ${summary.storage.projected_gb_month.toFixed(4)} / ${FREE.storage_gb_month} GB-month   ${pct(summary.storage.used_fraction)}   (peak ${summary.storage.peak_objects} objects)`);
    console.log(`  class A  ${summary.class_a.projected_month} / ${FREE.class_a_operations} ops/month   ${pct(summary.class_a.used_fraction)}   (MTD ${summary.class_a.month_to_date})`);
    console.log(`  class B  ${summary.class_b.projected_month} / ${FREE.class_b_operations} ops/month   ${pct(summary.class_b.used_fraction)}   (MTD ${summary.class_b.month_to_date})`);
    if (summary.class_a.unknown_actions_counted_as_class_a.length) {
      console.log(`  unclassified actions counted as class A: ${summary.class_a.unknown_actions_counted_as_class_a.map((u) => `${u.action}=${u.requests}`).join(", ")}`);
    }
    if (breaches.length) console.log(`  BREACH: ${breaches.join(", ")} at or above ${pct(FAIL_AT)} of the free allowance`);
    else if (warnings.length) console.log(`  WARN: ${warnings.join(", ")} at or above ${pct(WARN_AT)} of the free allowance`);
  }
  process.exit(verdict === "fail" ? 2 : verdict === "warn" ? 1 : 0);
}

await main();
