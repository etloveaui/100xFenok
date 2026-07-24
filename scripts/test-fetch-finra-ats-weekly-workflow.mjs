#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "fetch-finra-ats-weekly.yml");
const source = fs.readFileSync(workflowPath, "utf8");

function exactCount(haystack, needle) {
  return haystack.split(needle).length - 1;
}

assert.equal(exactCount(source, "- cron: '17 11 * * 3'"), 1, "weekly schedule must be exact and unique");
assert.equal(exactCount(source, "controlled_failure:"), 1, "controlled failure input must be dispatch-only and unique");
assert.equal(exactCount(source, "FINRA_API_CLIENT_ID: ${{ secrets.FINRA_API_CLIENT_ID }}"), 1);
assert.equal(exactCount(source, "FINRA_API_CLIENT_SECRET: ${{ secrets.FINRA_API_CLIENT_SECRET }}"), 1);
assert.equal(source.includes("echo $FINRA_API_CLIENT"), false, "workflow must never echo FINRA secrets");
assert.equal(exactCount(source, "group: fenok-data-writer-${{ github.ref }}"), 1);
assert.equal(exactCount(source, "cancel-in-progress: false"), 1);
assert.equal(exactCount(source, "queue: max"), 1);
assert.equal(exactCount(source, "node scripts/fetch-finra-ats-weekly.mjs"), 1);
assert.equal(exactCount(source, "--workflow .github/workflows/fetch-finra-ats-weekly.yml"), 2);
assert.equal(exactCount(source, "--stage always_if_exists"), 1);
assert.equal(exactCount(source, "--stage success_if_exists"), 1);
assert.equal(source.includes("100xfenok-next/public/"), false, "phase-1 workflow must have no public path");
assert.equal(source.includes("finra_short_volume"), false, "weekly workflow must not touch the RegSHO lane");

for (const [label, mutate] of [
  ["schedule", (text) => text.replace("- cron: '17 11 * * 3'", "- cron: '0 11 * * 3'")],
  ["secret", (text) => text.replace("${{ secrets.FINRA_API_CLIENT_SECRET }}", "${{ secrets.WRONG_SECRET }}")],
  ["public path", (text) => `${text}\n# 100xfenok-next/public/data/admin/finra-ats\n`],
]) {
  const mutated = mutate(source);
  const valid = exactCount(mutated, "- cron: '17 11 * * 3'") === 1
    && exactCount(mutated, "FINRA_API_CLIENT_SECRET: ${{ secrets.FINRA_API_CLIENT_SECRET }}") === 1
    && !mutated.includes("100xfenok-next/public/");
  assert.equal(valid, false, `${label} mutation must fail the exact workflow contract`);
}

console.log("FINRA ATS weekly workflow contract: ok");
