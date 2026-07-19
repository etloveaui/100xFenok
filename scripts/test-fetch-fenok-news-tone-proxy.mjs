#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  articleSeenAt,
  cleanCompanyName,
  computeTone,
  cueCounts,
  queryForTicker,
} from "./fetch-fenok-news-tone-proxy.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_ID = "gdelt_news_tone";
const WORKFLOW_REL = ".github/workflows/fetch-fenok-news-tone.yml";

assert.equal(cleanCompanyName("NVIDIA CORP Class A"), "NVIDIA A");
assert.equal(queryForTicker("NVDA", "NVIDIA CORP"), '"NVIDIA"');
assert.deepEqual(cueCounts("Analyst upgrades company after strong profit growth"), { positive: 3, negative: 0 });
assert.deepEqual(cueCounts("Company falls after weak warning and lawsuit"), { positive: 0, negative: 4 });
assert.equal(articleSeenAt("20260628T123456Z"), "2026-06-28T12:34:56.000Z");

const positive = computeTone({
  ticker: "TEST",
  company: "Test Inc",
  payload: {
    fetched_at: "2026-06-28T00:00:00Z",
    articles: [
      { title: "Test beats expectations with strong growth", seendate: "20260627T123456Z" },
      { title: "Analysts upgrade Test after record profit", seendate: "20260628T123456Z" },
    ],
  },
});
assert(positive.direct_news_tone_proxy.score_0_100 > 50);
assert.equal(positive.direct_news_tone_proxy.article_count, 2);
assert.equal(positive.as_of, "2026-06-28T12:34:56.000Z");
assert.equal(positive.as_of_reason, null);

const empty = computeTone({
  ticker: "EMPTY",
  company: "Empty Inc",
  payload: { fetched_at: null, articles: [] },
});
assert.equal(empty.direct_news_tone_proxy.score_0_100, null);
assert.equal(empty.confidence, "very_low");
assert.equal(empty.as_of, null);
assert.match(empty.as_of_reason, /seendate/);

// --- Workflow contract (owned producer wiring, #366) ------------------------
{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /controlled_failure/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE/);
  assert.match(workflow, new RegExp(`detection-attempts/${LANE_ID}\\.json`));
  assert.match(workflow, /data\/computed\/fenok_news_tone_proxy\.json/);
  assert.match(workflow, /data\/computed\/fenok_news_tone_proxy_history\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
}

// --- Lane Registry ⇄ commit-shard completeness gate (#366 step 4) -----------
{
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: WORKFLOW_REL,
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), [LANE_ID].sort(), "registry lane attribution for this workflow");
}

console.log("test-fetch-fenok-news-tone-proxy: ok");
