#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  buildFenoYardeniPayload,
  parseFredObservations,
  runFenoYardeni,
} from "./build-feno-yardeni-model.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const seedPayload = {
  meta: {
    model: "yardney_model",
    frequency: "weekly",
  },
  data: [
    {
      date: "2009-12-25",
      spx: 1100,
      eps: 80,
      bond_per: 20,
      fair_value: 1600,
      premium_pct: -31.25,
    },
    {
      date: "2010-01-01",
      spx: 1115.1,
      eps: 77.8493,
      bond_per: 20,
      fair_value: 1556.99,
      premium_pct: -28.38,
    },
  ],
};

const benchmarkPayload = {
  metadata: {
    version: "fixture-benchmark",
    generated: "2026-07-08T00:00:00.000Z",
    source: "Bloomberg Terminal",
  },
  sections: {
    sp500: {
      data: [
        {
          date: "2010-01-01",
          px_last: 1115.1,
          best_eps: 78.6127,
        },
        {
          date: "2010-01-08",
          px_last: 1144.98,
          best_eps: 79.1824,
        },
        {
          date: "2010-01-15",
          px_last: 1136.03,
          best_eps: 79.6816,
        },
      ],
    },
  },
};

const fredSeries = {
  WAAA: [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-08", value: 5.2 },
  ],
  WBAA: [
    { date: "2010-01-01", value: 6 },
    { date: "2010-01-08", value: 6.2 },
  ],
};

const { publicPayload, privatePayload, report } = buildFenoYardeniPayload({
  seedPayload,
  benchmarkPayload,
  fredSeries,
  generatedAt: "2026-07-08T00:00:00.000Z",
  generatedBy: "test",
});

assert.equal(publicPayload.meta.model, "feno_yardeni_model");
assert.equal(publicPayload.meta.public_schema_version, "yardney_model_public_v1");
assert.equal(publicPayload.meta.bond_yield_components_included, false);
assert.equal(publicPayload.data.length, 3);
assert.equal(publicPayload.data[0].date, "2009-12-25");
assert.equal(publicPayload.data[0].fair_value, 1600);

const firstComputed = publicPayload.data[1];
assert.deepEqual(firstComputed, {
  date: "2010-01-01",
  spx: 1115.1,
  eps: 78.6127,
  bond_per: 18.18,
  fair_value: 1429.18,
  premium_pct: -21.98,
});

assert.equal(publicPayload.data[2].date, "2010-01-08");
assert.equal(publicPayload.data.some((row) => row.date === "2010-01-15"), false);
assert.equal(report.seed_preserved_records, 1);
assert.equal(report.computed_records, 2);
assert.equal(report.skipped_benchmark_records, 1);

const publicText = JSON.stringify(publicPayload);
for (const forbidden of [
  "moodys_aaa",
  "moodys_baa",
  "spread_avg",
  "WAAA\":",
  "WBAA\":",
  "fred_aaa",
  "fred_baa",
]) {
  assert.equal(publicText.includes(forbidden), false, `public payload leaked ${forbidden}`);
}

assert.equal(privatePayload.data[1].moodys_aaa, 5);
assert.equal(privatePayload.data[1].moodys_baa, 6);
assert.equal(privatePayload.data[1].spread_avg, 5.5);

assert.deepEqual(
  parseFredObservations({
    observations: [
      { date: "2010-01-01", value: "5.00" },
      { date: "2010-01-08", value: "." },
      { date: "2010-01-15", value: "5.15" },
    ],
  }, "WAAA"),
  [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-15", value: 5.15 },
  ],
);

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function makeRunPaths(root) {
  return {
    publicOutputPath: path.join(root, "data", "yardney", "yardney_model.json"),
    publicMirrorPath: path.join(root, "public", "data", "yardney", "yardney_model.json"),
    privateOutputPath: path.join(root, "private", "yardney_model_full.json"),
    privateFredCachePath: path.join(root, "private", "fred_yardeni_yields.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_yardeni.json"),
  };
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-yardeni-test-"));
  const paths = makeRunPaths(root);
  const result = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, {
      observations: fredSeries[seriesId].map((row) => ({ date: row.date, value: String(row.value) })),
    }),
    observedAt: "2026-07-14T12:34:56.000Z",
    attemptId: "fred-yardeni-20260714t123456000z-test",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readFileSync(paths.publicOutputPath), fs.readFileSync(paths.publicMirrorPath));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "fred_yardeni"), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  assert.equal(shard.lane_id, "fred_yardeni");
  assert.equal(shard.attempts.length, 1);
  const row = shard.attempts[0];
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.equal(row.auth, "ok");
  assert.deepEqual(expectedAssertionIds("fred_yardeni"), ["observations_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fred_yardeni"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-yardeni-lkg-test-"));
  const paths = makeRunPaths(root);
  fs.mkdirSync(path.dirname(paths.publicOutputPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicMirrorPath), { recursive: true });
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.publicOutputPath, lkg);
  fs.writeFileSync(paths.publicMirrorPath, lkg);
  const result = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: async (_url, seriesId) => seriesId === "WBAA"
      ? response(429, { error: "rate limit" })
      : response(200, { observations: fredSeries.WAAA }),
    observedAt: "2026-07-14T12:34:56.000Z",
    attemptId: "fred-yardeni-20260714t123456000z-test",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited");
  assert.equal(fs.readFileSync(paths.publicOutputPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicMirrorPath, "utf8"), lkg);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "fred_yardeni"), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
}

// Natural request/build failures preserve a bounded, sanitized explanation on
// the runner result only. Detection attempt shards keep their fixed schema.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-yardeni-diagnostic-test-"));
  const paths = makeRunPaths(root);
  const transport = new Error("FRED socket reset Bearer secret-token https://fred.example/path?api_key=private");
  transport.code = "ECONNRESET";
  const result = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: async () => { throw transport; },
    observedAt: "2026-07-14T12:34:56.000Z",
    attemptId: "fred-yardeni-diagnostic-request",
  });
  assert.equal(result.reason, "transport_error");
  assert.match(result.failure_detail ?? "", /FRED socket reset/, "natural request failure retains a diagnostic detail");
  assert.ok(result.failure_detail.length <= 320, "diagnostic detail stays bounded");
  assert.equal(result.failure_detail.includes("secret-token"), false, "diagnostic detail redacts bearer credentials");
  assert.equal(result.failure_detail.includes("api_key=private"), false, "diagnostic detail redacts URL query values");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(Object.hasOwn(shard.attempts[0], "failure_detail"), false, "attempt shard schema remains unchanged");

  const buildResult = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload: {},
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, {
      observations: fredSeries[seriesId].map((row) => ({ date: row.date, value: String(row.value) })),
    }),
    observedAt: "2026-07-14T12:35:56.000Z",
    attemptId: "fred-yardeni-diagnostic-build",
  });
  assert.equal(buildResult.reason, "unexpected_error");
  assert.match(buildResult.failure_detail ?? "", /sections\.sp500\.data\[\] is required/, "natural build failure retains a diagnostic detail");
  assert.ok(buildResult.failure_detail.length <= 320, "build diagnostic detail stays bounded");

  const missingKey = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "",
    request: async () => { throw new Error("missing FRED key must not request"); },
    observedAt: "2026-07-14T12:36:56.000Z",
    attemptId: "fred-yardeni-diagnostic-missing-key",
  });
  assert.equal(missingKey.reason, "unexpected_error");
  assert.match(missingKey.failure_detail ?? "", /FRED_API_KEY is required/, "missing FRED credentials retain a safe static detail");
  assert.ok(missingKey.failure_detail.length <= 320, "static diagnostic detail stays bounded");
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-yardeni.yml"), "utf8");
  // The 2026-08-27 "deduplicate Yardeni staging" refactor (199f672298) moved
  // this workflow's shard paths out of the YAML hand list and into the
  // generated lane-commit-manifest.json (scripts/lib/lane-registry.mjs +
  // stage-lane-manifest.sh), matching the same migration already applied to
  // the other producer workflows (e.g. fetch-treasury-tga.yml, DEC-305/306).
  // The workflow body no longer contains the literal shard path, so the
  // contract check reads the generated manifest instead of grepping the YAML.
  const manifest = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
    "utf8",
  ));
  const workflowLanes = manifest.workflows[".github/workflows/fetch-fred-yardeni.yml"];
  const attemptSpec = workflowLanes?.stages?.always_if_exists
    ?.find((spec) => spec.path === "data/admin/data-supply-state/detection-attempts/fred_yardeni.json");
  assert.ok(attemptSpec, "fred_yardeni lane must declare its detection-attempt shard in always_if_exists");
  const canonicalSpec = workflowLanes?.stages?.success_if_exists
    ?.find((spec) => spec.path === "data/yardney/yardney_model.json");
  assert.equal(
    canonicalSpec?.required,
    true,
    "successful Feno Yardeni fetch must require the canonical payload",
  );
  assert.match(workflow, /- name: Commit and push Feno Yardeni data\n\s+if: \$\{\{ always\(\) \}\}/);

  // Durable checkout contract for the R2.4 public mirror guard: the Yardeni
  // sparse cone must pair the canonical data/computed tree (which activates
  // the guard's projection comparison) with the exact matching public
  // projection path. Dropping either side makes "Validate public payload"
  // fail with "public R2.4 enrollment: missing" / "public R2.4 index: missing"
  // in CI even though a full local checkout passes the guard.
  function parseSparseCone(yaml) {
    const lines = yaml.split("\n");
    const marker = lines.findIndex((line) => /^\s*sparse-checkout:\s*\|\s*$/.test(line));
    assert.ok(marker !== -1, "fetch-fred-yardeni.yml must declare a sparse-checkout block");
    const markerIndent = lines[marker].match(/^\s*/)[0].length;
    const firstContentLine = lines.slice(marker + 1).find((line) => line.trim());
    assert.ok(firstContentLine, "fetch-fred-yardeni.yml sparse-checkout block must not be empty");
    const scalarIndent = firstContentLine.match(/^\s*/)[0].length;
    assert.ok(scalarIndent > markerIndent, "fetch-fred-yardeni.yml sparse-checkout content must be indented");
    const cone = [];
    for (const line of lines.slice(marker + 1)) {
      if (!line.trim()) continue;
      if (line.match(/^\s*/)[0].length < scalarIndent) break;
      cone.push(line.slice(scalarIndent).trimEnd());
    }
    return cone;
  }

  const publicProjection = "100xfenok-next/public/data/computed/data-supply/etf-detail";
  function assertSparseConeContract(cone) {
    for (const requiredPath of [
      "data/computed",
      publicProjection,
      "100xfenok-next/scripts",
    ]) {
      assert.equal(
        cone.filter((entry) => entry === requiredPath).length,
        1,
        `Yardeni sparse cone must include ${requiredPath} exactly once so the R2.4 public mirror guard sees both projection sides`,
      );
    }

    const publicDataRoot = "100xfenok-next/public/data";
    const publicDataEntries = cone.filter(
      (entry) => entry === publicDataRoot
        || entry.startsWith(`${publicDataRoot}/`)
        || publicDataRoot.startsWith(`${entry}/`),
    );
    assert.deepEqual(
      publicDataEntries,
      [publicProjection],
      `Yardeni sparse cone must expose only the exact public projection ${publicProjection}`,
    );
  }

  const cone = parseSparseCone(workflow);
  assertSparseConeContract(cone);
  assert.deepEqual(
    parseSparseCone("steps:\n  sparse-checkout: |\n    data/computed\n  - uses: unnamed/action@v1\n    path: unrelated"),
    ["data/computed"],
    "sparse cone parsing must stop before an unnamed step at the scalar indentation boundary",
  );
  assert.throws(() => assertSparseConeContract([...cone, publicProjection]), /exactly once/);
  assert.throws(() => assertSparseConeContract([...cone, "100xfenok-next/public/data"]), /only the exact public projection/);
  assert.throws(
    () => assertSparseConeContract([...cone, "100xfenok-next/public/data/unrelated"]),
    /only the exact public projection/,
  );
}

console.log("build-feno-yardeni-model tests passed");
