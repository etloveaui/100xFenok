#!/usr/bin/env node
// A push trigger aimed at commits made by workflows can never fire.
//
// GitHub does not start a workflow from a push made with the default
// GITHUB_TOKEN, and every producer in this repository pushes that way. DEC-360
// gave build-stocks-analyzer an `on: push` filter over seven input families so
// the review-only SEC 13F bridge would re-seal when those inputs advanced.
// Measured 2026-08-21: that workflow has exactly three push runs in its whole
// history, all on 2026-08-16, all authored by a human. Zero producer commits
// have ever reached it.
//
// The trigger was not merely dead, it was wrong by construction: the push path
// runs the bridge builder without the S2/S5 regeneration whose ordering the
// test's pinned counts encode, which is the 69-vs-67 disagreement recorded on
// B-384. Update Manifest already owns both the rebuild and the git copies of
// all three sealed inputs, from a full non-sparse checkout, and its own script
// says so at scripts/update-manifest-projections.sh:343-345.
//
// This contract stops the shape from coming back anywhere: no workflow may
// filter `on: push` over data paths that only producers write. A path filter
// over source or workflow files is fine - that is a human-push concern and is
// how validate-workflows legitimately works.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Paths only a workflow ever writes. A push filter over these is unreachable.
const PRODUCER_WRITTEN = /^\s*-\s*'(data\/|100xfenok-next\/public\/data\/)/;

function pushPathBlock(source) {
  const at = source.search(/^on:/m);
  if (at < 0) return null;
  const onBlock = source.slice(at, source.search(/^permissions:|^jobs:/m));
  const push = onBlock.search(/^\s{2}push:/m);
  if (push < 0) return null;
  const rest = onBlock.slice(push);
  const end = rest.search(/\n\s{2}(schedule|workflow_dispatch|workflow_run|repository_dispatch):/);
  return end < 0 ? rest : rest.slice(0, end);
}

// SCOPE, stated because a broader version of this was written first and was
// wrong. Flagging every push filter over data/** caught five workflows, and a
// path alone cannot tell a trigger that is dead from one that is a convenience
// for human pushes - build-stocks-analyzer's own three push runs were human.
//
// B-395 measured the other four on 2026-08-21 and removed NONE of them. Each is
// declared below with what its run history actually says, so the next person
// inherits the measurement instead of the question. The declaration is not a
// blanket exemption: a FIFTH workflow growing this shape fails until someone
// measures it, and a declared workflow that no longer carries the filter fails
// as a stale entry.
const PRODUCER_PATH_PUSH_FILTER_REASONS = Object.freeze({
  "deploy-worker.yml":
    "ALIVE, human-push convenience. 1,318 push runs; the newest 100 are all actor etloveaui, most recently 'fix(ui): use defined Edge score token' on 2026-08-20. A person changing the site expects a redeploy, and producer commits reach it only through Update Manifest, never through this filter",
  "update-manifest.yml":
    "ALIVE, human-push convenience. 2,372 push runs, the newest being this session's own SEC 13F re-pin on 2026-08-21. Thirteen of the newest hundred carry producer-shaped 'data:' messages but every one was pushed by a person; a GITHUB_TOKEN push cannot start a workflow, so a run existing IS the proof it was human",
  "validate-workflows.yml":
    "ALIVE, and it is the gate itself. 445 push runs. Its filter covers pinned data fixtures - publish-outcome shards, the bridge index, lane and metadata manifests - which is exactly the case the header above calls legitimate: a person editing a fixture should re-run the gate. Blunting the gate is worth one extra step of caution, so this entry is deliberate rather than incidental",
  "global-scouter-shadow-publish.yml":
    "NO OPPORTUNITY YET - measured, and specifically NOT dead. Its whole history is one run, a workflow_dispatch on 2026-08-17T09:11:21Z, and the workflow itself only landed at fe5fd69dc9 on 2026-08-17T09:09:55Z. Since then five commits touched data/global-scouter/**, and all five are build-stocks-analyzer producer commits that structurally cannot fire it; zero human pushes have occurred. Its header states the design - the export is owner-run, so the owner's push IS the event - so the trigger is reachable and has simply had no turn. RE-MEASURE RATHER THAN TRUST THIS once an owner export lands: the path is producer-dominated, which is the same ambiguity B-395 exists for",
});

// Only build-stocks-analyzer is enforced as removed; the four above are
// enforced as DECLARED. That split is the point of B-395.
let inspected = 0;
const producerPathFilters = new Set();
for (const name of fs.readdirSync(WORKFLOW_DIR).filter((n) => n.endsWith(".yml"))) {
  const block = pushPathBlock(fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8"));
  if (!block) continue;
  inspected += 1;
  if (block.split("\n").some((line) => PRODUCER_WRITTEN.test(line))) producerPathFilters.add(name);
}
// The parser must see something, or every assertion below is vacuous.
assert.ok(inspected >= 1, `no push-path blocks were parsed at all (${inspected})`);
assert.ok(
  producerPathFilters.size >= 1,
  `no producer-path push filters were parsed at all (${producerPathFilters.size})`,
);

// Undeclared growth fails. This is the half that stops the shape returning.
for (const name of producerPathFilters) {
  assert.ok(
    Object.hasOwn(PRODUCER_PATH_PUSH_FILTER_REASONS, name),
    `${name} filters on: push over producer-written data paths and is undeclared. `
      + "Measure its push-run history and authorship, then declare it or remove the filter - "
      + "a path pattern alone cannot tell a dead trigger from a human-push convenience (B-395)",
  );
}

// Stale declarations fail too, or the list decays into a blanket exemption.
for (const name of Object.keys(PRODUCER_PATH_PUSH_FILTER_REASONS)) {
  assert.ok(
    producerPathFilters.has(name),
    `${name} is declared as carrying a producer-path push filter but no longer does; `
      + "remove the declaration rather than leaving a reason nothing matches",
  );
}

const analyzer = fs.readFileSync(path.join(WORKFLOW_DIR, "build-stocks-analyzer.yml"), "utf8");
const analyzerOn = analyzer.slice(0, analyzer.search(/^jobs:/m));
assert.ok(
  !/^\s{2}push:/m.test(analyzerOn),
  "build-stocks-analyzer must not carry a push trigger: it never fired for a producer commit "
    + "(3 push runs ever, all human, 2026-08-16) and its push path runs the bridge builder "
    + "without the S2/S5 regeneration the pinned counts encode",
);
assert.match(analyzerOn, /^\s{2}schedule:/m, "its daily cron must remain");
assert.match(analyzerOn, /^\s{2}workflow_dispatch:/m, "manual dispatch must remain");

// Update Manifest must keep owning the rebuild, or removing the trigger strands
// the bridge seal entirely.
const projections = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "update-manifest-projections.sh"), "utf8",
);
// Strip shell comments first. Matching the raw text passed with the call
// commented out, which is the same vacuous shape found repeatedly today.
const projectionCode = projections
  .split("\n")
  .map((line) => line.replace(/(^|\s)#.*$/, ""))
  .join("\n");
assert.match(
  projectionCode,
  /node scripts\/build-sec13f-bridge-index\.mjs/,
  "Update Manifest must still rebuild the bridge index; it is now the only owner",
);
const manifestWorkflow = fs.readFileSync(path.join(WORKFLOW_DIR, "update-manifest.yml"), "utf8");
assert.ok(
  !/sparse-checkout/.test(manifestWorkflow),
  "Update Manifest must keep a full checkout; a sparse cone would build the bridge from a partial tree",
);

console.log(
  `test-producer-push-triggers: ok (${inspected} push-path blocks inspected, `
    + `${producerPathFilters.size} over producer paths, all declared, 1 enforced as removed)`,
);
