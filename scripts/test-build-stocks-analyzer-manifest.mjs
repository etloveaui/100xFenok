#!/usr/bin/env node

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
const legacyDynamic = workflow.indexOf("find 100xfenok-next/public/data/sec-13f/investors");
assert.ok(manifestCall >= 0 && manifestCall < legacyStatic, "manifest staging must precede the retained static path list");
assert.ok(legacyStatic < legacyDynamic, "the retained dynamic investor set must follow the static path list");
assert.match(workflow, /data\/sec-13f\/investors\/\*\.json/);
assert.match(
  workflow,
  /find 100xfenok-next\/public\/data\/sec-13f\/investors[\s\S]*?! -name 'griffin\.json' -print0 \| xargs -0 git add/,
  "public investor staging must retain the explicit griffin.json exclusion",
);
assert.match(workflow, /if git push; then[\s\S]*?gh workflow run update-manifest\.yml --ref main -f rebuild_slickcharts=true/);

console.log("test-build-stocks-analyzer-manifest: ok");
