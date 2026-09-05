#!/usr/bin/env node

// Regression contract for the derived guru_holders_index holding-change
// enrichment. The fixture invokes the real builder in a temporary repository
// so the test never reads or mutates the working tree's data payload.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = path.join(ROOT, "scripts/build-guru-holders-index.mjs");
const GUARDED_JSON = path.join(ROOT, "scripts/lib/guarded-json.mjs");
const PRIVACY_AUTHORITY = path.join(
  ROOT,
  "100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs",
);
const PRIVACY_ENROLLMENT = path.join(
  ROOT,
  "100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-enrollment.generated.mjs",
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guru-holders-index-"));
const fixtureScripts = path.join(fixtureRoot, "scripts");
const fixtureLib = path.join(fixtureScripts, "lib");
const fixturePrivacy = path.join(fixtureRoot, "100xfenok-next/scripts/cloud-data-plane");
const fixtureAnalytics = path.join(fixtureRoot, "data/sec-13f/analytics");
const fixtureInvestors = path.join(fixtureRoot, "data/sec-13f/investors");

function filing(quarter, holdings) {
  return {
    quarter,
    filing_date: quarter === "2026-Q2" ? "2026-08-14" : "2026-05-15",
    report_date: quarter === "2026-Q2" ? "2026-06-30" : "2026-03-31",
    holdings,
  };
}

function holding(ticker, weight, cusip) {
  const row = { ticker };
  if (weight !== undefined) row.weight = weight;
  if (cusip !== undefined) row.cusip = cusip;
  return row;
}

function investorFile(name, filings) {
  return {
    metadata: { version: "fixture", quarters_covered: ["2026-Q2", "2026-Q1"] },
    investor: {
      name,
      entity: `${name} Capital`,
      cik: "0000000000",
      filings,
    },
  };
}

function writeJson(relativePath, value) {
  const absolute = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value)}\n`);
}

try {
  fs.mkdirSync(fixtureLib, { recursive: true });
  fs.mkdirSync(fixturePrivacy, { recursive: true });
  fs.mkdirSync(fixtureAnalytics, { recursive: true });
  fs.mkdirSync(fixtureInvestors, { recursive: true });
  fs.copyFileSync(BUILDER, path.join(fixtureScripts, "build-guru-holders-index.mjs"));
  fs.copyFileSync(GUARDED_JSON, path.join(fixtureLib, "guarded-json.mjs"));
  fs.copyFileSync(PRIVACY_AUTHORITY, path.join(fixturePrivacy, "cloud-data-plane-routing-authority.mjs"));
  fs.copyFileSync(PRIVACY_ENROLLMENT, path.join(fixturePrivacy, "cloud-data-plane-enrollment.generated.mjs"));

  writeJson("data/sec-13f/analytics/consensus.json", {
    metadata: {
      quarter: "2026-Q2",
      total_investors: 10,
      current_cohort_investors: 10,
    },
    consensus: {
      AAA: { holders_list: ["alpha", "beta", "gamma"] },
      XYZ: { holders_list: ["missing"] },
      BAD: { holders_list: ["invalid"] },
      CUS: { holders_list: ["cusip"] },
      NEW: { holders_list: ["conflict"] },
      NEG: { holders_list: ["controls"] },
      OVER: { holders_list: ["controls"] },
      SAME: { holders_list: ["controls"] },
    },
  });
  writeJson("data/sec-13f/summary.json", {
    investors: {
      alpha: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      beta: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      gamma: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      sold: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      missing: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      invalid: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      cusip: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      conflict: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      controls: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
      stale: { quarter: "2026-Q1", latest_quarter: "2026-Q1", is_stale: true },
      griffin: { quarter: "2026-Q2", latest_quarter: "2026-Q2", is_stale: false },
    },
  });

  // Alpha deliberately presents Q2 before Q1 and repeats AAA with mixed case;
  // the builder must order quarters and aggregate the ticker before comparing.
  writeJson("data/sec-13f/investors/alpha.json", investorFile("alpha", [
    filing("2026-Q2", [holding("aaa", 0.03), holding("AAA", 0.02)]),
    filing("2026-Q1", [holding("AAA", 0.03)]),
  ]));
  writeJson("data/sec-13f/investors/beta.json", investorFile("beta", [
    filing("2026-Q1", [holding("AAA", 0.05)]),
    filing("2026-Q2", [holding("AAA", 0.04)]),
  ]));
  writeJson("data/sec-13f/investors/gamma.json", investorFile("gamma", [
    filing("2026-Q1", [holding("BBB", 0.02)]),
    filing("2026-Q2", [holding("AAA", 0.01)]),
  ]));
  // Sold is still in the current public cohort: it has an exact current
  // filing, but AAA disappeared from that filing.
  writeJson("data/sec-13f/investors/sold.json", investorFile("sold", [
    filing("2026-Q2", [holding("BBB", 0.01)]),
    filing("2026-Q1", [holding("AAA", 0.07)]),
  ]));
  // No exact prior filing means unknown, never a new position.
  writeJson("data/sec-13f/investors/missing.json", investorFile("missing", [
    filing("2026-Q2", [holding("XYZ", 0.2)]),
  ]));
  // An invalid current weight may be held, but cannot become a zero-weight
  // comparable row or an artificial decrease.
  writeJson("data/sec-13f/investors/invalid.json", investorFile("invalid", [
    filing("2026-Q1", [holding("BAD", 0.08)]),
    filing("2026-Q2", [holding("BAD")]),
  ]));
  // The issuer retained its CUSIP while the current filing omitted ticker;
  // the stable CUSIP must resolve to the prior ticker before comparison.
  writeJson("data/sec-13f/investors/cusip.json", investorFile("cusip", [
    filing("2026-Q2", [holding(null, 0.05, "111111111")]),
    filing("2026-Q1", [holding("CUS", 0.04, "111111111")]),
  ]));
  // A CUSIP carrying different tickers across the two filings is ambiguous;
  // it must not fabricate a new/sold/comparable transition.
  writeJson("data/sec-13f/investors/conflict.json", investorFile("conflict", [
    filing("2026-Q1", [holding("OLD", 0.06, "222222222")]),
    filing("2026-Q2", [holding("NEW", 0.07, "222222222")]),
  ]));
  // Invalid ratios and malformed symbols are retained as neither zero nor a
  // guessed comparable transition; equivalent sums must remain unchanged.
  writeJson("data/sec-13f/investors/controls.json", investorFile("controls", [
    filing("2026-Q1", [holding("NEG", 0.1), holding("OVER", 0.8), holding("SAME", 0.3)]),
    filing("2026-Q2", [
      holding("NEG", -0.01),
      holding("OVER", 1.2),
      holding("SAME", 0.1),
      holding("SAME", 0.2),
      holding({ malformed: "ticker" }, 0.25),
    ]),
  ]));
  // This filer is stale because its latest filing is Q1; it must not enter
  // the current cohort even though it has a distinctive prior-quarter ticker.
  writeJson("data/sec-13f/investors/stale.json", investorFile("stale", [
    filing("2026-Q1", [holding("STALE", 0.5)]),
  ]));
  // The public route excludes this private investor file before reading; the
  // poison payload proves a private file cannot break the public build.
  fs.writeFileSync(path.join(fixtureInvestors, "griffin.json"), "{malformed private payload");

  execFileSync(process.execPath, [path.join(fixtureScripts, "build-guru-holders-index.mjs")], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });

  const output = JSON.parse(fs.readFileSync(
    path.join(fixtureAnalytics, "guru_holders_index.json"),
    "utf8",
  ));

  assert.equal(output.metadata.quarter, "2026-Q2");
  assert.equal(output.metadata.tickers, 8);
  assert.deepEqual(output.holders, {
    AAA: 3,
    XYZ: 1,
    BAD: 1,
    CUS: 1,
    NEW: 1,
    NEG: 1,
    OVER: 1,
    SAME: 1,
  });
  assert.ok(output.holding_changes && typeof output.holding_changes === "object",
    "builder must emit holding_changes");

  assert.deepEqual(output.holding_changes.AAA, {
    held_count: 3,
    new_count: 1,
    increased_count: 1,
    decreased_count: 1,
    unchanged_count: 0,
    sold_count: 1,
    comparable_count: 2,
    mean_weight_delta: 0.005,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.XYZ, {
    held_count: 1,
    new_count: 0,
    increased_count: 0,
    decreased_count: 0,
    unchanged_count: 0,
    sold_count: 0,
    comparable_count: 0,
    mean_weight_delta: null,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.BAD, {
    held_count: 1,
    new_count: 0,
    increased_count: 0,
    decreased_count: 0,
    unchanged_count: 0,
    sold_count: 0,
    comparable_count: 0,
    mean_weight_delta: null,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.CUS, {
    held_count: 1,
    new_count: 0,
    increased_count: 1,
    decreased_count: 0,
    unchanged_count: 0,
    sold_count: 0,
    comparable_count: 1,
    mean_weight_delta: 0.01,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.NEW, {
    held_count: 1,
    new_count: 0,
    increased_count: 0,
    decreased_count: 0,
    unchanged_count: 0,
    sold_count: 0,
    comparable_count: 0,
    mean_weight_delta: null,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.NEG, {
    held_count: 1,
    new_count: 0,
    increased_count: 0,
    decreased_count: 0,
    unchanged_count: 0,
    sold_count: 0,
    comparable_count: 0,
    mean_weight_delta: null,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.deepEqual(output.holding_changes.OVER, output.holding_changes.NEG);
  assert.deepEqual(output.holding_changes.SAME, {
    held_count: 1,
    new_count: 0,
    increased_count: 0,
    decreased_count: 0,
    unchanged_count: 1,
    sold_count: 0,
    comparable_count: 1,
    mean_weight_delta: 0,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.equal(Object.hasOwn(output.holding_changes, "OLD"), false);
  assert.equal(Object.hasOwn(output.holding_changes, "[OBJECT OBJECT]"), false);
  assert.equal(Object.hasOwn(output.holding_changes, "PRIVATE"), false);
  assert.equal(Object.hasOwn(output.holding_changes, "STALE"), false);

  // Coverage metadata is required to make missing prior filings and the
  // private route exclusion observable without publishing investor identities.
  assert.deepEqual(output.metadata.change_coverage, {
    eligible: 9,
    comparable: 8,
    missing_previous: 1,
    public_excluded: 1,
    comparison_basis: "public_retained_holdings",
    unresolved_mapping_count: 2,
    current_quarter: "2026-Q2",
    previous_quarter: "2026-Q1",
  });
  assert.equal(JSON.stringify(output.holding_changes).includes("alpha"), false);
  assert.equal(JSON.stringify(output.holding_changes).includes("griffin"), false);

  const outputPath = path.join(fixtureAnalytics, "guru_holders_index.json");
  const priorOutput = fs.readFileSync(outputPath);
  const builderPath = path.join(fixtureScripts, "build-guru-holders-index.mjs");
  const runExpectedFailure = (label) => {
    const result = spawnSync(process.execPath, [builderPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `${label} must fail closed`);
    assert.deepEqual(fs.readFileSync(outputPath), priorOutput,
      `${label} must preserve the previous output artifact`);
  };

  const missingAlpha = path.join(fixtureInvestors, "alpha.json.missing");
  fs.renameSync(path.join(fixtureInvestors, "alpha.json"), missingAlpha);
  try {
    runExpectedFailure("missing expected current investor file");
  } finally {
    fs.renameSync(missingAlpha, path.join(fixtureInvestors, "alpha.json"));
  }

  const betaPath = path.join(fixtureInvestors, "beta.json");
  const betaBytes = fs.readFileSync(betaPath);
  const betaPayload = JSON.parse(betaBytes);
  const betaCurrent = betaPayload.investor.filings.find((row) => row.quarter === "2026-Q2");
  betaCurrent.holdings = {};
  fs.writeFileSync(betaPath, `${JSON.stringify(betaPayload)}\n`);
  try {
    runExpectedFailure("malformed current holdings array");
  } finally {
    fs.writeFileSync(betaPath, betaBytes);
  }

  const betaRestored = JSON.parse(betaBytes);
  const betaPrior = betaRestored.investor.filings.find((row) => row.quarter === "2026-Q1");
  betaPrior.holdings = null;
  fs.writeFileSync(betaPath, `${JSON.stringify(betaRestored)}\n`);
  try {
    runExpectedFailure("malformed prior holdings array");
  } finally {
    fs.writeFileSync(betaPath, betaBytes);
  }

  const consensusPath = path.join(fixtureAnalytics, "consensus.json");
  const consensusBytes = fs.readFileSync(consensusPath);
  const malformedConsensus = JSON.parse(consensusBytes);
  malformedConsensus.metadata.quarter = null;
  fs.writeFileSync(consensusPath, `${JSON.stringify(malformedConsensus)}\n`);
  try {
    runExpectedFailure("malformed consensus quarter");
  } finally {
    fs.writeFileSync(consensusPath, consensusBytes);
  }

  const nonStringConsensusQuarter = JSON.parse(consensusBytes);
  nonStringConsensusQuarter.metadata.quarter = { value: "2026-Q2" };
  fs.writeFileSync(consensusPath, `${JSON.stringify(nonStringConsensusQuarter)}\n`);
  try {
    runExpectedFailure("non-string consensus quarter");
  } finally {
    fs.writeFileSync(consensusPath, consensusBytes);
  }

  const summaryPath = path.join(fixtureRoot, "data/sec-13f/summary.json");
  const summaryBytes = fs.readFileSync(summaryPath);
  const missingSummaryField = JSON.parse(summaryBytes);
  delete missingSummaryField.investors.alpha.is_stale;
  fs.writeFileSync(summaryPath, `${JSON.stringify(missingSummaryField)}\n`);
  try {
    runExpectedFailure("missing summary row field");
  } finally {
    fs.writeFileSync(summaryPath, summaryBytes);
  }

  const mismatchedCohort = JSON.parse(consensusBytes);
  mismatchedCohort.metadata.current_cohort_investors = 9;
  fs.writeFileSync(consensusPath, `${JSON.stringify(mismatchedCohort)}\n`);
  try {
    runExpectedFailure("current cohort count mismatch");
  } finally {
    fs.writeFileSync(consensusPath, consensusBytes);
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("test-build-guru-holders-index: fixture contract ready");
