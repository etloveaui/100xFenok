#!/usr/bin/env node
// LKG recovery adoption for the SEC EDGAR filing-timeline lane.
//
// Mirrors the finra/yardeni recovery contract, adapted for a weekly poll_only
// source (no market calendar; a quiet week is a valid poll, never a failure):
//   (a) a full clean poll promotes the freshness marker (max eligible
//       filingDate + coverage + tree digest) under provider_observation/v2,
//   (b) a clean poll with no newer filingDate is EXPECTED ABSENCE (not_newer),
//   (c) a partial poll (any ticker endpoint fails) retains the prior marker and
//       parks retry — degraded, exit 0 — while partial manifests still publish,
//   (d) a workflow_dispatch full success cannot promote a recovery (natural gate),
//   (e) a systemic class (rate limit) or an unprovable LKG is corruption (exit != 0),
//   (f) corrupt candidates are rejected fail-closed,
//   (g) the index the store writes round-trips through the KPI recovery validator.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEdgarFreshnessMarker,
  CLI_RUN_OPTIONS,
  edgarMarkerPathFor,
  edgarMarkerSourceAsOf,
  runEdgarFilingTimeline,
  validEdgarFreshnessMarker,
  EDGAR_LANE_ID,
  EDGAR_LKG_KEY,
} from "./build-edgar-filing-timeline.mjs";
import {
  projectRecoveryRecoveredSet,
  projectRecoveryRetrySet,
} from "./build-fenok-data-health-kpi.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

function response(statusCode, document) {
  return { statusCode, body: typeof document === "string" ? document : JSON.stringify(document) };
}

function pathsFor(root) {
  return {
    analyzerPath: path.join(root, "data/global-scouter/core/stocks_analyzer.json"),
    edgarCachePath: path.join(root, "data/edgar/company_tickers.json"),
    summaryRoot: path.join(root, "data/edgar-korean-summaries"),
    publicSummaryRoot: path.join(root, "100xfenok-next/public/data/edgar-korean-summaries"),
    attemptShardPath: path.join(root, "data/admin/data-supply-state/detection-attempts/edgar_filings.json"),
  };
}

function writeAnalyzer(root) {
  const file = pathsFor(root).analyzerPath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    data: [
      { country: "US", symbol: "NVDA" },
      { country: "US", symbol: "AAPL" },
    ],
  }), "utf8");
}

function companyTickers() {
  return {
    0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
    1: { cik_str: 320193, ticker: "AAPL", title: "APPLE INC" },
  };
}

function submissions(name, accession, filingDate) {
  return {
    name,
    filings: {
      recent: {
        form: ["10-Q"],
        accessionNumber: [accession],
        primaryDocument: ["doc.htm"],
        filingDate: [filingDate],
        reportDate: [filingDate],
      },
    },
  };
}

// Two provider generations: 2026-07-14 is the newest eligible filingDate in
// gen1; 2026-07-20 arrives in gen2 (the weekly advance).
const GEN1 = {
  NVDA: submissions("NVIDIA CORP", "0001045810-26-000001", "2026-07-14"),
  AAPL: submissions("APPLE INC", "0000320193-26-000001", "2026-07-14"),
};
const GEN2 = {
  NVDA: submissions("NVIDIA CORP", "0001045810-26-000002", "2026-07-20"),
  AAPL: submissions("APPLE INC", "0000320193-26-000002", "2026-07-20"),
};

function requestFor(gen, failures = {}) {
  return async (url) => {
    if (url.includes("company_tickers")) return response(200, companyTickers());
    if (url.includes("CIK0001045810")) return failures.NVDA ?? response(200, gen.NVDA);
    if (url.includes("CIK0000320193")) return failures.AAPL ?? response(200, gen.AAPL);
    throw new Error(`unexpected url: ${url}`);
  };
}

function naturalRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "schedule", observedAt };
}
function dispatchRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "workflow_dispatch", observedAt };
}

function makeRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `edgar-lkg-${tag}-`));
  writeAnalyzer(root);
  return root;
}
function indexPath(root) {
  return path.join(root, "data", "admin", EDGAR_LANE_ID, "index.json");
}
function lkgPath(root) {
  return path.join(root, "data", "admin", EDGAR_LANE_ID, "lkg", `${EDGAR_LKG_KEY}.json`);
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function markerSourceAsOf(root) {
  const marker = readJson(edgarMarkerPathFor(root));
  assert.equal(validEdgarFreshnessMarker(marker), true, "persisted freshness marker must be valid");
  return marker.source_as_of;
}

function runLane(root, { gen, failures, request, run, controlledFailureKey = "" }) {
  return runEdgarFilingTimeline({
    argv: ["--sleep", "0"],
    paths: pathsFor(root),
    request: request ?? requestFor(gen, failures),
    observedAt: run.observedAt,
    lkgRepoRoot: root,
    runId: run.runId,
    runAttempt: run.runAttempt,
    eventName: run.eventName,
    controlledFailureKey,
  });
}

// --- Detection-floor lane registration -------------------------------------
{
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === EDGAR_LANE_ID);
  assert.ok(lane, "edgar_filings must be a registered detection lane");
  assert.equal(lane.enforcement, "live", "edgar_filings lane is live; the recovery store depends on it staying live");
  assert.equal(lane.kpi_required, true);
}

// --- (a)-(d),(g) full failure -> LKG -> recovery cycle, via the producer -----
{
  const root = makeRoot("cycle");

  // (a) full clean poll seeds the marker
  const seed = await runLane(root, { gen: GEN1, run: naturalRun("seed-run", "2026-07-14T00:40:00Z") });
  assert.equal(seed.ok, true);
  assert.equal(seed.lkg.kind, "success");
  assert.equal(seed.lkg.updated, true);
  assert.equal(markerSourceAsOf(root), "2026-07-14");
  const afterSeed = readJson(indexPath(root));
  assert.deepEqual(afterSeed.retry_set, []);
  const seedItem = afterSeed.items[EDGAR_LKG_KEY];
  assert.equal(seedItem.resolution_state, "fresh_primary");
  assert.equal(seedItem.promotion_contract, "provider_observation/v2");
  assert.equal(seedItem.provider_observation.run_id, "seed-run");
  const seedMarker = readJson(edgarMarkerPathFor(root));
  assert.equal(seedMarker.coverage.tickers_total, 2);
  assert.equal(seedMarker.coverage.filings_total, 2);
  assert.equal(seedMarker.raw_public, false, "control-plane marker stays admin-private even though SEC content is public");
  assert.equal(seedMarker.public_mirror_allowed, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(seedMarker, "filings"), "marker carries no filing rows");

  // (b) quiet week: a clean poll with no newer filingDate is expected absence
  const quiet = await runLane(root, { gen: GEN1, run: naturalRun("quiet-week-run", "2026-07-15T00:40:00Z") });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.lkg.kind, "not_newer");
  assert.equal(quiet.lkg.updated, false);
  const afterQuiet = readJson(indexPath(root));
  assert.deepEqual(afterQuiet.retry_set, [], "a quiet week must not park the lane in retry");
  assert.equal(afterQuiet.items[EDGAR_LKG_KEY].resolution_state, "fresh_primary");

  // (c) a partial poll retains the prior marker and parks retry, degraded exit 0
  const partial = await runLane(root, {
    gen: GEN1,
    failures: { AAPL: response(500, "provider failed") },
    run: naturalRun("partial-run", "2026-07-16T00:40:00Z"),
  });
  assert.equal(partial.ok, true, "one valid ticker keeps publishable producer output");
  assert.equal(partial.lkg.kind, "failure");
  assert.equal(partial.lkg.reason, "http_error");
  assert.equal(partial.lkg.degraded, true);
  assert.equal(partial.lkg.corrupt, false);
  assert.equal(partial.lkg.exitCode, 0);
  assert.deepEqual(partial.lkg.retrySet, [EDGAR_LKG_KEY]);
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a partial poll must not overwrite the freshness marker");
  const retained = readJson(indexPath(root));
  assert.equal(retained.items[EDGAR_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(retained.items[EDGAR_LKG_KEY].latest_failure.run_id, "partial-run");
  assert.deepEqual(readJson(lkgPath(root)), seedMarker, "only the public-safe freshness marker is retained");

  // (g) the retry-state index round-trips through the KPI validator
  const retrySet = projectRecoveryRetrySet(retained, EDGAR_LANE_ID);
  assert.equal(retrySet.length, 1);
  assert.equal(retrySet[0].key, EDGAR_LKG_KEY);
  assert.equal(retrySet[0].failure_run_id, "partial-run");

  // same-source natural poll cannot recover (provider filingDate not advanced)
  const sameSource = await runLane(root, { gen: GEN1, run: naturalRun("same-source-run", "2026-07-17T00:40:00Z") });
  assert.equal(sameSource.ok, true);
  assert.equal(sameSource.lkg.kind, "not_promotable");
  assert.equal(sameSource.lkg.reason, "recovery_not_advanced_by_provider");
  const deferred = readJson(indexPath(root)).items[EDGAR_LKG_KEY];
  assert.equal(deferred.latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  assert.equal(deferred.latest_promotion_deferral.run_id, "same-source-run");

  // (d) a workflow_dispatch full success cannot promote a recovery (natural gate)
  const dispatchAttempt = await runLane(root, { gen: GEN2, run: dispatchRun("manual-run", "2026-07-17T12:00:00Z") });
  assert.equal(dispatchAttempt.ok, true);
  assert.equal(dispatchAttempt.lkg.kind, "recovery_requires_schedule");
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a dispatch run must not advance recovery");
  assert.equal(readJson(indexPath(root)).items[EDGAR_LKG_KEY].resolution_state, "lkg_primary");

  // (a,c) natural-schedule full poll with an advanced provider filingDate recovers
  const recovered = await runLane(root, { gen: GEN2, run: naturalRun("natural-recovery-run", "2026-07-21T00:40:00Z") });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lkg.kind, "success");
  assert.equal(recovered.lkg.recovered, true);
  assert.equal(markerSourceAsOf(root), "2026-07-20", "recovery advances the freshness anchor");

  const finalState = readJson(indexPath(root));
  assert.deepEqual(finalState.retry_set, []);
  const item = finalState.items[EDGAR_LKG_KEY];
  assert.equal(item.resolution_state, "fresh_primary");
  assert.equal(item.recovered_from_run_id, "partial-run");
  assert.equal(item.recovery_run_id, "natural-recovery-run");
  assert.equal(item.recovery_event_name, "schedule");
  assert.equal(item.last_recovered_failure.reason, "http_error");

  // (g) the recovered-state index round-trips through the KPI validator
  const recoveredSet = projectRecoveryRecoveredSet(finalState, EDGAR_LANE_ID);
  assert.equal(recoveredSet.length, 1);
  assert.equal(recoveredSet[0].key, EDGAR_LKG_KEY);
  assert.equal(recoveredSet[0].recovered_from_run_id, "partial-run");
  assert.equal(recoveredSet[0].recovery_event_name, "schedule");
  assert.equal(recoveredSet[0].lkg_source_as_of, "2026-07-14");
  assert.equal(recoveredSet[0].source_as_of, "2026-07-20");
}

// --- (e) a systemic break is corruption, not degradation ----------------------
{
  const root = makeRoot("systemic");
  const seed = await runLane(root, { gen: GEN1, run: naturalRun("seed-run", "2026-07-14T00:40:00Z") });
  assert.equal(seed.lkg.kind, "success");
  await assert.rejects(
    () => runLane(root, {
      gen: GEN1,
      failures: { AAPL: response(429, "rate limited") },
      run: naturalRun("rate-limit-run", "2026-07-16T00:40:00Z"),
    }),
    /EDGAR LKG failure is corrupt: rate_limited/,
    "a systemic class exits non-zero even with a retained LKG",
  );
  const state = readJson(indexPath(root));
  assert.equal(state.items[EDGAR_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(state.items[EDGAR_LKG_KEY].latest_failure.reason, "rate_limited");
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a systemic failure must not overwrite the freshness marker");
}

// --- (e) a due-poll bootstrap failure retains the marker ---------------------
{
  const root = makeRoot("bootstrap");
  const seed = await runLane(root, { gen: GEN1, run: naturalRun("seed-run", "2026-07-14T00:40:00Z") });
  assert.equal(seed.lkg.kind, "success");
  const result = await runLane(root, {
    request: async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); },
    run: naturalRun("transport-run", "2026-07-16T00:40:00Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.lkg.kind, "failure");
  assert.equal(result.lkg.degraded, true);
  assert.equal(result.lkg.corrupt, false);
  assert.equal(result.lkg.exitCode, 0, "a transport failure with a valid LKG is degraded, exit 0");
  assert.equal(markerSourceAsOf(root), "2026-07-14");
}

// --- (f) corrupt or unprovable states are rejected fail-closed ---------------
{
  // First-ever failure with no provable LKG = corruption, never pretend-degraded.
  const root = makeRoot("corrupt");
  await assert.rejects(
    () => runLane(root, {
      gen: GEN1,
      failures: { NVDA: response(500, "x"), AAPL: response(500, "x") },
      run: naturalRun("total-failure-run", "2026-07-14T00:40:00Z"),
    }),
    /EDGAR LKG failure is corrupt/,
  );
  assert.equal(readJson(indexPath(root)).items[EDGAR_LKG_KEY].resolution_state, "unavailable");

  // A candidate whose claimed source marker is not payload-bound is rejected by
  // the store's own validator before any state mutation.
  const store = new LaneLkgStore({ repoRoot: makeRoot("candidate"), laneId: EDGAR_LANE_ID });
  const manifests = new Map([["NVDA", {
    filings: [{ ticker: "NVDA", accession: "a1", filingDate: "2026-07-14" }],
  }]]);
  const marker = buildEdgarFreshnessMarker({ manifests, stats: { fetched: 1, resolved: 1 }, generatedAt: "2026-07-14T00:40:00Z" });
  const forged = {
    key: EDGAR_LKG_KEY,
    currentRelativePath: "data/admin/edgar_filings/current/edgar_filings.json",
    payloadBytes: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, "utf8"),
    sourceAsOf: "2099-01-01",
    validateDocument: validEdgarFreshnessMarker,
    deriveSourceAsOf: edgarMarkerSourceAsOf,
    promotion_contract: "legacy_source_marker/v1",
  };
  assert.throws(
    () => store.evaluatePromotionCandidates([forged], { runId: "forged-run", runAttempt: 1, eventName: "schedule", observedAt: "2026-07-14T00:40:00Z" }),
    /not payload-bound/,
  );
}

// --- engagement gates: manual/plan/full-universe runs never touch the store --
{
  const root = makeRoot("gates");
  const base = {
    paths: pathsFor(root),
    request: requestFor(GEN1),
    observedAt: "2026-07-14T00:40:00Z",
    lkgRepoRoot: root,
    runId: "gate-run",
    runAttempt: 1,
    eventName: "schedule",
  };
  const subset = await runEdgarFilingTimeline({ ...base, argv: ["--sleep", "0", "--tickers", "NVDA"] });
  assert.equal(subset.ok, true);
  assert.equal(subset.lkg, null, "--tickers subset polls never touch the store");
  const plan = await runEdgarFilingTimeline({ ...base, argv: ["--sleep", "0", "--plan-only"] });
  assert.equal(plan.lkg, null, "--plan-only never touches the store");
  const full = await runEdgarFilingTimeline({ ...base, argv: ["--sleep", "0", "--full-universe"] });
  assert.equal(full.lkg, null, "--full-universe dispatches never touch the store");
  assert.equal(fs.existsSync(indexPath(root)), false, "no recovery state is written by gated runs");

  const noStore = await runEdgarFilingTimeline({
    paths: pathsFor(makeRoot("inert")),
    request: requestFor(GEN1),
    observedAt: "2026-07-14T00:40:00Z",
    argv: ["--sleep", "0"],
  });
  assert.equal(noStore.ok, true);
  assert.equal(noStore.lkg, null, "no lkgRepoRoot -> the store is never touched");
}

// --- chaos injection: dispatch-only, through the real failure paths ----------
{
  // injection on schedule/local events is rejected in code
  const root0 = makeRoot("chaos-reject");
  await assert.rejects(
    () => runLane(root0, { gen: GEN1, run: naturalRun("sched-run", "2026-07-14T00:40:00Z"), controlledFailureKey: "edgar_filings" }),
    /controlled failure requires workflow_dispatch/,
    "schedule events must reject injection in code",
  );
  await assert.rejects(
    () => runLane(root0, { gen: GEN1, run: { runId: "local-run", runAttempt: 1, eventName: "local", observedAt: "2026-07-14T00:40:00Z" }, controlledFailureKey: "bootstrap" }),
    /requires workflow_dispatch/,
    "local events must reject injection in code",
  );
  await assert.rejects(
    () => runLane(root0, { gen: GEN1, run: dispatchRun("bad-key-run", "2026-07-14T00:40:00Z"), controlledFailureKey: "not_a_key" }),
    /unknown controlled EDGAR key/,
    "unknown tokens are rejected in code",
  );
  assert.equal(fs.existsSync(indexPath(root0)), false, "rejected injections never touch the store");

  // chaos cycle via the partial path: one ticker injected, marker retained
  const root = makeRoot("chaos-partial");
  const seed = await runLane(root, { gen: GEN1, run: naturalRun("seed-run", "2026-07-14T00:40:00Z") });
  assert.equal(seed.lkg.kind, "success");
  const chaos = await runLane(root, { gen: GEN1, run: dispatchRun("chaos-run", "2026-07-18T10:00:00Z"), controlledFailureKey: "edgar_filings" });
  assert.equal(chaos.ok, true, "one surviving ticker keeps the run publishable");
  assert.equal(chaos.lkg.kind, "failure");
  assert.equal(chaos.lkg.reason, "transport_error", "injection rides the real transport-error path");
  assert.equal(chaos.lkg.degraded, true);
  assert.equal(chaos.lkg.exitCode, 0);
  assert.deepEqual(chaos.lkg.retrySet, [EDGAR_LKG_KEY]);
  assert.equal(markerSourceAsOf(root), "2026-07-14", "chaos must not overwrite the freshness marker");
  assert.equal(readJson(indexPath(root)).items[EDGAR_LKG_KEY].latest_failure.run_id, "chaos-run");

  const recovered = await runLane(root, { gen: GEN2, run: naturalRun("natural-recovery-run", "2026-07-21T00:40:00Z") });
  assert.equal(recovered.lkg.kind, "success");
  assert.equal(recovered.lkg.recovered, true);
  const item = readJson(indexPath(root)).items[EDGAR_LKG_KEY];
  assert.equal(item.recovered_from_run_id, "chaos-run");
  assert.equal(item.recovery_run_id, "natural-recovery-run");
  assert.equal(item.recovery_event_name, "schedule");

  // chaos cycle via the bootstrap path: the whole poll fails, marker retained
  const rootB = makeRoot("chaos-bootstrap");
  const seedB = await runLane(rootB, { gen: GEN1, run: naturalRun("seed-run", "2026-07-14T00:40:00Z") });
  assert.equal(seedB.lkg.kind, "success");
  const chaosB = await runLane(rootB, { gen: GEN1, run: dispatchRun("chaos-bootstrap-run", "2026-07-18T10:00:00Z"), controlledFailureKey: "bootstrap" });
  assert.equal(chaosB.ok, false);
  assert.equal(chaosB.lkg.kind, "failure");
  assert.equal(chaosB.lkg.reason, "transport_error");
  assert.equal(chaosB.lkg.degraded, true);
  assert.equal(chaosB.lkg.exitCode, 0);
  assert.equal(markerSourceAsOf(rootB), "2026-07-14");

  // a dispatch WITHOUT the token is a normal run (byte-stable behavior)
  const plain = await runLane(rootB, { gen: GEN1, run: dispatchRun("plain-dispatch", "2026-07-18T11:00:00Z") });
  assert.equal(plain.ok, true);
  assert.equal(plain.lkg.kind, "recovery_requires_schedule", "no injection = no chaos; a plain dispatch just defers recovery to the natural gate");
}

// --- CLI-vs-library engagement parity (the inert-store class) -----------------
// The production CLI must engage the LKG store by default; library callers opt
// in explicitly. A bare runEdgarFilingTimeline() call lands the store inert
// (proven live by injection run 29642839382, which fired correctly and
// committed nothing). This pin must fail if the entry ever drops lkgRepoRoot.
{
  const producerPath = new URL("./build-edgar-filing-timeline.mjs", import.meta.url);
  const expectedRoot = path.resolve(path.dirname(producerPath.pathname), "..");
  assert.equal(CLI_RUN_OPTIONS.lkgRepoRoot, expectedRoot, "CLI options must bind the store to the repo root");
  assert.notEqual(CLI_RUN_OPTIONS.lkgRepoRoot, null, "CLI must engage the LKG store by default");
  const source = fs.readFileSync(producerPath, "utf8");
  assert.match(source, /runEdgarFilingTimeline\(CLI_RUN_OPTIONS\)/, "the CLI entry must pass CLI_RUN_OPTIONS");
  assert.doesNotMatch(source, /runEdgarFilingTimeline\(\)\.then/, "a bare CLI call leaves the store inert (the 29642839382 class)");
}

// --- Lane Registry ⇄ commit-shard completeness gate (#366 step 4) -----------
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-edgar-filings.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-edgar-filings.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes, ["edgar_filings"], "the registry must attribute this lane to fetch-edgar-filings.yml");
  assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflowText, /--stage always_if_exists/);
  assert.match(
    workflowText,
    /if \[ "\$\{EDGAR_PLAN_ONLY:-false\}" != "true" \] && \[ "\$FETCH_OUTCOME" = "success" \] && \[ "\$VERIFY_OUTCOME" = "success" \]; then[\s\S]*?scripts\/stage-lane-manifest\.sh[\s\S]*?--stage success_if_exists[\s\S]*?git add --/,
    "EDGAR directories must be manifest-staged inside the verified non-plan success branch",
  );
}

console.log("test-build-edgar-lkg-recovery: ok");
