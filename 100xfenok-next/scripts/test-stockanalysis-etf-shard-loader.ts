import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncStockanalysisEtfShardProjection } from "./sync-public-data.mjs";
import {
  STOCKANALYSIS_ETF_SHARD_ALGORITHM,
  STOCKANALYSIS_ETF_SHARD_COUNT,
  STOCKANALYSIS_ETF_SHARD_SCHEMA,
  stockanalysisEtfManifestSha256,
  stockanalysisEtfPayloadDocumentResultFromVerifiedShard,
  stockanalysisEtfShardId,
} from "../src/lib/stockanalysis-etf-shard.mjs";

const originalCwd = process.cwd();
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stockanalysis-etf-shard-loader-"));

interface ShardManifestEntry {
  path: string;
  sha256: string;
  byte_length: number;
  member_count: number;
}

interface ShardManifest {
  compatibility_mode: string;
  manifest_sha256: string;
  payload_count: number;
  shards: ShardManifestEntry[];
  [key: string]: unknown;
}

interface ShardMember {
  raw: string;
  sha256: string;
}

interface ShardDocument {
  shard_id: number;
  entries: Record<string, ShardMember>;
}

function write(filePath: string, body: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

function sha256(body: string) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function shardRoot(destinationRoot: string) {
  return path.join(destinationRoot, "stockanalysis", "etfs", "shards");
}

function readManifest(destinationRoot: string): ShardManifest {
  return JSON.parse(fs.readFileSync(path.join(shardRoot(destinationRoot), "index.json"), "utf8")) as ShardManifest;
}

function writeManifest(destinationRoot: string, manifest: ShardManifest) {
  manifest.manifest_sha256 = stockanalysisEtfManifestSha256(manifest);
  write(path.join(shardRoot(destinationRoot), "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function rewriteSelectedShard(
  destinationRoot: string,
  manifest: ShardManifest,
  ticker: string,
  mutate: (shard: ShardDocument, entry: ShardMember, selected: ShardManifestEntry) => void,
) {
  const selected = manifest.shards[stockanalysisEtfShardId(ticker)];
  const shardPath = path.join(shardRoot(destinationRoot), selected.path);
  const shard = JSON.parse(fs.readFileSync(shardPath, "utf8")) as ShardDocument;
  mutate(shard, shard.entries[ticker], selected);
  const shardRaw = `${JSON.stringify(shard)}\n`;
  fs.writeFileSync(shardPath, shardRaw, "utf8");
  selected.sha256 = sha256(shardRaw);
  selected.byte_length = Buffer.byteLength(shardRaw);
  writeManifest(destinationRoot, manifest);
}

async function main() {
  try {
    const sourceRoot = path.join(fixtureRoot, "data");
    const appRoot = path.join(fixtureRoot, "app");
    const destinationRoot = path.join(appRoot, "public", "data");
    const canonicalRaw = `{
  "ticker": "TQQQ",
  "source": "stockanalysis",
  "schema_version": "stockanalysis/v1",
  "asset_type": "etf",
  "fetched_at": "2026-07-29T01:19:39Z",
  "source_as_of": "2026-07-28T20:00:00Z",
  "marker": "shard-only"
}
`;
    write(path.join(sourceRoot, "stockanalysis", "etfs", "TQQQ.json"), canonicalRaw);
    const initial = syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });
    assert.equal(initial.stockanalysisEtfTickerFiles, 1);
    assert.equal(initial.stockanalysisEtfShardFiles, STOCKANALYSIS_ETF_SHARD_COUNT);
    assert.equal(initial.stockanalysisEtfManifestFiles, 1);

    const initialManifestRaw = fs.readFileSync(path.join(shardRoot(destinationRoot), "index.json"), "utf8");
    const initialManifest = JSON.parse(initialManifestRaw);
    const initialSelected = initialManifest.shards[stockanalysisEtfShardId("TQQQ")];
    const initialShardPath = path.join(shardRoot(destinationRoot), initialSelected.path);
    const initialShardRaw = fs.readFileSync(initialShardPath, "utf8");
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });
    assert.equal(fs.readFileSync(initialShardPath, "utf8"), initialShardRaw);
    assert.equal(fs.readFileSync(path.join(shardRoot(destinationRoot), "index.json"), "utf8"), initialManifestRaw);

    // A retained direct file is a trap: no result below may read or return it.
    write(
      path.join(destinationRoot, "stockanalysis", "etfs", "TQQQ.json"),
      canonicalRaw.replace("shard-only", "forbidden-direct-file"),
    );

    process.chdir(appRoot);
    const {
      getStockanalysisAsset,
      getStockanalysisEtfShardDocument,
    } = await import("../src/lib/server/data-loader");

    const ok = await getStockanalysisEtfShardDocument("TQQQ");
    assert.equal(ok.kind, "ok");
    if (ok.kind === "ok") {
      assert.equal(ok.document.raw, canonicalRaw);
      assert.equal(sha256(ok.document.raw), sha256(canonicalRaw));
    }
    assert.equal((await getStockanalysisAsset("etfs", "TQQQ"))?.marker, "shard-only");

    const absent = await getStockanalysisEtfShardDocument("ZZZZ");
    assert.equal(absent.kind, "ticker_not_found");

    fs.appendFileSync(initialShardPath, " ");
    const corrupt = await getStockanalysisEtfShardDocument("TQQQ");
    assert.equal(corrupt.kind, "shard_integrity_unavailable");
    assert.equal(await getStockanalysisAsset("etfs", "TQQQ"), null);
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const manifestPath = path.join(shardRoot(destinationRoot), "index.json");
    fs.renameSync(manifestPath, `${manifestPath}.missing`);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.renameSync(`${manifestPath}.missing`, manifestPath);

    fs.writeFileSync(manifestPath, "{ malformed manifest }\n", "utf8");
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const unsafePath = readManifest(destinationRoot);
    unsafePath.shards[stockanalysisEtfShardId("TQQQ")].path = "../selected.json";
    writeManifest(destinationRoot, unsafePath);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const missingSelected = readManifest(destinationRoot);
    const missingSelectedPath = path.join(
      shardRoot(destinationRoot),
      missingSelected.shards[stockanalysisEtfShardId("TQQQ")].path,
    );
    fs.unlinkSync(missingSelectedPath);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const duplicateShardId = readManifest(destinationRoot);
    duplicateShardId.shards[stockanalysisEtfShardId("TQQQ")].id =
      duplicateShardId.shards[
        (stockanalysisEtfShardId("TQQQ") + 1) % STOCKANALYSIS_ETF_SHARD_COUNT
      ].id;
    writeManifest(destinationRoot, duplicateShardId);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongMode = readManifest(destinationRoot);
    wrongMode.compatibility_mode = "legacy-fallback";
    writeManifest(destinationRoot, wrongMode);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongBytes = readManifest(destinationRoot);
    wrongBytes.shards[stockanalysisEtfShardId("TQQQ")].byte_length += 1;
    writeManifest(destinationRoot, wrongBytes);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongCount = readManifest(destinationRoot);
    const countEntry = wrongCount.shards[stockanalysisEtfShardId("TQQQ")];
    countEntry.member_count += 1;
    wrongCount.payload_count += 1;
    writeManifest(destinationRoot, wrongCount);
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongShardId = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, wrongShardId, "TQQQ", (shard) => {
      shard.shard_id = (shard.shard_id + 1) % STOCKANALYSIS_ETF_SHARD_COUNT;
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const rawHash = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, rawHash, "TQQQ", (_shard, entry) => {
      entry.raw = canonicalRaw.replace("shard-only", "tampered");
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const badJson = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, badJson, "TQQQ", (_shard, entry) => {
      entry.raw = "{ invalid embedded JSON }\n";
      entry.sha256 = sha256(entry.raw);
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongTicker = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, wrongTicker, "TQQQ", (_shard, entry) => {
      entry.raw = canonicalRaw.replace('"ticker": "TQQQ"', '"ticker": "SPY"');
      entry.sha256 = sha256(entry.raw);
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const wrongMembership = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, wrongMembership, "TQQQ", (shard, _entry, selected) => {
      const wrongKey = ["SPY", "IEFA", "QQQ"].find((ticker) => stockanalysisEtfShardId(ticker) !== shard.shard_id);
      assert.ok(wrongKey);
      shard.entries[wrongKey!] = shard.entries.TQQQ;
      selected.member_count += 1;
      wrongMembership.payload_count += 1;
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "shard_integrity_unavailable");
    fs.rmSync(shardRoot(destinationRoot), { recursive: true, force: true });
    syncStockanalysisEtfShardProjection({ sourceRoot, destinationRoot, logger: () => {} });

    const trueAbsence = readManifest(destinationRoot);
    rewriteSelectedShard(destinationRoot, trueAbsence, "TQQQ", (shard, _entry, selected) => {
      delete shard.entries.TQQQ;
      selected.member_count -= 1;
      trueAbsence.payload_count -= 1;
    });
    assert.equal((await getStockanalysisEtfShardDocument("TQQQ")).kind, "ticker_not_found");

    const selectedRaw = canonicalRaw;
    const selectedShardId = stockanalysisEtfShardId("TQQQ");
    const unrelatedTicker = Array.from({ length: 100_000 }, (_, index) => `X${index}`)
      .find((candidate) => stockanalysisEtfShardId(candidate) === selectedShardId);
    assert.ok(unrelatedTicker);
    let unrelatedRawRead = false;
    const runtimeFastPath = stockanalysisEtfPayloadDocumentResultFromVerifiedShard({
      schema_version: STOCKANALYSIS_ETF_SHARD_SCHEMA,
      shard_algorithm: STOCKANALYSIS_ETF_SHARD_ALGORITHM,
      shard_count: STOCKANALYSIS_ETF_SHARD_COUNT,
      shard_id: selectedShardId,
      entries: {
        TQQQ: { raw: selectedRaw, sha256: sha256(selectedRaw) },
        [unrelatedTicker]: {
          get raw() {
            unrelatedRawRead = true;
            throw new Error("runtime fast path read an unrelated payload");
          },
          sha256: "0".repeat(64),
        },
      },
    }, "TQQQ", 2);
    assert.equal(runtimeFastPath.kind, "ok");
    assert.equal(unrelatedRawRead, false);

    console.log("test-stockanalysis-etf-shard-loader: ok");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
