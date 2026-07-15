#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/fenok-edge-daily.yml"), "utf8");

assert.match(workflow, /node scripts\/test-data-supply-attempt-producer\.mjs/);
assert.match(workflow, /node scripts\/test-fetch-fenok-finra-daily-private\.mjs/);
assert.match(workflow, /node scripts\/test-fetch-fenok-occ-options-volume\.mjs/);
assert.match(workflow, /detection-attempts\/finra_short_volume\.json/);
assert.match(workflow, /detection-attempts\/occ_options_volume\.json/);
assert.match(workflow, /- name: Commit and push owned source artifacts\n\s+if: \$\{\{ always\(\) \}\}/);
assert.doesNotMatch(workflow, /git add -A/);

console.log("test-fenok-edge-daily-attempt-workflow: ok");
