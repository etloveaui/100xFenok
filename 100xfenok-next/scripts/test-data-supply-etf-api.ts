import assert from "node:assert/strict";
import {
  DATA_SUPPLY_ETF_DETAIL_POLICY,
  buildUnavailableEtfRepresentation,
  canonicalJsonSha256,
  mergeEtfDataSupply,
  resolveDataSupplyEtfDetail,
  sha256Text,
  validateDataSupplyPolicyRegistryForConsumer,
  type PublicJsonDocument,
} from "../src/lib/server/data-supply-etf-detail";
import policyRegistry from "../src/generated/data-supply-policy-registry.json";
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
  shardMissing?: boolean;
  shardUnavailable?: boolean;
  plane?: JsonRecord | null;
  planeUnavailable?: boolean;
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
    readPlanePayload: async () => {
      if (options.planeUnavailable || !options.plane) {
        return { kind: "unavailable", reason: "fixture" } as const;
      }
      return {
        kind: "ok",
        document: {
          ...document(options.plane),
          bytes: new TextEncoder().encode(JSON.stringify(options.plane)).buffer,
        },
        generationId: "stockanalysis-etf-detail-fixture",
        sourceAsOf: "2026-08-16",
      } as const;
    },
    readShardPayload: async () => {
      if (options.shardUnavailable) {
        return {
          kind: "shard_integrity_unavailable",
          reason: "fixture",
          manifestSha256: "d".repeat(64),
          snapshotId: "e".repeat(64),
        } as const;
      }
      if (options.shardMissing || !options.direct) {
        return {
          kind: "ticker_not_found",
          manifestSha256: "d".repeat(64),
          snapshotId: "e".repeat(64),
        } as const;
      }
      return {
        kind: "ok",
        document: document(options.direct),
        manifestSha256: "d".repeat(64),
        snapshotId: "e".repeat(64),
      } as const;
    },
  });
}

async function main() {
  assert.equal(DATA_SUPPLY_ETF_DETAIL_POLICY.resolution_scope, "domain_atomic");
  assert.deepEqual(
    DATA_SUPPLY_ETF_DETAIL_POLICY.providers.map((provider) => provider.name),
    ["stockanalysis", "yahoo_finance"],
  );
  assert.equal(DATA_SUPPLY_ETF_DETAIL_POLICY.fresh_ttl_hours, 168);
  assert.equal(DATA_SUPPLY_ETF_DETAIL_POLICY.emergency_lkg_ttl_days, 14);
  assert.equal(DATA_SUPPLY_ETF_DETAIL_POLICY.recovery_green_required, 3);
  assert.throws(
    () => validateDataSupplyPolicyRegistryForConsumer(
      policyRegistry,
      "etf_detail",
      "100xfenok-next.not_authorized",
    ),
    /data-supply-policy-registry:.*not authorized/,
  );
  assert.throws(
    () => validateDataSupplyPolicyRegistryForConsumer(
      { ...policyRegistry, policy_digest: "0".repeat(64) },
      "etf_detail",
      "100xfenok-next.data_supply_etf_detail",
    ),
    /data-supply-policy-registry:.*digest/,
  );

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

const planePayload = {
  schema_version: "stockanalysis/v1",
  source: "stockanalysis",
  asset_type: "etf",
  ticker: "SPY",
  fetched_at: "2026-08-16T00:00:00Z",
  name: "미국 대형주 ETF",
};
const staticPayload = { ...planePayload, fetched_at: "2026-08-15T00:00:00Z" };
const planeAuthority = await fixture({
  ticker: "SPY",
  enrolledTicker: "ADIU",
  plane: planePayload,
  direct: staticPayload,
});
assert.equal(planeAuthority.kind, "plane");
if (planeAuthority.kind === "plane") {
  assert.equal(planeAuthority.document.value.fetched_at, "2026-08-16T00:00:00Z");
  assert.equal(planeAuthority.generationId, "stockanalysis-etf-detail-fixture");
}

const planeFallback = await fixture({
  ticker: "SPY",
  enrolledTicker: "ADIU",
  plane: { ...planePayload, source: "unexpected" },
  direct: staticPayload,
});
assert.equal(planeFallback.kind, "shard", "invalid plane schema falls back to static LKG shard");

const unavailablePlaneFallback = await fixture({
  ticker: "SPY",
  enrolledTicker: "ADIU",
  planeUnavailable: true,
  direct: staticPayload,
});
assert.equal(unavailablePlaneFallback.kind, "shard", "unavailable plane falls back to static LKG shard");

const unavailable = await fixture({ state: "unavailable", payload: null });
assert.equal(unavailable.kind, "unavailable");
if (unavailable.kind === "unavailable") {
  assert.equal(unavailable.dataSupply.source_as_of, null);
  assert.equal(unavailable.stateObservedAt, "2026-07-11T00:00:00Z");
  const rawSummary = { schema_version: "stockanalysis/v1", ticker: "ADIU", detail_status: "surface_only" };
  const summary = mergeEtfDataSupply(rawSummary, unavailable.dataSupply);
  assert.equal((summary.data_supply as JsonRecord).resolution_state, "unavailable");
  const typedRepresentation = buildUnavailableEtfRepresentation("ADIU", unavailable.dataSupply);
  assert.equal(typedRepresentation.kind, "typed_unavailable");
  assert.equal(typedRepresentation.body.error, "DATA_SUPPLY_UNAVAILABLE");
}

const { buildEtfResponse, getEtfResponse } = await import("../src/app/api/data/stockanalysis/[assetType]/[ticker]/route");
const shardUnavailableResponse = await buildEtfResponse({
  kind: "shard_unavailable",
  reason: "fixture-corrupt-shard",
  projectionDigest: "d".repeat(64),
}, "SPY");
assert.equal(shardUnavailableResponse.status, 503);
assert.equal(shardUnavailableResponse.headers.get("Cache-Control"), "no-store");
assert.equal((await shardUnavailableResponse.json()).error, "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE");

const planeResponseBytes = new TextEncoder().encode(JSON.stringify(planePayload));
const planeResponse = await buildEtfResponse({
  kind: "plane",
  document: {
    ...document(planePayload),
    bytes: planeResponseBytes.buffer,
  },
  generationId: "stockanalysis-etf-detail-fixture",
  sourceAsOf: "2026-08-16",
}, "SPY");
assert.equal(planeResponse.status, 200);
assert.equal(planeResponse.headers.get("X-100x-ETF-Detail-Authority"), "cloud-data-plane");
assert.equal(planeResponse.headers.get("X-Data-Plane-Generation"), "stockanalysis-etf-detail-fixture");
assert.deepEqual(new Uint8Array(await planeResponse.arrayBuffer()), planeResponseBytes);

const absentResponse = await buildEtfResponse({
  kind: "not_found",
  projectionDigest: "d".repeat(64),
}, "ZZZZ");
assert.equal(absentResponse.status, 404);
assert.equal((await absentResponse.json()).error, "STOCKANALYSIS_ASSET_NOT_FOUND");

const unavailableResponse = await buildEtfResponse(unavailable, "ADIU");
assert.equal(unavailableResponse.status, 503);
assert.equal((await unavailableResponse.json()).error, "DATA_SUPPLY_UNAVAILABLE");

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
assert.equal(unenrolled.kind, "shard");
const unenrolledWithIndex = await fixture({ ticker: "IEFA", enrolledTicker: "ADIU", direct });
assert.equal(unenrolledWithIndex.kind, "shard");
const sourceProviderDirect = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  direct: { ...direct, source: undefined, source_provider: "stockanalysis" },
});
assert.equal(sourceProviderDirect.kind, "shard");
const stockanalysisWithYahooNewsAttribution = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  direct: {
    ...direct,
    raw: {
      overview: {
        news: {
          data: [{ source: "Yahoo Finance" }],
        },
      },
    },
  },
});
assert.equal(
  stockanalysisWithYahooNewsAttribution.kind,
  "shard",
  "nested news attribution must not be confused with the ETF payload provider",
);
const rejectedYahooDirect = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  direct: { ...direct, source: "yahoo_finance", detail_status: "yf_fallback" },
});
assert.equal(rejectedYahooDirect.kind, "shard_unavailable");
const missingShardTicker = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  shardMissing: true,
});
assert.equal(missingShardTicker.kind, "not_found");
const unavailableShard = await fixture({
  ticker: "IEFA",
  enrolledTicker: "ADIU",
  shardUnavailable: true,
});
assert.equal(unavailableShard.kind, "shard_unavailable");

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
let storedKey: string | null = null;
let loads = 0;
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  value: {
    default: {
      match: async (request: Request) => request.url === storedKey ? stored?.clone() : undefined,
      put: async (request: Request, response: Response) => {
        storedKey = request.url;
        stored = response.clone();
      },
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

  stored = null;
  let resolutions = 0;
  const shardRaw = `{
  "schema_version": "stockanalysis/v1",
  "source": "stockanalysis",
  "asset_type": "etf",
  "ticker": "SPY",
  "escaped": "\\u2603"
}
`;
  const resolveShard = async () => {
    resolutions += 1;
    return {
      kind: "shard",
      document: document(JSON.parse(shardRaw), shardRaw),
      projectionDigest: "d".repeat(64),
    } as const;
  };
  const firstEtf = await getEtfResponse("SPY", "build-a", resolveShard);
  const secondEtf = await getEtfResponse("SPY", "build-a", resolveShard);
  assert.equal(firstEtf.headers.get("X-100x-Cache"), "MISS");
  assert.equal(secondEtf.headers.get("X-100x-Cache"), "HIT");
  assert.equal(await firstEtf.text(), shardRaw, "cache MISS must preserve exact canonical ETF bytes");
  assert.equal(await secondEtf.text(), shardRaw, "cache HIT must preserve exact canonical ETF bytes");
  assert.equal(resolutions, 1, "a cache hit must not rerun ETF registry and shard validation");
  await getEtfResponse("SPY", "build-b", resolveShard);
  assert.equal(resolutions, 2, "a new build version must not reuse the prior artifact response");

  stored = Response.json(
    { schema_version: "stockanalysis/v1", source: "stockanalysis", asset_type: "etf", ticker: "SPY" },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
  storedKey = "https://100xfenok-cache.local/responses/negative%3AADIU%3Adigest";
  let bypassLoads = 0;
  const bypassed = await withResponseCache(
    "negative:ADIU:digest",
    300,
    async () => {
      bypassLoads += 1;
      return Response.json(
        { error: "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE", ticker: "SPY" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    },
    { bypassCache: true },
  );
  assert.equal(bypassed.status, 503, "a cached success must not mask shard integrity failure");
  assert.equal(bypassLoads, 1);
} finally {
  Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches });
}

console.log("data-supply ETF API tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
