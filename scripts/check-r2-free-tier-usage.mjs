#!/usr/bin/env node
// Owner 2026-10-17: Workers Paid, with about KRW 10,000/month extra charges.
// R2 retains its own 10 GB / 1M Class A / 10M Class B free allowances.
// Warn at 70% of free operations, but permit budgeted overages. Estimated R2
// costs warn at KRW 5,000 and block at KRW 8,000, leaving headroom for other
// services/tax. 1,500 KRW/USD is a conservative planning rate, not live FX.
// Retain the existing 40/70 GB storage limits. This is not an account billing cap.
// Unknown measurements still block publication.
//
// One shared deadline covers billing, analytics, all inventory pages and retries
// Successful gates sampled 2026-10-23: n=17, median 92.860s, max 135.873s.
// Allow 300s for the complete measurement (R2_MEASURE_TIMEOUT_MS override),
// while individual attempts retain their 60s R2_MEASURE_FETCH_TIMEOUT_MS cap.
// Partial evidence can prove a breach, but can never certify an account as OK.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... node scripts/check-r2-free-tier-usage.mjs [--json]
//
// Exit codes: 0 = ok, 1 = warn threshold crossed, 2 = fail threshold crossed,
// 3 = the measurement itself could not be trusted.

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "aeeb5ea3affe55a2219d08ea02dad9e1";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createR2S3ClientFromExistingToken } from "./lib/cloud-data-plane-s3.mjs";
import { runBoundedAsyncPool } from "./lib/cloud-data-plane-generation.mjs";
import {
  BACKOFF_BASE_MS,
  MAX_ATTEMPTS,
  MAX_RATE_LIMIT_ATTEMPTS,
  rateLimitDelayMs,
  sleep,
} from "./lib/cloudflare-rate-limit.mjs";

// Exit 2 used to mean BOTH "an axis is at or above 90% of the free allowance"
// and "the measurement could not be trusted", so the ledger could not tell a
// real overrun from an unreadable one and gateVerdict folded both into
// "blocked". They are separate answers and now carry separate codes. Whether an
// unverifiable measurement should still block publication is unchanged: it does.
const MEASUREMENT_UNVERIFIED_EXIT = 3;

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.R2_MEASURE_FETCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FETCH_TIMEOUT_MS;
})();

const MEASUREMENT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.R2_MEASURE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
})();

// Cloudflare R2 free allowance, per calendar month.
const FREE = {
  storage_gb_month: 10,
  class_a_operations: 1_000_000,
  class_b_operations: 10_000_000,
};

// Free-operation use warns early; paid cost, not 90% free use, blocks writes.
const WARN_AT = 0.7;
const COST_WARN_KRW = 5000;
const COST_FAIL_KRW = 8000;
const PLANNING_KRW_PER_USD = 1500;
export const STORAGE_WARN_GB = 40;
export const STORAGE_FAIL_GB = 70;
const STORAGE_USD_PER_GB_MONTH = 0.015;
export function storageCostUsd(gbMonth) {
  return Number((Math.ceil(Math.max(0, gbMonth - FREE.storage_gb_month)) * STORAGE_USD_PER_GB_MONTH).toFixed(3));
}

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

function remainingMeasurementMs(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("measurement deadline reached");
  return Math.min(FETCH_TIMEOUT_MS, remaining);
}

async function fetchWithTimeout(url, init = {}, deadline = Date.now() + MEASUREMENT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMeasurementMs(deadline));
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

// A response whose headers arrived but whose body never finishes used to hang
// the gate (and through it, the publisher holding the writer lock) forever:
// fetchWithTimeout's deadline covers headers only. Race every body read
// against the same deadline so a mid-body stall is reported as unverified.
async function readJsonBody(response, label, deadline = Date.now() + MEASUREMENT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} body read timed out after ${FETCH_TIMEOUT_MS}ms`)),
          remainingMeasurementMs(deadline),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Ask the billing API for the R2 subscription's period end and derive the
// anchor day from it. Returns null when the token lacks billing read or the
// shape is unfamiliar — the caller then falls back to configuration and says so.
async function fetchCycleAnchor(deadline) {
  try {
    const response = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/subscriptions`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }, deadline,
    );
    if (!response.ok) return null;
    const body = await readJsonBody(response, "billing subscriptions", deadline);
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

async function fetchUsage(bounds, deadline) {
  const response = await fetchWithTimeout("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { acc: ACCOUNT_ID, start: bounds.query_start, end: bounds.today },
    }),
  }, deadline);
  if (!response.ok) throw new Error(`graphql http ${response.status}`);
  const body = await readJsonBody(response, "graphql usage", deadline);
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

// Control-plane bucket discovery retains the write path's bounded retry policy.
// Object inventory uses the existing S3 pagination/retry implementation below.
// Exported with injectable transport and sleep so the retry can be exercised
// rather than inferred. A structural check that the 429 branch exists passed
// with that branch disabled, which is the vacuous-contract shape this whole
// programme keeps finding.
export async function cf(path, { transport = fetchWithTimeout, sleepImpl = sleep,
  deadline = Date.now() + MEASUREMENT_TIMEOUT_MS } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`;
  let rateLimitAttempts = 0;
  let transientAttempts = 0;
  for (;;) {
    remainingMeasurementMs(deadline);
    const response = await transport(url, { headers: { Authorization: `Bearer ${TOKEN}` } }, deadline);
    if (response.status === 429) {
      rateLimitAttempts += 1;
      if (rateLimitAttempts > MAX_RATE_LIMIT_ATTEMPTS) {
        throw new Error(`cf ${path} http 429 after ${MAX_RATE_LIMIT_ATTEMPTS} rate-limited attempts`);
      }
      const delay = rateLimitDelayMs(response, rateLimitAttempts, url);
      if (delay >= remainingMeasurementMs(deadline)) throw new Error("measurement retry exceeds deadline");
      await sleepImpl(delay);
      continue;
    }
    if (response.status >= 500) {
      transientAttempts += 1;
      if (transientAttempts >= MAX_ATTEMPTS) {
        throw new Error(`cf ${path} http ${response.status} after ${MAX_ATTEMPTS} attempts`);
      }
      const delay = BACKOFF_BASE_MS * 2 ** (transientAttempts - 1);
      if (delay >= remainingMeasurementMs(deadline)) throw new Error("measurement retry exceeds deadline");
      await sleepImpl(delay);
      continue;
    }
    if (!response.ok) throw new Error(`cf ${path} http ${response.status}`);
    const body = await readJsonBody(response, `cf ${path}`, deadline);
    if (!body.success) throw new Error(`cf ${path}: ${JSON.stringify(body.errors)}`);
    return body;
  }
}

// Storage needs the whole estate, including retained and unrelated families.
// The existing S3 reader lists object metadata, without the slow REST
// object walk. A shared deadline bounds pagination and retries together.
export async function fetchInventory({
  request = cf,
  createClient = createR2S3ClientFromExistingToken,
  fetchImpl = fetch,
  deadline = Date.now() + MEASUREMENT_TIMEOUT_MS,
} = {}) {
  const list = await request("/r2/buckets", { deadline });
  const buckets = (list?.result?.buckets ?? list?.result ?? []).map((b) => b.name).filter(Boolean);
  let bytes = 0;
  let objects = 0;
  let listCalls = 1;
  const bucketMeasurements = [];
  try {
    await runBoundedAsyncPool(buckets, async bucket => {
      const started = Date.now();
      const measured = { bucket, objects: 0, bytes: 0, pages: 0, list_requests: 0, elapsed_ms: 0, complete: false };
      bucketMeasurements.push(measured);
      try {
        const client = await createClient({
          env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: TOKEN },
          bucket,
          timeoutMs: remainingMeasurementMs(deadline),
          fetchImpl: (url, init) => {
            if (new URL(url).searchParams.get("list-type") === "2") {
              listCalls += 1;
              measured.list_requests += 1;
            }
            return fetchImpl(url, init);
          },
        });
        let listed, failure;
        try { listed = await client.listAllObjects({ deadline, onPage: () => { measured.pages += 1; } }); }
        catch (error) { listed = error.partialObjects ?? []; failure = error; }
        for (const object of listed) {
          if (!Number.isSafeInteger(object.size) || object.size < 0) {
            throw new Error("inventory object size is unavailable");
          }
          bytes += object.size;
          objects += 1;
          measured.bytes += object.size;
          measured.objects += 1;
        }
        if (failure) throw failure;
        measured.complete = true;
      } finally {
        measured.elapsed_ms = Date.now() - started;
      }
    });
  } catch (error) {
    // Preserve the lower bound already observed in completed buckets.
    error.inventory = { buckets: buckets.length, bytes, objects, truncated: true, list_calls: listCalls, bucket_measurements: bucketMeasurements };
    throw error;
  }
  return { buckets: buckets.length, bytes, objects, truncated: false, list_calls: listCalls, bucket_measurements: bucketMeasurements };
}

export async function measureAccount(bounds, { deadline = Date.now() + MEASUREMENT_TIMEOUT_MS,
  usage = fetchUsage, inventory = fetchInventory } = {}) {
  const [account, listed] = await Promise.allSettled([usage(bounds, deadline), inventory({ deadline })]);
  const errors = [account, listed].filter(result => result.status === "rejected")
    .map(result => result.reason?.message || String(result.reason));
  const buckets = listed.status === "fulfilled" ? listed.value : listed.reason?.inventory
    ?? { buckets: 0, bytes: 0, objects: 0, truncated: true, list_calls: 0 };
  const summary = summarise(account.status === "fulfilled" ? account.value : {}, bounds, buckets);
  return { summary, buckets, errors, blind: errors.length > 0 || buckets.truncated };
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

export function summarise(account, bounds, inventory) {
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
      projected_storage_cost_usd: storageCostUsd(projectedGbMonth),
      warn_gb_month: STORAGE_WARN_GB,
      fail_gb_month: STORAGE_FAIL_GB,
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

export function verdictFor(summary, plan, blind) {
  // A planned run is scored as if it had already happened. This is the only
  // part of the guard that closes the analytics-lag window: the publish path
  // knows its own operation count before it writes, and that number does not
  // depend on a dataset that reports late.
  const axes = [
    ["storage", (summary.storage.peak_bytes + plan.bytes) / 1e9 / FREE.storage_gb_month, STORAGE_WARN_GB / FREE.storage_gb_month, STORAGE_FAIL_GB / FREE.storage_gb_month],
    ["class_a", (summary.class_a.projected_month + plan.class_a) / FREE.class_a_operations, WARN_AT, Infinity],
    ["class_b", (summary.class_b.projected_month + plan.class_b) / FREE.class_b_operations, WARN_AT, Infinity],
  ];
  // Standard R2 rounds operation overages up to the next million.
  const storageUsd = storageCostUsd((summary.storage.peak_bytes + plan.bytes) / 1e9);
  const classAUsd = Math.ceil(Math.max(0, summary.class_a.projected_month + plan.class_a - FREE.class_a_operations) / 1e6) * 4.50;
  const classBUsd = Math.ceil(Math.max(0, summary.class_b.projected_month + plan.class_b - FREE.class_b_operations) / 1e6) * 0.36;
  axes.push(["estimated_cost_krw", Math.ceil((storageUsd + classAUsd + classBUsd) * PLANNING_KRW_PER_USD), COST_WARN_KRW, COST_FAIL_KRW]);
  const breaches = axes.filter(([, f, , fail]) => f >= fail).map(([name]) => name);
  const warnings = axes.filter(([, f, warn, fail]) => f >= warn && f < fail).map(([name]) => name);
  const with_plan = Object.fromEntries(axes);
  if (breaches.length) return { verdict: "fail", breaches, warnings, with_plan };
  if (blind) return { verdict: "unverified", breaches, warnings, with_plan };
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
  const deadline = Date.now() + MEASUREMENT_TIMEOUT_MS;
  // Billing discovery is optional; do not let it consume the measurement budget.
  const bounds = cycleBounds(new Date(), await fetchCycleAnchor(Math.min(deadline, Date.now() + 5000)));
  const plan = {
    class_a: numericFlag("plan-class-a"),
    class_b: numericFlag("plan-class-b"),
    bytes: numericFlag("plan-bytes"),
  };
  const { summary, buckets, errors, blind } = await measureAccount(bounds, { deadline });
  if (errors.length) {
    console.error(`check-r2-free-tier-usage: measurement incomplete (${errors.join("; ")}) — partial values are lower bounds, never verified OK`);
  }
  // The measurement's own S3 ListObjects requests are billable Class A too.
  plan.class_a += buckets.list_calls;
  // Storage now comes from the object listing, so an empty analytics dataset is
  // no longer blindness. The remaining blind case is a listing we could not
  // finish: we cannot certify bytes we did not count.
  const { verdict, breaches, warnings, with_plan } = verdictFor(summary, plan, blind);
  const report = {
    schema_version: "r2-free-tier-usage/v2",
    verdict, breaches, warnings,
    thresholds: {
      operation_fractions: { warn_at: WARN_AT, fail_at: null },
      estimated_cost_krw: { warn_at: COST_WARN_KRW, fail_at: COST_FAIL_KRW },
      planning_krw_per_usd: PLANNING_KRW_PER_USD,
      standard_operation_usd_per_million: { class_a: 4.50, class_b: 0.36 },
      storage_gb_month: { warn_at: STORAGE_WARN_GB, fail_at: STORAGE_FAIL_GB },
      decision_date: "2026-10-17", owner_extra_charge_allowance_krw: 10000,
      coverage: "R2 only; excludes Workers and other services, tax and FX variation" },
    planned_operations: plan,
    used_fraction_including_plan: with_plan,
    bucket_count: buckets.buckets,
    inventory_list_calls: buckets.list_calls,
    inventory_buckets: buckets.bucket_measurements ?? [],
    measurement_blind: blind,
    measurement_errors: errors,
    measurement_values_are_lower_bounds: blind,
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
      console.log(`  including plan: storage ${(with_plan.storage * FREE.storage_gb_month).toFixed(4)} GB-month, class A ${pct(with_plan.class_a)}, class B ${pct(with_plan.class_b)}`);
    }
    console.log(`  estimated R2 including plan: KRW ${with_plan.estimated_cost_krw}; warn ${COST_WARN_KRW}, block ${COST_FAIL_KRW} (planning FX ${PLANNING_KRW_PER_USD} KRW/USD)`);
    console.log(`  storage policy: warn ${STORAGE_WARN_GB} GB-month / fail ${STORAGE_FAIL_GB} GB-month; projected storage cost $${summary.storage.projected_storage_cost_usd.toFixed(3)} (before plan)`);
    if (summary.storage.pending_multipart_uploads > 0) {
      console.log(`  WARN: ${summary.storage.pending_multipart_uploads} pending multipart upload(s) hold bytes this projection may not cover`);
    }
    console.log(`  measured   ${summary.storage.measured_from_listing.objects} objects / ${summary.storage.measured_from_listing.bytes} bytes from the listing across ${buckets.buckets} bucket(s); analytics peak ${summary.storage.analytics_peak_bytes} bytes`);
    for (const bucket of buckets.bucket_measurements ?? []) {
      console.log(`  inventory bucket=${bucket.bucket} objects=${bucket.objects} bytes=${bucket.bytes} pages=${bucket.pages} list_requests=${bucket.list_requests} elapsed_ms=${bucket.elapsed_ms} complete=${bucket.complete}`);
    }
    if (blind) console.log(`  UNVERIFIED: measurement incomplete; reported values are lower bounds`);
    if (breaches.length) console.log(`  BREACH: ${breaches.join(", ")} at or above its axis fail threshold (storage ${STORAGE_FAIL_GB} GB-month; estimated R2 cost KRW ${COST_FAIL_KRW})`);
    else if (warnings.length) console.log(`  WARN: ${warnings.join(", ")} at or above its axis warning threshold (storage ${STORAGE_WARN_GB} GB-month; operations ${pct(WARN_AT)} free or cost KRW ${COST_WARN_KRW})`);
  }
  process.exit(verdict === "fail" ? 2 : verdict === "unverified" ? MEASUREMENT_UNVERIFIED_EXIT : verdict === "warn" ? 1 : 0);
}

// Guarded so the module can be imported. Without this, `await main()` ran on
// import: it scans the live Cloudflare account and then calls process.exit, so
// the module was untestable and any future importer would have triggered a real
// account walk as a side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
