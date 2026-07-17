// deploy-provenance — bind the live Worker bundle to the CI run that shipped it.
//
// Purpose: a deploy run that is cancelled (or dies) AFTER `wrangler deploy` but
// BEFORE its smokes leaves the live Worker serving a bundle no smoke ever
// verified, while the CI ledger records no green (BACKLOG #361, incident
// 2026-07-16: cancelled run 29502469123 served ~15h unverified). This module is
// the pure-logic core for three call sites:
//   1. scripts/write-deploy-provenance.mjs — stamps run identity into the bundle
//   2. scripts/check-live-deploy-provenance.mjs — classifies the CURRENT live
//      bundle's provenance before (and after) a deploy
//   3. scripts/check-deploy-supersession.mjs — decides whether a queued deploy
//      job may skip itself because a newer run exists
//
// Contract rules (DEC-264/DEC-266):
//   - Detection never blocks remediation: an unverified live bundle is named
//     loudly and the current run still deploys over it (exit 0).
//   - No runtime inference of identity: provenance is DECLARED in the bundle by
//     the run that built it; absence is reported as legacy, never guessed.

export const DEPLOY_PROVENANCE_SCHEMA = "deploy-provenance/v1";
export const DEPLOY_PROVENANCE_PUBLIC_PATH = "data/admin/deploy-provenance.json";

// Conclusions that mean "this run's smokes never passed".
const UNVERIFIED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
]);

export function buildDeployProvenance({
  buildId,
  builtAt,
  repository,
  runAttempt,
  runId,
  runNumber,
  serverUrl,
  sha,
}) {
  if (typeof buildId !== "string" || buildId.length === 0) {
    throw new Error("deploy provenance requires a non-empty build id");
  }
  for (const [name, value] of Object.entries({ repository, runId, sha })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`deploy provenance requires a non-empty ${name}`);
    }
  }
  const attempt = Number.parseInt(String(runAttempt ?? "1"), 10);
  const number = Number.parseInt(String(runNumber ?? "0"), 10);
  if (!Number.isFinite(attempt) || attempt < 1) {
    throw new Error("deploy provenance requires run_attempt >= 1");
  }
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("deploy provenance requires run_number >= 0");
  }
  const base = typeof serverUrl === "string" && serverUrl.length > 0
    ? serverUrl.replace(/\/+$/, "")
    : "https://github.com";
  return {
    schema_version: DEPLOY_PROVENANCE_SCHEMA,
    build_id: buildId,
    built_at: builtAt ?? new Date().toISOString(),
    repository,
    run_id: String(runId),
    run_attempt: attempt,
    run_number: number,
    sha,
    run_url: `${base}/${repository}/actions/runs/${runId}`,
  };
}

export function isDeployProvenance(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.schema_version === DEPLOY_PROVENANCE_SCHEMA
      && typeof value.build_id === "string"
      && value.build_id.length > 0
      && typeof value.run_id === "string"
      && value.run_id.length > 0,
  );
}

// Classify the currently-live bundle relative to the run about to deploy.
// Returns { verdict, annotation, detail } where annotation is one of
// "notice" | "warning" | "error" (the GitHub annotation level to emit).
// Every verdict is non-blocking by design; the caller decides presentation.
export function classifyLiveProvenance({
  apiAvailable = true,
  currentRunId,
  expectedBuildId,
  liveBuildId = null,
  liveProvenance = null,
  liveRunConclusion = null,
}) {
  if (typeof currentRunId !== "string" || currentRunId.length === 0) {
    throw new Error("classifyLiveProvenance requires currentRunId");
  }
  if (typeof expectedBuildId !== "string" || expectedBuildId.length === 0) {
    throw new Error("classifyLiveProvenance requires expectedBuildId");
  }

  if (liveBuildId === expectedBuildId) {
    // The deploy step's own reused-BUILD_ID guard handles this as a hard error;
    // classify it so callers can route to that guard instead of double-reporting.
    return {
      verdict: "own-bundle",
      annotation: "error",
      detail: "live bundle already carries this run's BUILD_ID (identity ambiguous)",
    };
  }

  if (!isDeployProvenance(liveProvenance)) {
    return {
      verdict: "legacy-unprovenanced",
      annotation: "warning",
      detail:
        "live bundle carries no deploy-provenance/v1 stamp (pre-contract bundle); "
        + "verification status of the current live bundle is unknowable from here",
    };
  }

  if (liveProvenance.build_id !== liveBuildId) {
    return {
      verdict: "provenance-mismatch",
      annotation: "error",
      detail:
        `live provenance build_id ${liveProvenance.build_id} != live BUILD_ID ${liveBuildId}; `
        + "serving surface and its identity stamp disagree",
    };
  }

  if (liveProvenance.run_id === currentRunId) {
    return {
      verdict: "own-run-bundle",
      annotation: "warning",
      detail:
        "live bundle was uploaded by this same run (earlier attempt); "
        + "its smokes may not have completed — this attempt re-verifies",
    };
  }

  if (!apiAvailable) {
    return {
      verdict: "api-unavailable",
      annotation: "warning",
      detail:
        `live bundle belongs to run ${liveProvenance.run_id} but the GitHub API was `
        + "unreachable; cannot prove whether that run's smokes passed",
    };
  }

  if (liveRunConclusion === "success") {
    return {
      verdict: "verified-predecessor",
      annotation: "notice",
      detail: `live bundle belongs to run ${liveProvenance.run_id} whose smokes passed`,
    };
  }

  if (liveRunConclusion === null || UNVERIFIED_CONCLUSIONS.has(liveRunConclusion)) {
    return {
      verdict: "unverified-serving",
      annotation: "error",
      detail:
        `live bundle belongs to run ${liveProvenance.run_id} `
        + `(conclusion: ${liveRunConclusion ?? "not found"}) — it has been serving `
        + "WITHOUT a passed smoke; this run deploys over it and names it here",
    };
  }

  return {
    verdict: "predecessor-inconclusive",
    annotation: "warning",
    detail:
      `live bundle belongs to run ${liveProvenance.run_id} `
      + `(conclusion: ${String(liveRunConclusion)}); treating as unproven`,
  };
}

// Given the workflow's recent runs, decide whether THIS run's deploy job may
// skip itself because a newer run is active (queued supersession: the deploy
// job is cancel-in-progress:false, so skipping must happen BEFORE any upload,
// never after — a superseded skip is only ever a no-op).
// Returns the newest active run object, or null when this run is the newest
// active one. "Active" = not completed; a completed newer run (even failed) is
// ignored so this run still ships its bundle.
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "pending",
  "waiting",
  "requested",
]);

// Supersession candidates are branch-scoped: a run dispatched from a non-main
// branch must never skip a main deploy (review condition for #361).
export function filterRunsByHeadBranch(runs, branch) {
  if (!Array.isArray(runs)) {
    throw new Error("filterRunsByHeadBranch requires an array of runs");
  }
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error("filterRunsByHeadBranch requires a branch name");
  }
  return runs.filter((run) => run && run.head_branch === branch);
}

// Evaluate one post-deploy observation of the live surface against this run.
// Cloudflare edges roll over gradually, so right after a deploy the /BUILD_ID
// asset and the provenance asset can disagree for seconds (first-live proof
// 2026-07-17: identity match on one edge, stale BUILD_ID + fresh provenance
// on another ~1s later — run 29559387354). The caller POLLS this evaluation
// until match or deadline; each non-match kind maps to one terminal error.
export function evaluatePostObservation({ currentRunId, expectedBuildId, liveBuildId, liveProvenance }) {
  if (typeof expectedBuildId !== "string" || expectedBuildId.length === 0) {
    throw new Error("evaluatePostObservation requires expectedBuildId");
  }
  if (!isDeployProvenance(liveProvenance)) {
    return {
      match: false,
      kind: "missing",
      detail:
        `post-deploy provenance missing or invalid at ${DEPLOY_PROVENANCE_PUBLIC_PATH}; `
        + "the bundle live now does not declare which run shipped it",
    };
  }
  if (liveBuildId !== expectedBuildId || liveProvenance.build_id !== expectedBuildId) {
    return {
      match: false,
      kind: "build-mismatch",
      detail:
        `post-deploy provenance build mismatch: live BUILD_ID=${liveBuildId} `
        + `provenance.build_id=${liveProvenance.build_id} expected=${expectedBuildId}`,
    };
  }
  if (liveProvenance.run_id !== currentRunId) {
    return {
      match: false,
      kind: "run-mismatch",
      detail:
        `post-deploy provenance run mismatch: live bundle was shipped by run `
        + `${liveProvenance.run_id}, expected this run ${currentRunId} — the serving `
        + "surface moved under this deploy between upload and verification",
    };
  }
  return { match: true, kind: "match", detail: "live bundle declared by this run" };
}

export function selectNewerActiveRun({ currentRunId, currentRunNumber, runs }) {
  if (!Number.isFinite(currentRunNumber)) {
    throw new Error("selectNewerActiveRun requires a numeric currentRunNumber");
  }
  if (!Array.isArray(runs)) {
    throw new Error("selectNewerActiveRun requires an array of runs");
  }
  let best = null;
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    if (String(run.id) === String(currentRunId)) continue;
    if (typeof run.run_number !== "number") continue;
    if (run.run_number <= currentRunNumber) continue;
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    if (best === null || run.run_number < best.run_number) {
      best = run;
    }
  }
  return best;
}
