#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/pipeline-failure-alarm.yml"), "utf8");

assert.doesNotMatch(workflow, /git add (?:-A|--all)/);
const commitStep = workflow.slice(
  workflow.indexOf("- name: Commit alarm state"),
  workflow.indexOf("- name: Prepare issue body"),
);
assert.match(commitStep, /if: always\(\)/);
assert.match(commitStep, /continue-on-error: true/);
assert.match(
  commitStep,
  /scripts\/stage-lane-manifest\.sh[\s\S]*?--workflow \.github\/workflows\/pipeline-failure-alarm\.yml[\s\S]*?--stage always_if_exists \|\| exit 0/,
  "manifest publication failure must remain non-primary",
);
const manifestCall = commitStep.indexOf("scripts/stage-lane-manifest.sh");
const legacyAdd = commitStep.indexOf("git add data/admin/alarm-state.json");
assert.ok(manifestCall >= 0 && manifestCall < legacyAdd, "manifest staging must precede the retained literal add");
assert.match(commitStep, /git add data\/admin\/alarm-state\.json 100xfenok-next\/public\/data\/admin\/alarm-state\.json \|\| exit 0/);
assert.match(workflow, /- name: Open or update OPS issue[\s\S]*?if: steps\.pipeline\.outcome == 'failure'/);
assert.match(workflow, /- name: Fail on alarm[\s\S]*?if: steps\.pipeline\.outcome == 'failure'[\s\S]*?run: exit 1/);

console.log("test-pipeline-failure-alarm-manifest: ok");
