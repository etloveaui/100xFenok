#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_PROVENANCE_PUBLIC_PATH,
  DEPLOY_PROVENANCE_SCHEMA,
  DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID,
  DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH,
  DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  buildDeployProvenance,
  classifyLiveProvenance,
  evaluateDeploySourceFence,
  evaluatePostObservation,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";
import {
  DEPLOY_SOURCE_FENCE_CANONICAL_LIVE_BASE_URL,
  probeUnprovenancedLive,
  runDeploySourceFenceCli,
} from "./check-deploy-source-fence.mjs";
import { writeDeployProvenance } from "./write-deploy-provenance.mjs";

// --- buildDeployProvenance -----------------------------------------------

const base = {
  buildId: "build-123",
  builtAt: "2026-07-17T05:00:00.000Z",
  repository: "etloveaui/100xFenok",
  runAttempt: "1",
  runId: "29502469123",
  runNumber: "1379",
  serverUrl: "https://github.com",
  sha: "47041d950747041d950747041d950747041d9507",
};

const provenance = buildDeployProvenance(base);
assert.equal(
  DEPLOY_PROVENANCE_PUBLIC_PATH,
  "deploy-provenance.json",
  "the live identity stamp must stay outside broad cached data paths",
);
assert.equal(provenance.schema_version, DEPLOY_PROVENANCE_SCHEMA);
assert.equal(provenance.build_id, "build-123");
assert.equal(provenance.run_id, "29502469123");
assert.equal(provenance.run_attempt, 1);
assert.equal(provenance.run_number, 1379);
assert.equal(
  provenance.run_url,
  "https://github.com/etloveaui/100xFenok/actions/runs/29502469123",
);
assert.equal(isDeployProvenance(provenance), true, "builder output must satisfy its own contract");

assert.throws(() => buildDeployProvenance({ ...base, buildId: "" }), /non-empty build id/);
assert.throws(() => buildDeployProvenance({ ...base, runId: "" }), /non-empty runId/);
assert.throws(() => buildDeployProvenance({ ...base, sha: "" }), /non-empty sha/);
assert.throws(() => buildDeployProvenance({ ...base, repository: "" }), /non-empty repository/);
assert.throws(() => buildDeployProvenance({ ...base, runAttempt: "0" }), /run_attempt >= 1/);
assert.throws(() => buildDeployProvenance({ ...base, runNumber: "-1" }), /run_number >= 0/);

// numeric inputs are accepted and normalized
const normalized = buildDeployProvenance({ ...base, runAttempt: 2, runNumber: 5 });
assert.equal(normalized.run_attempt, 2);
assert.equal(normalized.run_number, 5);

// --- isDeployProvenance ----------------------------------------------------

assert.equal(isDeployProvenance(null), false);
assert.equal(isDeployProvenance({}), false);
assert.equal(isDeployProvenance({ ...provenance, schema_version: "other/v9" }), false);
assert.equal(isDeployProvenance({ ...provenance, build_id: "" }), false);
assert.equal(isDeployProvenance({ ...provenance, run_id: 123 }), false);

// --- classifyLiveProvenance ------------------------------------------------

const classifyBase = {
  apiAvailable: true,
  currentRunId: "30000000001",
  expectedBuildId: "expected-build",
  liveBuildId: "live-build",
};

// own-bundle: live already carries this run's build id (routed to the hard guard)
assert.equal(
  classifyLiveProvenance({ ...classifyBase, liveBuildId: "expected-build" }).verdict,
  "own-bundle",
);

// legacy: no provenance at all (pre-contract bundles)
const legacy = classifyLiveProvenance({ ...classifyBase, liveProvenance: null });
assert.equal(legacy.verdict, "legacy-unprovenanced");
assert.equal(legacy.annotation, "warning");

// legacy: malformed provenance JSON parsed into a non-contract object
assert.equal(
  classifyLiveProvenance({ ...classifyBase, liveProvenance: { hello: "world" } }).verdict,
  "legacy-unprovenanced",
);

// provenance build_id disagrees with the live BUILD_ID
const mismatch = classifyLiveProvenance({
  ...classifyBase,
  liveProvenance: { ...provenance, build_id: "something-else" },
});
assert.equal(mismatch.verdict, "provenance-mismatch");
assert.equal(mismatch.annotation, "error");

// own-run bundle (earlier attempt of this very run uploaded it)
const ownRun = classifyLiveProvenance({
  ...classifyBase,
  currentRunId: "29502469123",
  liveBuildId: "build-123",
  liveProvenance: provenance,
});
assert.equal(ownRun.verdict, "own-run-bundle");
assert.equal(ownRun.annotation, "warning");

// api unavailable: identity known, verification unknowable
const apiDown = classifyLiveProvenance({
  ...classifyBase,
  apiAvailable: false,
  liveBuildId: "build-123",
  liveProvenance: provenance,
});
assert.equal(apiDown.verdict, "api-unavailable");
assert.equal(apiDown.annotation, "warning");

// verified predecessor
const verified = classifyLiveProvenance({
  ...classifyBase,
  liveBuildId: "build-123",
  liveProvenance: provenance,
  liveRunConclusion: "success",
});
assert.equal(verified.verdict, "verified-predecessor");
assert.equal(verified.annotation, "notice");

// unverified serving: every smoke-never-passed conclusion
for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "startup_failure", null]) {
  const result = classifyLiveProvenance({
    ...classifyBase,
    liveBuildId: "build-123",
    liveProvenance: provenance,
    liveRunConclusion: conclusion,
  });
  assert.equal(result.verdict, "unverified-serving", `conclusion ${conclusion} must mean unverified`);
  assert.equal(result.annotation, "error");
  assert.match(result.detail, /WITHOUT a passed smoke/);
}

// unknown conclusion value -> inconclusive warning, never silent
const weird = classifyLiveProvenance({
  ...classifyBase,
  liveBuildId: "build-123",
  liveProvenance: provenance,
  liveRunConclusion: "neutral",
});
assert.equal(weird.verdict, "predecessor-inconclusive");
assert.equal(weird.annotation, "warning");

assert.throws(() => classifyLiveProvenance({ ...classifyBase, currentRunId: "" }), /currentRunId/);
assert.throws(() => classifyLiveProvenance({ ...classifyBase, expectedBuildId: "" }), /expectedBuildId/);

// --- evaluateDeploySourceFence --------------------------------------------

const sourceFenceBase = {
  artifactSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  currentMainSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  liveSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  artifactRunId: "200",
  currentRunId: "200",
  artifactRunNumber: 20,
  currentRunNumber: 20,
  artifactRunAttempt: 1,
  currentRunAttempt: 1,
  liveRunNumber: 19,
  liveRunAttempt: 1,
  artifactIsAncestorOfCurrentMain: true,
  liveIsAncestorOfArtifact: true,
  artifactIsAncestorOfLive: true,
};

assert.deepEqual(
  evaluateDeploySourceFence(sourceFenceBase),
  {
    allowed: true,
    verdict: "source-monotonic",
    detail:
      "artifact matches this workflow run, remains on current main, and advances both live source and run order",
  },
);

const mainAdvanced = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "1111111111111111111111111111111111111111",
  runSha: "1111111111111111111111111111111111111111",
  currentMainSha: "2222222222222222222222222222222222222222",
  liveSha: "0000000000000000000000000000000000000000",
  artifactIsAncestorOfLive: false,
});
assert.equal(mainAdvanced.allowed, true, "a main advance alone must not starve a valid deploy");
assert.equal(mainAdvanced.verdict, "source-monotonic");

const diverged = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "2222222222222222222222222222222222222222",
  runSha: "2222222222222222222222222222222222222222",
  artifactIsAncestorOfCurrentMain: false,
});
assert.equal(diverged.allowed, false);
assert.equal(diverged.verdict, "source-diverged");

const staleLive = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "1111111111111111111111111111111111111111",
  runSha: "1111111111111111111111111111111111111111",
  liveSha: "2222222222222222222222222222222222222222",
  liveIsAncestorOfArtifact: false,
  artifactIsAncestorOfLive: true,
});
assert.equal(staleLive.allowed, false);
assert.equal(staleLive.verdict, "stale-live");

const liveDiverged = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "1111111111111111111111111111111111111111",
  runSha: "1111111111111111111111111111111111111111",
  liveSha: "2222222222222222222222222222222222222222",
  liveIsAncestorOfArtifact: false,
  artifactIsAncestorOfLive: false,
});
assert.equal(liveDiverged.allowed, false);
assert.equal(liveDiverged.verdict, "live-diverged");

const artifactMismatch = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "3333333333333333333333333333333333333333",
});
assert.equal(artifactMismatch.allowed, false);
assert.equal(artifactMismatch.verdict, "artifact-run-mismatch");

const artifactRunMismatch = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactRunNumber: 21,
});
assert.equal(artifactRunMismatch.allowed, false);
assert.equal(artifactRunMismatch.verdict, "artifact-run-mismatch");

const staleSameSourceRun = evaluateDeploySourceFence({
  ...sourceFenceBase,
  liveRunNumber: 21,
});
assert.equal(staleSameSourceRun.allowed, false);
assert.equal(staleSameSourceRun.verdict, "stale-run");

const newerAttempt = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactRunNumber: 20,
  currentRunNumber: 20,
  artifactRunAttempt: 2,
  currentRunAttempt: 2,
  liveRunNumber: 20,
  liveRunAttempt: 1,
});
assert.equal(newerAttempt.allowed, true);

for (const [field, value] of [
  ["artifactSha", ""],
  ["runSha", null],
  ["currentMainSha", "lookup-unavailable"],
  ["liveSha", "lookup-unavailable"],
]) {
  const unavailable = evaluateDeploySourceFence({ ...sourceFenceBase, [field]: value });
  assert.equal(unavailable.allowed, false, `${field} unavailable must fail closed`);
  assert.equal(unavailable.verdict, "identity-unavailable");
}

const ancestryUnavailable = evaluateDeploySourceFence({
  ...sourceFenceBase,
  liveIsAncestorOfArtifact: null,
});
assert.equal(ancestryUnavailable.allowed, false);
assert.equal(ancestryUnavailable.verdict, "ancestry-unavailable");

const legacyRemediationBase = {
  ...sourceFenceBase,
  liveSha: null,
  liveRunNumber: null,
  liveRunAttempt: null,
  liveIsAncestorOfArtifact: null,
  artifactIsAncestorOfLive: null,
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  liveProvenanceState: DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  liveBuildId: "legacy-live-build",
};
const legacyRemediation = evaluateDeploySourceFence(legacyRemediationBase);
assert.equal(legacyRemediation.allowed, true);
assert.equal(legacyRemediation.verdict, DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE);

const legacyWithoutMode = evaluateDeploySourceFence({
  ...legacyRemediationBase,
  mode: "strict",
});
assert.equal(legacyWithoutMode.allowed, false);
assert.equal(legacyWithoutMode.verdict, "identity-unavailable");

const remediationSourceDiverged = evaluateDeploySourceFence({
  ...legacyRemediationBase,
  artifactIsAncestorOfCurrentMain: false,
});
assert.equal(remediationSourceDiverged.allowed, false);
assert.equal(remediationSourceDiverged.verdict, "source-diverged");

const remediationArtifactMismatch = evaluateDeploySourceFence({
  ...legacyRemediationBase,
  artifactSha: "3333333333333333333333333333333333333333",
});
assert.equal(remediationArtifactMismatch.allowed, false);
assert.equal(remediationArtifactMismatch.verdict, "artifact-run-mismatch");

const remediationMalformed = evaluateDeploySourceFence({
  ...sourceFenceBase,
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  liveProvenanceState: DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_INVALID,
});
assert.equal(remediationMalformed.allowed, false);
assert.equal(remediationMalformed.verdict, "identity-unavailable");

const remediationPresentMismatch = evaluateDeploySourceFence({
  ...sourceFenceBase,
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  liveProvenanceState: DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH,
});
assert.equal(remediationPresentMismatch.allowed, false);
assert.equal(remediationPresentMismatch.verdict, "provenance-mismatch");

const remediationStaleLive = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactSha: "1111111111111111111111111111111111111111",
  runSha: "1111111111111111111111111111111111111111",
  liveSha: "2222222222222222222222222222222222222222",
  liveIsAncestorOfArtifact: false,
  artifactIsAncestorOfLive: true,
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  liveProvenanceState: "present-valid",
  liveBuildId: "live-build",
});
assert.equal(remediationStaleLive.allowed, false);
assert.equal(remediationStaleLive.verdict, "stale-live");

const strictCandidateBuildMismatch = evaluateDeploySourceFence({
  ...sourceFenceBase,
  artifactBuildId: "artifact-build",
  expectedBuildId: "different-build",
});
assert.equal(strictCandidateBuildMismatch.allowed, false);
assert.equal(strictCandidateBuildMismatch.verdict, "artifact-build-mismatch");

const remediationCandidateBuildMismatch = evaluateDeploySourceFence({
  ...legacyRemediationBase,
  artifactBuildId: "artifact-build",
  expectedBuildId: "different-build",
});
assert.equal(remediationCandidateBuildMismatch.allowed, false);
assert.equal(remediationCandidateBuildMismatch.verdict, "artifact-build-mismatch");

const remediationReusedLiveBuild = evaluateDeploySourceFence({
  ...legacyRemediationBase,
  artifactBuildId: "same-build",
  expectedBuildId: "same-build",
  liveBuildId: "same-build",
});
assert.equal(remediationReusedLiveBuild.allowed, false);
assert.equal(remediationReusedLiveBuild.verdict, "reused-live-build-id");

// --- evaluatePostObservation (propagation-window poll unit) -----------------

const postBase = {
  currentRunId: "29559387354",
  expectedBuildId: "MLayS3KhXW-r7PaVSvQjx",
};

// the incident shape: stale BUILD_ID edge + fresh provenance edge (transient)
const flipFlop = evaluatePostObservation({
  ...postBase,
  liveBuildId: "PbtOUxIacY3cj1VRFyq_5",
  liveProvenance: { ...provenance, build_id: "MLayS3KhXW-r7PaVSvQjx", run_id: "29559387354" },
});
assert.equal(flipFlop.match, false);
assert.equal(flipFlop.kind, "build-mismatch");

// consistent new bundle -> match
const postMatch = evaluatePostObservation({
  ...postBase,
  liveBuildId: "MLayS3KhXW-r7PaVSvQjx",
  liveProvenance: { ...provenance, build_id: "MLayS3KhXW-r7PaVSvQjx", run_id: "29559387354" },
});
assert.equal(postMatch.match, true);
assert.equal(postMatch.kind, "match");

// provenance not yet propagated (404/old edge) -> missing (poll again)
assert.equal(
  evaluatePostObservation({ ...postBase, liveBuildId: "MLayS3KhXW-r7PaVSvQjx", liveProvenance: null }).kind,
  "missing",
);
assert.equal(
  evaluatePostObservation({ ...postBase, liveBuildId: "MLayS3KhXW-r7PaVSvQjx", liveProvenance: { bad: 1 } }).kind,
  "missing",
);

// provenance says a different build than live -> build-mismatch
assert.equal(
  evaluatePostObservation({
    ...postBase,
    liveBuildId: "MLayS3KhXW-r7PaVSvQjx",
    liveProvenance: { ...provenance, build_id: "other-build", run_id: "29559387354" },
  }).kind,
  "build-mismatch",
);

// fully propagated but shipped by another run -> run-mismatch (the real anomaly)
const foreign = evaluatePostObservation({
  ...postBase,
  liveBuildId: "MLayS3KhXW-r7PaVSvQjx",
  liveProvenance: { ...provenance, build_id: "MLayS3KhXW-r7PaVSvQjx", run_id: "11111111111" },
});
assert.equal(foreign.match, false);
assert.equal(foreign.kind, "run-mismatch");
assert.match(foreign.detail, /11111111111/);

assert.throws(
  () => evaluatePostObservation({ ...postBase, expectedBuildId: "", liveBuildId: "x", liveProvenance: null }),
  /expectedBuildId/,
);

// --- probeUnprovenancedLive (authoritative remediation probe) ---------------

const probeResponse = (status, body = "") => ({
  status,
  text: async () => body,
});
const sequenceFetch = (steps, calls = []) => async (url, options) => {
  calls.push({ url, options });
  const step = steps.shift();
  if (step instanceof Error) throw step;
  assert.notEqual(step, undefined, "unexpected extra live probe request");
  return step;
};

const exactProbeCalls = [];
const exactProbe = await probeUnprovenancedLive({
  fetchImpl: sequenceFetch([
    probeResponse(200, "authoritative-live-build\n"),
    probeResponse(404),
    probeResponse(404),
  ], exactProbeCalls),
  cacheBust: "probe-fixture",
});
assert.equal(exactProbe.allowed, true);
assert.equal(exactProbe.liveBuildId, "authoritative-live-build");
assert.equal(exactProbeCalls.length, 3);
assert.deepEqual(
  exactProbeCalls.map(({ url }) => new URL(url).pathname),
  ["/BUILD_ID", "/deploy-provenance.json", "/data/admin/deploy-provenance.json"],
);
for (const { url, options } of exactProbeCalls) {
  assert.equal(new URL(url).origin, DEPLOY_SOURCE_FENCE_CANONICAL_LIVE_BASE_URL);
  assert.equal(new URL(url).searchParams.get("cb"), "probe-fixture");
  assert.equal(options.redirect, "manual");
  assert.equal(options.headers["cache-control"], "no-cache, no-store");
  assert.equal(options.headers.pragma, "no-cache");
}

const nonCanonicalProbeCalls = [];
const nonCanonicalProbe = await probeUnprovenancedLive({
  baseUrl: "https://example.invalid",
  fetchImpl: sequenceFetch([], nonCanonicalProbeCalls),
  cacheBust: "probe-fixture",
});
assert.equal(nonCanonicalProbe.allowed, false);
assert.equal(nonCanonicalProbe.verdict, "live-base-not-canonical");
assert.equal(nonCanonicalProbeCalls.length, 0);

for (const [label, steps] of [
  ["BUILD_ID transport", [new Error("transport")]],
  ["fresh provenance transport", [probeResponse(200, "live"), new Error("transport")]],
  ["legacy provenance transport", [probeResponse(200, "live"), probeResponse(404), new Error("transport")]],
]) {
  const result = await probeUnprovenancedLive({
    fetchImpl: sequenceFetch(steps),
    cacheBust: label.replaceAll(" ", "-"),
  });
  assert.equal(result.allowed, false, label);
  assert.equal(result.verdict, "live-probe-transport", label);
}

for (const status of [204, 302, 401, 403, 500]) {
  const result = await probeUnprovenancedLive({
    fetchImpl: sequenceFetch([probeResponse(status, "not-a-live-build")]),
    cacheBust: `build-status-${status}`,
  });
  assert.equal(result.allowed, false, `BUILD_ID HTTP ${status}`);
  assert.equal(result.verdict, "live-build-id-http");
}
for (const body of ["", "\r\n", "   "]) {
  const result = await probeUnprovenancedLive({
    fetchImpl: sequenceFetch([probeResponse(200, body)]),
    cacheBust: "empty-build",
  });
  assert.equal(result.allowed, false, `empty BUILD_ID ${JSON.stringify(body)}`);
  assert.equal(result.verdict, "live-build-id-empty");
}

for (const [label, response] of [
  ["fresh redirect", probeResponse(302)],
  ["fresh unauthorized", probeResponse(401)],
  ["fresh forbidden", probeResponse(403)],
  ["fresh server error", probeResponse(500)],
  ["fresh malformed present", probeResponse(200, "not-json")],
  ["fresh valid present", probeResponse(200, JSON.stringify(provenance))],
]) {
  const result = await probeUnprovenancedLive({
    fetchImpl: sequenceFetch([probeResponse(200, "live"), response]),
    cacheBust: label.replaceAll(" ", "-"),
  });
  assert.equal(result.allowed, false, label);
  assert.equal(result.verdict, "fresh-provenance-present-or-unavailable", label);
}

for (const [label, response] of [
  ["legacy redirect", probeResponse(302)],
  ["legacy unauthorized", probeResponse(401)],
  ["legacy forbidden", probeResponse(403)],
  ["legacy server error", probeResponse(500)],
  ["legacy malformed present", probeResponse(200, "not-json")],
  ["legacy valid present", probeResponse(200, JSON.stringify(provenance))],
]) {
  const result = await probeUnprovenancedLive({
    fetchImpl: sequenceFetch([probeResponse(200, "live"), probeResponse(404), response]),
    cacheBust: label.replaceAll(" ", "-"),
  });
  assert.equal(result.allowed, false, label);
  assert.equal(result.verdict, "legacy-provenance-present-or-unavailable", label);
}

// --- writeDeployProvenance (filesystem round-trip) --------------------------

const tmpAssets = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-provenance-"));
fs.writeFileSync(path.join(tmpAssets, "BUILD_ID"), "bundle-abc\n");

const { outPath, provenance: written } = writeDeployProvenance({
  assetsDir: tmpAssets,
  env: {
    GITHUB_REPOSITORY: "etloveaui/100xFenok",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "29554849521",
    GITHUB_RUN_NUMBER: "1402",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_SHA: "ae15b48dadae15b48dadae15b48dadae15b48dad",
  },
  now: "2026-07-17T04:26:00.000Z",
});

assert.equal(written.build_id, "bundle-abc");
assert.equal(written.built_at, "2026-07-17T04:26:00.000Z");
const onDisk = JSON.parse(fs.readFileSync(outPath, "utf8"));
assert.deepEqual(onDisk, written, "on-disk provenance must round-trip the builder output");

const sourceFenceScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-deploy-source-fence.mjs",
);
const sourceFenceRepo = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-source-fence-"));
const runGit = (...args) => {
  const result = spawnSync("git", args, { cwd: sourceFenceRepo, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
};
runGit("init", "-q");
runGit("config", "user.email", "source-fence@example.invalid");
runGit("config", "user.name", "Source Fence Test");
const commitFile = path.join(sourceFenceRepo, "state.txt");
fs.writeFileSync(commitFile, "live\n");
runGit("add", "state.txt");
runGit("commit", "-qm", "live");
const liveSource = runGit("rev-parse", "HEAD");
fs.writeFileSync(commitFile, "candidate\n");
runGit("commit", "-qam", "candidate");
const candidateSource = runGit("rev-parse", "HEAD");
fs.writeFileSync(commitFile, "current main\n");
runGit("commit", "-qam", "current main");
const currentMainSource = runGit("rev-parse", "HEAD");
const candidateProvenancePath = path.join(sourceFenceRepo, "candidate-provenance.json");
const liveProvenancePath = path.join(sourceFenceRepo, "live-provenance.json");
const candidateRun = {
  ...onDisk,
  sha: candidateSource,
  run_id: "30000000000",
  run_number: 1380,
  run_attempt: 1,
};
const liveRun = {
  ...onDisk,
  sha: liveSource,
  run_id: "29999999999",
  run_number: 1379,
  run_attempt: 1,
};
fs.writeFileSync(candidateProvenancePath, JSON.stringify(candidateRun));
fs.writeFileSync(liveProvenancePath, JSON.stringify(liveRun));
const cliPass = spawnSync(
  process.execPath,
  [
    sourceFenceScript,
    "--provenance",
    candidateProvenancePath,
    "--expected-build-id",
    candidateRun.build_id,
    "--live-provenance",
    liveProvenancePath,
    "--current-main",
    currentMainSource,
  ],
  {
    cwd: sourceFenceRepo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: candidateSource,
      GITHUB_RUN_ID: candidateRun.run_id,
      GITHUB_RUN_NUMBER: String(candidateRun.run_number),
      GITHUB_RUN_ATTEMPT: String(candidateRun.run_attempt),
    },
  },
);
assert.equal(cliPass.status, 0, `${cliPass.stderr}\n${cliPass.stdout}`);
assert.match(cliPass.stdout, /source-monotonic/);

fs.writeFileSync(liveProvenancePath, JSON.stringify({
  ...liveRun,
  sha: currentMainSource,
  run_number: 1381,
}));
const cliStale = spawnSync(
  process.execPath,
  [
    sourceFenceScript,
    "--provenance",
    candidateProvenancePath,
    "--expected-build-id",
    candidateRun.build_id,
    "--live-provenance",
    liveProvenancePath,
    "--current-main",
    currentMainSource,
  ],
  {
    cwd: sourceFenceRepo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: candidateSource,
      GITHUB_RUN_ID: candidateRun.run_id,
      GITHUB_RUN_NUMBER: String(candidateRun.run_number),
      GITHUB_RUN_ATTEMPT: String(candidateRun.run_attempt),
    },
  },
);
assert.equal(cliStale.status, 1);
assert.match(cliStale.stdout, /stale-live/);

const malformedProvenancePath = path.join(sourceFenceRepo, "malformed-provenance.json");
fs.writeFileSync(malformedProvenancePath, JSON.stringify({ sha: candidateSource }));
const cliMalformed = spawnSync(
  process.execPath,
  [
    sourceFenceScript,
    "--provenance",
    malformedProvenancePath,
    "--expected-build-id",
    candidateRun.build_id,
    "--live-provenance",
    liveProvenancePath,
    "--current-main",
    currentMainSource,
  ],
  {
    cwd: sourceFenceRepo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: candidateSource,
      GITHUB_RUN_ID: candidateRun.run_id,
      GITHUB_RUN_NUMBER: String(candidateRun.run_number),
      GITHUB_RUN_ATTEMPT: String(candidateRun.run_attempt),
    },
  },
);
assert.equal(cliMalformed.status, 1);
assert.match(cliMalformed.stdout, /identity-unavailable/);

const cliFenceEnv = {
  ...process.env,
  GITHUB_SHA: candidateSource,
  GITHUB_RUN_ID: candidateRun.run_id,
  GITHUB_RUN_NUMBER: String(candidateRun.run_number),
  GITHUB_RUN_ATTEMPT: String(candidateRun.run_attempt),
};
const absentLiveProvenancePath = path.join(sourceFenceRepo, "absent-live-provenance.json");
fs.rmSync(absentLiveProvenancePath, { force: true });
const malformedLiveProvenancePath = path.join(sourceFenceRepo, "malformed-live-provenance.json");
fs.writeFileSync(malformedLiveProvenancePath, JSON.stringify({ sha: liveSource }));
const mismatchedLiveProvenancePath = path.join(sourceFenceRepo, "mismatched-live-provenance.json");
fs.writeFileSync(
  mismatchedLiveProvenancePath,
  JSON.stringify({ ...liveRun, build_id: "provenance-build", sha: liveSource }),
);

const runCliCase = async ({
  livePath = absentLiveProvenancePath,
  expectedBuildId = candidateRun.build_id,
  mode = null,
  callerState = null,
  callerLiveBuildId = null,
  probeSteps = [],
  eventName = "workflow_dispatch",
  remediationInput = "true",
}) => {
  const argv = [
    process.execPath,
    sourceFenceScript,
    "--provenance",
    candidateProvenancePath,
    "--expected-build-id",
    expectedBuildId,
    "--live-provenance",
    livePath,
    "--current-main",
    currentMainSource,
  ];
  if (callerState !== null) argv.push("--live-provenance-state", callerState);
  if (callerLiveBuildId !== null) argv.push("--live-build-id", callerLiveBuildId);
  if (mode !== null) argv.push("--mode", mode);
  const output = [];
  const errors = [];
  const probeCalls = [];
  const status = await runDeploySourceFenceCli({
    argv,
    env: {
      ...cliFenceEnv,
      DEPLOY_EVENT_NAME: eventName,
      DEPLOY_REMEDIATION_INPUT: remediationInput,
    },
    fetchImpl: sequenceFetch([...probeSteps], probeCalls),
    gitCwd: sourceFenceRepo,
    now: () => 12345,
    emit: (message) => output.push(message),
    emitError: (message) => errors.push(message),
  });
  return { status, output: output.join("\n"), errors: errors.join("\n"), probeCalls };
};

for (const [eventName, remediationInput] of [
  ["schedule", "true"],
  ["push", "true"],
  ["workflow_run", "true"],
  ["workflow_dispatch", null],
  ["workflow_dispatch", "false"],
]) {
  const result = await runCliCase({
    mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
    eventName,
    remediationInput,
    probeSteps: [
      probeResponse(200, "authoritative-live-build"),
      probeResponse(404),
      probeResponse(404),
    ],
  });
  assert.equal(result.status, 1, `${eventName} input=${String(remediationInput)}`);
  assert.match(result.errors, /explicit owner input/);
  assert.equal(result.probeCalls.length, 0, "unauthorized remediation must not probe");
}

const spoofedRemediation = await runCliCase({
  callerState: DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  callerLiveBuildId: "spoofed-live-build",
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  probeSteps: [probeResponse(500)],
});
assert.equal(spoofedRemediation.status, 1);
assert.match(spoofedRemediation.errors, /live-build-id-http/);

const strictSpoofedLegacy = await runCliCase({
  callerState: DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  callerLiveBuildId: "spoofed-live-build",
});
assert.equal(strictSpoofedLegacy.status, 1);
assert.match(strictSpoofedLegacy.output, /identity-unavailable/);
assert.equal(strictSpoofedLegacy.probeCalls.length, 0, "strict mode must not consume remediation proof");

const staleTempAuthoritativeProbe = await runCliCase({
  livePath: mismatchedLiveProvenancePath,
  callerState: DEPLOY_SOURCE_FENCE_LIVE_STATE_PRESENT_MISMATCH,
  callerLiveBuildId: "spoofed-live-build",
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  probeSteps: [
    probeResponse(200, "authoritative-live-build"),
    probeResponse(404),
    probeResponse(404),
  ],
});
assert.equal(staleTempAuthoritativeProbe.status, 0, staleTempAuthoritativeProbe.errors);
assert.match(staleTempAuthoritativeProbe.output, /remediate-unprovenanced-live/);
assert.match(staleTempAuthoritativeProbe.output, /authoritative-live-build/);
assert.doesNotMatch(staleTempAuthoritativeProbe.output, /spoofed-live-build|provenance-build/);

const remediationArtifactBuildMismatchCli = await runCliCase({
  expectedBuildId: "different-artifact-build",
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  probeSteps: [
    probeResponse(200, "authoritative-live-build"),
    probeResponse(404),
    probeResponse(404),
  ],
});
assert.equal(remediationArtifactBuildMismatchCli.status, 1);
assert.match(remediationArtifactBuildMismatchCli.output, /artifact-build-mismatch/);

const remediationReusedLiveBuildCli = await runCliCase({
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  probeSteps: [
    probeResponse(200, candidateRun.build_id),
    probeResponse(404),
    probeResponse(404),
  ],
});
assert.equal(remediationReusedLiveBuildCli.status, 1);
assert.match(remediationReusedLiveBuildCli.output, /reused-live-build-id/);

const strictArtifactBuildMismatchCli = await runCliCase({
  livePath: liveProvenancePath,
  expectedBuildId: "different-artifact-build",
});
assert.equal(strictArtifactBuildMismatchCli.status, 1);
assert.match(strictArtifactBuildMismatchCli.output, /artifact-build-mismatch/);

const strictMalformedLive = await runCliCase({
  livePath: malformedLiveProvenancePath,
  callerState: DEPLOY_SOURCE_FENCE_LIVE_STATE_LEGACY_UNPROVENANCED,
  callerLiveBuildId: "spoofed-live-build",
});
assert.equal(strictMalformedLive.status, 1);
assert.match(strictMalformedLive.output, /identity-unavailable/);

const strictPresentMismatch = await runCliCase({
  livePath: mismatchedLiveProvenancePath,
  callerLiveBuildId: "actual-live-build",
});
assert.equal(strictPresentMismatch.status, 1);
assert.match(strictPresentMismatch.output, /provenance-mismatch/);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployWorkflowPath = path.join(repoRoot, ".github", "workflows", "deploy-worker.yml");
const deployWorkflow = fs.readFileSync(deployWorkflowPath, "utf8");
const deployJob = deployWorkflow.slice(deployWorkflow.indexOf("\n  deploy:"));
const dispatchInput = deployWorkflow.slice(
  deployWorkflow.indexOf("  workflow_dispatch:"),
  deployWorkflow.indexOf("  # Requeue path:"),
);
const staticHeaders = fs.readFileSync(
  path.join(
    repoRoot,
    "100xfenok-next",
    "public",
    "_headers",
  ),
  "utf8",
);
assert.match(
  staticHeaders,
  /^\/deploy-provenance\.json\r?\n\s+Cache-Control: no-store$/m,
  "the live identity stamp must be served with an exact no-store header rule",
);
assert.equal(
  [...deployWorkflow.matchAll(/fetch-depth: 0/g)].length,
  1,
  "only the deploy checkout should fetch full history for the source-lineage fence",
);
assert.match(deployJob, /uses: actions\/checkout@v4\s+with:\s+fetch-depth: 0/);

// active supersession is REMOVED: no gate script, no pre-smoke skip signal.
// Every admitted deploy job proceeds (serialized by the concurrency group) to
// the pre-upload source fence, which alone rejects stale candidates.
assert.equal(
  fs.existsSync(path.join(repoRoot, "scripts", "check-deploy-supersession.mjs")),
  false,
  "the supersession gate script must stay deleted",
);
assert.doesNotMatch(deployJob, /check-deploy-supersession/, "no step may invoke a supersession gate");
assert.doesNotMatch(deployJob, /SUPERSEDED/, "no step may read or write the retired SUPERSEDED signal");
const liveProvenanceFetchPosition = deployJob.indexOf("live-deploy-provenance-source-fence.json");
const sourceFencePosition = deployJob.indexOf("check-deploy-source-fence.mjs");
const uploadPosition = deployJob.indexOf("npx wrangler deploy");
const preProvenancePosition = deployJob.indexOf("node scripts/check-live-deploy-provenance.mjs --pre");
const postProvenancePosition = deployJob.indexOf("node ../scripts/check-live-deploy-provenance.mjs --post");
const sourceFenceBlock = deployJob.slice(deployJob.indexOf("fetch_http_status"), uploadPosition);
const postBlock = deployJob.slice(postProvenancePosition);
const smokeStep = deployJob.slice(deployJob.indexOf("      - name: Smoke data health KPI"));
assert.match(
  dispatchInput,
  /remediate_unprovenanced_live:\s+description:[\s\S]+required:\s+false[\s\S]+default:\s+false[\s\S]+type:\s+boolean/,
  "remediation input must be optional, default false, and boolean",
);
assert.match(
  deployJob,
  /DEPLOY_EVENT_NAME:\s+\$\{\{\s*github\.event_name\s*\}\}[\s\S]+DEPLOY_REMEDIATION_INPUT:\s+\$\{\{\s*inputs\.remediate_unprovenanced_live\s+\|\|\s+false\s*\}\}/,
  "the deploy step must receive the current event and non-sticky input value",
);
assert.match(deployJob, /\$base_url\/deploy-provenance\.json\?cb=/);
assert.match(
  sourceFenceBlock,
  /--write-out '%\{http_code\}'/,
  "source-fence surface reads must inspect HTTP status without curl --fail",
);
assert.match(
  sourceFenceBlock,
  /live_provenance_surface="fresh-no-store"[\s\S]+live_provenance_surface="legacy-cached-fallback"[\s\S]+Deploy source fence provenance surface: \$live_provenance_surface/,
  "the deploy log must disclose whether the source fence read the fresh or rollback-only legacy surface",
);
assert.match(sourceFenceBlock, /case "\$fresh_provenance_status" in[\s\S]+404\)[\s\S]+legacy_provenance_status=/);
assert.match(
  sourceFenceBlock,
  /legacy_provenance_status[\s\S]+case "\$legacy_provenance_status" in[\s\S]+404\)[\s\S]+live_provenance_state="legacy-unprovenanced"/,
  "only the exact dual-404 branch may establish legacy-unprovenanced state",
);
assert.match(sourceFenceBlock, /transport\|\*[\s\S]+exit 1/);
assert.doesNotMatch(sourceFenceBlock, /curl -f/, "404-only source-fence reads must not use curl --fail");
assert.match(
  sourceFenceBlock,
  /if \[ "\$DEPLOY_EVENT_NAME" = "workflow_dispatch" \][\s\S]+\[ "\$DEPLOY_REMEDIATION_INPUT" = "true" \][\s\S]+\[ "\$live_provenance_state" = "legacy-unprovenanced" \]/,
  "remediation must require dispatch, true input, and exact legacy state",
);
assert.doesNotMatch(
  sourceFenceBlock,
  /--live-provenance-state/,
  "caller-declared legacy state must not be passed as remediation proof",
);
assert.match(sourceFenceBlock, /--live-build-id "\$live_build_id"/);
assert.match(sourceFenceBlock, /--expected-build-id "\$expected_build_id"/);
assert.match(sourceFenceBlock, /--mode "\$source_fence_mode"/);
assert.match(
  sourceFenceBlock,
  /if \[ "\$live_build_id" = "\$expected_build_id" \][\s\S]+deployment identity would be ambiguous[\s\S]+exit 1/,
  "remediation must retain the unique BUILD_ID guard",
);
assert.match(
  sourceFenceBlock,
  /--provenance "\.open-next\/assets\/deploy-provenance\.json"/,
);
assert.equal(
  liveProvenanceFetchPosition >= 0
    && preProvenancePosition >= 0
    && preProvenancePosition < liveProvenanceFetchPosition
    && sourceFencePosition > liveProvenanceFetchPosition
    && uploadPosition > sourceFencePosition,
  true,
  "live provenance and the monotonic source fence must run in order immediately before upload",
);
assert.equal(postProvenancePosition > uploadPosition, true, "post provenance must run after upload");
assert.match(postBlock, /node \.\.\/scripts\/check-live-deploy-provenance\.mjs --post/);
assert.doesNotMatch(postBlock, /remediate-unprovenanced-live/, "post mode must never inherit remediation");

const smokeWorkingDirectory = smokeStep.match(/working-directory:\s*([^\s]+)/)?.[1] ?? null;
const postScriptArgument = smokeStep.match(/node\s+(\.\.\/scripts\/check-live-deploy-provenance\.mjs)\s+--post/)?.[1] ?? null;
assert.equal(smokeWorkingDirectory, "100xfenok-next", "post command working directory must be explicit");
assert.equal(postScriptArgument, "../scripts/check-live-deploy-provenance.mjs");
const resolvedPostScript = path.resolve(repoRoot, smokeWorkingDirectory, postScriptArgument);
assert.equal(resolvedPostScript, path.join(repoRoot, "scripts", "check-live-deploy-provenance.mjs"));
assert.equal(fs.existsSync(resolvedPostScript), true, "post checker must resolve from its declared working directory");
const postScriptSyntax = spawnSync(process.execPath, ["--check", resolvedPostScript], { encoding: "utf8" });
assert.equal(postScriptSyntax.status, 0, `${postScriptSyntax.stderr}\n${postScriptSyntax.stdout}`);

const remediationGate = ({ eventName, input, liveState }) => (
  eventName === "workflow_dispatch"
  && input === "true"
  && liveState === "legacy-unprovenanced"
);
for (const [eventName, input, expected] of [
  ["schedule", "true", false],
  ["push", "true", false],
  ["workflow_run", "true", false],
  ["workflow_dispatch", undefined, false],
  ["workflow_dispatch", "false", false],
  ["workflow_dispatch", "true", true],
]) {
  assert.equal(
    remediationGate({ eventName, input, liveState: "legacy-unprovenanced" }),
    expected,
    `${eventName} input=${String(input)}`,
  );
}
assert.equal(remediationGate({ eventName: "workflow_dispatch", input: "true", liveState: "present-invalid" }), false);

// structural round-trip: what the writer stamps, the checker credits as its own run
const roundTrip = classifyLiveProvenance({
  apiAvailable: true,
  currentRunId: "99999999999",
  expectedBuildId: "next-build",
  liveBuildId: "bundle-abc",
  liveProvenance: onDisk,
  liveRunConclusion: "success",
});
assert.equal(roundTrip.verdict, "verified-predecessor");

// writer refuses a bundle without BUILD_ID (identity must never be fabricated)
const emptyAssets = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-provenance-noid-"));
assert.throws(() => writeDeployProvenance({ assetsDir: emptyAssets, env: {} }), /BUILD_ID not found/);

for (const temporaryPath of [tmpAssets, sourceFenceRepo, emptyAssets]) {
  fs.rmSync(temporaryPath, { recursive: true, force: true });
}

console.log("test-deploy-provenance: ok");
