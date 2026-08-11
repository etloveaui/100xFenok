#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const scripts = packageJson.scripts;
const reachable = new Set();
const pending = ["cf:build"];
const npmRun = /\bnpm run ([A-Za-z0-9:_-]+)/g;

while (pending.length > 0) {
  const scriptName = pending.pop();
  if (reachable.has(scriptName)) continue;
  assert.equal(typeof scripts[scriptName], "string", `missing package script: ${scriptName}`);
  reachable.add(scriptName);
  npmRun.lastIndex = 0;
  for (const match of scripts[scriptName].matchAll(npmRun)) {
    if (!reachable.has(match[1])) pending.push(match[1]);
  }
}

for (const scriptName of ["cf:build:steps", "sync-static", "reconcile:derived"]) {
  assert.ok(reachable.has(scriptName), `${scriptName} must remain reachable from cf:build`);
  assert.doesNotMatch(scripts[scriptName], /\b(?:build|qa):rim\S*/,
    `${scriptName} must not invoke retired RIM build or QA commands`);
}

for (const scriptName of [
  "build:rim-index",
  "build:rim-five-canonical",
  "build:rim-sustainable-public",
  "build:rim-sustainable-research",
  "qa:rim-sustainable-research",
  "qa:rim-index",
  "qa:rim-five-canonical",
  "qa:rim-band",
  "qa:rim-sustainable-public",
]) {
  assert.equal(typeof scripts[scriptName], "string", `${scriptName} remains available for explicit historical/audit use`);
}

console.log("deploy build chain excludes retired RIM and preserves standalone RIM scripts: ok");
