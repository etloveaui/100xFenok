#!/usr/bin/env node
// Canonical-only staging contract for the build-stocks-analyzer lane.
// The lane publishes only data/ paths; the public mirror is owned by the
// merge boundary (update-manifest materialize routes + sync walk), enforced
// by the actual publication fences.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Exercise the actual builder: provider aliases must preserve canonical rows,
// raw consensus joins, and Yahoo enrichment without rewriting the raw source.
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scouter-alias-"));
try {
  const writeFixture = (relative, value) => {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  for (const relative of [
    "scripts/build-stocks-analyzer.mjs",
    "scripts/lib/yf-screener-enrichment.mjs",
    "scripts/lib/screener-return-periods.mjs",
  ]) {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
  }
  const source_date = "2026-09-04";
  const stocks = Object.fromEntries(["BRK.A", "BRK.B", "RBRK", "BRKR"].map((symbol) => [symbol, {
    n: symbol, c: "US", p: 100, pe: 20, pb: 2,
  }]));
  writeFixture("data/global-scouter/core/stocks_index.json", { source_date, stocks });
  const rawSymbols = ["BRKA", "BRKB", "RBRK", "BRKR"];
  const companyRecords = rawSymbols.map((key, i) => {
    const values = Array(34).fill(null);
    values[1] = key; values[2] = key; values[3] = "NYSE";
    values[8] = 1000 + i; values[11] = 3.24 + i; values[12] = 1.5 + i;
    values[9] = 0.1 + i / 100; values[14] = 0.02 + i / 100;
    return { key, values };
  });
  const consensusRecords = rawSymbols.map((key, i) => {
    const values = Array(27).fill(null);
    values[1] = key; values[26] = 10 + i;
    return { key, values };
  });
  const companyPath = "data/global-scouter/raw/company_master_m_company.json";
  const consensusPath = "data/global-scouter/raw/eps_consensus_t_eps_c.json";
  writeFixture(companyPath, { source_date, records: companyRecords });
  writeFixture(consensusPath, { source_date, records: consensusRecords });
  writeFixture("data/yf/finance/BRK.B.json", {
    schema_version: "yf-finance/v2", ticker: "BRK.B", source_as_of: source_date,
    data: { info: { currency: "USD", forwardPE: 21, forwardEps: 12 } },
  });
  const runBuilder = () => spawnSync(process.execPath, ["scripts/build-stocks-analyzer.mjs"], {
    cwd: fixtureRoot, encoding: "utf8",
  });
  let run = runBuilder();
  assert.equal(run.status, 0, run.stderr);
  const outputPath = path.join(fixtureRoot, "data/global-scouter/core/stocks_analyzer.json");
  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.count, 4, "renamed Berkshire classes must not disappear from the screener");
  assert.deepEqual(output.data.map((row) => row.symbol).sort(), Object.keys(stocks).sort());
  const berkshire = output.data.find((row) => row.symbol === "BRK.B");
  assert.equal(berkshire.eps, 11, "raw BRKB consensus joins canonical BRK.B");
  assert.equal(berkshire.momentum1m, 0.03);
  assert.equal(berkshire.epsForward, 12, "existing dotted Yahoo file remains connected");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixtureRoot, companyPath), "utf8")).records,
    companyRecords, "raw provider spelling remains unchanged");
  // A deliberate converter rejection must never be restored from the raw sheet.
  writeFixture("data/global-scouter/stocks/detail/BRK.B.json", {
    eps_consensus: { weekly: { fy_plus_1: [
      { date: source_date, value: null, rejection_reason: "source_duplicate_across_share_classes" },
    ] } },
  });
  writeFixture("data/global-scouter/stocks/detail/BRK.A.json", {
    eps_consensus: { weekly: { fy_plus_1: [
      { date: "2026-08-28", value: 32000 },
      { date: source_date, value: 33000 },
    ] } },
  });
  run = runBuilder();
  assert.equal(run.status, 0, run.stderr);
  const validated = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(validated.data.find((row) => row.symbol === "BRK.B").eps, undefined,
    "rejected structured EPS must not fall back to raw EPS");
  assert.equal(validated.data.find((row) => row.symbol === "BRK.A").eps, 33000,
    "structured EPS selects latest dated observation and preserves valid large values");
  assert.equal(validated.data.find((row) => row.symbol === "BRK.B").epsForward, 12,
    "separate forward EPS remains available");
  // A deliberate index rejection is authoritative; ordinary missing values
  // retain the existing company-master fallback.
  Object.assign(stocks["BRK.B"], {
    pe: null, pb: null, mc: null, dy: null,
    data_quality: { affected_fields: ["per", "pbr", "marketCap"] },
  });
  Object.assign(stocks["BRK.A"], { pe: null, mc: null });
  writeFixture("data/global-scouter/core/stocks_index.json", { source_date, stocks });
  run = runBuilder();
  assert.equal(run.status, 0, run.stderr);
  const withheld = JSON.parse(fs.readFileSync(outputPath, "utf8")).data;
  const suppressed = withheld.find((row) => row.symbol === "BRK.B");
  const missing = withheld.find((row) => row.symbol === "BRK.A");
  assert.equal(suppressed.per, null, "withheld PER must not be restored from the raw master");
  assert.equal(suppressed.pbr, null, "withheld PBR remains suppressed");
  assert.equal(suppressed.marketCap, null, "withheld market cap must not bypass the same annotation");
  assert.equal(suppressed.dividendYield, undefined, "a null index yield has no raw fallback");
  assert.equal(missing.per, 3.24, "un-annotated missing PER retains the raw-master fallback");
  assert.equal(missing.marketCap, 1000, "un-annotated missing market cap retains its fallback");
  const lastGood = fs.readFileSync(outputPath, "utf8");
  for (const [relative, records] of [[companyPath, companyRecords], [consensusPath, consensusRecords]]) {
    writeFixture(relative, { source_date, records: [...records, { ...records[0], key: "BRK.A" }] });
    run = runBuilder();
    assert.notEqual(run.status, 0, "ambiguous alias collisions must fail before replacing last-good output");
    assert.equal(fs.readFileSync(outputPath, "utf8"), lastGood);
    writeFixture(relative, { source_date, records });
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("test-build-stocks-analyzer-manifest: ok");
