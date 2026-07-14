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
  assert.doesNotMatch(workflow, /git pull --rebase --autostash/, `${member} must use shard-aware publishing`);
}

for (const member of ["history", "symbols"]) {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", `slickcharts-${member}.yml`), "utf8");
  assert.match(workflow, /Upload .*attempt telemetry/);
  assert.match(workflow, /--events-root artifacts/);
  assert.match(workflow, /if-no-files-found: ignore/);
}

console.log("test-slickcharts-attempt-workflows: ok");
