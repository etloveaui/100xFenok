// Caller-level fault seam for the ETF authority boundary.
//
// P3 needs one thing proven before any cutover can be considered: that under a
// lost Cloud pointer and under a corrupted Cloud payload, the resolver still
// serves the exact static LKG bytes and never substitutes the Cloud document.
//
// It is deliberately non-mutating. resolveDataSupplyEtfDetail already merges
// caller-supplied dependencies over its defaults, so both faults are produced by
// substituting readPlanePayload in process. Nothing here writes a pointer, an
// object, a credential or any production state, and nothing contacts the remote
// plane. Run it with:
//   node --import tsx --test src/lib/server/data-supply-etf-detail.fault.test.ts
// (tsx is already a devDependency here; the module under test uses extensionless
// relative imports, which the raw type-stripping runner cannot resolve.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalJsonSha256,
  resolveDataSupplyEtfDetail,
  type EtfDetailResolverDependencies,
} from "./data-supply-etf-detail";

const TICKER = "TQQQ";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

// A strict-valid StockAnalysis ETF shard payload. This is the static LKG: the
// only document any of these cases may end up serving.
const shardValue = {
  schema_version: "stockanalysis/v1",
  source: "stockanalysis",
  asset_type: "etf",
  ticker: TICKER,
  source_as_of: "2026-08-18",
  detail_status: "ok",
} as const;
const shardRaw = JSON.stringify(shardValue);
const shardDocument = { raw: shardRaw, value: { ...shardValue } };

// The Cloud shadow, byte-identical to the static shard unless a case corrupts it.
const cleanPlaneRaw = shardRaw;
// Same fields, different bytes: valid as a payload, wrong as a copy.
const corruptedPlaneValue = { ...shardValue, source_as_of: "2026-01-01" };
const corruptedPlaneRaw = JSON.stringify(corruptedPlaneValue);

function planeOk(raw: string, value: Record<string, unknown>) {
  return {
    kind: "ok" as const,
    document: {
      raw,
      value: { ...value },
      bytes: new TextEncoder().encode(raw).buffer as ArrayBuffer,
    },
    generationId: "stockanalysis-etf-detail-faultseam",
    sourceAsOf: null,
  };
}

async function dependencies(
  plane: EtfDetailResolverDependencies["readPlanePayload"],
): Promise<Partial<EtfDetailResolverDependencies>> {
  // TICKER is deliberately absent from the enrolment set, so the resolver takes
  // the shard path where the Cloud shadow is read and compared.
  const tickers = ["AAAA", "ZZZZ"];
  const guardValue = {
    schema_version: "data-supply-etf-detail-enrollment/v1",
    domain: "etf_detail",
    generated_at: "2026-08-18T00:00:00.000Z",
    active_transaction_id: "fault-seam",
    active_generation_manifest_sha256: SHA_A,
    index_sha256: SHA_B,
    membership_sha256: await canonicalJsonSha256(tickers),
    enrolled_count: tickers.length,
    tickers,
  };
  return {
    readEnrollment: async () => ({ raw: JSON.stringify(guardValue), value: guardValue }),
    // No index document: a non-enrolled ticker resolves through the shard path.
    readIndex: async () => null,
    readProjectionPayload: async () => null,
    readShardPayload: async () => ({
      kind: "ok" as const,
      document: shardDocument,
      manifestSha256: SHA_A,
      snapshotId: "fault-seam",
    }),
    readPlanePayload: plane,
    now: () => new Date("2026-08-18T00:00:00.000Z"),
  };
}

async function resolveWithPlane(plane: EtfDetailResolverDependencies["readPlanePayload"]) {
  return resolveDataSupplyEtfDetail(TICKER, await dependencies(plane));
}

function assertServedStaticLkg(result: Awaited<ReturnType<typeof resolveWithPlane>>) {
  assert.equal(result.kind, "shard", "the resolver must still serve the static shard");
  if (result.kind !== "shard") return;
  assert.equal(result.document.raw, shardRaw, "served bytes must be the static LKG byte for byte");
  assert.equal(result.document, shardDocument, "the served document must be the shard object, never a Cloud substitute");
  assert.notEqual(result.document.raw, corruptedPlaneRaw, "a corrupted Cloud payload must never reach the caller");
}

test("pointer loss: the Cloud generation is unreachable and the static LKG is served unchanged", async () => {
  const result = await resolveWithPlane(async () => ({ kind: "unavailable", reason: "pointer_lost" }));
  assertServedStaticLkg(result);
  if (result.kind !== "shard") return;
  assert.equal(result.planeShadowParity, "unavailable", "a lost pointer is reported as unavailable shadow evidence");
});

test("payload corruption: the Cloud generation differs and the static LKG is still served", async () => {
  const result = await resolveWithPlane(async () => planeOk(corruptedPlaneRaw, corruptedPlaneValue));
  assertServedStaticLkg(result);
  if (result.kind !== "shard") return;
  assert.equal(result.planeShadowParity, "mismatch", "differing Cloud bytes are reported as a mismatch, not served");
});

test("plane read throwing is contained and still serves the static LKG", async () => {
  const result = await resolveWithPlane(async () => {
    throw new Error("plane exploded");
  });
  assertServedStaticLkg(result);
  if (result.kind !== "shard") return;
  assert.equal(result.planeShadowParity, "unavailable", "an exception is shadow uncertainty, never a served payload");
});

test("control: a healthy byte-identical Cloud generation is still only shadow evidence", async () => {
  const result = await resolveWithPlane(async () => planeOk(cleanPlaneRaw, shardValue));
  assertServedStaticLkg(result);
  if (result.kind !== "shard") return;
  assert.equal(result.planeShadowParity, "match", "agreement is recorded, and the static document is still what is served");
});

test("the ETF response route emits no Cloud authority header", () => {
  // Checked against the route source rather than by booting Next: the point is
  // that no code path can emit such a header, and pulling the framework in to
  // observe that would add exactly the machinery P3 says not to add.
  const routePath = path.join(
    process.cwd(),
    "src/app/api/data/stockanalysis/[assetType]/[ticker]/route.ts",
  );
  const source = fs.readFileSync(routePath, "utf8");
  for (const forbidden of ["generation", "data-plane", "dataPlane", "authority", "plane-"]) {
    assert.equal(
      source.toLowerCase().includes(`"x-100x-${forbidden.toLowerCase()}`),
      false,
      `the route must not emit an X-100x-${forbidden} header`,
    );
  }
  assert.equal(source.includes("planeShadowParity"), false, "shadow parity must not leak into the response surface");
});
