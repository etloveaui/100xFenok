import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkCloudFamilyAcceptance,
  evaluateStrictServingResponse,
  familyPaths,
} from "./check-cloud-family-acceptance.mjs";
import { buildPublishOutcomeRecord } from "../lib/publish-outcome-shard.mjs";

const family = "slickcharts-symbols";
const minObservedAt = "2026-08-16T07:30:00.000Z";
const observedAt = "2026-08-16T07:31:00.000Z";
const generationId = "slickcharts-symbols-abcdef0123456789";
const nowIso = "2026-08-16T07:32:00.000Z";
const paths = familyPaths(family);
assert.deepEqual(paths, ["/data/slickcharts/symbols.json", "/data/slickcharts/symbols-all.json"]);

function writeOutcome(root, result, overrides = {}) {
  const outcomePath = path.join(root, "outcomes.json");
  const record = buildPublishOutcomeRecord({
    family,
    result,
    generationId,
    observedAt,
    sourceAsOf: "2026-08-16",
    ...overrides,
  });
  fs.writeFileSync(outcomePath, JSON.stringify({
    schema_version: "plane-publish-outcome-shard/v1",
    family,
    records: [record],
  }));
  return outcomePath;
}
function strictFetch() {
  return async () => new Response(null, {
    status: 200,
    headers: {
      "x-data-plane-generation": generationId,
      "x-data-plane-source-as-of": "2026-08-16",
      "x-data-plane-published-at": "2026-08-16T07:31:30.000Z",
    },
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-family-acceptance-"));
try {
  {
    const outcomeFile = writeOutcome(tempRoot, "published");
    const result = await checkCloudFamilyAcceptance({
      family,
      outcomeFile,
      minObservedAt,
      nowIso,
      fetchFn: strictFetch(),
    });
    assert.equal(result.state, "proven");
    assert.equal(result.paths.length, 2);
  }

  {
    const outcomeFile = writeOutcome(tempRoot, "gate_blocked");
    let fetchCalls = 0;
    const result = await checkCloudFamilyAcceptance({
      family,
      outcomeFile,
      minObservedAt,
      nowIso,
      fetchFn: async () => { fetchCalls += 1; return new Response(null, { status: 200 }); },
    });
    assert.equal(result.state, "not_proven");
    assert.equal(result.reason, "cost_gate_blocked");
    assert.equal(fetchCalls, 0);
  }

  {
    const outcomeFile = writeOutcome(tempRoot, "published");
    const result = await checkCloudFamilyAcceptance({
      family,
      outcomeFile,
      minObservedAt,
      nowIso,
      fetchFn: async () => new Response(null, { status: 200 }),
    });
    assert.equal(result.state, "not_proven");
    assert.equal(result.reason, "strict_serving_not_proven");
    assert.equal(result.paths.every((entry) => entry.failures.length > 0), true);
  }

  {
    const outcomeFile = writeOutcome(tempRoot, "published");
    const result = await checkCloudFamilyAcceptance({
      family,
      outcomeFile,
      minObservedAt: "2026-08-16T08:00:00.000Z",
      nowIso,
      fetchFn: strictFetch(),
    });
    assert.equal(result.state, "not_proven");
    assert.equal(result.reason, "no_outcome_from_current_run");
  }

  {
    const result = evaluateStrictServingResponse({
      path: paths[0],
      family,
      expectedGeneration: generationId,
      status: 200,
      generationHeader: "slickcharts-symbols-old",
      sourceAsOfHeader: "2026-08-16",
      publishedAtHeader: "2026-08-16T07:31:30.000Z",
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /does not match current/);
  }

  console.log("PASS check-cloud-family-acceptance (5 cases)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
