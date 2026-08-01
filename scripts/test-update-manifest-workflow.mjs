#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for update-manifest.yml
// (#366 step 4). The central reconciler owns no lane but commits many admin
// control-plane artifacts; every one must be covered by a registry lane
// declaration or a declared exception.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/update-manifest.yml", import.meta.url), "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/update-manifest.yml",
});
assert.deepEqual(gate.lanes, [], "update-manifest is a central reconciler with no lane attribution");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.equal(gate.allowlist_count > 0, true, "update-manifest does commit admin control-plane artifacts");

assert.match(
  workflowText,
  /test-kpi-fixture-attestation\.mjs[\s\S]*?test-build-fenok-data-health-kpi\.mjs[\s\S]*?kpi-fixture-attestor\.mjs" record/,
  "the initial KPI suite always runs before its immutable attestation is recorded",
);
assert.match(
  workflowText,
  /git reset --hard origin\/main\n\s+kpi_fixture_digest_matches_reset=false\n\s+if node "\$RUNNER_TEMP\/kpi-fixture-attestor\.mjs" verify/,
  "every latest-main reset immediately recomputes the fixture digest",
);
assert.equal(
  (workflowText.match(/kpi-fixture-attestor\.mjs" verify/g) ?? []).length,
  2,
  "retry skip requires verification both after reset and immediately before the duplicate suite",
);
assert.match(
  workflowText,
  /if \[ "\$kpi_fixture_digest_matches_reset" = "true" \][\s\S]*?KPI fixture inputs unchanged[\s\S]*?else\n\s+node scripts\/test-build-fenok-data-health-kpi\.mjs\n\s+node "\$RUNNER_TEMP\/kpi-fixture-attestor\.mjs" record/,
  "a miss or malformed attestation runs the suite and records only its newly proven digest",
);
assert.match(
  workflowText,
  /check-fenok-public-mirror-guard\.mjs[\s\S]*?kpi_fixture_digest_matches_reset[\s\S]*?check-fenok-data-health-kpi\.mjs --strict --context=reconcile[\s\S]*?build:static-route-manifest[\s\S]*?stage-update-manifest-central\.mjs --check[\s\S]*?git push origin HEAD:main/,
  "attestation optimization preserves mirror, strict artifact, staging, and push ordering",
);

console.log("test-update-manifest-workflow: ok");
