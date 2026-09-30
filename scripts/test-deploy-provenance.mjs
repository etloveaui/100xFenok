#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEPLOY_PROVENANCE_SCHEMA,
  DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  buildDeployProvenance,
  evaluateDeploySourceFence,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";
import { probeUnprovenancedLive, runDeploySourceFenceCli } from "./check-deploy-source-fence.mjs";
import { writeDeployProvenance } from "./write-deploy-provenance.mjs";

const sha = "a".repeat(40);
const provenance = buildDeployProvenance({
  buildId: "bundle", sha, builtAt: "2026-09-30T00:00:00Z",
  repository: "fixture/repo", runId: "legacy", runAttempt: 1, runNumber: 90,
});
assert.deepEqual(provenance, {
  schema_version: DEPLOY_PROVENANCE_SCHEMA,
  build_id: "bundle",
  sha,
  built_at: "2026-09-30T00:00:00Z",
}, "a deploy manifest needs build/source identity, not execution credit");
assert.equal(isDeployProvenance(provenance), true);
assert.equal(isDeployProvenance({ ...provenance, run_id: "legacy", run_number: 90 }), true,
  "already-deployed manifests remain readable");
for (const invalidSha of ["", "local", "a".repeat(39), "g".repeat(40)]) {
  assert.throws(() => buildDeployProvenance({ buildId: "bundle", sha: invalidSha }), /SHA/);
  assert.equal(isDeployProvenance({ ...provenance, sha: invalidSha }), false);
}
for (const buildId of ["", "   ", null]) {
  assert.throws(() => buildDeployProvenance({ buildId, sha }), /build id/);
  assert.equal(isDeployProvenance({ ...provenance, build_id: buildId }), false);
}
assert.equal(isDeployProvenance(null), false);
assert.equal(isDeployProvenance({ ...provenance, schema_version: "other" }), false);

const fence = {
  artifactSha: sha,
  runSha: sha,
  currentMainSha: "b".repeat(40),
  liveSha: sha,
  artifactIsAncestorOfCurrentMain: true,
  liveIsAncestorOfArtifact: true,
  artifactIsAncestorOfLive: true,
};
assert.equal(evaluateDeploySourceFence(fence).allowed, true,
  "same-source rebuilds do not require newer execution counters");
for (const [override, verdict] of [
  [{ runSha: "c".repeat(40) }, "artifact-source-mismatch"],
  [{ artifactIsAncestorOfCurrentMain: false }, "source-diverged"],
  [{ artifactIsAncestorOfCurrentMain: null }, "ancestry-unavailable"],
  [{ liveSha: "c".repeat(40), liveIsAncestorOfArtifact: false }, "stale-live"],
  [{ liveSha: "c".repeat(40), liveIsAncestorOfArtifact: false, artifactIsAncestorOfLive: false }, "live-diverged"],
  [{ liveIsAncestorOfArtifact: null }, "ancestry-unavailable"],
  [{ liveSha: null }, "identity-unavailable"],
]) {
  const result = evaluateDeploySourceFence({ ...fence, ...override });
  assert.equal(result.allowed, false);
  assert.equal(result.verdict, verdict);
}
const remediation = {
  ...fence,
  mode: DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE,
  liveProvenanceState: "legacy-unprovenanced",
  liveBuildId: "live-bundle",
  liveSha: null,
  liveIsAncestorOfArtifact: null,
  artifactIsAncestorOfLive: null,
};
assert.equal(evaluateDeploySourceFence(remediation).allowed, true);
assert.equal(evaluateDeploySourceFence({ ...remediation, artifactIsAncestorOfCurrentMain: false }).allowed, false);
assert.equal(evaluateDeploySourceFence({ ...remediation, liveProvenanceState: "present-invalid" }).allowed, false);

const response = (status, body = "") => ({ status, text: async () => body });
const sequenceFetch = (steps) => async () => {
  const step = steps.shift();
  assert.notEqual(step, undefined, "unexpected extra request");
  if (step instanceof Error) throw step;
  return step;
};
assert.equal((await probeUnprovenancedLive({
  fetchImpl: sequenceFetch([response(200, "live\n"), response(404), response(404)]),
})).allowed, true);
for (const steps of [
  [new Error("offline")],
  [response(200, "")],
  [response(302, "redirect")],
  [response(200, "live"), response(200, "malformed")],
  [response(200, "live"), response(404), response(500)],
]) {
  assert.equal((await probeUnprovenancedLive({ fetchImpl: sequenceFetch(steps) })).allowed, false);
}
assert.equal((await probeUnprovenancedLive({ baseUrl: "https://example.invalid" })).allowed, false);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-source-fence-"));
try {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: temporaryRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Deploy Fence Fixture");
  const commit = (content) => {
    fs.writeFileSync(path.join(temporaryRoot, "payload"), content);
    git("add", "payload");
    git("commit", "-qm", content);
    return git("rev-parse", "HEAD");
  };
  const older = commit("older");
  const candidate = commit("candidate");
  const newer = commit("newer");
  const assetsDir = path.join(temporaryRoot, "assets");
  fs.mkdirSync(assetsDir);
  fs.writeFileSync(path.join(assetsDir, "BUILD_ID"), "candidate-build\n");
  const { outPath, provenance: written } = writeDeployProvenance({ assetsDir, env: { GITHUB_SHA: candidate } });
  assert.equal(written.sha, candidate);
  assert.equal(written.build_id, "candidate-build");
  assert.deepEqual(JSON.parse(fs.readFileSync(outPath, "utf8")), written);
  assert.throws(() => writeDeployProvenance({ assetsDir, env: {} }), /SHA/);
  const livePath = path.join(temporaryRoot, "live.json");
  const argv = ["node", "fence", "--provenance", outPath, "--live-provenance", livePath,
    "--expected-build-id", "candidate-build", "--current-main", newer];
  const invoke = (options = {}) => runDeploySourceFenceCli({
    argv, env: { GITHUB_SHA: candidate }, gitCwd: temporaryRoot,
    emit: () => {}, emitError: () => {}, ...options,
  });
  const writeLive = (source) => fs.writeFileSync(livePath, JSON.stringify({
    schema_version: DEPLOY_PROVENANCE_SCHEMA, build_id: "live-build", sha: source,
  }));
  writeLive(older);
  assert.equal(await invoke(), 0, "an ancestor live source may advance");
  writeLive(candidate);
  assert.equal(await invoke(), 0, "same-source deployment may retry without run metadata");
  fs.writeFileSync(livePath, JSON.stringify(written));
  assert.equal(await invoke(), 0, "same-source retry may reuse an already serving build");
  assert.equal(await invoke({ argv: [...argv, "--live-build-id", "other-build"] }), 1,
    "mixed serving source and cache identity must reject");
  assert.equal(await invoke({ argv: argv.map((value) => value === "candidate-build" ? "wrong-build" : value) }), 1,
    "downloaded source manifest must bind the actual artifact BUILD_ID");
  writeLive(newer);
  assert.equal(await invoke(), 1, "older build must not overwrite newer serving source");
  writeLive(older);
  assert.equal(await invoke({ env: { GITHUB_SHA: older } }), 1, "artifact must match requested workflow source");
  fs.writeFileSync(livePath, "malformed");
  assert.equal(await invoke(), 1, "malformed live source must not be treated as absence");
  fs.unlinkSync(livePath);
  assert.equal(await invoke(), 1, "missing live source rejects ordinary deployment");
  const remediationArgv = [...argv, "--mode", DEPLOY_SOURCE_FENCE_MODE_REMEDIATE_UNPROVENANCED_LIVE];
  assert.equal(await invoke({ argv: remediationArgv }), 1, "absence alone does not authorize remediation");
  assert.equal(await invoke({
    argv: remediationArgv,
    env: { GITHUB_SHA: candidate, DEPLOY_EVENT_NAME: "workflow_dispatch", DEPLOY_REMEDIATION_INPUT: "true" },
    fetchImpl: sequenceFetch([response(200, "live-build"), response(404), response(404)]),
  }), 0, "explicit remediation requires actual canonical live absence");
  assert.equal(await invoke({
    argv: remediationArgv,
    env: { GITHUB_SHA: candidate, DEPLOY_EVENT_NAME: "workflow_dispatch", DEPLOY_REMEDIATION_INPUT: "true" },
    fetchImpl: sequenceFetch([response(200, "live-build"), response(500)]),
  }), 1, "transport/server failures cannot authorize remediation");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log("test-deploy-provenance: ok");
