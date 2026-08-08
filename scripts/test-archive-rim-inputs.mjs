#!/usr/bin/env node
// P2 deterministic test — two sequential refreshes must preserve BOTH vintages.
// Uses a temp archive dir; never touches the real archive. Proves:
//  1) refresh 1 appends vintage 1
//  2) refresh 2 with the identical observation DEDUPES (vintage 1 survives, no duplicate)
//  3) a genuinely new observation appends vintage 2 and BOTH vintages survive
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRimIndexInputs } from "./build-rim-index.mjs";
import { archiveAll, appendVintage, buildPayoutVintage, stableKey } from "./archive-rim-inputs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");

let passed = 0;
const ok = (name) => { passed += 1; console.log(`PASS ${name}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rim-archive-test-"));
const payload = buildRimIndexInputs({ dataRootOverride: dataRoot });

// ---- 1. first refresh appends vintage 1 ----
const r1 = archiveAll(payload, { archiveDir: tmp });
for (const kind of ["forecast", "payout", "erp"]) {
  assert.equal(r1[kind].appended, true, `${kind} first refresh should append`);
  assert.equal(r1[kind].deduped, false);
}
const h1 = {
  forecast: JSON.parse(fs.readFileSync(path.join(tmp, "forecast_history.json"), "utf8")),
  payout: JSON.parse(fs.readFileSync(path.join(tmp, "payout_history.json"), "utf8")),
  erp: JSON.parse(fs.readFileSync(path.join(tmp, "erp_history.json"), "utf8")),
};
assert.equal(h1.forecast.length, 1);
assert.equal(h1.payout.length, 1);
assert.equal(h1.erp.length, 1);
ok("refresh 1 appends one vintage per lane");

// ---- 2. second refresh with identical observation dedupes ----
const r2 = archiveAll(payload, { archiveDir: tmp });
for (const kind of ["forecast", "payout", "erp"]) {
  assert.equal(r2[kind].appended, false, `${kind} identical refresh must dedup`);
  assert.equal(r2[kind].deduped, true);
}
const h2 = {
  forecast: JSON.parse(fs.readFileSync(path.join(tmp, "forecast_history.json"), "utf8")),
  payout: JSON.parse(fs.readFileSync(path.join(tmp, "payout_history.json"), "utf8")),
  erp: JSON.parse(fs.readFileSync(path.join(tmp, "erp_history.json"), "utf8")),
};
assert.equal(h2.forecast.length, 1, "identical refresh must not duplicate");
assert.equal(h2.payout.length, 1);
assert.equal(h2.erp.length, 1);
assert.equal(h2.forecast[0].vintage_id, h1.forecast[0].vintage_id, "vintage 1 identity unchanged");
ok("refresh 2 with identical observation dedupes; vintage 1 survives");

// ---- 3. a genuinely new observation appends vintage 2 and BOTH survive ----
const newForecast = { ...h1.forecast[0], source_as_of: "2026-08-01", derived_aggregate_hash: "newhash-forecast-abc123" };
const newPayout = { ...h1.payout[0], source_as_of: "2026-08-02T00:00:00+00:00", derived_aggregate_hash: "newhash-payout-abc123" };
const newErp = { ...h1.erp[0], source_as_of: "August 1, 2026", derived_aggregate_hash: "newhash-erp-abc123" };
const r3 = {
  forecast: appendVintage("forecast_history.json", newForecast, { archiveDir: tmp }),
  payout: appendVintage("payout_history.json", newPayout, { archiveDir: tmp }),
  erp: appendVintage("erp_history.json", newErp, { archiveDir: tmp }),
};
for (const kind of ["forecast", "payout", "erp"]) {
  assert.equal(r3[kind].appended, true, `${kind} new observation must append`);
  assert.equal(r3[kind].count, 2, `${kind} should now hold two vintages`);
}
const h3 = {
  forecast: JSON.parse(fs.readFileSync(path.join(tmp, "forecast_history.json"), "utf8")),
  payout: JSON.parse(fs.readFileSync(path.join(tmp, "payout_history.json"), "utf8")),
  erp: JSON.parse(fs.readFileSync(path.join(tmp, "erp_history.json"), "utf8")),
};
assert.equal(h3.forecast.length, 2);
assert.equal(h3.payout.length, 2);
assert.equal(h3.erp.length, 2);
assert.equal(h3.forecast[0].vintage_id, h1.forecast[0].vintage_id, "vintage 1 still first");
assert.equal(h3.forecast[1].vintage_id, r3.forecast.vintage_id, "vintage 2 appended after");
ok("refresh 3 with a new observation appends vintage 2; BOTH vintages preserved");

// ---- 4. archive content sanity: live semantics present ----
assert.ok(Number.isFinite(h1.forecast[0].entries[0].fy1), "forecast fy1 present");
assert.ok(h1.payout[0].entries[0].payout_route_a != null, "payout route A present");
assert.ok(h1.payout[0].entries[0].yield_observation.yield_pct != null, "yield observation present");
assert.ok(h1.erp[0].value.us_erp != null, "ERP value present");
assert.ok(h1.forecast[0].raw_source_hash && h1.forecast[0].derived_aggregate_hash, "forecast hashes present");
ok("archive records carry live-semantic fields and hashes");

// ---- 5. REGRESSION: a scrape that changes only its own timestamp is NOT a new vintage ----
// The payout lane's dedup key once hashed the yield file's scrape timestamp and its whole-file
// hash. Every re-scrape then minted a "revision" with economically identical payout routes, so
// the archive appended forever and deduplicated nothing. Tests 1-3 could not see this because
// they re-ran against the same on-disk file. This one varies the file.
const yieldFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "rim-yield-fixture-"));
function writeYieldFixture(name, srcPath, updatedAt) {
  const y = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  y.updated = updatedAt;
  const p = path.join(yieldFixtureDir, name);
  fs.writeFileSync(p, JSON.stringify(y, null, 1));
  return p;
}
const liveSpx = path.join(dataRoot, "slickcharts", "sp500-yield.json");
const liveNdx = path.join(dataRoot, "slickcharts", "nasdaq100-yield.json");

const scrapeA = {
  SPX: writeYieldFixture("spx-a.json", liveSpx, "2026-08-01T21:34:17+00:00"),
  NDX: writeYieldFixture("ndx-a.json", liveNdx, "2026-08-01T21:34:17+00:00"),
};
const scrapeB = {
  SPX: writeYieldFixture("spx-b.json", liveSpx, "2026-08-02T09:02:55+00:00"),
  NDX: writeYieldFixture("ndx-b.json", liveNdx, "2026-08-02T09:02:55+00:00"),
};

const vA = buildPayoutVintage(payload, { yieldFiles: scrapeA });
const vB = buildPayoutVintage(payload, { yieldFiles: scrapeB });

assert.notEqual(
  JSON.parse(fs.readFileSync(scrapeA.SPX, "utf8")).updated,
  JSON.parse(fs.readFileSync(scrapeB.SPX, "utf8")).updated,
  "fixture sanity: the two scrapes must differ in their timestamp",
);
assert.equal(vA.derived_aggregate_hash, vB.derived_aggregate_hash,
  "a timestamp-only re-scrape must not change the economic hash");
assert.equal(stableKey(vA), stableKey(vB),
  "a timestamp-only re-scrape must not change the dedup key");

const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), "rim-archive-dedup-"));
const a5 = appendVintage("payout_history.json", vA, { archiveDir: tmp5 });
const b5 = appendVintage("payout_history.json", vB, { archiveDir: tmp5 });
assert.equal(a5.appended, true, "first scrape appends");
assert.equal(b5.appended, false, "timestamp-only re-scrape must dedup, not append");
assert.equal(
  JSON.parse(fs.readFileSync(path.join(tmp5, "payout_history.json"), "utf8")).length, 1,
  "archive must hold exactly one payout vintage after a timestamp-only re-scrape",
);
// and the provenance the key excludes is still recorded on the vintage
assert.ok(vA.entries[0].yield_observation.updated, "the scrape timestamp is still recorded as provenance");
assert.ok(vA.raw_source_hash.sp500_yield && vA.raw_source_hash.nasdaq100_yield,
  "both raw file hashes recorded in full, neither truncated");
ok("timestamp-only re-scrape dedupes; the payout key hashes economic content only");

// ---- 6. a real payout change still appends ----
const changed = JSON.parse(JSON.stringify(payload));
changed.indices.SPX.derived.payout_ratio.value = payload.indices.SPX.derived.payout_ratio.value + 0.01;
const vChanged = buildPayoutVintage(changed, { yieldFiles: scrapeA });
assert.notEqual(vChanged.derived_aggregate_hash, vA.derived_aggregate_hash,
  "a genuine payout move must change the economic hash");
const c6 = appendVintage("payout_history.json", vChanged, { archiveDir: tmp5 });
assert.equal(c6.appended, true, "a genuine payout move must append");
assert.equal(c6.count, 2, "both vintages preserved");
ok("a genuine payout change still appends; dedup is not over-collapsing");

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(tmp5, { recursive: true, force: true });
fs.rmSync(yieldFixtureDir, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
