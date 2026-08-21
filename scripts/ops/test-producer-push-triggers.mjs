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
// Only the case actually measured is enforced here; the other four are
// registered as B-395 rather than ripped out unmeasured.
let inspected = 0;
for (const name of fs.readdirSync(WORKFLOW_DIR).filter((n) => n.endsWith(".yml"))) {
  if (pushPathBlock(fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8"))) inspected += 1;
}
// The parser must see something, or every assertion below is vacuous.
assert.ok(inspected >= 1, `no push-path blocks were parsed at all (${inspected})`);

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

console.log(`test-producer-push-triggers: ok (${inspected} push-path blocks inspected, 1 enforced)`);
