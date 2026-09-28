#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const members = ["daily", "weekly", "monthly", "history", "symbols"];
for (const member of members) {
  const workflow = fs.readFileSync(path.join(root, `.github/workflows/slickcharts-${member}.yml`), "utf8");
  assert.match(workflow, /scripts\/build-slickcharts-run-row\.mjs/);
  assert.match(workflow, new RegExp(`--member ${member}\\b`));
  assert.match(workflow, /scripts\/publish-slickcharts-attempt\.sh/);
  assert.match(workflow, /--manifest-workflow \.github\/workflows\/slickcharts-/);
  assert.match(workflow, /--manifest-always always_if_exists/);
  assert.doesNotMatch(workflow, /emit-slickcharts-attempt\.mjs|detection-attempts\/slickcharts\.json/);
  assert.doesNotMatch(workflow, /persist-cloud-publish-outcome\.mjs/);
}

for (const member of ["weekly", "symbols"]) {
  const workflow = fs.readFileSync(path.join(root, `.github/workflows/slickcharts-${member}.yml`), "utf8");
  assert.match(workflow, new RegExp(`check-cloud-family-acceptance\\.mjs --family=slickcharts-${member}`));
  assert.match(workflow, /CLOUD_ACCEPTANCE_MIN_OBSERVED_AT/);
}

const symbols = fs.readFileSync(path.join(root, ".github/workflows/slickcharts-symbols.yml"), "utf8");
assert.match(symbols, /Remove consumed symbol attempt artifacts/);
assert.doesNotMatch(symbols, /artifacts\/attempt-symbols-\*/);

console.log("test-slickcharts-attempt-workflows: ok");
