#!/usr/bin/env node
/**
 * test-cloud-data-plane-retention.mjs — the inventory completeness rule.
 *
 * Why this exists: the estate is 38,685 files, of which 20,919 had no declared
 * owner, so the budget gate could never compute storage. Two wrong fixes were
 * rejected before this one. Registering everything as a canonical output would
 * have declared operational state — acquisition attempt records, last-known-good
 * payloads, recovery journals — to be servable canonical data, which is false and
 * would have distorted the migration scope. Registering only the largest groups
 * would have left the gate closed while claiming progress.
 *
 * The rule implemented here is: a file counts as accounted for when it is owned
 * by a lane or derived asset, OR covered by an explicitly declared retention
 * exception carrying a reason. An undeclared file still fails. That distinction
 * is the whole point — this widens what can be *declared*, not what can be
 * *skipped*, and these tests exist to keep it that way.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { inventoryCloudDataPlaneRoots } from "./lib/cloud-data-plane-budget.mjs";

function fixtureRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-retention-"));
  for (const [relative, body] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body);
  }
  return root;
}

const LANES = { lanes: [{ id: "served", roots: { canonical_outputs: ["data/served"] } }] };
const DERIVED = { assets: [] };

function inventory(root, retention) {
  return inventoryCloudDataPlaneRoots({
    repoRoot: root,
    laneRegistry: LANES,
    derivedRegistry: DERIVED,
    retentionRegistry: retention,
  });
}

// --- An undeclared file still fails. This is the property that keeps it a gate. ---
{
  const root = fixtureRepo({ "data/served/a.json": "{}", "data/mystery/b.json": "{}" });
  try {
    const result = inventory(root, { retained: [], optional_paths: [] });
    assert.equal(result.complete, false, "an undeclared file must leave the inventory incomplete");
    assert.equal(result.unowned.file_count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- A declared retention exception accounts for the file without claiming it is canonical ---
{
  const root = fixtureRepo({ "data/served/a.json": "{}", "data/admin/state/b.json": "{}" });
  try {
    const result = inventory(root, {
      retained: [{ path: "data/admin/state", reason: "acquisition attempt state; never served" }],
      optional_paths: [],
    });
    assert.equal(result.complete, true, "a declared retention exception must account for the file");
    assert.equal(result.unowned.file_count, 0);
    assert.equal(result.retained.file_count, 1, "retained files are counted separately, not folded into owned");
    assert.equal(
      result.declared.file_count,
      1,
      "a retained file must NOT be counted as declared canonical coverage — that would overstate the servable estate",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- An exception without a reason is rejected, so the escape hatch cannot be used silently ---
{
  const root = fixtureRepo({ "data/served/a.json": "{}", "data/admin/state/b.json": "{}" });
  try {
    assert.throws(
      () => inventory(root, { retained: [{ path: "data/admin/state" }], optional_paths: [] }),
      /reason/i,
      "a retention exception must carry a reason",
    );
    assert.throws(
      () => inventory(root, { retained: [{ path: "data/admin/state", reason: "" }], optional_paths: [] }),
      /reason/i,
      "an empty reason must be rejected",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- A retention exception may not shadow a lane's own canonical output ---
{
  const root = fixtureRepo({ "data/served/a.json": "{}" });
  try {
    assert.throws(
      () => inventory(root, {
        retained: [{ path: "data/served", reason: "attempting to retain a served root" }],
        optional_paths: [],
      }),
      /served|canonical|overlap/i,
      "retention must not be usable to quietly remove a served family from the canonical set",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- A declared optional path may be absent; an undeclared missing root still fails ---
{
  const root = fixtureRepo({ "data/served/a.json": "{}" });
  try {
    const lanesWithOptional = {
      lanes: [{ id: "served", roots: { canonical_outputs: ["data/served", "data/rare/only-on-request.json"] } }],
    };
    const withoutDeclaration = inventoryCloudDataPlaneRoots({
      repoRoot: root,
      laneRegistry: lanesWithOptional,
      derivedRegistry: DERIVED,
      retentionRegistry: { retained: [], optional_paths: [] },
    });
    assert.equal(withoutDeclaration.complete, false, "an absent undeclared root must fail");
    assert.deepEqual(withoutDeclaration.missing_paths, ["data/rare/only-on-request.json"]);

    const withDeclaration = inventoryCloudDataPlaneRoots({
      repoRoot: root,
      laneRegistry: lanesWithOptional,
      derivedRegistry: DERIVED,
      retentionRegistry: {
        retained: [],
        optional_paths: [{ path: "data/rare/only-on-request.json", reason: "produced only on an explicit manual selection" }],
      },
    });
    assert.equal(withDeclaration.complete, true, "a declared optional path may be absent");
    assert.deepEqual(withDeclaration.missing_paths, [], "a declared optional absence is not a missing path");
    assert.deepEqual(withDeclaration.optional_absent, ["data/rare/only-on-request.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- The real registry accounts for the real estate ---
{
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const result = inventoryCloudDataPlaneRoots({ repoRoot });
  assert.equal(
    result.unowned.file_count,
    0,
    `every file must be owned or declared retained; still undeclared: ${JSON.stringify(result.unowned.top_level_groups?.slice(0, 5) ?? [])}`,
  );
  assert.deepEqual(result.missing_paths, [], "no undeclared missing path may remain");
  assert.equal(result.complete, true);
  assert.ok(result.retained.file_count > 0, "the real estate does contain retained control-plane state");
}

console.log("test-cloud-data-plane-retention: ok");
