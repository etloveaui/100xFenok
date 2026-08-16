import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDataAssetPublicPath,
  normalizeGenerationManifestPath,
  readPrivateCloudGenerationAsset,
  readDataAsset,
  readDataAssetWithDeps,
} from "./data-asset-reader.ts";
import {
  familyForPath,
} from "../../../../scripts/lib/cloud-data-plane-worker-read.mjs";

// Minimal reader-contract invariant (packets fh-20260817-194/-208/-223):
// normalize once and REJECT (never collapse) duplicate empty segments, encoded
// separators, '?'/'#', dot segments, trailing slash, null and backslash;
// source order is fs -> plane -> ASSETS -> unavailable, plane precedes ASSETS;
// filesystem-first with ASSETS not called; typed unavailable without throw.

test("normalize rejects traversal, null, encoded separators, ?/#, and private/canonical paths", () => {
  const rejected = [
    "/data/../etc/passwd",
    "/data/stockanalysis/..%2F..%2Fsecret.json",
    "/data/stockanalysis/%2e%2e/secret.json",
    "/data/stockanalysis/foo/../../bar.json",
    "/data/stockanalysis/foo/./bar.json",
    "/data/stockanalysis/foo//bar.json", // duplicate empty segment: reject, not collapse
    "/data/stockanalysis/foo%2Fbar.json", // encoded separator: reject
    "/data/stockanalysis/foo%3Fbar.json", // encoded '?': reject (would become query)
    "/data/stockanalysis/foo%23bar.json", // encoded '#': reject (would become fragment)
    "/data/stockanalysis/foo?bar=baz.json", // raw '?': reject
    "/data/stockanalysis/foo#bar.json", // raw '#': reject
    "/data/stockanalysis/foo\\bar.json",
    "/data/stockanalysis/\u0000.json",
    "/etc/passwd",
    "data/stockanalysis/etf_universe.json",
    "/stockanalysis/etf_universe.json",
    "",
    "/data/",
  ];
  for (const value of rejected) {
    assert.equal(normalizeDataAssetPublicPath(value), null, `should reject: ${value}`);
  }
});

test("normalize accepts only a clean single-slash public data path", () => {
  assert.equal(
    normalizeDataAssetPublicPath("/data/stockanalysis/etf_universe.json"),
    "/data/stockanalysis/etf_universe.json",
  );
  assert.equal(
    normalizeDataAssetPublicPath("/data/stockanalysis/surfaces/etf_screener.json"),
    "/data/stockanalysis/surfaces/etf_screener.json",
  );
});

test("generation manifest paths admit bounded public/private roots and reject URL ambiguity", () => {
  assert.equal(
    normalizeGenerationManifestPath("data/stockanalysis/etfs/BRK.B.json"),
    "data/stockanalysis/etfs/BRK.B.json",
  );
  assert.equal(
    normalizeGenerationManifestPath("public/generated/index.json"),
    "public/generated/index.json",
  );
  for (const value of [
    "/data/stockanalysis/etfs/SPY.json",
    "data/stockanalysis/../secret.json",
    "data/stockanalysis//SPY.json",
    "data/stockanalysis/SPY%2fsecret.json",
    "data/stockanalysis/SPY.json?x=1",
    "private/stockanalysis/SPY.json",
    "public/datax/SPY.json",
  ]) assert.equal(normalizeGenerationManifestPath(value), null, `should reject: ${value}`);
});

test("private generation reader binds the one family to one ETF path before resolving bindings", async () => {
  for (const input of [
    { family: undefined, manifestPath: "data/stockanalysis/etfs/SPY.json" },
    { family: null, manifestPath: "data/stockanalysis/etfs/SPY.json" },
    { family: "fred-macro", manifestPath: "data/stockanalysis/etfs/SPY.json" },
    { family: "stockanalysis-etf-detail", manifestPath: "data/stockanalysis/stocks/SPY.json" },
    { family: "stockanalysis-etf-detail", manifestPath: "data/stockanalysis/etfs/SPY/other.json" },
  ]) {
    const result = await readPrivateCloudGenerationAsset(input as never);
    assert.deepEqual(result, { kind: "unavailable", reason: "INVALID_GENERATION_ASSET_REQUEST" });
  }
});

test("parity: normalize accepts exactly what familyForPath enrolls for a clean path", () => {
  const clean = "/data/slickcharts/sp500.json"; // enrolled exact path (family slickcharts-weekly)
  assert.equal(normalizeDataAssetPublicPath(clean), clean);
  assert.equal(familyForPath(clean), "slickcharts-weekly");
  // A query/fragment variant is rejected by normalize and is not enrolled.
  assert.equal(normalizeDataAssetPublicPath("/data/slickcharts/sp500.json?v=1"), null);
  assert.equal(familyForPath("/data/slickcharts/sp500.json?v=1"), null);
});

test("readDataAsset: filesystem-first and ASSETS is NOT called when fs hits", async () => {
  let assetsCalled = 0;
  const env = {
    ASSETS: {
      fetch: async () => {
        assetsCalled += 1;
        return new Response('{"assets":true}', { status: 200 });
      },
    },
  };
  const result = await readDataAsset("/data/stockanalysis/etf_universe.json", env);
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.source, "filesystem");
    assert.ok(JSON.parse(result.raw));
  }
  assert.equal(assetsCalled, 0, "ASSETS must not be called on a filesystem hit");
});

test("readDataAsset: ASSETS fallback is used after fs miss with injected ASSETS", async () => {
  const env = {
    ASSETS: {
      fetch: async () => new Response('{"assets":true}', { status: 200 }),
    },
  };
  const result = await readDataAsset("/data/stockanalysis/surfaces/definitely_missing.json", env);
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.source, "assets");
    assert.deepEqual(JSON.parse(result.raw), { assets: true });
  }
});

test("orchestration: plane success precedes ASSETS (fs miss, plane ok, ASSETS not called)", async () => {
  let assetsCalled = 0;
  let planeCalled = 0;
  const seam = {
    readLocalFile: async () => null, // force fs miss
    resolveEnv: async (injected: unknown) => injected as never,
    readPlane: async () => {
      planeCalled += 1;
      return { kind: "ok", raw: '{"plane":true}', source: "data-plane" } as const;
    },
    readAssets: async () => {
      assetsCalled += 1;
      return null;
    },
  };
  const result = await readDataAssetWithDeps(
    "/data/slickcharts/sp500.json",
    { ASSETS: { fetch: async () => new Response("{}", { status: 200 }) } } as never,
    seam,
  );
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.source, "data-plane");
    assert.deepEqual(JSON.parse(result.raw), { plane: true });
  }
  assert.equal(planeCalled, 1, "plane must be consulted once on fs miss");
  assert.equal(assetsCalled, 0, "ASSETS must NOT be called when plane succeeds");
});

test("readDataAsset: typed unavailable (no throw) when fs misses and no bindings", async () => {
  const result = await readDataAsset("/data/stockanalysis/surfaces/definitely_missing.json");
  assert.equal(result.kind, "unavailable");
  if (result.kind === "unavailable") {
    assert.ok(result.reason.length > 0);
  }
});
