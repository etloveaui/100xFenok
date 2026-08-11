#!/usr/bin/env node
// Measure real Cloudflare R2 usage against the free allowance and fail closed
// before anything can be billed.
//
// The owner's constraint is absolute: this account must never incur an R2
// charge. Cloudflare offers no hard spend stop for R2, so the only real
// protection is a measurement that runs before we write at scale and refuses
// to go on when the projection approaches the free ceiling.
//
// Every measurement fetch carries a bounded deadline (default 60s; override
// with R2_MEASURE_FETCH_TIMEOUT_MS). A timed-out measurement throws and fails
// closed (exit 2) exactly like any other unreadable API; only the billing
// cycle-anchor probe keeps its existing fallback-to-configuration behavior.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... node scripts/check-r2-free-tier-usage.mjs [--json]
//
// Exit codes: 0 = ok, 1 = warn threshold crossed, 2 = fail threshold crossed
// or the measurement itself could not be trusted.

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "aeeb5ea3affe55a2219d08ea02dad9e1";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.R2_MEASURE_FETCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FETCH_TIMEOUT_MS;
})();

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
  "ListMultipartUploads", "ListParts", "PutBucketEncryption", "PutBucketCors",
  "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition",
]);
const CLASS_B = new Set([
  "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption",
  "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
]);
const FREE_ACTIONS = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

// The free allowance resets on the account's billing anniversary, NOT on the
// first of the calendar month. The anchor is read from the R2 subscription when
// the token carries billing read; otherwise it falls back to configuration. The
// guard never trusts it alone either way (see TRAILING_DAYS).
const CYCLE_ANCHOR_FALLBACK = Number(process.env.R2_BILLING_CYCLE_ANCHOR_DAY ?? 11);

// A trailing window at least as long as any monthly cycle. Usage is scored on
// the LARGER of the anchored cycle and this window, so a wrong anchor can only
// make the guard stricter, never blinder.
const TRAILING_DAYS = 31;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`measurement fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Ask the billing API for the R2 subscription's period end and derive the
// anchor day from it. Returns null when the token lacks billing read or the
// shape is unfamiliar — the caller then falls back to configuration and says so.
async function fetchCycleAnchor() {
  try {
    const response = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/subscriptions`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.success) return null;
    const r2 = (body.result ?? []).find((s) => (s?.rate_plan?.id ?? "").startsWith("r2"));
    const end = r2?.current_period_end;
    if (!end) return null;
    const day = new Date(end).getUTCDate();
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { day, source: `billing API, subscription ${r2.rate_plan.id}, period end ${end}` } : null;
  } catch {
    return null;
  }
}

function cycleBounds(now, anchorInfo) {
  const anchor = Math.min(Math.max(anchorInfo?.day ?? CYCLE_ANCHOR_FALLBACK, 1), 28);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startsThisMonth = now.getUTCDate() >= anchor;
  const start = new Date(Date.UTC(y, startsThisMonth ? m : m - 1, anchor));
  const end = new Date(Date.UTC(y, startsThisMonth ? m + 1 : m, anchor));
  const cycleDays = Math.round((end - start) / 86_400_000);
  const elapsed = Math.max(1, Math.round((now - start) / 86_400_000) + 1);
  return {
    cycle_start: iso(start),
    cycle_end_exclusive: iso(end),
    cycle_days: cycleDays,
    elapsed_days: Math.min(elapsed, cycleDays),
    trailing_start: iso(addDays(now, -(TRAILING_DAYS - 1))),
    today: iso(now),
    // Query range must cover whichever window starts earlier.
    query_start: iso(new Date(Math.min(start.getTime(), addDays(now, -(TRAILING_DAYS - 1)).getTime()))),
    anchor_day: anchor,
    anchor_source: anchorInfo?.source ?? `configuration fallback (day ${CYCLE_ANCHOR_FALLBACK}), billing API unavailable`,
  };
}

const QUERY = `query($acc:String!,$start:Date!,$end:Date!){
  viewer{ accounts(filter:{accountTag:$acc}){
    r2StorageAdaptiveGroups(limit:200, filter:{date_geq:$start, date_leq:$end}){
      max{ payloadSize objectCount uploadCount } dimensions{ date }
    }
    r2OperationsAdaptiveGroups(limit:5000, filter:{date_geq:$start, date_leq:$end}){
      sum{ requests } dimensions{ actionType date }
    }
  }}
}`;

async function fetchUsage(bounds) {
  const response = await fetchWithTimeout("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { acc: ACCOUNT_ID, start: bounds.query_start, end: bounds.today },
    }),
  });
  if (!response.ok) throw new Error(`graphql http ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(`graphql: ${JSON.stringify(body.errors)}`);
  const account = body?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("graphql returned no account row");
  return account;
}

// The storage analytics dataset is daily-granular: measured 2026-08-03, a fresh
// object was still invisible to it 57 minutes after the write while operations
// appeared within about one minute. Storage therefore cannot depend on
// analytics — it is measured directly from the object listing, which is ground
// truth. Analytics remains the source for operations.
const INVENTORY_PAGE_SIZE = 1000;
const INVENTORY_MAX_PAGES = 100; // 100k objects; the current estate is ~31.7k

async function cf(path) {
  const response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) throw new Error(`cf ${path} http ${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error(`cf ${path}: ${JSON.stringify(body.errors)}`);
  return body;
}

// Walk every bucket and sum real object bytes. Throws so the caller fails closed;
// a truncated walk is reported rather than silently under-counted.
async function fetchInventory() {
  const list = await cf("/r2/buckets");
  const buckets = (list?.result?.buckets ?? list?.result ?? []).map((b) => b.name).filter(Boolean);
  let bytes = 0;
  let objects = 0;
  let truncated = false;
  let listCalls = 1;
  for (const bucket of buckets) {
    let cursor = "";
    for (let page = 0; page < INVENTORY_MAX_PAGES; page += 1) {
      const query = `?per_page=${INVENTORY_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await cf(`/r2/buckets/${encodeURIComponent(bucket)}/objects${query}`);
      listCalls += 1;
      for (const object of body.result ?? []) {
        bytes += object?.size ?? 0;
        objects += 1;
      }
      cursor = body?.result_info?.cursor ?? "";
      if (!cursor) break;
      if (page === INVENTORY_MAX_PAGES - 1) truncated = true;
    }
  }
  return { buckets: buckets.length, bytes, objects, truncated, list_calls: listCalls };
}

function tallyOperations(rows, fromDate) {
  let classA = 0;
  let classB = 0;
  const unknown = new Map();
  for (const row of rows ?? []) {
    const date = row?.dimensions?.date ?? "";
    if (date && date < fromDate) continue;
    const action = row?.dimensions?.actionType ?? "";
    const requests = row?.sum?.requests ?? 0;
    if (FREE_ACTIONS.has(action)) continue;
    if (CLASS_B.has(action)) { classB += requests; continue; }
    if (!CLASS_A.has(action)) unknown.set(action, (unknown.get(action) ?? 0) + requests);
    classA += requests;
  }
  return { classA, classB, unknown: [...unknown].map(([action, requests]) => ({ action, requests })) };
}

function summarise(account, bounds, inventory) {
  const storageDays = account.r2StorageAdaptiveGroups ?? [];
  const peakSince = (from) => storageDays.reduce(
    (acc, row) => (row?.dimensions?.date && row.dimensions.date < from)
      ? acc
      : {
          bytes: Math.max(acc.bytes, row?.max?.payloadSize ?? 0),
          objects: Math.max(acc.objects, row?.max?.objectCount ?? 0),
          uploads: Math.max(acc.uploads, row?.max?.uploadCount ?? 0),
        },
    { bytes: 0, objects: 0, uploads: 0 },
  );

  // Score every axis on the LARGER of the anchored billing cycle and a trailing
  // 31-day window. If the anchor day is wrong, this can only overstate usage.
  const cyclePeak = peakSince(bounds.cycle_start);
  const trailingPeak = peakSince(bounds.trailing_start);
  // Ground truth from the listing wins whenever it is larger than what the
  // daily analytics snapshot has caught up to.
  const peakBytes = Math.max(cyclePeak.bytes, trailingPeak.bytes, inventory?.bytes ?? 0);
  const peakObjects = Math.max(cyclePeak.objects, trailingPeak.objects, inventory?.objects ?? 0);
  // Pending multipart uploads hold bytes that `payloadSize` may not include.
  // Nothing here uploads multipart today, so any non-zero value means a code
  // path we did not expect is storing bytes this projection cannot see.
  const pendingUploads = Math.max(cyclePeak.uploads, trailingPeak.uploads);

  // Conservative storage projection: assume the observed peak is sustained for
  // the whole cycle. Under-projecting is the only failure mode that costs money.
  const projectedGbMonth = peakBytes / 1e9;

  const ops = account.r2OperationsAdaptiveGroups;
  const cycleOps = tallyOperations(ops, bounds.cycle_start);
  const trailingOps = tallyOperations(ops, bounds.trailing_start);

  // Cycle usage is projected forward at the observed rate; the trailing window
  // is already a full cycle length and is used as-is.
  const rate = bounds.cycle_days / bounds.elapsed_days;
  const projectA = Math.max(Math.ceil(cycleOps.classA * rate), trailingOps.classA);
  const projectB = Math.max(Math.ceil(cycleOps.classB * rate), trailingOps.classB);
  const unknown = cycleOps.unknown.length >= trailingOps.unknown.length ? cycleOps.unknown : trailingOps.unknown;

  return {
    window: {
      billing_cycle: { start: bounds.cycle_start, end_exclusive: bounds.cycle_end_exclusive, days: bounds.cycle_days, elapsed_days: bounds.elapsed_days },
      trailing_window: { start: bounds.trailing_start, days: TRAILING_DAYS },
      through: bounds.today,
      anchor_day: bounds.anchor_day,
      anchor_source: bounds.anchor_source,
      scoring: "max(billing cycle projected to full cycle, trailing 31 days)",
    },
    storage: {
      peak_bytes: peakBytes,
      peak_objects: peakObjects,
      measured_from_listing: { bytes: inventory?.bytes ?? 0, objects: inventory?.objects ?? 0, truncated: Boolean(inventory?.truncated) },
      analytics_peak_bytes: Math.max(cyclePeak.bytes, trailingPeak.bytes),
      pending_multipart_uploads: pendingUploads,
      projected_gb_month: projectedGbMonth,
      free_gb_month: FREE.storage_gb_month,
      used_fraction: projectedGbMonth / FREE.storage_gb_month,
    },
    class_a: {
      cycle_to_date: cycleOps.classA,
      trailing_31d: trailingOps.classA,
      projected_month: projectA,
      free: FREE.class_a_operations,
      used_fraction: projectA / FREE.class_a_operations,
      unknown_actions_counted_as_class_a: unknown,
    },
    class_b: {
      cycle_to_date: cycleOps.classB,
      trailing_31d: trailingOps.classB,
      projected_month: projectB,
      free: FREE.class_b_operations,
      used_fraction: projectB / FREE.class_b_operations,
    },
  };
}

function verdictFor(summary, plan, blind) {
  // A planned run is scored as if it had already happened. This is the only
  // part of the guard that closes the analytics-lag window: the publish path
  // knows its own operation count before it writes, and that number does not
  // depend on a dataset that reports late.
  const axes = [
    ["storage", (summary.storage.peak_bytes + plan.bytes) / 1e9 / FREE.storage_gb_month],
    ["class_a", (summary.class_a.projected_month + plan.class_a) / FREE.class_a_operations],
    ["class_b", (summary.class_b.projected_month + plan.class_b) / FREE.class_b_operations],
  ];
  const breaches = axes.filter(([, f]) => f >= FAIL_AT).map(([name]) => name);
  const warnings = axes.filter(([, f]) => f >= WARN_AT && f < FAIL_AT).map(([name]) => name);
  const with_plan = Object.fromEntries(axes);
  if (blind) return { verdict: "fail", breaches: ["measurement_blind"], warnings, with_plan };
  if (breaches.length) return { verdict: "fail", breaches, warnings, with_plan };
  if (warnings.length) return { verdict: "warn", breaches, warnings, with_plan };
  return { verdict: "ok", breaches, warnings, with_plan };
}

function numericFlag(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return 0;
  const value = Number(hit.slice(name.length + 3));
  if (!Number.isFinite(value) || value < 0) {
    console.error(`check-r2-free-tier-usage: --${name} must be a non-negative number`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const json = process.argv.includes("--json");
  if (!TOKEN) {
    console.error("check-r2-free-tier-usage: CLOUDFLARE_API_TOKEN is not set — refusing to report ok on an unmeasured account");
    process.exit(2);
  }
  const bounds = cycleBounds(new Date(), await fetchCycleAnchor());
  const plan = {
    class_a: numericFlag("plan-class-a"),
    class_b: numericFlag("plan-class-b"),
    bytes: numericFlag("plan-bytes"),
  };
  let summary;
  let buckets;
  try {
    const [account, inv] = await Promise.all([fetchUsage(bounds), fetchInventory()]);
    summary = summarise(account, bounds, inv);
    buckets = inv;
  } catch (error) {
    console.error(`check-r2-free-tier-usage: measurement failed (${error.message}) — treating as fail, not as ok`);
    process.exit(2);
  }
  // Storage now comes from the object listing, so an empty analytics dataset is
  // no longer blindness. The remaining blind case is a listing we could not
  // finish: we cannot certify bytes we did not count.
  const blind = buckets.truncated;
  const { verdict, breaches, warnings, with_plan } = verdictFor(summary, plan, blind);
  const report = {
    schema_version: "r2-free-tier-usage/v2",
    verdict, breaches, warnings,
    thresholds: { warn_at: WARN_AT, fail_at: FAIL_AT },
    planned_operations: plan,
    used_fraction_including_plan: with_plan,
    bucket_count: buckets.buckets,
    inventory_list_calls: buckets.list_calls,
    measurement_blind: blind,
    ...summary,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = (f) => `${(f * 100).toFixed(2)}%`;
    console.log(`check-r2-free-tier-usage: ${verdict.toUpperCase()}  (billing cycle ${bounds.cycle_start} → ${bounds.cycle_end_exclusive}, day ${bounds.elapsed_days}/${bounds.cycle_days}; anchor ${bounds.anchor_day} from ${bounds.anchor_source})`);
    console.log(`  storage  ${summary.storage.projected_gb_month.toFixed(4)} / ${FREE.storage_gb_month} GB-month   ${pct(summary.storage.used_fraction)}   (peak ${summary.storage.peak_objects} objects)`);
    console.log(`  class A  ${summary.class_a.projected_month} / ${FREE.class_a_operations} ops/month   ${pct(summary.class_a.used_fraction)}   (cycle ${summary.class_a.cycle_to_date}, trailing31d ${summary.class_a.trailing_31d})`);
    console.log(`  class B  ${summary.class_b.projected_month} / ${FREE.class_b_operations} ops/month   ${pct(summary.class_b.used_fraction)}   (cycle ${summary.class_b.cycle_to_date}, trailing31d ${summary.class_b.trailing_31d})`);
    if (summary.class_a.unknown_actions_counted_as_class_a.length) {
      console.log(`  unclassified actions counted as class A: ${summary.class_a.unknown_actions_counted_as_class_a.map((u) => `${u.action}=${u.requests}`).join(", ")}`);
    }
    if (plan.class_a || plan.class_b || plan.bytes) {
      console.log(`  planned run: +${plan.class_a} class A, +${plan.class_b} class B, +${plan.bytes} bytes`);
      console.log(`  including plan: storage ${pct(with_plan.storage)}, class A ${pct(with_plan.class_a)}, class B ${pct(with_plan.class_b)}`);
    }
    if (summary.storage.pending_multipart_uploads > 0) {
      console.log(`  WARN: ${summary.storage.pending_multipart_uploads} pending multipart upload(s) hold bytes this projection may not cover`);
    }
    console.log(`  measured   ${summary.storage.measured_from_listing.objects} objects / ${summary.storage.measured_from_listing.bytes} bytes from the listing across ${buckets.buckets} bucket(s); analytics peak ${summary.storage.analytics_peak_bytes} bytes`);
    if (blind) console.log(`  BLIND: object listing truncated — cannot certify bytes that were not counted`);
    else if (breaches.length) console.log(`  BREACH: ${breaches.join(", ")} at or above ${pct(FAIL_AT)} of the free allowance`);
    else if (warnings.length) console.log(`  WARN: ${warnings.join(", ")} at or above ${pct(WARN_AT)} of the free allowance`);
  }
  process.exit(verdict === "fail" ? 2 : verdict === "warn" ? 1 : 0);
}

await main();
