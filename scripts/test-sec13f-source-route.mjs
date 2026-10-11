#!/usr/bin/env node

// Fail-closed route guard for the daily 13F downstream lane. SEC ingestion is
// performed by the external CCH converter; this check prevents local Yahoo
// enrichment from making an old SEC source look current without provenance.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(
  fs.readFileSync(path.join(root, relativePath), "utf8"),
);

const summary = readJson("data/sec-13f/summary.json");
const metadata = summary.metadata;
const consensus = readJson("data/sec-13f/analytics/consensus.json");
const consensusMetadata = consensus.metadata;

function quarterEndDate(year, quarter) {
  return new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999));
}

function quarterKey(year, quarter) {
  return `${year}-Q${quarter}`;
}

function latestDueQuarter(now) {
  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  let latest = null;
  for (let year = currentYear - 2; year <= currentYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const due = new Date(quarterEndDate(year, quarter).getTime() + 45 * 24 * 60 * 60 * 1000);
      if (due <= now) latest = { year, quarter };
    }
  }
  if (!latest) return quarterKey(currentYear, Math.max(1, currentQuarter - 1));
  return quarterKey(latest.year, latest.quarter);
}

function compareQuarter(a, b) {
  const parse = (value) => {
    const match = String(value).match(/^(\d{4})-Q([1-4])$/u);
    return match ? Number(match[1]) * 4 + Number(match[2]) : -1;
  };
  return parse(a) - parse(b);
}

assert.ok(metadata && typeof metadata === "object", "13F summary metadata is required");
assert.match(
  String(metadata.source_generated_at ?? ""),
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
  "13F source_generated_at must preserve the upstream converter timestamp",
);
assert.match(
  String(metadata.source_quarter ?? ""),
  /^\d{4}-Q[1-4]$/u,
  "13F source_quarter must identify the upstream converter quarter",
);
assert.equal(metadata.partial_run, false, "13F source converter must not be partial");
assert.equal(metadata.publish_blocked, false, "13F source converter must not be publish-blocked");
assert.deepEqual(metadata.investor_errors, [], "13F source converter must have no investor errors");
assert.ok(Array.isArray(metadata.quarters_covered), "13F quarters_covered must be an array");
assert.equal(
  metadata.quarters_covered[0],
  metadata.source_quarter,
  "13F source_quarter must match the newest converter quarter",
);
const dueQuarter = latestDueQuarter(new Date());
assert.ok(
  compareQuarter(metadata.source_quarter, dueQuarter) >= 0,
  `13F source quarter ${metadata.source_quarter} is behind the latest due quarter ${dueQuarter}`,
);
assert.equal(
  consensusMetadata.quarter,
  metadata.source_quarter,
  "13F consensus quarter must match the converter source quarter",
);

const investorEntries = Object.entries(summary.investors ?? {});
const activeCount = investorEntries.filter(([, investor]) => (
  investor.latest_quarter === metadata.source_quarter
)).length;
assert.equal(activeCount, consensusMetadata.current_cohort_investors);
assert.equal(investorEntries.length, metadata.investor_count);
assert.equal(consensusMetadata.total_investors, activeCount);

console.log(
  `sec13f source route: ok (source_quarter=${metadata.source_quarter} ` +
  `cohort=${activeCount}/${investorEntries.length} ` +
  `latest_due_quarter=${dueQuarter} ` +
  `source_generated_at=${metadata.source_generated_at})`,
);

// Missing quarter metadata must fail before writing any index. Exercise the
// real builder in an isolated fixture, preserving three prior outputs.
if (!process.argv.includes("--candidate-only")) {
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "sec13f-quarter-"));
try {
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.copyFileSync(path.join(root, "scripts/build-13f-integrity-indexes.mjs"), path.join(fixture, "scripts/build-13f-integrity-indexes.mjs"));
  fs.symlinkSync(path.join(root, "scripts/lib"), path.join(fixture, "scripts/lib"), "dir");
  const dataDir = path.join(fixture, "data/sec-13f");
  fs.mkdirSync(path.join(dataDir, "analytics"), {recursive:true});
  fs.mkdirSync(path.join(dataDir, "investors"));
  const consensusFile = path.join(dataDir, "analytics/consensus.json");
  fs.writeFileSync(path.join(dataDir, "by_ticker.json"), '{"prior":true}');
  fs.writeFileSync(path.join(dataDir, "analytics/ticker_aliases.json"), '{"prior":true}');
  for (const quarter of [undefined, null, "", "2026-Q5", "2026-Q2junk"]) {
    const original = JSON.stringify({metadata:{quarter},consensus:{prior:true}});
    fs.writeFileSync(consensusFile, original);
    const run = spawnSync(process.execPath, [path.join(fixture, "scripts/build-13f-integrity-indexes.mjs")], {encoding:"utf8"});
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /requires valid consensus metadata.quarter/);
    assert.equal(fs.readFileSync(consensusFile, "utf8"), original);
    assert.equal(fs.readFileSync(path.join(dataDir, "by_ticker.json"), "utf8"), '{"prior":true}');
    assert.equal(fs.readFileSync(path.join(dataDir, "analytics/ticker_aliases.json"), "utf8"), '{"prior":true}');
  }
  fs.writeFileSync(consensusFile, JSON.stringify({metadata:{quarter:"2026-Q2"}}));
  fs.writeFileSync(path.join(dataDir, "investors/example.json"), JSON.stringify({investor:{filings:[
    {quarter:"2026-Q2",holdings:[{name:"Unconfirmed Fixture Issuer",cusip:"000000001"}]}, {quarter:"2026-Q3",holdings:[{name:"Wrong Quarter Issuer",cusip:"000000002"},{name:"Other Quarter Issuer",cusip:"000000003"}]}
  ]}}));
  const valid = spawnSync(process.execPath, [path.join(fixture, "scripts/build-13f-integrity-indexes.mjs")], {encoding:"utf8"});
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(fs.readFileSync(consensusFile)).metadata.quarter, "2026-Q2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "analytics/ticker_aliases.json"))).quarter, "2026-Q2");
  const audit = JSON.parse(fs.readFileSync(path.join(dataDir, "analytics/ticker_aliases.json")));
  assert.equal(audit.source_rows, 1, "only the declared quarter contributes rows");
  assert.equal(audit.unresolved_positions[0].quarter, "2026-Q2");
  fs.mkdirSync(path.join(fixture, "data/edgar"), {recursive:true});
  fs.mkdirSync(path.join(fixture, "data/yf/finance"), {recursive:true});
  fs.writeFileSync(path.join(fixture, "data/edgar/company_tickers.json"), JSON.stringify({rows:[{ticker:"FIXTR",title:"Unconfirmed Fixture Issuer"}]}));
  fs.writeFileSync(path.join(fixture, "data/yf/finance/FIXTR.json"), JSON.stringify({data:{info:{longName:"Unconfirmed Fixture Issuer"}}}));
  const resolved = spawnSync(process.execPath, [path.join(fixture, "scripts/build-13f-integrity-indexes.mjs")], {encoding:"utf8"});
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /newly_resolved_positions=1 newly_unresolved_positions=0/);
  fs.unlinkSync(path.join(fixture, "data/yf/finance/FIXTR.json"));
  fs.writeFileSync(path.join(fixture, "data/edgar/company_tickers.json"), JSON.stringify({rows:[]}));
  const unresolved = spawnSync(process.execPath, [path.join(fixture, "scripts/build-13f-integrity-indexes.mjs")], {encoding:"utf8"});
  assert.equal(unresolved.status, 0, unresolved.stderr);
  assert.match(unresolved.stdout, /newly_resolved_positions=0 newly_unresolved_positions=1/);
  console.log("sec13f quarter guard: five invalid forms preserve prior outputs; declared quarter passed");
} finally {
  fs.rmSync(fixture, {recursive:true,force:true});
}
}
