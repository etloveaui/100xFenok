#!/usr/bin/env node
// Canonical-only staging contract for the build-stocks-analyzer lane.
// The lane publishes only data/ paths; the public mirror is owned by the
// merge boundary (update-manifest materialize routes + sync walk), enforced
// structurally by scripts/check-public-mirror-coverage.mjs.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/build-stocks-analyzer.yml"), "utf8");

// UPDATED 2026-08-21 (B-384). This pinned the exact seven push paths DEC-360
// declared, and required the push trigger to exist at all. The trigger was
// removed at c2e5f7f528 because it could never fire: GitHub does not start a
// workflow from a push made with the default GITHUB_TOKEN, and every producer
// pushes that way. Measured, this workflow had three push runs in its whole
// history, all on 2026-08-16 and all authored by a human.
//
// It was also wrong by construction - the push path ran the bridge builder
// without the S2/S5 regeneration whose ordering the bridge test's pinned counts
// encode. Update Manifest owns the rebuild from a full checkout and says so at
// scripts/update-manifest-projections.sh:343-345.
//
// The invariant kept here is the inverse: the trigger must stay gone, so the
// unreachable shape cannot quietly return.
const onBlock = workflow.slice(0, workflow.search(/^jobs:/m));
assert.ok(
  !/\n  push:\n/.test(onBlock),
  "build-stocks-analyzer must not regain a push trigger; it can never fire for a producer commit",
);

assert.match(workflow, /\n  schedule:\n/);
assert.match(workflow, /\n  workflow_dispatch:\n/);
for (const stepName of [
  "Build stocks_analyzer.json",
  "Verify SEC 13F source provenance",
  "Build 13F downstream analytics (SEC ingestion is external)",
  "Build revision movers + industry benchmarks",
  "Build calendar previous-release values (FRED)",
  "Verify output",
]) {
  const stepStart = workflow.indexOf(`- name: ${stepName}`);
  assert.ok(stepStart >= 0, `workflow step must exist: ${stepName}`);
  const stepEnd = workflow.indexOf("\n      - name:", stepStart + 1);
  const step = workflow.slice(stepStart, stepEnd < 0 ? workflow.length : stepEnd);
  assert.match(step, /if: github\.event_name != 'push'/, `${stepName} must be skipped on lightweight pushes`);
}
const bridgeBuildStepStart = workflow.indexOf("- name: Build the SEC 13F bridge index from the regenerated tree");
const bridgeBuildStepEnd = workflow.indexOf("\n      - name:", bridgeBuildStepStart + 1);
const bridgeBuildStep = workflow.slice(
  bridgeBuildStepStart,
  bridgeBuildStepEnd < 0 ? workflow.length : bridgeBuildStepEnd,
);
assert.doesNotMatch(bridgeBuildStep, /if: github\.event_name != 'push'/, "bridge refresh must run on lightweight pushes");
assert.match(bridgeBuildStep, /build-sec13f-bridge-index\.mjs/);
assert.doesNotMatch(
  bridgeBuildStep,
  /test-sec13f-bridge-index\.mjs/,
  "the bridge verification must not gate production builders or publication",
);

const retryStart = workflow.indexOf("for attempt in $(seq 1 5); do");
const retryEnd = workflow.indexOf('echo "git push failed after retrying concurrent main updates"', retryStart);
const retryBlock = workflow.slice(retryStart, retryEnd);
assert.match(
  retryBlock,
  /git pull --rebase --autostash origin main[\s\S]*?build-sec13f-bridge-index\.mjs[\s\S]*?git add data\/computed\/sec13f_bridge_index\.json[\s\S]*?git push/,
  "every retry must rebuild the bridge after rebase",
);
assert.doesNotMatch(
  retryBlock,
  /test-sec13f-bridge-index\.mjs/,
  "the bridge verification must not block a rebased production publication",
);

const publishStepStart = workflow.indexOf("- name: Commit and push");
const publishStepEnd = workflow.indexOf("\n      - name:", publishStepStart + 1);
const publishStep = workflow.slice(publishStepStart, publishStepEnd < 0 ? workflow.length : publishStepEnd);
const bridgeReviewStepStart = workflow.indexOf(
  "- name: Verify the SEC 13F bridge index against the regenerated tree",
);
const bridgeReviewStepEnd = workflow.indexOf("\n      - name:", bridgeReviewStepStart + 1);
const bridgeReviewStep = workflow.slice(
  bridgeReviewStepStart,
  bridgeReviewStepEnd < 0 ? workflow.length : bridgeReviewStepEnd,
);
assert.ok(
  publishStepStart >= 0 && bridgeReviewStepStart > publishStepStart,
  "the regenerated-tree review contract must run only after production publication",
);
assert.match(publishStep, /id: publish/);
assert.match(
  publishStep,
  /if git diff --staged --quiet; then[\s\S]*?bridge_review_ready=true[\s\S]*?exit 0/,
  "a no-change producer run must still enable regenerated-tree review",
);
assert.match(
  publishStep,
  /if git push; then[\s\S]*?bridge_review_ready=true[\s\S]*?gh workflow run update-manifest\.yml/,
  "successful publication must enable review before the downstream dispatch can fail",
);
assert.match(
  bridgeReviewStep,
  /if: \$\{\{ always\(\) && steps\.publish\.outputs\.bridge_review_ready == 'true' \}\}/,
  "review must run after a successful or no-change publication even if a later command fails",
);
assert.match(bridgeReviewStep, /test-sec13f-bridge-index\.mjs/);
assert.doesNotMatch(bridgeReviewStep, /build-sec13f-bridge-index\.mjs/);
const dispatchText = "gh workflow run update-manifest.yml --ref main -f rebuild_slickcharts=true";
const dispatchIndex = workflow.indexOf(dispatchText);
const dispatchGuardStart = workflow.lastIndexOf('if [[ "$GITHUB_EVENT_NAME" != "push" ]]; then', dispatchIndex);
const dispatchGuardEnd = workflow.indexOf("\n              fi", dispatchGuardStart);
assert.ok(dispatchGuardStart >= 0 && dispatchIndex > dispatchGuardStart && dispatchIndex < dispatchGuardEnd,
  "Update Manifest dispatch must be guarded out for push-triggered bridge refreshes");

assert.doesNotMatch(workflow, /git add (?:-A|--all)/);
assert.match(
  workflow,
  /scripts\/stage-lane-manifest\.sh[\s\S]*?--workflow \.github\/workflows\/build-stocks-analyzer\.yml[\s\S]*?--stage always_if_exists/,
);
const manifestCall = workflow.indexOf("scripts/stage-lane-manifest.sh");
const legacyStatic = workflow.indexOf("git add \\");
assert.ok(
  manifestCall >= 0 && manifestCall < legacyStatic,
  "manifest staging must precede the static canonical path list",
);
assert.match(workflow, /data\/sec-13f\/investors\/\*\.json/);
assert.match(workflow, /scripts\/test-sec13f-source-route\.mjs/);
assert.doesNotMatch(workflow, /100xfenok-next\/public/);
assert.doesNotMatch(workflow, /find 100xfenok-next\/public/, "no lane mirror staging may return");
assert.match(workflow, /data\/calendar\/prev-values\.json/);
assert.match(workflow, /data\/damodaran\/industry_benchmarks\.json/);
assert.match(workflow, /data\/global-scouter\/core\/revision_movers\.json/);
assert.match(
  workflow,
  /if git push; then[\s\S]*?gh workflow run update-manifest\.yml --ref main -f rebuild_slickcharts=true/,
  "the push must hand the mirror refresh to the update-manifest boundary",
);

console.log("test-build-stocks-analyzer-manifest: ok");
