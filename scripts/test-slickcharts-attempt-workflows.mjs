#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const members = ["daily", "weekly", "monthly", "history", "symbols"];

for (const member of members) {
  const filePath = path.join(root, ".github", "workflows", `slickcharts-${member}.yml`);
  const workflow = fs.readFileSync(filePath, "utf8");
  assert.match(workflow, new RegExp(`--member ${member}\\b`), `${member} must emit its declared member id`);
  assert.match(workflow, /scripts\/publish-slickcharts-attempt\.sh/);
  assert.match(workflow, /- name: (?:Commit and push changes|Commit .* attempt)\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /SLICKCHARTS_ATTEMPT_EVENTS_PATH/);
  assert.doesNotMatch(
    workflow,
    /runs-on:[^\n]+\n\s+env:\n\s+SLICKCHARTS_ATTEMPT_EVENTS_PATH: \$\{\{ runner\.temp \}\}/,
    `${member} must not use runner context in job-level env`,
  );
  assert.match(workflow, /SLICKCHARTS_ATTEMPT_EVENTS_PATH=\$RUNNER_TEMP\/.+ >> "\$GITHUB_ENV"/);
  assert.doesNotMatch(workflow, /git pull --rebase --autostash/, `${member} must use shard-aware publishing`);
}

for (const member of ["history", "symbols"]) {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", `slickcharts-${member}.yml`), "utf8");
  assert.match(workflow, /Upload .*attempt telemetry/);
  assert.match(workflow, /--events-root artifacts/);
  assert.match(workflow, /if-no-files-found: ignore/);
}

{
  const daily = fs.readFileSync(path.join(root, ".github", "workflows", "slickcharts-daily.yml"), "utf8");
  assert.match(daily, /controlled_failure_files/);
  assert.match(daily, /SLICKCHARTS_DAILY_OUTCOMES_PATH/);
  assert.match(daily, /scripts\/run-slickcharts-daily-key\.mjs/g);
  assert.match(daily, /scripts\/slickcharts-daily-recovery\.mjs prepare/);
  assert.match(daily, /scripts\/slickcharts-daily-recovery\.mjs finalize/);
  assert.match(daily, /node scripts\/test-slickcharts-daily-recovery\.mjs/);
  assert.match(
    daily,
    /scripts\/publish-slickcharts-attempt\.sh[\s\S]*?--manifest-workflow \.github\/workflows\/slickcharts-daily\.yml[\s\S]*?--manifest-always always_if_exists[\s\S]*?--manifest-data success_if_exists[\s\S]*?--[\s\S]*?data\/slickcharts\/gainers\.json/,
    "daily must opt into manifest mode while retaining positional data paths",
  );
  for (const key of ["gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json"]) {
    assert.match(daily, new RegExp(`--key ${key.replace(".", "\\.")}`));
  }
}

{
  const weekly = fs.readFileSync(path.join(root, ".github", "workflows", "slickcharts-weekly.yml"), "utf8");
  assert.match(
    weekly,
    /scripts\/publish-slickcharts-attempt\.sh[\s\S]*?--manifest-workflow \.github\/workflows\/slickcharts-weekly\.yml[\s\S]*?--manifest-always always_if_exists[\s\S]*?--[\s\S]*?data\/slickcharts\/sp500\.json[\s\S]*?data\/slickcharts\/berkshire\.json/,
    "weekly must opt into its always manifest stage while retaining all positional data paths",
  );
}

console.log("test-slickcharts-attempt-workflows: ok");
