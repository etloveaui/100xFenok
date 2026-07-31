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
  buildDeployProvenance,
  classifyLiveProvenance,
  evaluateDeploySourceFence,
  evaluatePostObservation,
  filterRunsByHeadBranch,
  isDeployProvenance,
  selectNewerActiveRun,
} from "./lib/deploy-provenance.mjs";
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

// --- selectNewerActiveRun ---------------------------------------------------

const runRow = (id, runNumber, status) => ({ id, run_number: runNumber, status });

// no runs -> not superseded
assert.equal(selectNewerActiveRun({ currentRunId: "1", currentRunNumber: 10, runs: [] }), null);

// self is excluded even when listed
assert.equal(
  selectNewerActiveRun({ currentRunId: "1", currentRunNumber: 10, runs: [runRow("1", 10, "in_progress")] }),
  null,
);

// older active runs do not supersede
assert.equal(
  selectNewerActiveRun({ currentRunId: "1", currentRunNumber: 10, runs: [runRow("2", 9, "in_progress")] }),
  null,
);

// a COMPLETED newer run (even failed) does not supersede — this run still ships
assert.equal(
  selectNewerActiveRun({ currentRunId: "1", currentRunNumber: 10, runs: [runRow("2", 11, "completed")] }),
  null,
);

// the queue-draining case: newest active run supersedes this one
const newer = selectNewerActiveRun({
  currentRunId: "1",
  currentRunNumber: 10,
  runs: [
    runRow("2", 12, "in_progress"),
    runRow("3", 11, "queued"),
    runRow("4", 9, "in_progress"),
    runRow("5", 13, "completed"),
  ],
});
assert.equal(newer.id, "3", "lowest-numbered newer ACTIVE run supersedes (deterministic)");

// every active status qualifies
for (const status of ["queued", "in_progress", "pending", "waiting", "requested"]) {
  const found = selectNewerActiveRun({
    currentRunId: "1",
    currentRunNumber: 10,
    runs: [runRow("9", 11, status)],
  });
  assert.equal(found?.id, "9", `status ${status} must count as active`);
}

assert.throws(() => selectNewerActiveRun({ currentRunId: "1", currentRunNumber: NaN, runs: [] }), /currentRunNumber/);
assert.throws(() => selectNewerActiveRun({ currentRunId: "1", currentRunNumber: 1, runs: null }), /array/);

// --- filterRunsByHeadBranch (review condition: non-main never supersedes) ---

const branchedRuns = [
  { ...runRow("2", 12, "in_progress"), head_branch: "km/fix-361" },
  { ...runRow("3", 11, "queued"), head_branch: "main" },
  { ...runRow("4", 13, "in_progress"), head_branch: null },
];
const mainOnly = filterRunsByHeadBranch(branchedRuns, "main");
assert.deepEqual(mainOnly.map((run) => run.id), ["3"], "only head_branch === 'main' runs survive");

// a newer active NON-main run must not supersede; a main run still does
const branchScoped = selectNewerActiveRun({
  currentRunId: "1",
  currentRunNumber: 10,
  runs: filterRunsByHeadBranch(branchedRuns, "main"),
});
assert.equal(branchScoped.id, "3");
assert.equal(
  selectNewerActiveRun({
    currentRunId: "1",
    currentRunNumber: 10,
    runs: filterRunsByHeadBranch([{ ...runRow("2", 12, "in_progress"), head_branch: "km/fix-361" }], "main"),
  }),
  null,
  "non-main dispatch run must not skip a main deploy",
);
assert.throws(() => filterRunsByHeadBranch(null, "main"), /array/);
assert.throws(() => filterRunsByHeadBranch([], ""), /branch name/);

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

const deployWorkflowPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
  "deploy-worker.yml",
);
const deployWorkflow = fs.readFileSync(deployWorkflowPath, "utf8");
const deployJob = deployWorkflow.slice(deployWorkflow.indexOf("\n  deploy:"));
const staticHeaders = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
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
const liveProvenanceFetchPosition = deployJob.indexOf("live-deploy-provenance-source-fence.json");
const sourceFencePosition = deployJob.indexOf("check-deploy-source-fence.mjs");
const uploadPosition = deployJob.indexOf("npx wrangler deploy");
assert.match(deployJob, /\$base_url\/deploy-provenance\.json\?cb=/);
assert.match(
  deployJob,
  /if ! curl[\s\S]+\$base_url\/deploy-provenance\.json\?cb=[\s\S]+\$base_url\/data\/admin\/deploy-provenance\.json\?cb=/,
);
assert.match(
  deployJob,
  /--provenance "\.open-next\/assets\/deploy-provenance\.json"/,
);
assert.equal(
  liveProvenanceFetchPosition >= 0
    && sourceFencePosition > liveProvenanceFetchPosition
    && uploadPosition > sourceFencePosition,
  true,
  "live provenance and the monotonic source fence must run in order immediately before upload",
);

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
