#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  APEWISDOM_HISTORY_PERSISTENCE_POLICY,
  MAX_APEWISDOM_HISTORY_SOURCE_DATES,
  attentionScoreFromRank,
  buildRows,
  mergeHistory,
  momentumScore,
  normalizeApeRows,
  parseArgs,
  runApeWisdomAttention,
} from "./fetch-fenok-apewisdom-attention-proxy.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_ID = "apewisdom_attention";
const WORKFLOW_REL = ".github/workflows/fetch-fenok-apewisdom.yml";
const OBSERVED_AT = "2026-07-24T13:17:00.000Z";

const APEWISDOM_PRODUCER_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "fetch-fenok-apewisdom-attention-proxy.mjs"),
  "utf8",
);
assert.doesNotMatch(
  APEWISDOM_PRODUCER_SOURCE,
  /body\.slice\(0, 160\)/,
  "secondary ApeWisdom HTTP errors must not embed provider response bodies",
);

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function providerResponse(document, date) {
  return { statusCode: 200, body: JSON.stringify(document), headers: { date } };
}

function runnerPaths(root) {
  return {
    repoRoot: root,
    dataRoot: path.join(root, "data"),
    privateRoot: path.join(root, "_private", "admin", "fenok-flow", "apewisdom"),
    canonicalPath: path.join(root, "data", "computed", "fenok_social_attention_proxy.json"),
    historyPath: path.join(root, "data", "computed", "fenok_social_attention_proxy_history.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`),
  };
}

function expectedAssertionIds(laneId) {
  return DATA_SUPPLY_DETECTION_CONFIG.lanes
    .find((lane) => lane.id === laneId)
    .endpoint_contract.assertions
    .map((assertion) => assertion.id);
}

// P: follow the FINRA daily marker sibling's bounded 100 distinct source-date
// policy. Retention is by provider source date, not by the number of tickers.
{
  assert.equal(MAX_APEWISDOM_HISTORY_SOURCE_DATES, 100);
  assert.equal(APEWISDOM_HISTORY_PERSISTENCE_POLICY.max_distinct_source_dates, 100);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apewisdom-history-retention-"));
  const dataRoot = path.join(root, "data");
  const sourceDates = Array.from({ length: MAX_APEWISDOM_HISTORY_SOURCE_DATES + 1 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    return date.toISOString().slice(0, 10).replaceAll("-", "");
  });
  const historyPath = path.join(dataRoot, "computed", "fenok_social_attention_proxy_history.json");
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify({
    schema_version: 1,
    formula_version: "fenok-social-attention-v0.1-apewisdom",
    generated_at: OBSERVED_AT,
    rows: sourceDates.slice(0, -1).map((source_date) => ({ ticker: "NVDA", source_date, as_of: source_date })),
  }, null, 2)}\n`);
  const merged = mergeHistory({
    generated_at: OBSERVED_AT,
    rows: [{
      ticker: "NVDA",
      source_date: sourceDates.at(-1),
      as_of: sourceDates.at(-1),
      confidence: "medium",
      social_attention_proxy: { score_0_100: 100, momentum_score_0_100: 50, mentions: 10, rank: 1 },
    }],
  }, { dataRoot });
  assert.equal(merged.rows.length, MAX_APEWISDOM_HISTORY_SOURCE_DATES);
  assert.equal(merged.rows.some((row) => row.source_date === sourceDates[0]), false, "oldest provider date is evicted first");
  assert.deepEqual(merged.persistence_state, {
    available_source_dates: MAX_APEWISDOM_HISTORY_SOURCE_DATES + 1,
    retained_source_dates: MAX_APEWISDOM_HISTORY_SOURCE_DATES,
    pruned_source_dates: 1,
  });
}

// L/P/R: a provider failure retains a payload-bound LKG, records the retry,
// and only a natural schedule attempt 1 may replace it with a newer provider
// observation. The provider's HTTP Date is the sole source marker here; the
// runner clock must never be substituted for it.
{
  const naturalFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apewisdom-diagnostic-"));
  const naturalFailurePaths = runnerPaths(naturalFailureRoot);
  const naturalFailure = await runApeWisdomAttention({
    ...naturalFailurePaths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => {
      const error = new Error("ApeWisdom socket reset Bearer secret-token https://apewisdom.example/feed?token=private");
      error.code = "ECONNRESET";
      throw error;
    },
    observedAt: OBSERVED_AT,
    attemptId: "apewisdom-natural-diagnostic",
    runId: "natural-diagnostic-run",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(naturalFailure.reason, "transport_error");
  assert.match(naturalFailure.failure_detail ?? "", /ApeWisdom socket reset/, "natural request failure retains a diagnostic detail");
  assert.ok(naturalFailure.failure_detail.length <= 320, "diagnostic detail stays bounded");
  assert.equal(naturalFailure.failure_detail.includes("secret-token"), false, "diagnostic detail redacts bearer credentials");
  assert.equal(naturalFailure.failure_detail.includes("token=private"), false, "diagnostic detail redacts URL query values");
  const naturalFailureShard = readJson(naturalFailurePaths.attemptShardPath);
  assert.equal(Object.hasOwn(naturalFailureShard.attempts[0], "failure_detail"), false, "attempt shard schema remains unchanged");

  const missingDateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apewisdom-source-date-missing-"));
  const missingDate = await runApeWisdomAttention({
    ...runnerPaths(missingDateRoot),
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], undefined),
    observedAt: OBSERVED_AT,
    attemptId: "apewisdom-source-date-missing",
    runId: "source-date-missing-run",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(missingDate.reason, "source_date_unavailable");
  assert.equal(missingDate.corrupt, true, "the runner clock must not substitute for a missing provider Date");
  assert.equal(fs.existsSync(path.join(missingDateRoot, "data", "computed", "fenok_social_attention_proxy.json")), false);

  // Deployment continuity: the committed canonical predates provider-bound
  // source_as_of. Its observer-day marker is not eligible for new promotion,
  // but the first provider failure must retain it as an explicitly marked,
  // one-time legacy LKG rather than dropping yesterday's payload.
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apewisdom-legacy-lkg-seed-"));
  const legacyPaths = runnerPaths(legacyRoot);
  const committedCanonical = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    generated_at: "2026-07-23T15:38:42.364Z",
    formula_version: "fenok-social-attention-v0.1-apewisdom",
    source: {
      provider: "ApeWisdom",
      filter: "all-stocks",
      source_url: "https://apewisdom.io/api/v1.0/filter/all-stocks",
      source_date: "20260723",
      pages_collected: 1,
      reported_count: 2,
    },
    rows: [{ ticker: "NVDA", as_of: "20260723" }],
  }, null, 2)}\n`);
  fs.mkdirSync(path.dirname(legacyPaths.canonicalPath), { recursive: true });
  fs.writeFileSync(legacyPaths.canonicalPath, committedCanonical);
  const legacyFailure = await runApeWisdomAttention({
    ...legacyPaths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    controlledFailure: "transport",
    observedAt: "2026-07-24T12:00:00.000Z",
    attemptId: "apewisdom-legacy-controlled-failure",
    runId: "legacy-controlled-failure-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
  });
  assert.equal(legacyFailure.degraded, true, "first post-deploy provider failure retains the committed legacy payload");
  assert.equal(fs.readFileSync(legacyPaths.canonicalPath, "utf8"), committedCanonical.toString("utf8"));
  const legacyStatePath = path.join(legacyRoot, "data", "admin", LANE_ID, "index.json");
  const legacyState = readJson(legacyStatePath);
  assert.equal(legacyState.items.social_attention_proxy.lkg.source_as_of, "2026-07-23T00:00:00.000Z");
  assert.equal(legacyState.items.social_attention_proxy.promotion_contract, undefined,
    "legacy observer date remains an LKG seed, never a provider-observation promotion");
  assert.equal(legacyState.items.social_attention_proxy.provider_observation, undefined);
  const legacyRecovered = await runApeWisdomAttention({
    ...legacyPaths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], "Fri, 24 Jul 2026 13:17:00 GMT"),
    observedAt: "2026-07-24T13:17:00.000Z",
    attemptId: "apewisdom-legacy-natural-recovery",
    runId: "legacy-natural-recovery-run",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(legacyRecovered.ok, true);
  assert.equal(legacyRecovered.recovered, true);
  const recoveredFromLegacy = readJson(legacyPaths.canonicalPath);
  assert.equal(recoveredFromLegacy.source.source_as_of, "2026-07-24T13:17:00.000Z");
  assert.match(recoveredFromLegacy.source.provider_observation_payload_sha256, /^[0-9a-f]{64}$/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apewisdom-lkg-"));
  const paths = runnerPaths(root);
  const initialDate = "Fri, 24 Jul 2026 13:17:00 GMT";
  const initial = await runApeWisdomAttention({
    ...paths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], initialDate),
    observedAt: OBSERVED_AT,
    attemptId: "apewisdom-baseline",
    runId: "baseline-run",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(initial.ok, true);
  const baselineBytes = fs.readFileSync(paths.canonicalPath, "utf8");
  const baselineSnapshot = readJson(paths.canonicalPath);
  assert.equal(baselineSnapshot.source.source_as_of, "2026-07-24T13:17:00.000Z");
  assert.equal(baselineSnapshot.source.source_date, "20260724");
  assert.match(baselineSnapshot.source.provider_observation_payload_sha256, /^[0-9a-f]{64}$/);
  const successShard = readJson(paths.attemptShardPath);
  assert.deepEqual(successShard.attempts[0].assertions.map((assertion) => assertion.id), expectedAssertionIds(LANE_ID),
    "successful endpoint observations retain the registry assertion ids");

  const failed = await runApeWisdomAttention({
    ...paths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    controlledFailure: "transport",
    observedAt: "2026-07-24T14:00:00.000Z",
    attemptId: "apewisdom-controlled-failure",
    runId: "controlled-failure-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.equal(failed.failure_detail, null, "controlled synthetic failures carry no diagnostic detail");
  assert.deepEqual(failed.retrySet, ["social_attention_proxy"]);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), baselineBytes, "provider failure must retain the canonical LKG");
  const statePath = path.join(root, "data", "admin", LANE_ID, "index.json");
  const lkgPath = path.join(root, "data", "admin", LANE_ID, "lkg", "social_attention_proxy.json");
  assert.equal(fs.existsSync(lkgPath), true);
  assert.equal(readJson(statePath).items.social_attention_proxy.resolution_state, "lkg_primary");
  const failureShard = readJson(paths.attemptShardPath);
  assert.equal(validateAttemptShard(failureShard, LANE_ID), true);
  assert.equal(validateAttemptEvidence({ schema_version: "data-supply-detection-attempts/v1", attempts: failureShard.attempts }), true);
  assert.deepEqual(
    failureShard.attempts[0].assertions,
    expectedAssertionIds(LANE_ID).map((id) => ({ id, passed: false })),
    "transport failures retain the endpoint-contract assertion ids with failed verdicts",
  );

  const advancedDate = "Sat, 25 Jul 2026 13:17:00 GMT";
  const dispatched = await runApeWisdomAttention({
    ...paths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], advancedDate),
    observedAt: "2026-07-25T13:17:00.000Z",
    attemptId: "apewisdom-dispatch-recovery",
    runId: "dispatch-recovery-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
  });
  assert.equal(dispatched.reason, "recovery_requires_schedule");
  assert.equal(dispatched.degraded, true);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), baselineBytes, "dispatch may not replace an active LKG");

  const retryAttempt = await runApeWisdomAttention({
    ...paths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], advancedDate),
    observedAt: "2026-07-25T13:18:00.000Z",
    attemptId: "apewisdom-schedule-retry",
    runId: "schedule-retry-run",
    runAttempt: 2,
    eventName: "schedule",
  });
  assert.equal(retryAttempt.reason, "recovery_requires_schedule", "schedule retries are not a natural recovery run");

  const recovered = await runApeWisdomAttention({
    ...paths,
    filter: "all-stocks",
    maxPages: 1,
    tickers: "NVDA,MSFT",
    request: async () => providerResponse(samplePages[0], advancedDate),
    observedAt: "2026-07-25T13:19:00.000Z",
    attemptId: "apewisdom-scheduled-recovery",
    runId: "scheduled-recovery-run",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.social_attention_proxy.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.social_attention_proxy.promotion_contract, "provider_observation/v2");
  assert.equal(recoveredState.items.social_attention_proxy.provider_observation.source_as_of, "2026-07-25T13:17:00.000Z");
}

// --- Workflow contract (owned producer wiring, #366) ------------------------
{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
    "utf8",
  ));
  assert.match(workflow, /node scripts\/test-fetch-fenok-apewisdom-attention-proxy\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fenok-apewisdom-attention-proxy\.mjs/);
  assert.match(workflow, /controlled_failure/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE/);
  assert.deepEqual(
    manifest.workflows[WORKFLOW_REL].stages.success_if_exists,
    [
      {
        kind: "file",
        path: "data/computed/fenok_social_attention_proxy.json",
        required: true,
      },
      {
        kind: "file",
        path: "data/computed/fenok_social_attention_proxy_history.json",
        required: true,
      },
    ],
    "successful ApeWisdom fetch must require both computed outputs",
  );
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
