#!/usr/bin/env node
// Generator for scripts/fixtures/ink4-contrast-sites.json, the render-target
// manifest consumed by test-ink4-contrast-contract.mjs. Do not hand-edit the
// fixture: change sources, then re-run this (or `regen:pins`) so occurrence
// counts, site counts, and the contract hash are recomputed.
//
// Design note: fixture sites are existence witnesses, not exhaustive per-line
// coverage (e.g. one pinned site may witness a line that occurs 3x in its
// file), and role/background/evidence-surface assignments are curated audit
// judgments. The generator therefore carries the curated roster forward,
// verifies every pin against current sources, and recomputes only the
// mechanical fields (site_count, contract_hash). Source drift fails loudly:
// a vanished target or a vanished background-evidence line throws with the
// exact site diff. (Unpinned candidate lines elsewhere in src are out of the
// audited sample by design and do not fail regeneration.)

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const INK4_CONTRAST_FIXTURE_PATH = path.join(APP_ROOT, "scripts/fixtures/ink4-contrast-sites.json");

// Must stay identical to the candidatePattern in test-ink4-contrast-contract.mjs.
const CANDIDATE_PATTERN = /var\(--c-ink-3\)|theme\.token\("ink3"\)|#64748b|text-slate-500|bg-slate-500|outline-slate-500|var\(--fnk-neutral-500\)|var\(--ink-3\)/;

const normalize = (value) => value.trim().replace(/\s+/g, " ");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function targetOccurrences(source) {
  const lines = source.split(/\r?\n/);
  const occurrences = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    if (!CANDIDATE_PATTERN.test(lines[index])) continue;
    const hash = sha256(normalize(lines[index]));
    occurrences.set(hash, (occurrences.get(hash) ?? 0) + 1);
  }
  return occurrences;
}

function lineEvidence(source) {
  const evidence = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = normalize(rawLine);
    const hash = sha256(line);
    const current = evidence.get(hash) ?? { count: 0, line };
    current.count += 1;
    evidence.set(hash, current);
  }
  return evidence;
}

function renderContractHash(sites) {
  const payload = sites.map((site) => [
    site.id,
    site.path,
    site.target_hash,
    site.occurrence,
    site.foreground,
    site.background,
    site.role,
    site.min_ratio,
    site.exemption ?? "",
    site.background_evidence.path,
    site.background_evidence.target_hash,
    site.background_evidence.occurrence,
    site.background_evidence.surface,
  ].join("|")).join("\n");
  return sha256(payload);
}

const readSource = (relativePath) => fs.readFileSync(path.join(APP_ROOT, relativePath), "utf8");

export function emitInk4ContrastFixture({ outputPath = INK4_CONTRAST_FIXTURE_PATH } = {}) {
  const baseline = JSON.parse(fs.readFileSync(INK4_CONTRAST_FIXTURE_PATH, "utf8"));

  const targetCache = new Map();
  const evidenceCache = new Map();
  const getTargets = (relativePath) => {
    if (!targetCache.has(relativePath)) targetCache.set(relativePath, targetOccurrences(readSource(relativePath)));
    return targetCache.get(relativePath);
  };
  const getEvidence = (relativePath) => {
    if (!evidenceCache.has(relativePath)) evidenceCache.set(relativePath, lineEvidence(readSource(relativePath)));
    return evidenceCache.get(relativePath);
  };

  for (const site of baseline.sites) {
    const actual = getTargets(site.path).get(site.target_hash) ?? 0;
    if (actual < site.occurrence) {
      throw new Error(
        `ink4 fixture drift: ${site.id} pins occurrence ${site.occurrence} but only ${actual} render-target line(s) remain in ${site.path}`,
      );
    }
    const evidence = getEvidence(site.background_evidence.path).get(site.background_evidence.target_hash);
    if ((evidence?.count ?? 0) < site.background_evidence.occurrence) {
      throw new Error(
        `ink4 fixture drift: ${site.id} background evidence pins occurrence ${site.background_evidence.occurrence} but only ${evidence?.count ?? 0} line(s) remain in ${site.background_evidence.path}`,
      );
    }
  }

  const manifest = {
    ...baseline,
    site_count: baseline.sites.length,
    contract_hash: renderContractHash(baseline.sites),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const invokedAsScript = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const mode = process.argv[2] === "--check" ? "check" : process.argv[2] === undefined ? "write" : null;
  if (mode === null) throw new Error("usage: node scripts/build-ink4-contrast-fixture.mjs [--check]");
  if (mode === "write") {
    const manifest = emitInk4ContrastFixture();
    console.log(`regen:ink4 wrote ${manifest.site_count} render sites`);
  } else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-ink4-"));
    try {
      const tempPath = path.join(tempRoot, "ink4-contrast-sites.json");
      const manifest = emitInk4ContrastFixture({ outputPath: tempPath });
      const canonical = fs.readFileSync(INK4_CONTRAST_FIXTURE_PATH);
      const regenerated = fs.readFileSync(tempPath);
      if (!canonical.equals(regenerated)) {
        throw new Error("ink4 contrast fixture is stale: re-run the generator and commit the result");
      }
      console.log(`qa:ink4-fixture ok (${manifest.site_count} byte-identical render sites)`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}
