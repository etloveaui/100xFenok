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

const weekly = fs.readFileSync(path.join(root, ".github/workflows/slickcharts-weekly.yml"), "utf8");
const symbols = fs.readFileSync(path.join(root, ".github/workflows/slickcharts-symbols.yml"), "utf8");
assert.match(weekly, /^run-name: SlickCharts Weekly \(\$\{\{ github\.event\.inputs\.scraper \|\| 'all' \}\}\)$/m);
assert.doesNotMatch(weekly, /gh workflow run slickcharts-symbols\.yml/);
assert.match(symbols, /workflow_run:\s*\n\s+workflows: \[SlickCharts Weekly\]\s*\n\s+types: \[completed\]\s*\n\s+branches: \[main\]/);
assert.match(symbols, /github\.event\.workflow_run\.conclusion == 'success'/);
assert.match(symbols, /github\.event\.workflow_run\.head_branch == 'main'/);
assert.match(symbols, /github\.event\.workflow_run\.event == 'schedule'/);
assert.match(symbols, /github\.event\.workflow_run\.event == 'workflow_dispatch'/);
assert.match(symbols, /display_title == 'SlickCharts Weekly \(all\)'/);
assert.match(symbols, /needs\.scrape-batch\.result != 'skipped'/);
assert.match(symbols, /--full-run "\$\{\{ \(github\.event_name == 'workflow_run' \|\| github\.event\.inputs\.batch == 'ALL'\)/);
assert.doesNotMatch(symbols, /^  schedule:/m, "symbols has no independent timed run");
assert.match(symbols, /workflow_dispatch:/);
assert.match(symbols, /- ALL/);
assert.match(symbols, /- single/);
assert.match(symbols, /Remove consumed symbol attempt artifacts/);
assert.doesNotMatch(symbols, /artifacts\/attempt-symbols-\*/);

console.log("test-slickcharts-attempt-workflows: ok");
