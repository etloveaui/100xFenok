#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "fetch-finra-ats-weekly.yml");
const source = fs.readFileSync(workflowPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "admin", "lane-commit-manifest.json"), "utf8"));

function exactCount(haystack, needle) {
  return haystack.split(needle).length - 1;
}

assert.equal(exactCount(source, "- cron: '17 11 * * 3'"), 1, "weekly schedule must be exact and unique");
assert.equal(exactCount(source, "controlled_failure:"), 1, "controlled failure input must be dispatch-only and unique");
assert.equal(exactCount(source, "FINRA_API_CLIENT_ID: ${{ secrets.FINRA_API_CLIENT_ID }}"), 1);
assert.equal(exactCount(source, "FINRA_API_CLIENT_SECRET: ${{ secrets.FINRA_API_CLIENT_SECRET }}"), 1);
assert.equal(source.includes("echo $FINRA_API_CLIENT"), false, "workflow must never echo FINRA secrets");
assert.equal(exactCount(source, "group: fenok-data-writer-${{ github.ref }}"), 1);
assert.equal(exactCount(source, "cancel-in-progress: false"), 1);
assert.equal(exactCount(source, "queue: max"), 1);
assert.equal(exactCount(source, "node scripts/fetch-finra-ats-weekly.mjs"), 1);
assert.equal(exactCount(source, "--workflow .github/workflows/fetch-finra-ats-weekly.yml"), 2);
assert.equal(exactCount(source, "--stage always_if_exists"), 1);
assert.equal(exactCount(source, "--stage success_if_exists"), 1);
assert.equal(exactCount(source, "FETCH_PROMOTED: ${{ steps.fetch_finra_ats.outputs.promoted || 'false' }}"), 1);
assert.equal(exactCount(source, 'proof dispatch, nothing to stage: stage_selected=0'), 1);
assert.equal(source.includes("100xfenok-next/public/"), false, "phase-1 workflow must have no public path");
assert.equal(source.includes("finra_short_volume"), false, "weekly workflow must not touch the RegSHO lane");

const successStage = manifest.workflows[".github/workflows/fetch-finra-ats-weekly.yml"].stages.success_if_exists;
assert.deepEqual(
  successStage.map((entry) => entry.required),
  [true, true],
  "a promoted natural success must require both current and bounded-week artifacts",
);

function commitStepScript() {
  const stepMarker = "      - name: Commit FINRA ATS evidence\n";
  const stepStart = source.indexOf(stepMarker);
  assert.notEqual(stepStart, -1, "commit step must exist");
  const runMarker = "        run: |\n";
  const runStart = source.indexOf(runMarker, stepStart);
  assert.notEqual(runStart, -1, "commit step shell body must exist");
  return source.slice(runStart + runMarker.length)
    .split("\n")
    .filter((line) => line.length === 0 || line.startsWith("          "))
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

function runCommitFixture({ promoted, requiredFiles = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finra-ats-workflow-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  if (requiredFiles) fs.writeFileSync(path.join(root, "required-success-files"), "present\n");

  const stageStub = `#!/usr/bin/env bash
set -euo pipefail
stage=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--stage" ]]; then stage="$2"; shift 2; else shift; fi
done
echo "$stage" >> stage-calls.log
if [[ "$stage" == "success_if_exists" && ! -f required-success-files ]]; then
  echo "required file is missing" >&2
  exit 1
fi
if [[ "$stage" == "success_if_exists" ]]; then
  echo "lane-manifest stage proof: stage_selected=2"
else
  echo "lane-manifest stage proof: stage_selected=0"
fi
`;
  fs.writeFileSync(path.join(root, "scripts", "stage-lane-manifest.sh"), stageStub);
  fs.chmodSync(path.join(root, "scripts", "stage-lane-manifest.sh"), 0o755);

  const gitStub = `#!/usr/bin/env bash
if [[ "$1" == "diff" && "$2" == "--staged" && "$3" == "--quiet" ]]; then exit 0; fi
exit 0
`;
  fs.writeFileSync(path.join(root, "bin", "git"), gitStub);
  fs.chmodSync(path.join(root, "bin", "git"), 0o755);

  const result = spawnSync("bash", ["-c", commitStepScript()], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      FETCH_OUTCOME: "success",
      FETCH_PROMOTED: String(promoted),
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
  });
  return {
    ...result,
    stageCalls: fs.readFileSync(path.join(root, "stage-calls.log"), "utf8").trim().split("\n"),
  };
}

{
  const proofDispatch = runCommitFixture({ promoted: false });
  assert.equal(proofDispatch.status, 0, proofDispatch.stderr);
  assert.deepEqual(proofDispatch.stageCalls, ["always_if_exists"]);
  assert.match(proofDispatch.stdout, /proof dispatch, nothing to stage: stage_selected=0/);

  const missingNaturalArtifacts = runCommitFixture({ promoted: true });
  assert.equal(missingNaturalArtifacts.status, 1);
  assert.match(missingNaturalArtifacts.stderr, /required file is missing/);

  const naturalSuccess = runCommitFixture({ promoted: true, requiredFiles: true });
  assert.equal(naturalSuccess.status, 0, naturalSuccess.stderr);
  assert.deepEqual(naturalSuccess.stageCalls, ["always_if_exists", "success_if_exists"]);
}

for (const [label, mutate] of [
  ["schedule", (text) => text.replace("- cron: '17 11 * * 3'", "- cron: '0 11 * * 3'")],
  ["secret", (text) => text.replace("${{ secrets.FINRA_API_CLIENT_SECRET }}", "${{ secrets.WRONG_SECRET }}")],
  ["public path", (text) => `${text}\n# 100xfenok-next/public/data/admin/finra-ats\n`],
]) {
  const mutated = mutate(source);
  const valid = exactCount(mutated, "- cron: '17 11 * * 3'") === 1
    && exactCount(mutated, "FINRA_API_CLIENT_SECRET: ${{ secrets.FINRA_API_CLIENT_SECRET }}") === 1
    && !mutated.includes("100xfenok-next/public/");
  assert.equal(valid, false, `${label} mutation must fail the exact workflow contract`);
}

console.log("FINRA ATS weekly workflow contract: ok");
