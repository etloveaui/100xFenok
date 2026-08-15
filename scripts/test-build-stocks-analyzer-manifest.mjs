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
