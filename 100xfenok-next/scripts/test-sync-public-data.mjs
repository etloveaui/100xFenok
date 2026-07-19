#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_PUBLIC_DATA_FILES,
  EXCLUDED_PUBLIC_DATA_ROOTS,
  syncPublicData,
} from "./sync-public-data.mjs";
import { inspectCloudflareAssetBudget } from "./check-cloudflare-asset-budget.mjs";
import {
  MARKET_FACTS_SHARD_COUNT,
  fetchMarketFactsFromShard,
  marketFactsFromShard,
  marketFactsShardFileName,
  marketFactsShardUrl,
} from "../src/lib/market-facts-shard.mjs";
import { checkSyncExclusionsAgainstRegistry } from "../../scripts/check-lane-registry-sync.mjs";
import { LANE_REGISTRY } from "../../scripts/lib/lane-registry.mjs";
import {
  deriveExcludedPublicDataFiles,
  deriveExcludedPublicDataRoots,
  deriveForbiddenPrivateDataSupplyRoots,
} from "../../scripts/lib/lane-routing.mjs";
import { FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS } from "./check-fenok-public-mirror-guard.mjs";

// Lane-routing ⇄ hand-list parity gate (#366 item 4, shadow step): the hand
// lists stay authoritative, but any divergence between them and the registry
// derivation fails loudly here — before any consumer flips in later slices.
// Equality is TRUE SET equality (both sides deduped, then compared order-free).
{
  const setEqual = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  // equality semantics pinned: deduped both sides, order-free (sol fh-155 B1)
  assert.equal(setEqual(["x"], ["x", "x"]), true, "set equality must be duplicate-insensitive");
  assert.equal(setEqual(["x"], ["y"]), false);

  // registry-parameter honored end to end (sol fh-155 B2): an injected
  // registry with NO declared exceptions must derive accordingly.
  const derivedRoots = deriveExcludedPublicDataRoots();
  const derivedFiles = deriveExcludedPublicDataFiles();
  const derivedGuardRoots = deriveForbiddenPrivateDataSupplyRoots();
  const withoutExceptions = { ...LANE_REGISTRY, declared_exceptions: [] };
  assert.equal(deriveExcludedPublicDataRoots(withoutExceptions).includes("admin/data-supply-state"), false,
    "deriveExcludedPublicDataRoots must honor the injected registry's declared_exceptions");
  assert.equal(deriveForbiddenPrivateDataSupplyRoots(withoutExceptions).includes("yf/migration-evidence"), false,
    "deriveForbiddenPrivateDataSupplyRoots must honor the injected registry's declared_exceptions");
  assert.equal(setEqual(derivedRoots, EXCLUDED_PUBLIC_DATA_ROOTS), true,
    `registry-derived sync roots diverge from the hand list: derived=${JSON.stringify(derivedRoots)} hand=${JSON.stringify(EXCLUDED_PUBLIC_DATA_ROOTS)}`);
  assert.equal(setEqual(derivedFiles, EXCLUDED_PUBLIC_DATA_FILES), true,
    `registry-derived sync files diverge from the hand list: derived=${JSON.stringify(derivedFiles)} hand=${JSON.stringify(EXCLUDED_PUBLIC_DATA_FILES)}`);
  assert.equal(setEqual(derivedGuardRoots, FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS), true,
    `registry-derived guard roots diverge from the hand list: derived=${JSON.stringify(derivedGuardRoots)} hand=${JSON.stringify(FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS)}`);

  // materialize.py coverage: every derived private root must be covered by the
  // Python private-token lists (either path form) — the third consumer of the
  // same fact family (#21). Content-level tokens stay hand-authored by design.
  const materializeSource = fs.readFileSync(
    fileURLToPath(new URL("../../scripts/materialize_data_supply_public.py", import.meta.url)),
    "utf8",
  );
  for (const root of derivedGuardRoots) {
    const bareForm = `${root}/`;
    const dataForm = root.startsWith("admin/") ? `data/${root}/` : null;
    const covered = materializeSource.includes(bareForm) || (dataForm !== null && materializeSource.includes(dataForm));
    assert.equal(covered, true, `materialize_data_supply_public.py does not cover private root ${root} (#21 parity)`);
  }
}

const DETECTION_FLOOR_REPORT = "admin/data-supply-detection-floor.json";
const EXPECTED_PRIVATE_ROOTS = Object.freeze([
  "admin/apewisdom_attention",
  "admin/data-supply-state",
  "admin/finra_short_volume",
  "admin/gdelt_news_tone",
  "admin/occ_options_volume",
  "admin/yahoo_private_options",
  "admin/fred_yardeni",
  "admin/edgar_filings",
  "admin/nasdaq_giw_sox",
  "yf/etf-details",
  "yf/migration-evidence",
]);

const EXPECTED_PRIVATE_PROXY_FILES = Object.freeze([
  "computed/fenok_news_tone_proxy.json",
  "computed/fenok_news_tone_proxy_history.json",
  "computed/fenok_social_attention_proxy.json",
  "computed/fenok_social_attention_proxy_history.json",
]);

// Lane Registry ⇄ exclusion cross-check (BACKLOG #366 step 2): the hand list
// stays authoritative, but omitting a private lane's store from it must be
// impossible to miss (the 07-18 finra leak class). Also pin the local copy of
// the list to the imported one so the two can never drift apart silently.
{
  assert.deepEqual(
    [...EXPECTED_PRIVATE_ROOTS].sort(),
    [...EXCLUDED_PUBLIC_DATA_ROOTS].sort(),
    "EXPECTED_PRIVATE_ROOTS must mirror EXCLUDED_PUBLIC_DATA_ROOTS exactly",
  );
  const gate = checkSyncExclusionsAgainstRegistry({ excludedRoots: EXCLUDED_PUBLIC_DATA_ROOTS });
  assert.equal(
    gate.ok,
    true,
    `registry/sync exclusion mismatch: ${JSON.stringify({
      missing_exclusions: gate.missing_exclusions,
      undeclared_exclusions: gate.undeclared_exclusions,
    })}`,
  );
}

// Root/file shape split (2026-07-19 deploy-crash class): sync-public-data's
// visit() hard-requires every EXCLUDED_PUBLIC_DATA_ROOTS entry that exists on
// disk to be a directory. A file-shaped entry stays latent until its lane's
// first successful run commits the artifact, then every build crashes
// ("excluded source root must be a directory" — the apewisdom
// fenok_social_attention_proxy.json firing). File-shaped private canonicals
// must therefore live in the FILES list, on both the hand lists and the
// registry derivations.
{
  for (const [label, list] of [
    ["EXCLUDED_PUBLIC_DATA_ROOTS", EXCLUDED_PUBLIC_DATA_ROOTS],
    ["deriveExcludedPublicDataRoots()", deriveExcludedPublicDataRoots()],
  ]) {
    for (const entry of list) {
      assert.equal(entry.endsWith(".json"), false, `${label} carries a file-shaped path: ${entry}`);
    }
  }
  for (const expectedFile of EXPECTED_PRIVATE_PROXY_FILES) {
    assert.equal(
      EXCLUDED_PUBLIC_DATA_FILES.includes(expectedFile),
      true,
      `private proxy file missing from EXCLUDED_PUBLIC_DATA_FILES: ${expectedFile}`,
    );
  }

  // Value-changing derivation case: a mirrorless private lane with one
  // file-shaped and one directory-shaped canonical must split across the two
  // derived lists instead of both landing in roots.
  const probe = JSON.parse(JSON.stringify(LANE_REGISTRY.lanes.find((lane) => lane.id === "apewisdom_attention")));
  probe.id = "zz_shape_split_probe";
  probe.roots.canonical_outputs = [
    "data/computed/zz_shape_split_probe.json",
    "data/computed/zz_shape_split_probe_store",
  ];
  const probeRegistry = { ...LANE_REGISTRY, lanes: [...LANE_REGISTRY.lanes, probe] };
  assert.equal(deriveExcludedPublicDataRoots(probeRegistry).includes("computed/zz_shape_split_probe.json"), false,
    "file-shaped canonical must NOT derive into the sync roots list");
  assert.equal(deriveExcludedPublicDataFiles(probeRegistry).includes("computed/zz_shape_split_probe.json"), true,
    "file-shaped canonical must derive into the sync files list");
  assert.equal(deriveExcludedPublicDataRoots(probeRegistry).includes("computed/zz_shape_split_probe_store"), true,
    "directory-shaped canonical must stay in the sync roots list");
  // The mirror guard is a shape-agnostic presence check, so file-shaped
  // canonicals stay in its forbidden list unchanged.
  assert.equal(deriveForbiddenPrivateDataSupplyRoots(probeRegistry).includes("computed/zz_shape_split_probe.json"), true,
    "mirror-guard derivation must keep forbidding file-shaped private canonicals");
}

function realBaselineRootArg() {
  const index = process.argv.indexOf("--real-baseline-root");
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error("--real-baseline-root requires a path");
  return path.resolve(process.argv[index + 1]);
}

function copyRealBaselineFixture(targetRoot) {
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const repoRoot = path.resolve(appRoot, "..");
  if (fs.readdirSync(targetRoot).length !== 0) {
    throw new Error(`real baseline fixture root must be empty: ${targetRoot}`);
  }
  const copies = [
    ["data/admin/data-supply-state/v1", "data/admin/data-supply-state/v1"],
    ["data/admin/data-usage-manifest.json", "data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "data/computed/data-supply/etf-detail"],
    ["data/stockanalysis/etfs", "data/stockanalysis/etfs"],
    ["data/admin/data-usage-manifest.json", "100xfenok-next/public/data/admin/data-usage-manifest.json"],
    ["data/computed/data-supply/etf-detail", "100xfenok-next/public/data/computed/data-supply/etf-detail"],
    ["100xfenok-next/public/data/stockanalysis/etfs", "100xfenok-next/public/data/stockanalysis/etfs"],
  ];
  for (const [sourceRel, targetRel] of copies) {
    const source = path.join(repoRoot, sourceRel);
    const target = path.join(targetRoot, targetRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true });
  }
  console.log(`test-sync-public-data real baseline fixture ready: ${targetRoot}`);
}

const requestedRealBaselineRoot = realBaselineRootArg();
if (requestedRealBaselineRoot) {
  copyRealBaselineFixture(requestedRealBaselineRoot);
  process.exit(0);
}

function write(root, relativePath, body = "{}\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function snapshotNode(target) {
  const stat = lstatIfPresent(target);
  if (!stat) return { type: "missing" };
  if (stat.isSymbolicLink()) return { type: "symlink", target: fs.readlinkSync(target) };
  if (stat.isDirectory()) {
    return {
      type: "directory",
      entries: fs.readdirSync(target).sort().map((entry) => [entry, snapshotNode(path.join(target, entry))]),
    };
  }
  if (stat.isFile()) {
    return {
      type: "file",
      mode: stat.mode & 0o777,
      body: fs.readFileSync(target).toString("base64"),
    };
  }
  if (stat.isFIFO()) return { type: "fifo", mode: stat.mode & 0o777 };
  return { type: "special", mode: stat.mode & 0o777 };
}

function snapshotPaths(paths) {
  return paths.map((target) => [target, snapshotNode(target)]);
}

function seedPrivateRoots(sourceRoot, destinationRoot) {
  for (const relativeRoot of EXPECTED_PRIVATE_ROOTS) {
    write(sourceRoot, `${relativeRoot}/private.json`, '{"secret":true}\n');
    write(destinationRoot, `${relativeRoot}/stale.json`, '{"stale":true}\n');
  }
  // File-shaped private proxies are seeded as REGULAR FILES so the fixture
  // exercises the root/file split (2026-07-19 deploy-crash class): on the
  // source side they must be withheld as excluded exact files, and stale
  // destination copies must be removed as exact files.
  for (const relativeFile of EXPECTED_PRIVATE_PROXY_FILES) {
    write(sourceRoot, relativeFile, '{"secret":true}\n');
    write(destinationRoot, relativeFile, '{"stale":true}\n');
  }
}

function makeSyncCase(parentRoot, label) {
  const root = fs.mkdtempSync(path.join(parentRoot, `${label}-`));
  const sourceRoot = path.join(root, "data");
  const destinationRoot = path.join(root, "100xfenok-next", "public", "data");
  write(sourceRoot, "safe/keep.json", '{"safe":true}\n');
  write(destinationRoot, "admin/safe-sibling.json", '{"sibling":true}\n');
  seedPrivateRoots(sourceRoot, destinationRoot);
  return { root, sourceRoot, destinationRoot };
}

async function assertMarketFactsShardProjection(parentRoot) {
  assert.equal(MARKET_FACTS_SHARD_COUNT, 1024);
  assert.equal(marketFactsShardFileName("AAPL"), "0779.json");
  assert.equal(marketFactsShardFileName("NVDA"), "0470.json");
  assert.equal(marketFactsShardFileName("SPY"), "0509.json");
  assert.equal(marketFactsShardFileName("BRK.B"), "0570.json");
  assert.equal(marketFactsShardFileName("BF-B"), "0474.json");
  assert.equal(marketFactsShardFileName("230360.KQ"), "0153.json");
  assert.equal(marketFactsShardUrl(" spy "), "/data/computed/market_facts/shards/0509.json");

  const fixture = makeSyncCase(parentRoot, "market-facts-shards");
  const payloads = {
    NVDA: {
      schema_version: "market-facts/v1",
      ticker: "NVDA",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      identity: { name: "NVIDIA", exchange: "Nasdaq" },
      facts: { beta: { value: 1.71, source: "yf", as_of: "2026-07-11" } },
      financials: { revenue: { value: 130_000_000_000, source: "stockanalysis" } },
      resolver: { selected_sources: ["yf", "stockanalysis"] },
    },
    SPY: {
      schema_version: "market-facts/v1",
      ticker: "SPY",
      asset_type: "etf",
      generated_at: "2026-07-13T00:00:00Z",
      identity: { name: "SPDR S&P 500 ETF Trust", exchange: "NYSE Arca" },
      facts: { beta: { value: 1, source: "stockanalysis.overview" } },
      etf: { holdings_count: 503, sectors: [{ name: "Technology", weight: 0.3 }] },
      resolver: { selected_sources: ["stockanalysis.overview"] },
    },
    "BRK.B": {
      schema_version: "market-facts/v1",
      ticker: "BRK.B",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      facts: { beta: { value: 0.87, source: "yf" } },
      resolver: { selected_sources: ["yf"] },
    },
    "BF-B": {
      schema_version: "market-facts/v1",
      ticker: "BF-B",
      asset_type: "stock",
      generated_at: "2026-07-13T00:00:00Z",
      facts: { beta: { value: 0.68, source: "yf" } },
      resolver: { selected_sources: ["yf"] },
    },
  };
  const indexBody = `${JSON.stringify({ count: Object.keys(payloads).length, rows: Object.keys(payloads) }, null, 2)}\n`;
  write(fixture.sourceRoot, "computed/market_facts/index.json", indexBody);
  for (const [ticker, payload] of Object.entries(payloads)) {
    write(fixture.sourceRoot, `computed/market_facts/tickers/${ticker}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  }
  write(fixture.destinationRoot, "computed/market_facts/tickers/NVDA.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');

  const sourceBefore = snapshotNode(fixture.sourceRoot);
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  const rehearsal = syncPublicData({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    dryRun: true,
    logger: () => {},
  });
  assert.equal(rehearsal.filesCopied, 2, "index and safe fixture file remain ordinary mirror files");
  assert.equal(rehearsal.marketFactsTickerFiles, 4);
  assert.equal(rehearsal.marketFactsShardFiles, 1024);
  assert.equal(rehearsal.removedTransformedDestinationRoots, 2);
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "sharding must never mutate canonical ticker files");
  assert.deepEqual(snapshotNode(fixture.destinationRoot), destinationBefore, "dry-run must not mutate the public mirror");

  const result = syncPublicData({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.equal(result.marketFactsTickerFiles, 4);
  assert.equal(result.marketFactsShardFiles, 1024);
  assert.equal(fs.existsSync(path.join(fixture.destinationRoot, "computed/market_facts/tickers")), false);
  assert.equal(fs.readFileSync(path.join(fixture.destinationRoot, "computed/market_facts/index.json"), "utf8"), indexBody);
  const shardRoot = path.join(fixture.destinationRoot, "computed/market_facts/shards");
  const shardFiles = fs.readdirSync(shardRoot).filter((name) => /^\d{4}\.json$/.test(name)).sort();
  assert.equal(shardFiles.length, 1024);
  assert.equal(fs.existsSync(path.join(shardRoot, "stale.json")), false);

  for (const [ticker, payload] of Object.entries(payloads)) {
    const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, marketFactsShardFileName(ticker)), "utf8"));
    assert.deepEqual(shard[ticker], payload, `${ticker} must retain every source field in its deterministic shard`);
    assert.deepEqual(marketFactsFromShard(shard, ticker), payload);
  }
  assert.equal(marketFactsFromShard({}, "NVDA"), null);

  let fetchedUrl = null;
  let fetchedInit = null;
  const fetched = await fetchMarketFactsFromShard("nvda", {
    requestInit: { cache: "no-store" },
    fetchImpl: async (url, init) => {
      fetchedUrl = url;
      fetchedInit = init;
      const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, marketFactsShardFileName("NVDA")), "utf8"));
      return { ok: true, status: 200, json: async () => shard };
    },
  });
  assert.equal(fetchedUrl, "/data/computed/market_facts/shards/0470.json");
  assert.deepEqual(fetchedInit, { cache: "no-store" });
  assert.deepEqual(fetched, payloads.NVDA);
  assert.equal(fetched.facts.beta.value, 1.71, "beta must survive the public projection unchanged");
  assert.equal(await fetchMarketFactsFromShard("NVDA", {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => null }),
  }), null);
  await assert.rejects(
    () => fetchMarketFactsFromShard("NVDA", {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }),
    }),
    /status 503/i,
  );

  const destinationAfter = snapshotNode(fixture.destinationRoot);
  syncPublicData({ sourceRoot: fixture.sourceRoot, destinationRoot: fixture.destinationRoot, logger: () => {} });
  assert.deepEqual(snapshotNode(fixture.destinationRoot), destinationAfter, "market-facts projection must be byte-idempotent");
  assert.deepEqual(snapshotNode(fixture.sourceRoot), sourceBefore, "canonical ticker files must remain byte-identical");
}

function marketFactsFixturePayload(ticker = "AAPL") {
  return `${JSON.stringify({
    schema_version: "market-facts/v1",
    ticker,
    asset_type: "stock",
    facts: { beta: { value: 1.23, source: "yf" } },
  })}\n`;
}

function assertCanonicalShardSourceFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "canonical-shards-forbidden");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  write(fixture.sourceRoot, "computed/market_facts/tickers/AAPL.json", marketFactsFixturePayload());
  write(fixture.sourceRoot, "computed/market_facts/shards/stale.json", '{"must_not_publish":true}\n');
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /public-only market-facts shards/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "canonical shard input refusal must precede every destination mutation",
  );
}

function assertMissingCanonicalTickerSourceFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "missing-canonical-tickers");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /market-facts root exists without its ticker source root/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "missing canonical ticker source must fail before destination mutation",
  );
}

function assertOrphanedDestinationProjectionFailsClosed(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "orphaned-destination-market-facts");
  write(fixture.destinationRoot, "computed/market_facts/tickers/AAPL.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  assert.throws(
    () => syncPublicData({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    }),
    /without the canonical market-facts ticker source/i,
  );
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "orphaned public projection must fail before destination mutation",
  );
}

function assertMarketFactsSourceDriftFailsBeforeMutation(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "market-facts-source-drift");
  write(fixture.sourceRoot, "computed/market_facts/index.json", "{}\n");
  const tickerPath = write(
    fixture.sourceRoot,
    "computed/market_facts/tickers/AAPL.json",
    marketFactsFixturePayload(),
  );
  write(fixture.destinationRoot, "computed/market_facts/tickers/AAPL.json", '{"stale":true}\n');
  write(fixture.destinationRoot, "computed/market_facts/shards/stale.json", '{"stale":true}\n');
  const outside = path.join(fixture.root, "outside-market-facts.json");
  fs.writeFileSync(outside, marketFactsFixturePayload());
  const destinationBefore = snapshotNode(fixture.destinationRoot);
  let hookRan = false;
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
    beforeMutation: () => {
      hookRan = true;
      fs.unlinkSync(tickerPath);
      fs.symlinkSync(outside, tickerPath);
    },
  });
  assert.equal(hookRan, true, "source-drift fixture must reach the pre-mutation hook");
  assert.ok(error, "source ticker replacement must fail closed");
  assert.match(String(error.message), /source identity drift/i);
  assert.deepEqual(
    snapshotNode(fixture.destinationRoot),
    destinationBefore,
    "source ticker drift must be rejected before destination mutation",
  );
  assert.equal(fs.lstatSync(tickerPath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outside, "utf8"), marketFactsFixturePayload());
}

function createWrongNode(root, relativePath, kind, label) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (kind === "directory") {
    fs.mkdirSync(target);
    return { supported: true, target };
  }
  if (kind === "symlink") {
    const outside = path.join(path.dirname(root), `${label}-outside.json`);
    fs.writeFileSync(outside, "outside-untouched\n");
    fs.symlinkSync(outside, target);
    return { supported: true, target, outside };
  }
  if (kind === "fifo") {
    const result = spawnSync("mkfifo", [target], { encoding: "utf8" });
    if (result.error?.code === "ENOENT" || result.status !== 0) {
      fs.rmSync(target, { force: true });
      return { supported: false, target };
    }
    return { supported: true, target };
  }
  throw new Error(`unsupported wrong-node kind: ${kind}`);
}

function captureSyncError(options) {
  try {
    syncPublicData(options);
    return null;
  } catch (error) {
    return error;
  }
}

function assertWrongReportNodeFailsClosed(parentRoot, side, kind) {
  const fixture = makeSyncCase(parentRoot, `wrong-${side}-${kind}`);
  const reportRoot = side === "source" ? fixture.sourceRoot : fixture.destinationRoot;
  const wrongNode = createWrongNode(reportRoot, DETECTION_FLOOR_REPORT, kind, `${side}-${kind}`);
  if (!wrongNode.supported) {
    console.log(`test-sync-public-data: skipping unsupported ${side} FIFO fixture`);
    return;
  }
  const protectedPaths = [
    wrongNode.target,
    ...EXPECTED_PRIVATE_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
    path.join(fixture.destinationRoot, "admin", "safe-sibling.json"),
  ];
  const before = snapshotPaths(protectedPaths);
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.deepEqual(
    snapshotPaths(protectedPaths),
    before,
    `${side} ${kind} report refusal must not partially remove any destination target`,
  );
  assert.ok(error, `${side} ${kind} report node must fail closed`);
  assert.match(String(error.message), /data-supply-detection-floor|symlink|directory|special|regular|fifo|node/i);
  if (wrongNode.outside) assert.equal(fs.readFileSync(wrongNode.outside, "utf8"), "outside-untouched\n");
}

function assertPrivateRootFailureLeavesReportAndRoots(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "wrong-private-root");
  const reportPath = write(fixture.destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const unsafeRoot = path.join(fixture.destinationRoot, "yf", "etf-details");
  fs.rmSync(unsafeRoot, { recursive: true });
  const outside = path.join(fixture.root, "outside-private-root");
  fs.mkdirSync(outside);
  write(outside, "untouched.json", "outside-untouched\n");
  fs.symlinkSync(outside, unsafeRoot, "dir");
  const protectedPaths = [
    reportPath,
    ...EXPECTED_PRIVATE_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
  ];
  const before = snapshotPaths(protectedPaths);
  const error = captureSyncError({
    sourceRoot: fixture.sourceRoot,
    destinationRoot: fixture.destinationRoot,
    logger: () => {},
  });
  assert.ok(error, "unsafe private root must fail closed");
  assert.match(String(error.message), /symlink|private|excluded root/i);
  assert.deepEqual(snapshotPaths(protectedPaths), before, "private-root refusal must retain report and all roots");
  assert.equal(fs.readFileSync(path.join(outside, "untouched.json"), "utf8"), "outside-untouched\n");
}

function assertIdentityDriftFailsBeforeMutation(parentRoot) {
  const fixture = makeSyncCase(parentRoot, "identity-drift");
  const reportPath = write(fixture.destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const outside = path.join(fixture.root, "drift-outside.json");
  fs.writeFileSync(outside, "outside-untouched\n");
  const protectedPaths = [
    ...EXPECTED_PRIVATE_ROOTS.map((relativeRoot) => path.join(fixture.destinationRoot, ...relativeRoot.split("/"))),
    path.join(fixture.destinationRoot, "admin", "safe-sibling.json"),
  ];
  const before = snapshotPaths(protectedPaths);
  const originalLstatSync = fs.lstatSync;
  let driftInjected = false;
  let error = null;
  fs.lstatSync = function patchedLstatSync(target, ...args) {
    const stat = originalLstatSync.call(fs, target, ...args);
    if (!driftInjected && path.resolve(String(target)) === path.resolve(reportPath)) {
      fs.unlinkSync(reportPath);
      fs.symlinkSync(outside, reportPath);
      driftInjected = true;
    }
    return stat;
  };
  try {
    error = captureSyncError({
      sourceRoot: fixture.sourceRoot,
      destinationRoot: fixture.destinationRoot,
      logger: () => {},
    });
  } finally {
    fs.lstatSync = originalLstatSync;
  }
  assert.equal(driftInjected, true, "identity-drift fixture must intercept report preflight");
  assert.ok(error, "report identity drift must fail closed");
  assert.match(String(error.message), /identity|drift|changed|symlink/i);
  assert.equal(fs.lstatSync(reportPath).isSymbolicLink(), true);
  assert.deepEqual(snapshotPaths(protectedPaths), before, "identity drift must precede every destination mutation");
  assert.equal(fs.readFileSync(outside, "utf8"), "outside-untouched\n");
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-sync-public-data-"));

try {
  assert.deepEqual(
    EXCLUDED_PUBLIC_DATA_ROOTS,
    EXPECTED_PRIVATE_ROOTS,
    "the excluded directory roots must remain exact",
  );
  assert.deepEqual(
    EXCLUDED_PUBLIC_DATA_FILES,
    [
      DETECTION_FLOOR_REPORT,
      "admin/damodaran-shadow-parity.json",
      "admin/lane-commit-manifest.json",
      ...EXPECTED_PRIVATE_PROXY_FILES,
    ],
    "the exact-file exclusion allowlist must include all private flat admin reports and file-shaped private proxies",
  );
  const sourceRoot = path.join(fixtureRoot, "data");
  const destinationRoot = path.join(fixtureRoot, "100xfenok-next", "public", "data");
  write(sourceRoot, "safe/keep.json", '{"safe":true}\n');
  const krxSlice2Body = '{"schema_version":"fenok_krx_public_kosdaq_market_cap_aggregate.v1","aggregate_only":true}\n';
  write(sourceRoot, "computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json", krxSlice2Body);
  const sourceReportPath = write(sourceRoot, DETECTION_FLOOR_REPORT, '{"schema_version":"data-supply-detection-floor/v1"}\n');
  write(sourceRoot, "yf/finance/AAA.json", '{"public":true}\n');
  seedPrivateRoots(sourceRoot, destinationRoot);
  const destinationReportPath = write(destinationRoot, DETECTION_FLOOR_REPORT, '{"stale":true}\n');
  const safeAdminSiblingPath = write(destinationRoot, "admin/safe-sibling.json", '{"sibling":true}\n');
  write(destinationRoot, "destination-only/preserve.json", "{}\n");

  const sourceBeforeDryRun = snapshotNode(sourceRoot);
  const destinationBeforeDryRun = snapshotNode(destinationRoot);
  const rehearsal = syncPublicData({
    sourceRoot,
    destinationRoot,
    dryRun: true,
    logger: () => {},
  });
  assert.equal(rehearsal.dryRun, true);
  assert.equal(
    rehearsal.filesCopied,
    3,
    "public-safe files must copy while the canonical detection-floor report stays excluded",
  );
  // Exact-file exclusion set (order-insensitive contract; membership + count
  // are the pins, traversal order is not).
  const expectedExcludedExactFiles = [DETECTION_FLOOR_REPORT, ...EXPECTED_PRIVATE_PROXY_FILES].sort();
  assert.equal(rehearsal.excludedSourceFiles, 5);
  assert.equal(rehearsal.removedDestinationExactFiles, 5);
  assert.deepEqual([...rehearsal.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual([...rehearsal.removedDestinationExactFilePaths].sort(), expectedExcludedExactFiles);
  assert.equal(rehearsal.excludedSourceRoots, 11);
  assert.equal(rehearsal.removedDestinationRoots, 11);
  assert.equal(rehearsal.removedDestinationFiles, 11);
  assert.deepEqual(snapshotNode(sourceRoot), sourceBeforeDryRun, "dry-run must not mutate source bytes");
  assert.deepEqual(snapshotNode(destinationRoot), destinationBeforeDryRun, "dry-run must not mutate destination bytes");
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state/stale.json")), true);
  assert.equal(fs.readFileSync(destinationReportPath, "utf8"), '{"stale":true}\n');
  assert.equal(fs.readFileSync(safeAdminSiblingPath, "utf8"), '{"sibling":true}\n');

  const result = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(result.filesCopied, 3);
  assert.equal(result.excludedSourceRoots, 11);
  assert.equal(result.excludedSourceFiles, 5);
  assert.equal(result.removedDestinationRoots, 11);
  assert.equal(result.removedDestinationFiles, 11);
  assert.equal(result.removedDestinationExactFiles, 5);
  assert.deepEqual([...result.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual([...result.removedDestinationExactFilePaths].sort(), expectedExcludedExactFiles);
  assert.equal(fs.readFileSync(path.join(destinationRoot, "safe/keep.json"), "utf8"), '{"safe":true}\n');
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"), "utf8"),
    krxSlice2Body,
    "Slice 2 canonical aggregate must be copied byte-identically to the public mirror",
  );
  assert.equal(fs.readFileSync(path.join(destinationRoot, "yf/finance/AAA.json"), "utf8"), '{"public":true}\n');
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/data-supply-state")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/finra_short_volume")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/occ_options_volume")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/yahoo_private_options")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/fred_yardeni")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/edgar_filings")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "admin/nasdaq_giw_sox")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/etf-details")), false);
  assert.equal(fs.existsSync(path.join(destinationRoot, "yf/migration-evidence")), false);
  assert.equal(lstatIfPresent(destinationReportPath), null);
  assert.equal(fs.readFileSync(sourceReportPath, "utf8"), '{"schema_version":"data-supply-detection-floor/v1"}\n');
  assert.equal(fs.readFileSync(safeAdminSiblingPath, "utf8"), '{"sibling":true}\n');
  assert.equal(fs.existsSync(path.join(destinationRoot, "destination-only/preserve.json")), true);

  const destinationBeforeRerun = snapshotNode(destinationRoot);
  const rerun = syncPublicData({ sourceRoot, destinationRoot, logger: () => {} });
  assert.equal(rerun.filesCopied, 3);
  assert.equal(rerun.excludedSourceRoots, 11);
  assert.equal(rerun.excludedSourceFiles, 5);
  assert.equal(rerun.removedDestinationRoots, 0);
  assert.equal(rerun.removedDestinationFiles, 0);
  assert.equal(rerun.removedDestinationExactFiles, 0);
  assert.deepEqual([...rerun.excludedSourceFilePaths].sort(), expectedExcludedExactFiles);
  assert.deepEqual(rerun.removedDestinationExactFilePaths, []);
  assert.deepEqual(snapshotNode(destinationRoot), destinationBeforeRerun, "second sync must be byte-idempotent");

  const outside = path.join(fixtureRoot, "outside");
  fs.mkdirSync(outside, { recursive: true });
  write(outside, "secret.json", "{}\n");
  fs.rmSync(path.join(sourceRoot, "yf/etf-details"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(sourceRoot, "yf/etf-details"), "dir");
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /symlink/i,
  );
  assert.equal(fs.existsSync(path.join(destinationRoot, "safe/keep.json")), true);

  fs.rmSync(path.join(sourceRoot, "yf/etf-details"));
  fs.mkdirSync(path.join(sourceRoot, "yf/etf-details"));
  const destinationOutside = path.join(fixtureRoot, "destination-outside.json");
  fs.writeFileSync(destinationOutside, "untouched");
  fs.rmSync(path.join(destinationRoot, "safe/keep.json"));
  fs.symlinkSync(destinationOutside, path.join(destinationRoot, "safe/keep.json"));
  assert.throws(
    () => syncPublicData({ sourceRoot, destinationRoot, logger: () => {} }),
    /destination public-data path is a symlink/i,
  );
  assert.equal(fs.readFileSync(destinationOutside, "utf8"), "untouched");

  for (const side of ["source", "destination"]) {
    for (const kind of ["symlink", "directory", "fifo"]) {
      assertWrongReportNodeFailsClosed(fixtureRoot, side, kind);
    }
  }
  assertPrivateRootFailureLeavesReportAndRoots(fixtureRoot);
  assertIdentityDriftFailsBeforeMutation(fixtureRoot);
  assertCanonicalShardSourceFailsClosed(fixtureRoot);
  assertMissingCanonicalTickerSourceFailsClosed(fixtureRoot);
  assertOrphanedDestinationProjectionFailsClosed(fixtureRoot);
  assertMarketFactsSourceDriftFailsBeforeMutation(fixtureRoot);
  await assertMarketFactsShardProjection(fixtureRoot);

  const buildRoot = path.join(fixtureRoot, "100xfenok-next", ".open-next");
  const assetRoot = path.join(buildRoot, "assets");
  const reportPath = path.join(buildRoot, "asset-budget-report.json");
  write(assetRoot, "index.html", "ok");
  write(assetRoot, "data/computed/data-supply/etf-detail/enrollment.json", "{}\n");
  write(assetRoot, "data/computed/data-supply/etf-detail/index.json", '{"selected_count":1}\n');
  write(assetRoot, "data/computed/data-supply/etf-detail/payloads/AAA.json", "{}\n");

  const budget = inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 5 });
  assert.equal(budget.status, "pass");
  assert.equal(budget.regular_file_count, 4);
  assert.equal(budget.headroom, 1);
  assert.deepEqual(budget.data_supply_projection, {
    enrollment_files: 1,
    index_files: 1,
    payload_files: 1,
    total_files: 3,
  });
  assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).regular_file_count, 4);
  assert.equal(path.relative(assetRoot, reportPath).startsWith(".."), true);

  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 4 }),
    /asset limit/i,
  );
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath: path.join(assetRoot, "report.json"), limit: 5 }),
    /outside/i,
  );

  fs.symlinkSync(path.join(assetRoot, "index.html"), path.join(assetRoot, "linked.html"));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 10 }),
    /symlink/i,
  );
  fs.rmSync(path.join(assetRoot, "linked.html"));
  write(assetRoot, "generated/data-json-files-manifest.json", JSON.stringify({
    computed: [{ name: "same.json" }, { name: "same.json" }],
  }));
  assert.throws(
    () => inspectCloudflareAssetBudget({ assetRoot, reportPath, limit: 10 }),
    /duplicate manifest path/i,
  );

  console.log("test-sync-public-data: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
