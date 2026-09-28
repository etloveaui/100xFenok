#!/usr/bin/env node
/**
 * Hermetic fixture proof for check-yf-finance-mirror-gap.mjs.
 *
 * Uses temp canonical/mirror trees (no repo state, no git, no network) and
 * asserts the exact file-set/hash gap contract: missing, stale-twin, identical,
 * extra, named-symbol rows, and summary stamps. The git-anchor classification
 * is exercised with anchors disabled (the real-tree report runs separately).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeYfFinanceMirrorGap } from "./check-yf-finance-mirror-gap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeJson(dir, name, payload) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yf-mirror-gap-"));
let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
};

try {
  const canonical = path.join(tmp, "canonical");
  const mirror = path.join(tmp, "mirror");
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(mirror, { recursive: true });

  // 1. identical twin
  writeJson(canonical, "AAPL.json", { ticker: "AAPL", value: 1 });
  writeJson(mirror, "AAPL.json", { ticker: "AAPL", value: 1 });
  // 2. stale twin: mirror carries an older revision
  writeJson(canonical, "688825.SS.json", { ticker: "688825.SS", fetched_at: "2026-08-10T17:06:02Z", value: 2 });
  writeJson(mirror, "688825.SS.json", { ticker: "688825.SS", fetched_at: "2026-08-07T00:00:00Z", value: 1 });
  // 3. missing on mirror (would 404 when served)
  writeJson(canonical, "EDOG.json", { ticker: "EDOG", value: 3 });
  // 4. extra on mirror (retired canonical row)
  writeJson(mirror, "RETIRED.json", { ticker: "RETIRED", value: 4 });
  // 5. named symbol absent from both sides (fetch never produced canonical)
  writeJson(canonical, "_summary.json", { generated_at: "2026-08-10T15:24:42Z", count: 4, ok: 3, failed: 1 });
  writeJson(mirror, "_summary.json", { generated_at: "2026-08-10T15:24:42Z", count: 4, ok: 3, failed: 1 });

  const report = computeYfFinanceMirrorGap({
    canonicalDir: canonical,
    mirrorDir: mirror,
    symbols: ["285A.T", "688825.SS", "AAPL", "EDOG"],
    withGitAnchors: false,
  });

  assert.deepEqual(report.counts, {
    canonical: 4,
    mirror: 4,
    missing_on_mirror: 1,
    stale_twins: 1,
    identical: 2,
    extra_on_mirror: 1,
  });
  ok("file-set gap counts are exact (missing/stale/identical/extra)");

  assert.equal(report.classification.expected_publication_delay, null);
  assert.deepEqual(report.classification.unexplained_missing, ["EDOG.json"]);
  assert.deepEqual(report.classification.unexplained_stale, ["688825.SS.json"]);
  ok("git anchors disabled leaves every gap row unexplained and reported");

  assert.deepEqual(report.summary_stamps.canonical, {
    generated_at: "2026-08-10T15:24:42Z",
    count: 4,
    ok: 3,
    failed: 1,
  });
  assert.deepEqual(report.summary_stamps.canonical, report.summary_stamps.mirror);
  ok("_summary stamps are compared on both sides");

  const bySymbol = Object.fromEntries(report.symbols.map((row) => [row.symbol, row]));
  assert.equal(bySymbol["285A.T"].verdict, "absent_canonical");
  assert.equal(bySymbol["285A.T"].canonical, false);
  assert.equal(bySymbol["285A.T"].mirror, false);
  assert.equal(bySymbol["688825.SS"].verdict, "stale_twin");
  assert.equal(bySymbol["688825.SS"].fetched_at, "2026-08-10T17:06:02Z");
  assert.equal(bySymbol["AAPL"].verdict, "in_sync");
  assert.equal(bySymbol["EDOG"].verdict, "missing_on_mirror");
  ok("named-symbol rows carry canonical/mirror presence, hashes, and verdicts");

  const shaDiff = report.symbols.find((row) => row.symbol === "688825.SS");
  assert.notEqual(shaDiff.canonical_sha256, shaDiff.mirror_sha256);
  assert.match(shaDiff.canonical_sha256, /^[0-9a-f]{64}$/);
  ok("stale verdict is bound to a real sha256 content difference");

  assert.throws(
    () => computeYfFinanceMirrorGap({ canonicalDir: path.join(tmp, "nope"), mirrorDir: mirror }),
    /prerequisites missing/,
  );
  ok("missing prerequisite directories fail closed");

  console.log(`\n# ${passed} yf mirror-gap fixture checks passed`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
