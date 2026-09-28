#!/usr/bin/env node
/**
 * The data manifest states every family twice. Make the two halves agree.
 *
 * data/manifest.json describes each family in a `folders` entry and again in a
 * `categories` row, under different key names for the same three facts. Nothing
 * derives one from the other. On 2026-08-23 a weekly Global Scouter refresh
 * updated the folders half and shipped a file asserting 2026-08-21 with 1,073
 * indicators in one place and 2026-08-14 with 1,072 in the other. A peer review
 * caught it; no code did.
 *
 * This is the cheap half of B-408. It does not derive one half from the other -
 * that touches every converter's document step - it only refuses a file whose
 * two halves disagree, which is what would have caught that edit immediately.
 *
 * `version` vs `schemaVersion` is deliberately NOT compared. Measured across
 * all twenty families they differ for exactly one, and it is not established
 * that they are meant to be the same fact rather than a data version and a
 * schema version that happen to sit side by side.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

/** folders key -> categories key, for facts that are the same fact. */
const PAIRS = [
  ["updated", "lastUpdated"],
  ["file_count", "fileCount"],
  ["description", "notes"],
];

const MANIFESTS = [
  "data/manifest.json",
  "100xfenok-next/public/data/manifest.json",
];

const failures = [];
let checked = 0;

for (const rel of MANIFESTS) {
  const path = resolve(repo, rel);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${rel}: unreadable or invalid JSON - ${error.message}`);
    continue;
  }
  const folders = doc.folders ?? {};
  const categories = Array.isArray(doc.categories) ? doc.categories : [];
  const byName = new Map();
  for (const row of categories) {
    if (typeof row?.name !== "string") {
      failures.push(`${rel}: a categories row has no name`);
      continue;
    }
    if (byName.has(row.name)) failures.push(`${rel}: categories lists ${row.name} twice`);
    byName.set(row.name, row);
  }

  for (const [name, row] of byName) {
    if (!Object.hasOwn(folders, name)) {
      failures.push(`${rel}: categories lists ${name}, which has no folders entry`);
    }
  }

  for (const [name, folder] of Object.entries(folders)) {
    const row = byName.get(name);
    // A folders-only family is allowed: `admin` has no categories row by design.
    if (!row) continue;
    checked += 1;
    for (const [fKey, cKey] of PAIRS) {
      const a = folder[fKey];
      const b = row[cKey];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        failures.push(
          `${rel}: ${name} disagrees with itself - folders.${fKey}=${JSON.stringify(a)} but categories.${cKey}=${JSON.stringify(b)}`,
        );
      }
    }
  }
}

// The public copy must be an exact mirror; a drift here is the same defect one
// level up, and the SOP already requires the two files to move together.
const [canonical, mirror] = MANIFESTS.map((rel) => readFileSync(resolve(repo, rel), "utf8"));
if (canonical !== mirror) {
  failures.push("data/manifest.json and its public mirror are not byte-identical");
}

if (failures.length > 0) {
  console.error("test-manifest-halves-agree: FAIL");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`test-manifest-halves-agree: ok — ${checked} family/manifest pairs agree on date, count and description`);
