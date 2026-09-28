// deploy-provenance — bind the live Worker bundle to the CI run that shipped it.
//
// Purpose: a deploy run that is cancelled (or dies) AFTER `wrangler deploy` but
// BEFORE its smokes leaves the live Worker serving a bundle no smoke ever
// verified, while the CI ledger records no green (BACKLOG #361, incident
// 2026-07-16: cancelled run 29502469123 served ~15h unverified). This module is
// the pure-logic core for two call sites:
//   1. scripts/write-deploy-provenance.mjs — stamps run identity into the bundle
//   2. scripts/check-live-deploy-provenance.mjs — classifies the CURRENT live
//      bundle's provenance before (and after) a deploy
//
// Contract rules (DEC-264/DEC-266):
//   - Detection never blocks remediation: an unverified live bundle is named
//     loudly and the current run still deploys over it (exit 0).
//   - No runtime inference of identity: provenance is DECLARED in the bundle by
//     the run that built it; absence is reported as legacy, never guessed.

export const DEPLOY_PROVENANCE_SCHEMA = "deploy-provenance/v1";
export const DEPLOY_PROVENANCE_PUBLIC_PATH = "deploy-provenance.json";
export const DEPLOY_SOURCE_FENCE_MODE_STRICT = "strict";
export const DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE = "remediate-unprovenanced-live";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED = "legacy-unprovenanced";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID = "present-invalid";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH = "present-mismatched";

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

// Fail closed unless the downloaded artifact belongs to this workflow run,
// remains on current main, and is not older than the source serving live.
// Main may advance while a build runs; that alone must not starve publication.
// The live-source relation is the monotonicity boundary that prevents an older
// scheduled artifact from overwriting a newer accepted deployment. The only
// exception is the explicit remediation mode, where both provenance surfaces
// are proven absent; artifact/run identity and current-main ancestry still run.
export function evaluateDeploySourceFence({
  artifactSha,
  runSha,
  currentMainSha,
  liveSha,
  artifactRunId,
  currentRunId,
  artifactRunNumber,
  currentRunNumber,
  artifactRunAttempt,
  currentRunAttempt,
  liveRunNumber,
  liveRunAttempt,
  artifactIsAncestorOfCurrentMain,
  liveIsAncestorOfArtifact,
  artifactIsAncestorOfLive,
  artifactBuildId = null,
  expectedBuildId = null,
  mode = DEPLOY_SOURCE_FENCE_MODE_STRICT,
  liveProvenanceState = null,
  liveBuildId = null,
}) {
  const validSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
  if (
    mode !== DEPLOY_SOURCE_FENCE_MODE_STRICT
    && mode !== DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE
  ) {
    return {
      allowed: false,
      verdict: "identity-unavailable",
      detail: `unsupported deploy source fence mode: ${String(mode)}`,
    };
  }
  const remediationLiveIdentityAbsent = mode === DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE
    && liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED
    && typeof liveBuildId === "string"
    && liveBuildId.length > 0
    && liveSha === null
    && liveRunNumber === null
    && liveRunAttempt === null
    && liveIsAncestorOfArtifact === null
    && artifactIsAncestorOfLive === null;
  const sourceIds = { artifactSha, runSha, currentMainSha };
  if (
    Object.values(sourceIds).some((value) => !validSha(value))
    || (!remediationLiveIdentityAbsent && !validSha(liveSha))
  ) {
    return {
      allowed: false,
      verdict: "identity-unavailable",
      detail: "artifact, workflow run, current origin/main, and live deployment must each provide a full Git SHA",
    };
  }

  const artifactBuildBindingRequested = artifactBuildId !== null || expectedBuildId !== null;
  if (
    artifactBuildBindingRequested
    && (
      typeof artifactBuildId !== "string"
      || artifactBuildId.length === 0
      || typeof expectedBuildId !== "string"
      || expectedBuildId.length === 0
      || artifactBuildId !== expectedBuildId
    )
  ) {
    return {
      allowed: false,
      verdict: "artifact-build-mismatch",
      detail: "artifact provenance build_id does not match the expected artifact BUILD_ID",
    };
  }
  if (
    typeof liveBuildId === "string"
    && liveBuildId.length > 0
    && typeof expectedBuildId === "string"
    && expectedBuildId.length > 0
    && liveBuildId === expectedBuildId
  ) {
    return {
      allowed: false,
      verdict: "reused-live-build-id",
      detail: "expected artifact BUILD_ID is already live; deployment identity would be ambiguous",
    };
  }

  if (liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID) {
    return {
      allowed: false,
      verdict: "identity-unavailable",
      detail: "live deploy provenance is present but malformed or does not satisfy the provenance contract",
    };
  }
  if (liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH) {
    return {
      allowed: false,
      verdict: "provenance-mismatch",
      detail: "live deploy provenance build_id does not match the live BUILD_ID",
    };
  }

  const artifact = artifactSha.toLowerCase();
  const run = runSha.toLowerCase();
  if (artifact !== run) {
    return {
      allowed: false,
      verdict: "artifact-run-mismatch",
      detail: `artifact source ${artifact} does not match workflow source ${run}`,
    };
  }
  if (
    typeof artifactRunId !== "string"
    || artifactRunId.length === 0
    || artifactRunId !== currentRunId
    || !Number.isInteger(artifactRunNumber)
    || artifactRunNumber !== currentRunNumber
    || !Number.isInteger(artifactRunAttempt)
    || artifactRunAttempt !== currentRunAttempt
  ) {
    return {
      allowed: false,
      verdict: "artifact-run-mismatch",
      detail: "artifact run id, run number, or run attempt does not match the current workflow run",
    };
  }
  if (typeof artifactIsAncestorOfCurrentMain !== "boolean") {
    return {
      allowed: false,
      verdict: "ancestry-unavailable",
      detail: "Git ancestry required for the current-main and live-source fence is unavailable",
    };
  }
  if (!artifactIsAncestorOfCurrentMain) {
    return {
      allowed: false,
      verdict: "source-diverged",
      detail: `workflow source ${run} is not an ancestor of current origin/main ${currentMainSha.toLowerCase()}`,
    };
  }
  if (remediationLiveIdentityAbsent) {
    return {
      allowed: true,
      verdict: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
      detail:
        "artifact matches this workflow run and current main; exact legacy live provenance absence "
        + "was explicitly authorized for this dispatch, so live source/run monotonicity is unavailable",
    };
  }
  if (
    !Number.isInteger(liveRunNumber)
    || liveRunNumber < 0
    || !Number.isInteger(liveRunAttempt)
    || liveRunAttempt < 1
  ) {
    return {
      allowed: false,
      verdict: "identity-unavailable",
      detail: "live deployment run number and run attempt must be available",
    };
  }
  if (
    typeof liveIsAncestorOfArtifact !== "boolean"
    || typeof artifactIsAncestorOfLive !== "boolean"
  ) {
    return {
      allowed: false,
      verdict: "ancestry-unavailable",
      detail: "Git ancestry required for the current-main and live-source fence is unavailable",
    };
  }
  if (!liveIsAncestorOfArtifact) {
    if (artifactIsAncestorOfLive) {
      return {
        allowed: false,
        verdict: "stale-live",
        detail: `workflow source ${run} is older than live deployment source ${liveSha.toLowerCase()}`,
      };
    }
    return {
      allowed: false,
      verdict: "live-diverged",
      detail: `live deployment source ${liveSha.toLowerCase()} is not on the workflow source lineage`,
    };
  }
  const candidateIsNewerRun = artifactRunNumber > liveRunNumber
    || (artifactRunNumber === liveRunNumber && artifactRunAttempt > liveRunAttempt);
  if (!candidateIsNewerRun) {
    return {
      allowed: false,
      verdict: "stale-run",
      detail:
        `workflow run ${artifactRunNumber}.${artifactRunAttempt} is not newer than `
        + `live deployment run ${liveRunNumber}.${liveRunAttempt}`,
    };
  }
  return {
    allowed: true,
    verdict: "source-monotonic",
    detail:
      "artifact matches this workflow run, remains on current main, and advances both live source and run order",
  };
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
