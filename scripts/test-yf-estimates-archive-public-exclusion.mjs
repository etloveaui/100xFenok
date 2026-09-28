#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { removePrivateDataSupplyPublicTrees } from "../100xfenok-next/sync-static-overrides.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const family = "yf/estimates-archive";
const publicRoot = path.join(ROOT, "100xfenok-next", "public", "data", "yf", "estimates-archive");
const canonicalRoot = path.join(ROOT, "data", "yf", "estimates-archive");
const canonicalFiles = fs.readdirSync(canonicalRoot)
  .filter((name) => name.endsWith(".json"))
  .sort();
const dateShards = canonicalFiles.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));

assert.ok(dateShards.length > 0, "the canonical estimate archive must retain date shards");
assert.equal(canonicalFiles.includes("_summary.json"), true, "the canonical estimate archive must retain _summary.json");
assert.equal(fs.existsSync(publicRoot), false, "the private estimate archive must not remain public");

for (const relative of canonicalFiles) {
  assert.equal(
    fs.existsSync(path.join(canonicalRoot, relative)),
    true,
    `canonical estimate archive file missing: ${relative}`,
  );
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--no-index", "-q", "--", `100xfenok-next/public/data/${family}/${relative}`],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(ignored.status, 0, `public estimate archive path is not ignored: ${relative}`);
}

const overrides = fs.readFileSync(path.join(ROOT, "100xfenok-next", "sync-static-overrides.mjs"), "utf8");
assert.equal(
  overrides.includes(`public/data/${family}`),
  true,
  "sync-static-overrides must remove the whole generated estimate archive tree",
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yf-estimates-archive-public-exclusion-"));
try {
  const futurePath = path.join(fixtureRoot, "public", "data", "yf", "estimates-archive", "future.json");
  fs.mkdirSync(path.dirname(futurePath), { recursive: true });
  fs.writeFileSync(futurePath, "{}", "utf8");
  const cleanup = removePrivateDataSupplyPublicTrees({ rootDir: fixtureRoot, logger: () => {} });
  assert.equal(cleanup.filesRemoved, 1, "the private tree cleanup must remove a future archive shard");
  assert.equal(fs.existsSync(path.dirname(futurePath)), false, "the generated archive tree must be removed recursively");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const retention = await import("./lib/cloud-data-plane-retention-registry.mjs");
assert.equal(
  retention.RETENTION_REGISTRY.retained.some((entry) => entry.path === "data/yf/estimates-archive"),
  true,
  "the canonical archive must remain accounted as private retained history",
);
assert.equal(
  retention.OWNERSHIP_REGISTRY.exposed_no_consumer.some((entry) => entry.path === "data/yf/estimates-archive"),
  false,
  "a removed public tree must not remain in the exposed-no-consumer queue",
);

const laneManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/admin/lane-commit-manifest.json"), "utf8"));
const workflow = laneManifest.workflows?.[".github/workflows/fetch-yf-finance.yml"];
const canonicalStages = workflow?.stages?.always_if_exists ?? [];
assert.equal(
  canonicalStages.some((entry) => entry.path === "data/yf/estimates-archive"),
  true,
  "the Yahoo workflow must retain its canonical archive commit contract",
);
assert.equal(
  JSON.stringify(workflow?.lanes ?? []) .includes("yahoo_batch_quote_history"),
  true,
  "the existing Yahoo lane ownership must remain intact",
);

for (const manifest of ["data/manifest.json", "100xfenok-next/public/data/manifest.json"]) {
  assert.equal(fs.existsSync(path.join(ROOT, manifest)), true, `manifest missing: ${manifest}`);
}
assert.deepEqual(
  fs.readFileSync(path.join(ROOT, "data/manifest.json")),
  fs.readFileSync(path.join(ROOT, "100xfenok-next", "public", "data", "manifest.json")),
  "the public catalog must remain canonical and byte-identical",
);

console.log(`[test-yf-estimates-archive-public-exclusion] OK (${dateShards.length} date shards + _summary retained canonically)`);
