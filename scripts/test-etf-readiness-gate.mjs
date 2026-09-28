#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildEtfScoringLaneReadiness } from "./lib/etf-readiness-gate.mjs";
import { checkEtfSignalPayload, runEtfSignalGateChecks } from "../100xfenok-next/scripts/check-fenok-etf-signal-gate.mjs";

const greenScoredLane = {
  signalGeneratedAt: "2026-07-26T14:23:44.115Z",
  signalAgeHours: 9.46,
  historyGapGeneratedAt: "2026-07-26T14:24:14.000Z",
  historyGapAgeHours: 9.45,
  maxAgeHours: 48,
  publicReady: true,
  qaGateOk: true,
  classificationAsOf: "2026-07-26T14:23:56.710Z",
  scoredDenominatorCount: 4431,
  exactPlanScoredCount: 4431,
  scoredCompleteDaily1y: 3642,
  scoredFetchableDaily1yGap: 0,
  scoredInceptionLimitedDaily1yGap: 740,
  scoredTerminalLimitedDaily1yGap: 49,
  exactPlanCountEquationOk: true,
  historyGapDaily1yMatches: true,
  fullPrimaryFetchableRequiredHistory: 2,
  fullPrimaryMissingRequiredHistory: 684,
  fullPrimaryInceptionLimitedRequiredHistory: 259,
  fullPrimaryTerminalLimitedRequiredHistory: 423,
  fullPrimaryFetchableRows: [
    { ticker: "OUTSIDE_PLAN_A", missing: ["daily_1y"] },
    { ticker: "OUTSIDE_PLAN_B", missing: ["daily_1y"] },
  ],
};

const dependencyKiller = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  coreArtifactExists: false,
  coreReady: false,
  coreAgeHours: 49,
  coreSelectedCount: 0,
  coreFreshSelectedCount: 0,
  coreStaleSelectedCount: 1,
});

assert.equal(dependencyKiller.dailyReady, true);
assert.equal(dependencyKiller.gatedReady, true);
assert.deepEqual(dependencyKiller.dailyBlockers, []);
assert.deepEqual(dependencyKiller.gatedBlockers, []);
assert.equal(
  dependencyKiller.scoringLaneChecks.some((check) => check.id.includes("core_daily")),
  false,
  "Core Basket must not set, clear, or substitute for full ETF S3",
);
assert.equal(
  dependencyKiller.scoringLaneChecks.some((check) => check.id.includes("required_history")),
  false,
  "full-primary history gaps must not enter the scored-denominator gate",
);

const fullPrimaryDiagnostic = dependencyKiller.diagnosticChecks.find(
  (check) => check.id === "etf_no_fetchable_required_history_gap",
);
assert.equal(fullPrimaryDiagnostic?.ok, false);
assert.equal(fullPrimaryDiagnostic?.missing_required_history, 684);
assert.deepEqual(
  fullPrimaryDiagnostic?.fetchable_rows.map((row) => row.ticker),
  ["OUTSIDE_PLAN_A", "OUTSIDE_PLAN_B"],
);
assert.deepEqual(
  dependencyKiller.gatedChecks.map((check) => check.id),
  [
    "etf_signal_summary_fresh",
    "etf_history_gap_report_fresh",
    "etf_scored_daily_1y_count_equation",
    "etf_no_fetchable_daily_1y_gap",
    "public_surface_proof",
    "qa_fenok_etf_signal_gate",
  ],
);

for (const [label, mutation] of [
  ["Core missing", { coreArtifactExists: false }],
  ["Core stale", { coreAgeHours: 49 }],
  ["Core false", { coreReady: false }],
  ["Core sparse", { coreSelectedCount: 0, coreFreshSelectedCount: 0 }],
]) {
  const mutated = buildEtfScoringLaneReadiness({ ...greenScoredLane, ...mutation });
  assert.equal(mutated.dailyReady, true, `${label} must not flip full ETF S3 daily`);
  assert.equal(mutated.gatedReady, true, `${label} must not flip full ETF S3 gated`);
  console.log(`mutation ${label}: daily=true gated=true core_ignored=true`);
}

const openScoredGap = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  scoredCompleteDaily1y: 3641,
  scoredFetchableDaily1yGap: 1,
});
assert.equal(openScoredGap.dailyReady, false);
assert.equal(openScoredGap.gatedReady, false);
assert.deepEqual(openScoredGap.dailyBlockers, ["etf_no_fetchable_daily_1y_gap"]);

const brokenCountEquation = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  exactPlanScoredCount: 4432,
});
assert.equal(brokenCountEquation.dailyReady, false);
assert.deepEqual(brokenCountEquation.dailyBlockers, ["etf_scored_daily_1y_count_equation"]);

const publicBlocked = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  publicReady: false,
});
assert.equal(publicBlocked.dailyReady, true);
assert.equal(publicBlocked.gatedReady, false);
assert.deepEqual(publicBlocked.gatedBlockers, ["public_surface_proof"]);

const qaBlocked = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  qaGateOk: false,
});
assert.equal(qaBlocked.dailyReady, true);
assert.equal(qaBlocked.gatedReady, false);
assert.deepEqual(qaBlocked.gatedBlockers, ["qa_fenok_etf_signal_gate"]);

console.log("test-etf-readiness-gate: ok");

// ---------------------------------------------------------------------------
// API route delegation proof: runEtfSignalGateChecks must require the real
// route entry to import AND invoke both delegation helpers, plus the helper's
// four semantics and a summary filename read inside getFenokEtfSignalsSummary
// itself. A missing route, a disconnected helper, or a filename mentioned only
// by an unrelated function must still fail.
// ---------------------------------------------------------------------------

const ROUTE_REL = "100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts";
const HELPER_REL = "100xfenok-next/src/lib/server/fenok-etf-signal-route.ts";
const LOADER_REL = "100xfenok-next/src/lib/server/data-loader.ts";
const UI_REL = "100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx";
const SUMMARY_REL = "data/computed/fenok_etf_signals_summary.json";
const PUBLIC_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json";

const GOOD_ROUTE = [
  'import { buildEtfSignalRouteResponse } from "@/lib/server/fenok-etf-signal-route";',
  'import { getFenokEtfSignalsSummary } from "@/lib/server/data-loader";',
  "export async function GET() { return buildEtfSignalRouteResponse(await getFenokEtfSignalsSummary(), \"SPY\"); }",
].join("\n");
const GOOD_HELPER = [
  "fields?: string[]",
  "function normalizeEtfSignalRow() { return Array.isArray(rawRow); }",
  "FENOK_ETF_SIGNAL_NOT_FOUND",
  "export function buildEtfSignalRouteResponse() {}",
].join("\n");
const GOOD_LOADER = [
  "export async function getFenokEtfSignalsSummary(): Promise<FenokEtfSignalsSummaryReadResult> {",
  '  const result = await readDataAsset("/data/computed/fenok_etf_signals_summary.json");',
  "  return result;",
  "}",
].join("\n");
const GOOD_UI = [
  "/api/data/fenok-etf-signals/",
  "Fenok Edge ETF 시그널",
  "ETF_SIGNAL_SCORE_FIELDS",
].join("\n");

function makeFixture(mutate) {
  const root = mkdtempSync(join(tmpdir(), "etf-gate-fx-"));
  const files = {
    [ROUTE_REL]: GOOD_ROUTE,
    [HELPER_REL]: GOOD_HELPER,
    [LOADER_REL]: GOOD_LOADER,
    [UI_REL]: GOOD_UI,
    [SUMMARY_REL]: '{"rows":[]}',
    [PUBLIC_SUMMARY_REL]: '{"rows":[]}',
  };
  if (mutate) mutate(files);
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const fixtureRoots = [];
function fixture(mutate) {
  const root = makeFixture(mutate);
  fixtureRoots.push(root);
  return runEtfSignalGateChecks({ repoRoot: root }).public_surface_proof;
}

// Positive on the real source: route_proof / api_route_ready only — the
// overall `ready` also needs generated public data, which a clean checkout
// does not carry, so it is asserted on the self-contained fixture below.
const currentProof = runEtfSignalGateChecks().public_surface_proof;
assert.equal(currentProof.route_proof?.route_exists, true, "current route entry must exist");
assert.equal(currentProof.route_proof?.route_delegates, true, "current route must import+invoke both helpers");
assert.equal(currentProof.route_proof?.helper_semantics, true, "current helper must carry the four semantics");
assert.equal(currentProof.route_proof?.summary_loader_linkage, true, "current loader must read the summary inside getFenokEtfSignalsSummary");
assert.equal(currentProof.api_route_ready, true, "current delegated layout must satisfy api_route_ready");
console.log("route proof (current delegated layout): ok");

try {
  // Positive: self-contained fixture carries its own mirror/UI data, so
  // overall `ready` is proven without depending on generated checkout state.
  const fixtureOk = fixture();
  assert.equal(fixtureOk.api_route_ready, true);
  assert.equal(fixtureOk.ready, true);

  // Negative 1: missing route entry.
  const missingRoute = fixture((files) => { files[ROUTE_REL] = null; });
  assert.equal(missingRoute.route_proof?.route_exists, false);
  assert.equal(missingRoute.api_route_ready, false);
  assert.equal(missingRoute.ready, false, "missing route must not prove the surface");

  // Negative 2: route exists but is disconnected from the helpers.
  const disconnected = fixture((files) => {
    files[ROUTE_REL] = "export async function GET() { return null; }";
  });
  assert.equal(disconnected.route_proof?.route_exists, true);
  assert.equal(disconnected.route_proof?.route_delegates, false, "route without import+invoke is disconnected");
  assert.equal(disconnected.api_route_ready, false);
  assert.equal(disconnected.ready, false, "disconnected delegation must not prove the surface");

  // Negative 3: helper missing one of the four semantics.
  const missingHelperSemantic = fixture((files) => {
    files[HELPER_REL] = GOOD_HELPER.replace("FENOK_ETF_SIGNAL_NOT_FOUND", "SOMETHING_ELSE");
  });
  assert.equal(missingHelperSemantic.route_proof?.route_delegates, true);
  assert.equal(missingHelperSemantic.route_proof?.helper_semantics, false);
  assert.equal(missingHelperSemantic.api_route_ready, false);
  assert.equal(missingHelperSemantic.ready, false, "missing helper semantic must not prove the surface");

  // Negative 4: getFenokEtfSignalsSummary without the summary filename.
  const missingLoader = fixture((files) => {
    files[LOADER_REL] = "export async function getFenokEtfSignalsSummary() { return null; }";
  });
  assert.equal(missingLoader.route_proof?.route_delegates, true);
  assert.equal(missingLoader.route_proof?.summary_loader_linkage, false);
  assert.equal(missingLoader.api_route_ready, false);
  assert.equal(missingLoader.ready, false, "missing summary loader proof must not prove the surface");

  // Negative 5: filename exists only in an unrelated function — not linkage.
  const unrelatedFunction = fixture((files) => {
    files[LOADER_REL] = [
      "export function readSomeOtherAsset() { return '/data/computed/fenok_etf_signals_summary.json'; }",
      "export async function getFenokEtfSignalsSummary() { return null; }",
    ].join("\n");
  });
  assert.equal(unrelatedFunction.route_proof?.route_delegates, true);
  assert.equal(unrelatedFunction.route_proof?.summary_loader_linkage, false,
    "filename in an unrelated function is not summary-loader linkage");
  assert.equal(unrelatedFunction.api_route_ready, false);
  assert.equal(unrelatedFunction.ready, false, "unrelated filename mention must not prove the surface");

  // Negative 6: non-exported function AFTER the loader carries the filename
  // while the loader itself has no read — an export-delimited span would have
  // passed via that trailing function; the first-statement window must not.
  const trailingSmuggle = fixture((files) => {
    files[LOADER_REL] = [
      "export async function getFenokEtfSignalsSummary() { return null; }",
      "function smuggleTheFilename() { return '/data/computed/fenok_etf_signals_summary.json'; }",
    ].join("\n");
  });
  assert.equal(trailingSmuggle.route_proof?.route_delegates, true);
  assert.equal(trailingSmuggle.route_proof?.summary_loader_linkage, false,
    "non-exported function after the loader cannot supply the filename");
  assert.equal(trailingSmuggle.api_route_ready, false);
  assert.equal(trailingSmuggle.ready, false, "trailing filename cannot prove the surface");

  // Negative 7: filename-only-without-read — the loader's first statement
  // mentions the file but never awaits readDataAsset.
  const filenameWithoutRead = fixture((files) => {
    files[LOADER_REL] = [
      "export async function getFenokEtfSignalsSummary(): Promise<FenokEtfSignalsSummaryReadResult> {",
      "  const note = \"fenok_etf_signals_summary.json\";",
      "  return note;",
      "}",
    ].join("\n");
  });
  assert.equal(filenameWithoutRead.route_proof?.route_delegates, true);
  assert.equal(filenameWithoutRead.route_proof?.summary_loader_linkage, false,
    "filename without an await readDataAsset first statement is not linkage");
  assert.equal(filenameWithoutRead.api_route_ready, false);
  assert.equal(filenameWithoutRead.ready, false, "filename-without-read must not prove the surface");

  console.log("route proof (delegation regression cases): ok");
} finally {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
}

// signal_definitions public contract: exact top-level allowlist plus
// the intended shape — tracking_quality {label, meaning} only, no private/raw
// nested data. Numerical/row/privacy checks above stay untouched.
{
  const currentSummary = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "data", "computed", "fenok_etf_signals_summary.json"),
      "utf8",
    ),
  );
  const check = (payload) => {
    const errors = [];
    checkEtfSignalPayload(payload, payload.__name ?? "signal_definitions fixture", new Set(), errors, [], { publicSummary: true });
    return errors;
  };
  const cloneWith = (mutate, name) => {
    const payload = structuredClone(currentSummary);
    payload.__name = name;
    mutate(payload);
    delete payload.__name;
    return payload;
  };

  // Positive: current shipped summary satisfies the full public contract.
  assert.deepEqual(
    check(structuredClone(currentSummary)),
    [],
    "current summary must pass every public payload check including signal_definitions",
  );

  // Negative: missing definitions -> exact top-level allowlist rejects it.
  const missingErrors = check(cloneWith((p) => { delete p.signal_definitions; }, "missing definitions"));
  assert.ok(
    missingErrors.some((e) => e.includes("unexpected or missing public top-level field")),
    "missing signal_definitions must be rejected",
  );

  // Negative: malformed shape (tracking_quality with unexpected keys).
  const malformedShapeErrors = check(cloneWith((p) => {
    p.signal_definitions = { tracking_quality: { label: "베타·이력 점수", benchmark_error_rate: 0.01 } };
  }, "malformed definitions shape"));
  assert.ok(
    malformedShapeErrors.some((e) => e.includes("signal_definitions")),
    "malformed signal_definitions shape must be rejected",
  );

  // Negative: malformed content (empty label must not pass as nonempty string).
  const malformedContentErrors = check(cloneWith((p) => {
    p.signal_definitions.tracking_quality = { label: " ", meaning: "Mean of beta proximity." };
  }, "malformed definitions content"));
  assert.ok(
    malformedContentErrors.some((e) => e.includes("signal_definitions")),
    "empty-label signal_definitions must be rejected",
  );

  // Negative: unexpected extra top-level field.
  const extraTopErrors = check(cloneWith((p) => { p.private_debug = { raw: true }; }, "unexpected top-level field"));
  assert.ok(
    extraTopErrors.some((e) => e.includes("unexpected or missing public top-level field")),
    "unexpected top-level field must be rejected",
  );

  // Negative: unexpected nested field inside tracking_quality.
  const extraNestedErrors = check(cloneWith((p) => {
    p.signal_definitions.tracking_quality.raw_scores = [1, 2, 3];
  }, "unexpected nested field"));
  assert.ok(
    extraNestedErrors.some((e) => e.includes("signal_definitions")),
    "unexpected nested field inside signal_definitions must be rejected",
  );

  console.log("signal_definitions public contract: ok");
}
