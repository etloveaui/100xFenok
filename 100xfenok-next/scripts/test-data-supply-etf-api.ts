import assert from "node:assert/strict";
import {
  buildUnavailableEtfRepresentation,
  canonicalJsonSha256,
  mergeEtfDataSupply,
  resolveDataSupplyEtfDetail,
  sha256Text,
  type PublicJsonDocument,
} from "../src/lib/server/data-supply-etf-detail";
import {
  buildTypedUnavailableDataPoint,
  recordTypedUnavailableResponse,
  unavailableStateAgeHours,
} from "../src/lib/server/data-supply-etf-telemetry";
import { withResponseCache } from "../src/lib/server/response-cache";

type JsonRecord = Record<string, unknown>;

function document(value: JsonRecord, raw = JSON.stringify(value)): PublicJsonDocument {
  return { raw, value };
}

async function fixture(options: {
  ticker?: string;
  enrolledTicker?: string;
  state?: "fresh_fallback" | "lkg_fallback" | "unavailable";
  direct?: JsonRecord | null;
  payload?: JsonRecord | null;
  guardMissing?: boolean;
  indexMissing?: boolean;
  invalidCounts?: boolean;
  crossbind?: boolean;
}) {
  const ticker = options.ticker ?? "ADIU";
  const enrolledTicker = options.enrolledTicker ?? ticker;
  const unavailable = options.state === "unavailable";
  const entry = unavailable
    ? {
        ticker,
        enrollment_state: "enrolled",
        resolution_state: "unavailable",
        provider_role: null,
        fallback_depth: null,
        source_as_of: null,
        selected_at: null,
        recovery_transition: "unavailable",
        payload_sha256: null,
        payload_path: null,
      }
    : {
        ticker,
        enrollment_state: "enrolled",
        resolution_state: options.state ?? "fresh_fallback",
        provider_role: "fallback",
        fallback_depth: 1,
        source_as_of: "2026-07-02T01:57:29Z",
        selected_at: "2026-07-11T00:00:00Z",
        reason_code: "primary_unavailable",
        payload_sha256: "",
        payload_path: `payloads/${ticker}.json`,
      };
  const payload = options.payload === undefined
    ? {
        schema_version: "yf-etf-detail/v1",
        source: "yahoo_finance",
        asset_type: "etf",
        ticker,
        fetched_at: "2026-07-02T01:57:29Z",
        source_as_of: "2026-07-02T01:57:29Z",
        normalized: { holdings: [] },
      }
    : options.payload;
  const payloadDoc = payload ? document(payload) : null;
  if (payloadDoc && !unavailable) entry.payload_sha256 = await sha256Text(payloadDoc.raw);
  const membershipSha = await canonicalJsonSha256([enrolledTicker]);

  const index: JsonRecord = {
    schema_version: "data-supply-etf-detail-public-index/v1",
    domain: "etf_detail",
    generated_at: "2026-07-11T00:00:00Z",
    active_transaction_id: "tx-1",
    active_generation_manifest_sha256: "a".repeat(64),
    membership_sha256: membershipSha,
    enrolled_count: 1,
    selected_count: unavailable ? 0 : 1,
    unavailable_count: unavailable ? 1 : 0,
    entries: { [enrolledTicker]: { ...entry, ticker: enrolledTicker, payload_path: unavailable ? null : `payloads/${enrolledTicker}.json` } },
  };
  if (options.invalidCounts) index.selected_count = 99;
  const indexSha = await canonicalJsonSha256(index);
  index.index_sha256 = indexSha;
  const guard: JsonRecord = {
    schema_version: "data-supply-etf-detail-enrollment/v1",
    domain: "etf_detail",
    generated_at: "2026-07-11T00:00:00Z",
    active_transaction_id: "tx-1",
    active_generation_manifest_sha256: "a".repeat(64),
    index_sha256: options.crossbind ? "c".repeat(64) : indexSha,
    membership_sha256: membershipSha,
    enrolled_count: 1,
    tickers: [enrolledTicker],
  };

  return resolveDataSupplyEtfDetail(ticker, {
    now: () => new Date("2026-07-12T00:00:00Z"),
    readEnrollment: async () => options.guardMissing ? null : document(guard),
    readIndex: async () => options.indexMissing ? null : document(index),
    readProjectionPayload: async () => payloadDoc,
    readDirectPayload: async () => options.direct ? document(options.direct) : null,
  });
}

async function main() {
const fresh = await fixture({ state: "fresh_fallback" });
assert.equal(fresh.kind, "selected", JSON.stringify(fresh));
if (fresh.kind === "selected") {
  assert.equal(fresh.dataSupply.resolution_state, "fresh_fallback");
  assert.equal(fresh.dataSupply.provider_role, "fallback");
  assert.equal(fresh.dataSupply.source_age_days, 9);
  assert.equal((fresh.payload as JsonRecord).data_supply, undefined);
  const merged = mergeEtfDataSupply(fresh.payload, fresh.dataSupply);
  assert.equal((merged.data_supply as JsonRecord).projection_digest, fresh.projectionDigest);
}

const lkg = await fixture({ state: "lkg_fallback" });
assert.equal(lkg.kind, "selected");
if (lkg.kind === "selected") assert.equal(lkg.dataSupply.resolution_state, "lkg_fallback");

const unavailable = await fixture({ state: "unavailable", payload: null });
assert.equal(unavailable.kind, "unavailable");
if (unavailable.kind === "unavailable") {
  assert.equal(unavailable.dataSupply.source_as_of, null);
  assert.equal(unavailable.stateObservedAt, "2026-07-11T00:00:00Z");
  const rawSummary = { schema_version: "stockanalysis/v1", ticker: "ADIU", detail_status: "surface_only" };
  const summary = mergeEtfDataSupply(rawSummary, unavailable.dataSupply);
  assert.equal((summary.data_supply as JsonRecord).resolution_state, "unavailable");
  const summaryRepresentation = buildUnavailableEtfRepresentation("ADIU", unavailable.dataSupply, rawSummary);
  assert.equal(summaryRepresentation.kind, "summary");
  const typedRepresentation = buildUnavailableEtfRepresentation("ADIU", unavailable.dataSupply, null);
  assert.equal(typedRepresentation.kind, "typed_unavailable");
  assert.equal(typedRepresentation.body.error, "DATA_SUPPLY_UNAVAILABLE");
}

assert.equal(unavailableStateAgeHours(
  "2026-07-11T00:00:00Z",
  new Date("2026-07-12T12:00:00Z"),
), 36);
const telemetryPoint = buildTypedUnavailableDataPoint({
  ticker: "ADIU",
  cacheStatus: "HIT",
  stateObservedAt: "2026-07-11T00:00:00Z",
  now: new Date("2026-07-12T12:00:00Z"),
});
assert.deepEqual(telemetryPoint.indexes, ["ADIU"]);
assert.deepEqual(telemetryPoint.blobs, [
  "2026-07-12",
  "ADIU",
  "etf",
  "unavailable",
  "HIT",
  "data-supply-unavailable/v1",
]);
assert.deepEqual(telemetryPoint.doubles, [36]);

let writes = 0;
let scheduledWrite: Promise<unknown> | null = null;
recordTypedUnavailableResponse({
  ticker: "ADIU",
  cacheStatus: "MISS",
  stateObservedAt: "2026-07-11T00:00:00Z",
  now: new Date("2026-07-12T12:00:00Z"),
}, () => ({
  env: {
    DATA_SUPPLY_ANALYTICS: {
      writeDataPoint: () => { writes += 1; },
    },
  },
  ctx: {
    waitUntil: (promise) => { scheduledWrite = promise; },
  },
}));
assert.equal(writes, 0, "Analytics Engine write must be deferred off the response path");
assert.ok(scheduledWrite);
await scheduledWrite;
assert.equal(writes, 1, "one scheduled call must write exactly one datapoint");

let failedWrite: Promise<unknown> | null = null;
assert.doesNotThrow(() => recordTypedUnavailableResponse({
  ticker: "ADIU",
  cacheStatus: "MISS",
  stateObservedAt: "2026-07-11T00:00:00Z",
}, () => ({
  env: {
    DATA_SUPPLY_ANALYTICS: {
      writeDataPoint: () => { throw new Error("quota exceeded"); },
    },
  },
  ctx: {
    waitUntil: (promise) => { failedWrite = promise; },
  },
})));
assert.ok(failedWrite);
await failedWrite;
assert.doesNotThrow(() => recordTypedUnavailableResponse({
  ticker: "ADIU",
  cacheStatus: "MISS",
  stateObservedAt: "2026-07-11T00:00:00Z",
}, () => { throw new Error("Cloudflare context unavailable"); }));

const missingGuard = await fixture({ guardMissing: true });
assert.deepEqual(missingGuard, {
  kind: "error",
  code: "DATA_SUPPLY_GUARD_UNAVAILABLE",
  projectionDigest: null,
});

const missingIndexEnrolled = await fixture({ indexMissing: true });
assert.equal(missingIndexEnrolled.kind, "error");
if (missingIndexEnrolled.kind === "error") assert.equal(missingIndexEnrolled.code, "DATA_SUPPLY_INDEX_UNAVAILABLE");
const invalidIndexEnrolled = await fixture({ invalidCounts: true });
assert.equal(invalidIndexEnrolled.kind, "error");
if (invalidIndexEnrolled.kind === "error") assert.equal(invalidIndexEnrolled.code, "DATA_SUPPLY_INDEX_UNAVAILABLE");
const crossboundIndex = await fixture({ crossbind: true });
assert.equal(crossboundIndex.kind, "error");
if (crossboundIndex.kind === "error") assert.equal(crossboundIndex.code, "DATA_SUPPLY_GUARD_UNAVAILABLE");

const direct = {
  schema_version: "stockanalysis/v1",
  source: "stockanalysis",
  asset_type: "etf",
  ticker: "IEFA",
  normalized: { holdings: [] },
};
const unenrolled = await fixture({ ticker: "IEFA", enrolledTicker: "ADIU", indexMissing: true, direct });
assert.equal(unenrolled.kind, "direct");
const unenrolledWithIndex = await fixture({ ticker: "IEFA", enrolledTicker: "ADIU", direct });
assert.equal(unenrolledWithIndex.kind, "direct");
const sourceProviderDirect = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  direct: { ...direct, source: undefined, source_provider: "stockanalysis" },
});
assert.equal(sourceProviderDirect.kind, "direct");
const rejectedYahooDirect = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  direct: { ...direct, source: "yahoo_finance", detail_status: "yf_fallback" },
});
assert.equal(rejectedYahooDirect.kind, "error");

const collision = await fixture({ payload: {
  schema_version: "yf-etf-detail/v1",
  source: "yahoo_finance",
  asset_type: "etf",
  ticker: "ADIU",
  data_supply: {},
} });
assert.equal(collision.kind, "error");

const originalCaches = globalThis.caches;
let stored: Response | null = null;
let loads = 0;
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  value: {
    default: {
      match: async () => stored?.clone(),
      put: async (_request: Request, response: Response) => { stored = response.clone(); },
    },
  },
});
try {
  const loadUnavailable = async () => {
    loads += 1;
    return Response.json(
      { error: "DATA_SUPPLY_UNAVAILABLE", data_supply: { resolution_state: "unavailable" } },
      { status: 503, headers: { "Cache-Control": "public, max-age=15, s-maxage=60" } },
    );
  };
  const first = await withResponseCache("negative:ADIU:digest", 60, loadUnavailable, {
    isCacheable: (response) => response.status === 503,
    preserveCacheControl: true,
  });
  const second = await withResponseCache("negative:ADIU:digest", 60, loadUnavailable, {
    isCacheable: (response) => response.status === 503,
    preserveCacheControl: true,
  });
  assert.equal(first.headers.get("X-100x-Cache"), "MISS");
  assert.equal(second.headers.get("X-100x-Cache"), "HIT");
  assert.equal(second.headers.get("Cache-Control"), "public, max-age=15, s-maxage=60");
  assert.equal(loads, 1);
} finally {
  Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches });
}

console.log("data-supply ETF API tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
