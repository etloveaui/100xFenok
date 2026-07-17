#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEPLOY_PROVENANCE_SCHEMA,
  buildDeployProvenance,
  classifyLiveProvenance,
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
  sha: "47041d9507",
};

const provenance = buildDeployProvenance(base);
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
    GITHUB_SHA: "ae15b48dad",
  },
  now: "2026-07-17T04:26:00.000Z",
});

assert.equal(written.build_id, "bundle-abc");
assert.equal(written.built_at, "2026-07-17T04:26:00.000Z");
const onDisk = JSON.parse(fs.readFileSync(outPath, "utf8"));
assert.deepEqual(onDisk, written, "on-disk provenance must round-trip the builder output");

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

console.log("test-deploy-provenance: ok");
