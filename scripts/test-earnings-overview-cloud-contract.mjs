#!/usr/bin/env node
// Contract tests for the bounded public earnings-overview cloud family.
//
// The producer owns document derivation. This file pins the cloud boundary:
// exactly four public assets, per-document period clocks, and one registry
// owner for source, detection, staging, and publish-outcome evidence.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildFamilyManifest,
  FAMILIES,
} from "./publish-cloud-data-generation.mjs";
import {
  LANE_REGISTRY,
  PLANE_PUBLISH_OUTCOME_BINDINGS,
} from "./lib/lane-registry.mjs";
import { PLANE_ENROLLMENT_EXACT } from "../100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-enrollment.generated.mjs";
import { derivePublicPlaneEnrollment } from "./lib/plane-enrollment-derivation.mjs";

const FAMILY = "earnings-overview";
const WORKFLOW = ".github/workflows/refresh-earnings-overview.yml";
const CALLER_WORKFLOW = ".github/workflows/fetch-stockanalysis.yml";
const TICKERS = ["AAPL", "AMZN", "MSFT", "META"];
const OUTCOME_SHARD = "data/admin/data-supply-state/publish-outcomes/earnings-overview.json";
const DETECTION_SHARD = "data/admin/data-supply-state/detection-attempts/earnings_overview.json";
const CANONICAL_ROOT = "data/earnings-overview";
const MANIFEST_PREFIX = "public/data/earnings-overview";
const MAX_TOTAL_BYTES = 200_000;
const INCOME_METRICS = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingExpenses",
  "operatingIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
  "dilutedEps",
];

function expectAssetSpec(policy, expectedPath) {
  return Object.values(policy.stages)
    .flatMap((stage) => stage)
    .find((spec) => spec.path === expectedPath);
}

function validIncome() {
  return { revenue: 100e6, costOfRevenue: 40e6, grossProfit: 60e6, operatingExpenses: 20e6, operatingIncome: 40e6, pretaxIncome: 45e6, incomeTax: 10e6, netIncome: 35e6, dilutedEps: 1.25 };
}

function validPeriod(ticker, end, label) {
  return {
    end,
    label,
    income: validIncome(),
    source: {
      name: "SEC EDGAR",
      url: `https://www.sec.gov/Archives/edgar/data/${ticker.toLowerCase()}`,
      filedAt: end,
    },
    segments: [],
    segmentBasis: null,
    notes: ["Fixture source evidence"],
  };
}

function validDocument(ticker, newestEnd, olderEnd, updatedAt = "2026-09-06T12:00:00Z") {
  return {
    schemaVersion: 1,
    ticker,
    companyName: `${ticker} Fixture Company`,
    currency: "USD",
    updatedAt,
    status: "current",
    notice: null,
    periods: [
      validPeriod(ticker, newestEnd, "Q2"),
      validPeriod(ticker, olderEnd, "Q1"),
    ],
  };
}

// The public cloud family is deliberately a finite allowlist. A tree walk,
// raw StockAnalysis root, or a larger quota would make this boundary drift.
{
  const family = FAMILIES[FAMILY];
  assert.ok(family, `${FAMILY} must be declared in the publisher`);
  assert.equal(family.root, CANONICAL_ROOT);
  assert.equal(family.manifest_prefix, MANIFEST_PREFIX);
  assert.equal(family.privacy_class, "public");
  assert.notEqual(family.reader_enrollment, false, "public earnings must be reader-enrolled");
  assert.deepEqual(
    family.files,
    TICKERS.map((ticker) => `${ticker}.json`),
    "only the four allowlisted ticker documents may be published",
  );
  assert.equal(new Set(family.files).size, 4);
  assert.deepEqual(
    family.source_as_of,
    {
      files: Object.fromEntries(
        family.files.map((filename) => [filename, { max_date: { array: "periods", key: "end" } }]),
      ),
    },
    "each ticker document must derive its source clock from max periods[].end",
  );
  assert.equal(family.policy.max_assets, 4);
  assert.ok(
    family.policy.max_total_bytes <= MAX_TOTAL_BYTES,
    `family byte gate must stay at or below ${MAX_TOTAL_BYTES} bytes`,
  );
  assert.equal(typeof family.validate_public_payload, "function");
  const validPayload = new TextEncoder().encode(
    JSON.stringify(validDocument("AAPL", "2026-06-30", "2026-03-31")),
  );
  assert.equal(
    family.validate_public_payload({ bytes: validPayload }),
    true,
  );
  const emptyPeriods = validDocument("AAPL", "2026-06-30", "2026-03-31");
  emptyPeriods.periods = [];
  assert.equal(
    family.validate_public_payload({ bytes: new TextEncoder().encode(JSON.stringify(emptyPeriods)) }),
    false,
    "public validator must reject an empty periods array",
  );
  const missingMetric = validDocument("AAPL", "2026-06-30", "2026-03-31");
  delete missingMetric.periods[0].income.revenue;
  assert.equal(
    family.validate_public_payload({ bytes: new TextEncoder().encode(JSON.stringify(missingMetric)) }),
    false,
    "public validator must reject a period with missing financial metrics",
  );
  const secretPayload = validDocument("AAPL", "2026-06-30", "2026-03-31");
  secretPayload.token = "must-not-be-public";
  assert.equal(
    family.validate_public_payload({
      bytes: new TextEncoder().encode(JSON.stringify(secretPayload)),
    }),
    false,
    "public validator must reject credential-shaped fields",
  );
}

// The source clock is the newest period end in each document. updatedAt is an
// acquisition/publication field and must never replace the provider date.
{
  const sourceEnds = {
    "AAPL.json": "2026-06-30",
    "AMZN.json": "2026-03-31",
    "MSFT.json": "2026-06-30",
    "META.json": "2025-12-31",
  };
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "earnings-overview-cloud-contract-"));
  try {
    for (const [filename, newestEnd] of Object.entries(sourceEnds)) {
      const olderEnd = newestEnd === "2026-06-30" ? "2026-03-31" : "2025-09-30";
      const ticker = filename.slice(0, -5);
      const document = validDocument(ticker, newestEnd, olderEnd);
      assert.equal(document.ticker, ticker, "each document ticker must match its allowlisted filename");
      assert.equal(
        FAMILIES[FAMILY].validate_public_payload({
          bytes: new TextEncoder().encode(JSON.stringify(document)),
        }),
        true,
        `${ticker} source-clock fixture must satisfy the complete public schema`,
      );
      await writeFile(
        path.join(fixtureRoot, filename),
        JSON.stringify(document),
        "utf8",
      );
    }

    const built = await buildFamilyManifest({
      familyName: FAMILY,
      absRoot: fixtureRoot,
      relRoot: MANIFEST_PREFIX,
      now: () => "2026-09-06T12:00:00.000Z",
    });
    assert.equal(built.summary.asset_count, 4);
    assert.deepEqual(built.sourceAsOf, {
      value: "2025-12-31",
      origin: "per-asset",
      perAsset: new Map([
        ["AAPL.json", "2026-06-30"],
        ["AMZN.json", "2026-03-31"],
        ["MSFT.json", "2026-06-30"],
        ["META.json", "2025-12-31"],
      ]),
    });
    assert.deepEqual(
      built.manifest.assets.map((asset) => [asset.path, asset.source_as_of]),
      TICKERS.map((ticker) => [
        `${MANIFEST_PREFIX}/${ticker}.json`,
        sourceEnds[`${ticker}.json`],
      ]),
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

// Publication ownership must have one registry lane and one workflow. The
// lane owns source paths, its detection attempt, canonical staging, and the
// publish-outcome shard; the workflow policy must carry those declarations.
{
  const lane = LANE_REGISTRY.lanes.find((candidate) => (
    candidate.commit_shards.includes(OUTCOME_SHARD)
  ));
  assert.ok(lane, `${FAMILY} publish-outcome shard must have a registry owner`);
  assert.equal(lane.owner_workflow, WORKFLOW);
  assert.deepEqual(lane.provider_refs, [
    { provider_id: "sec_edgar", role: "source", members: null },
  ]);
  assert.deepEqual(lane.roots.canonical_outputs, [CANONICAL_ROOT]);
  assert.equal(lane.lane_class, "auxiliary");
  assert.equal(lane.roots.detection_attempt, null, "unadmitted detection attempt is not fabricated");
  assert.ok(lane.commit_shards.includes(CANONICAL_ROOT));
  assert.ok(lane.commit_shards.includes("data/admin/earnings_overview"));
  assert.ok(lane.script_sources?.includes("scripts/build-earnings-overview.py"));

  assert.deepEqual(PLANE_PUBLISH_OUTCOME_BINDINGS[FAMILY], {
    lane_id: lane.id,
    workflow: WORKFLOW,
  });

  const workflowPolicy = LANE_REGISTRY.workflow_policies[WORKFLOW];
  assert.ok(workflowPolicy, `${WORKFLOW} must have a registry policy`);
  assert.ok(workflowPolicy.lanes.includes(lane.id));
  assert.ok(
    workflowPolicy.stages.always_if_exists.some((spec) => spec.path === OUTCOME_SHARD),
    "outcome evidence must be staged on every run",
  );
  assert.ok(
    workflowPolicy.stages.always_if_exists.some((spec) => spec.path === "data/admin/earnings_overview"),
    "real refresh outcome evidence must be staged on every run",
  );
  assert.ok(
    expectAssetSpec(workflowPolicy, CANONICAL_ROOT),
    "canonical earnings documents must be covered by workflow staging",
  );
}

// Enrollment and Worker-first routing are generated from the public family
// descriptor. This assertion gives the hosted RED a precise stale-descriptor
// failure until the lead intentionally regenerates the artifact after the
// publisher contract is green.
{
  const enrollment = derivePublicPlaneEnrollment(FAMILIES);
  assert.deepEqual(
    enrollment.exact.filter(([, family]) => family === FAMILY),
    [...TICKERS].sort().map((ticker) => [`/data/earnings-overview/${ticker}.json`, FAMILY]),
  );
  assert.deepEqual(PLANE_ENROLLMENT_EXACT.filter(([, family]) => family === FAMILY), enrollment.exact.filter(([, family]) => family === FAMILY), "committed Worker enrollment must match the verified bounded family");
  assert.equal(
    enrollment.prefixes.some(({ family }) => family === FAMILY),
    false,
    "finite earnings allowlist must not become a broad public prefix",
  );

  const wrangler = await readFile(
    new URL("../100xfenok-next/wrangler.jsonc", import.meta.url),
    "utf8",
  );
  assert.match(
    wrangler,
    /"\/data\/earnings-overview\/\*"/u,
    "Worker-first routing must include the bounded earnings family",
  );
}

// The daily 21:20 UTC StockAnalysis schedule calls the independent reusable
// earnings workflow so an unrelated provider failure cannot suppress this
// four-file family. The reusable workflow also remains manually dispatchable
// for the bounded initial publish.
{
  const reusable = await readFile(new URL("../.github/workflows/refresh-earnings-overview.yml", import.meta.url), "utf8");
  assert.match(reusable, /workflow_call:/u);
  assert.match(reusable, /workflow_dispatch:/u);
  assert.match(reusable, /build-earnings-overview\.py\s+--refresh/u);
  assert.match(reusable, /--output-dir\s+data\/earnings-overview/u);
  assert.match(reusable, /publish-cloud-data-generation\.mjs\s+--family=earnings-overview/u);
  assert.match(reusable, /persist-cloud-publish-outcome\.mjs[\s\S]*--family=earnings-overview/u);
  assert.match(reusable, /fenok-data-writer-refs\/heads\/main/u);
  assert.match(reusable, /git fetch origin main/u);
  assert.match(reusable, /\[skip ci\]/u);
  assert.match(reusable, /data\/earnings-overview/u);

  const deployWorkflow = await readFile(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
  assert.ok(deployWorkflow.includes("'!100xfenok-next/public/data/earnings-overview/**'"), "static LKG refresh cannot trigger a Worker UI deployment");
  const updateManifest = await readFile(new URL("../.github/workflows/update-manifest.yml", import.meta.url), "utf8");
  assert.ok(updateManifest.includes("'!data/earnings-overview/**'"), "earnings data refresh cannot trigger full UI reconciliation");
  assert.ok(updateManifest.includes("'!data/admin/earnings_overview/**'"));
  const caller = await readFile(new URL("../.github/workflows/fetch-stockanalysis.yml", import.meta.url), "utf8");
  assert.match(caller, /cron:\s*['"]20 21 \* \* \*['"]/u);
  const callerJobStart = caller.indexOf("  refresh-earnings-overview:");
  assert.notEqual(callerJobStart, -1, `${CALLER_WORKFLOW} must call the earnings workflow`);
  const callerBlock = caller.slice(callerJobStart);
  assert.match(callerBlock, /uses:\s*\.\/\.github\/workflows\/refresh-earnings-overview\.yml/u);
  assert.doesNotMatch(callerBlock, /needs:\s*acquire-stockanalysis/u, "earnings refresh must be independent of StockAnalysis success");
}

process.stdout.write("test-earnings-overview-cloud-contract: ok\n");
