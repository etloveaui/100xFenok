#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attentionScoreFromRank,
  buildRows,
  momentumScore,
  normalizeApeRows,
  parseArgs,
} from "./fetch-fenok-apewisdom-attention-proxy.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_ID = "apewisdom_attention";
const WORKFLOW_REL = ".github/workflows/fetch-fenok-apewisdom.yml";

const samplePages = [
  {
    count: 797,
    pages: 8,
    current_page: 1,
    results: [
      {
        rank: 1,
        ticker: "NVDA",
        name: "NVIDIA",
        mentions: "166",
        upvotes: "785",
        rank_24h_ago: "2",
        mentions_24h_ago: "120",
      },
      {
        rank: "25",
        ticker: "msft",
        name: "Microsoft",
        mentions: "42",
        upvotes: "105",
        rank_24h_ago: "20",
        mentions_24h_ago: "60",
      },
    ],
  },
];

const args = parseArgs(["--filter", "all-stocks", "--max-pages", "2", "--tickers", "NVDA,MSFT,ZZZZ"]);
assert.equal(args.filter, "all-stocks");
assert.equal(args.maxPages, 2);
assert.equal(args.tickers, "NVDA,MSFT,ZZZZ");

assert.throws(() => parseArgs(["--filter", "not-a-filter"]), /Unsupported ApeWisdom filter/);

const apeRows = normalizeApeRows(samplePages);
assert.equal(apeRows.length, 2);
assert.equal(apeRows[1].ticker, "MSFT");
assert.equal(apeRows[0].mentions, 166);
assert.equal(apeRows[0].upvotes, 785);

assert.equal(attentionScoreFromRank(1, 797), 100);
assert.equal(attentionScoreFromRank(797, 797), 0);
assert.equal(attentionScoreFromRank(null, 797), null);
assert.ok(momentumScore({ mentions: 166, mentions_24h_ago: 120 }) > 50);
assert.ok(momentumScore({ mentions: 42, mentions_24h_ago: 60 }) < 50);
assert.equal(momentumScore({ mentions: null, mentions_24h_ago: 60 }), null);

const rows = buildRows({
  universeTickers: ["NVDA", "MSFT", "ZZZZ"],
  apeRows,
  count: samplePages[0].count,
  sourceDate: "20260629",
});

assert.equal(rows.length, 3);
assert.equal(rows[0].ticker, "NVDA");
assert.equal(rows[0].coverage_ratio, 1);
assert.equal(rows[0].confidence, "medium");
assert.equal(rows[0].caveat_code, "attention_proxy_not_sentiment");
assert.equal(rows[0].social_attention_proxy.score_0_100, 100);
assert.equal(rows[0].social_attention_proxy.mentions, 166);
assert.equal(rows[1].ticker, "MSFT");
assert.ok(rows[1].social_attention_proxy.score_0_100 < rows[0].social_attention_proxy.score_0_100);
assert.equal(rows[2].ticker, "ZZZZ");
assert.equal(rows[2].coverage_ratio, 0);
assert.equal(rows[2].confidence, "low");
assert.equal(rows[2].social_attention_proxy.score_0_100, null);
assert.equal(rows[2].social_attention_proxy.mentions, null);

// --- Workflow contract (owned producer wiring, #366) ------------------------
{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fenok-apewisdom-attention-proxy\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fenok-apewisdom-attention-proxy\.mjs/);
  assert.match(workflow, /controlled_failure/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE/);
  assert.match(workflow, new RegExp(`detection-attempts/${LANE_ID}\\.json`));
  assert.match(workflow, /data\/computed\/fenok_social_attention_proxy\.json/);
  assert.match(workflow, /data\/computed\/fenok_social_attention_proxy_history\.json/);
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

console.log("test-fetch-fenok-apewisdom-attention-proxy: ok");
