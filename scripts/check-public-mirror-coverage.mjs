#!/usr/bin/env node
/**
 * check-public-mirror-coverage.mjs — standing coverage gate for the public mirror.
 *
 * #377 slice-2 contract, enforced continuously (CI + local):
 *   (a) no lane workflow may stage public-mirror paths directly — the mirror is
 *       owned by the merge boundary (sync-public-data.mjs full walk + update-manifest
 *       materialize routes + the fetch-stockanalysis full-sync commit).
 *   (b) every family that HAS a public mirror must be sync-covered (not in the
 *       derived exclusion lists) OR explicitly lane-staged — otherwise its mirror
 *       has no updater and silently freezes (the regression class hit twice on
 *       2026-08-10: slice-2 staging removal + registry public_mirror surgery).
 * (a) has no remaining lane exceptions since 2026-08-11: the last one
 *       (fetch-yahoo-ticker.yml) was removed when the plane serving enrollment
 *       (ENROLLED_PATHS "/data/macro/yahoo-ticker.json" + hourly publish +
 *       serving probe) landed. Companion untrack-prerequisite measurement:
 *       scripts/test-public-mirror-untrack-prereqs.mjs.
 *
 * Tree-state only (no network, no writes). Mirrors freshness stays with the KPI
 * and the hourly serving probe; this gate is structural.
 *
 * Exit codes: 0 = clean, 1 = structural violation(s). Output is the family map.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const CANONICAL_ROOT = path.join(REPO_ROOT, "data");
const MIRROR_ROOT = path.join(REPO_ROOT, "100xfenok-next", "public", "data");

// The merge boundary workflows that legitimately write the mirror.
const BOUNDARY_WORKFLOWS = new Set([
  ".github/workflows/update-manifest.yml",
  ".github/workflows/fetch-stockanalysis.yml", // full sync + its commit
]);

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function familyRoots() {
  const roots = new Set();
  for (const entry of listDir(CANONICAL_ROOT)) {
    if (entry.isDirectory() && entry.name !== "admin") {
      // admin/* is lane state; treat each admin subroot separately below.
      roots.add(entry.name);
    } else if (entry.isFile()) {
      roots.add(entry.name);
    }
  }
  for (const entry of listDir(path.join(CANONICAL_ROOT, "admin"))) {
    roots.add(`admin/${entry.name}`);
  }
  for (const entry of listDir(path.join(CANONICAL_ROOT, "computed"))) {
    roots.add(`computed/${entry.name}`);
  }
  return [...roots].sort();
}

function mirrorHasFamily(family) {
  const p = path.join(MIRROR_ROOT, family);
  return fs.existsSync(p);
}

function laneStagedMirrorPaths() {
  const staged = [];
  for (const file of listDir(WORKFLOWS_DIR)) {
    if (!file.name.endsWith(".yml")) continue;
    const rel = `.github/workflows/${file.name}`;
    if (BOUNDARY_WORKFLOWS.has(rel)) continue;
    const src = fs.readFileSync(path.join(WORKFLOWS_DIR, file.name), "utf8");
    // Normalize shell line continuations so a `git add -- \` split across two
    // lines cannot hide a mirror path from the scan.
    const normalized = src.replace(/\\[ \t]*\r?\n[ \t]*/g, " ");
    for (const line of normalized.split("\n")) {
      const m = line.match(/git\s+add.*?100xfenok-next\/public\/data(?:\/|$)/);
      if (m) staged.push(`${rel}: ${line.trim()}`);
    }
  }
  return staged;
}

async function main() {
  const { EXCLUDED_PUBLIC_DATA_ROOTS, EXCLUDED_PUBLIC_DATA_FILES } = await import(
    path.join(REPO_ROOT, "100xfenok-next", "scripts", "sync-public-data.mjs")
  );
  const excluded = new Set([...EXCLUDED_PUBLIC_DATA_ROOTS, ...EXCLUDED_PUBLIC_DATA_FILES]);

  const violations = [];
  const rows = [];

  for (const family of familyRoots()) {
    if (family.startsWith("admin/") && !mirrorHasFamily(family)) continue;
    const hasMirror = mirrorHasFamily(family);
    if (!hasMirror) continue;
    const syncCovered = !excluded.has(family);
    rows.push({ family, hasMirror: true, syncCovered });
    if (!syncCovered) {
      violations.push(
        `family "${family}" has a public mirror but is EXCLUDED from the sync and not lane-staged -> mirror has no updater (frozen). Restore its public_mirror declaration in scripts/lib/lane-registry.mjs or declare an explicit updater.`
      );
    }
  }

  const laneStaged = laneStagedMirrorPaths();
  for (const line of laneStaged) {
    violations.push(`lane workflow still stages mirror paths: ${line}`);
  }

  const table = rows
    .map((r) => `${r.family.padEnd(34)} mirror=${r.hasMirror} sync_covered=${r.syncCovered}`)
    .join("\n");
  console.log(`public-mirror coverage (${rows.length} mirrored families):\n${table}`);

  if (violations.length) {
    console.error(`\nCOVERAGE VIOLATIONS (${violations.length}):`);
    for (const v of violations) console.error(`- ${v}`);
    process.exit(1);
  }
  console.log("\ncoverage: OK — every mirrored family is sync-covered; no lane stages the mirror");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
