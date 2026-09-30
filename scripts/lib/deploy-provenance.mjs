// Build/source identity for the serving bundle and its Git ancestry fence.
// built_at is diagnostic; it never dates or credits provider data.

export const DEPLOY_PROVENANCE_SCHEMA = "deploy-provenance/v1";
export const DEPLOY_PROVENANCE_PUBLIC_PATH = "deploy-provenance.json";
export const DEPLOY_SOURCE_FENCE_MODE_STRICT = "strict";
export const DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE = "remediate-unprovenanced-live";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED = "legacy-unprovenanced";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID = "present-invalid";
export const DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH = "present-mismatched";

const validSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
const validBuildId = (value) => typeof value === "string" && value.trim().length > 0;

export function buildDeployProvenance({ buildId, builtAt, sha }) {
  if (!validBuildId(buildId)) throw new Error("deploy manifest requires a non-empty build id");
  if (!validSha(sha)) throw new Error("deploy manifest requires a full Git SHA");
  return {
    schema_version: DEPLOY_PROVENANCE_SCHEMA,
    build_id: buildId,
    sha: sha.toLowerCase(),
    built_at: builtAt ?? new Date().toISOString(),
  };
}

// Legacy deployed manifests may contain execution fields; readers ignore them.
export function isDeployProvenance(value) {
  return Boolean(value && typeof value === "object"
    && value.schema_version === DEPLOY_PROVENANCE_SCHEMA
    && validBuildId(value.build_id) && validSha(value.sha));
}

// Same-source retries are allowed. An older or diverged source may never
// overwrite the currently serving source. Exact legacy absence is usable only
// after the CLI's canonical live probe and explicit owner-dispatch safeguard.
export function evaluateDeploySourceFence({
  artifactSha,
  runSha,
  currentMainSha,
  liveSha,
  artifactIsAncestorOfCurrentMain,
  liveIsAncestorOfArtifact,
  artifactIsAncestorOfLive,
  artifactBuildId = null,
  expectedBuildId = null,
  mode = DEPLOY_SOURCE_FENCE_MODE_STRICT,
  liveProvenanceState = null,
  liveBuildId = null,
}) {
  const reject = (verdict, detail) => ({ allowed: false, verdict, detail });
  if (mode !== DEPLOY_SOURCE_FENCE_MODE_STRICT
    && mode !== DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE) {
    return reject("identity-unavailable", `unsupported deploy source fence mode: ${String(mode)}`);
  }
  const legacyAbsence = mode === DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE
    && liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED
    && validBuildId(liveBuildId) && liveSha === null
    && liveIsAncestorOfArtifact === null && artifactIsAncestorOfLive === null;
  if (![artifactSha, runSha, currentMainSha].every(validSha) || (!legacyAbsence && !validSha(liveSha))) {
    return reject("identity-unavailable", "artifact, workflow source, current main and live source require full Git SHAs");
  }
  if ((artifactBuildId !== null || expectedBuildId !== null)
    && (!validBuildId(artifactBuildId) || !validBuildId(expectedBuildId) || artifactBuildId !== expectedBuildId)) {
    return reject("artifact-build-mismatch", "artifact manifest does not match the actual artifact BUILD_ID");
  }
  if (liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID) {
    return reject("identity-unavailable", "live source manifest is malformed");
  }
  if (liveProvenanceState === DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH) {
    return reject("provenance-mismatch", "live manifest build_id does not match the serving BUILD_ID");
  }
  if (artifactSha.toLowerCase() !== runSha.toLowerCase()) {
    return reject("artifact-source-mismatch", "artifact source differs from the requested workflow source");
  }
  if (typeof artifactIsAncestorOfCurrentMain !== "boolean") {
    return reject("ancestry-unavailable", "current-main Git ancestry is unavailable");
  }
  if (!artifactIsAncestorOfCurrentMain) {
    return reject("source-diverged", "artifact source is not an ancestor of current main");
  }
  if (legacyAbsence) {
    return {
      allowed: true,
      verdict: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
      detail: "artifact matches requested source and current main; explicit legacy remediation has no live source to compare",
    };
  }
  if (typeof liveIsAncestorOfArtifact !== "boolean" || typeof artifactIsAncestorOfLive !== "boolean") {
    return reject("ancestry-unavailable", "live-source Git ancestry is unavailable");
  }
  if (!liveIsAncestorOfArtifact) {
    return artifactIsAncestorOfLive
      ? reject("stale-live", "artifact source is older than the currently serving source")
      : reject("live-diverged", "live source is not on the artifact source lineage");
  }
  return {
    allowed: true,
    verdict: "source-monotonic",
    detail: "artifact matches requested source, remains on current main and preserves live source order",
  };
}
