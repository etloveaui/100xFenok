// Offline sensitivity of the realised payout band to locally observed 2026
// S&P 500 and Nasdaq-100 membership changes.
//
// This deliberately does not claim point-in-time membership for fiscal years
// 2022-2025. Membership observation dates are collector run dates, and the
// finance files are the current local copies.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { payoutByYear } from "./build-index-payout-history.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEMBERSHIP_PATH = "data/slickcharts/membership-changes.json";
const PAYOUT_BUILDER_PATH = "scripts/build-index-payout-history.mjs";
const SELF_PATH = "scripts/build-fenok-rim-membership-sensitivity.mjs";
const OUT_PATH = "data/computed/fenok-rim/membership-sensitivity-2026.json";
const INDEX_CONFIG = [
  { key: "sp500", name: "S&P 500", snapshotPath: "data/slickcharts/sp500.json" },
  { key: "nasdaq100", name: "Nasdaq-100", snapshotPath: "data/slickcharts/nasdaq100.json" },
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSource(relativePath) {
  const buffer = fs.readFileSync(path.join(ROOT, relativePath));
  return {
    path: relativePath,
    sha256: sha256Buffer(buffer),
  };
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(`membership ledger validation failed: ${message}`);
}

function symbolSetSha256(symbols) {
  return sha256Buffer(Buffer.from(`${sorted(symbols).join("\n")}\n`, "utf8"));
}

export function validateMembershipLedger(payload, indexKey) {
  const index = payload?.indices?.[indexKey];
  assertCondition(index && Array.isArray(index.tickers), `${indexKey}: current ticker set missing`);
  assertCondition(new Set(index.tickers).size === index.tickers.length, `${indexKey}: duplicate current tickers`);
  assertCondition(index.count === index.tickers.length, `${indexKey}: current count does not match exact set`);

  const records = (payload?.changes ?? [])
    .map((change, position) => ({ ...change, position }))
    .filter((change) => change.index === indexKey)
    .sort((a, b) => b.date.localeCompare(a.date) || a.position - b.position);
  const bootstraps = records.filter((change) => Number(change.previousCount) === 0);
  assertCondition(bootstraps.length === 1, `${indexKey}: expected exactly one bootstrap record`);
  const bootstrap = bootstraps[0];
  assertCondition(Array.isArray(bootstrap.added), `${indexKey}: bootstrap exact set missing`);
  assertCondition((bootstrap.removed ?? []).length === 0, `${indexKey}: bootstrap must not remove symbols`);
  assertCondition(new Set(bootstrap.added).size === bootstrap.added.length, `${indexKey}: duplicate bootstrap symbols`);
  assertCondition(bootstrap.currentCount === bootstrap.added.length, `${indexKey}: bootstrap count does not match exact set`);

  const transitions = records.filter((change) => change !== bootstrap);
  assertCondition(
    transitions.every((change) => change.date >= bootstrap.date && Number(change.previousCount) > 0),
    `${indexKey}: transition predates or conflicts with bootstrap`,
  );

  const state = new Set(index.tickers);
  for (const change of transitions) {
    const added = change.added ?? [];
    const removed = change.removed ?? [];
    assertCondition(new Set(added).size === added.length, `${indexKey}/${change.date}: duplicate added symbols`);
    assertCondition(new Set(removed).size === removed.length, `${indexKey}/${change.date}: duplicate removed symbols`);
    assertCondition(!added.some((symbol) => removed.includes(symbol)), `${indexKey}/${change.date}: symbol both added and removed`);
    assertCondition(state.size === change.currentCount, `${indexKey}/${change.date}: currentCount transition mismatch`);
    assertCondition(added.every((symbol) => state.has(symbol)), `${indexKey}/${change.date}: added symbol absent from later state`);
    assertCondition(removed.every((symbol) => !state.has(symbol)), `${indexKey}/${change.date}: removed symbol present in later state`);
    for (const symbol of added) state.delete(symbol);
    for (const symbol of removed) state.add(symbol);
    assertCondition(state.size === change.previousCount, `${indexKey}/${change.date}: previousCount transition mismatch`);
  }

  const reconstructedBootstrap = sorted(state);
  const exactBootstrap = sorted(bootstrap.added);
  assertCondition(
    JSON.stringify(reconstructedBootstrap) === JSON.stringify(exactBootstrap),
    `${indexKey}: reverse transitions do not recover bootstrap exact set`,
  );
  return {
    bootstrap,
    transitions,
    exact_symbols: exactBootstrap,
    exact_set_sha256: symbolSetSha256(exactBootstrap),
  };
}

export function reconstructObservedMembership(payload, indexKey, observationDate) {
  const validation = validateMembershipLedger(payload, indexKey);
  assertCondition(observationDate >= validation.bootstrap.date, `${indexKey}: requested date predates bootstrap`);
  const current = new Set(payload?.indices?.[indexKey]?.tickers ?? []);

  for (const change of validation.transitions) {
    if (change.date <= observationDate) continue;
    for (const symbol of change.added ?? []) current.delete(symbol);
    for (const symbol of change.removed ?? []) current.add(symbol);
  }
  return sorted(current);
}

function observationDates(payload, indexKey) {
  return sorted(new Set((payload?.changes ?? [])
    .filter((change) => change.index === indexKey)
    .map((change) => change.date)));
}

function changedSymbols(currentSymbols, observedSymbols) {
  const current = new Set(currentSymbols);
  const observed = new Set(observedSymbols);
  const addedSinceObservation = sorted([...current].filter((symbol) => !observed.has(symbol)));
  const removedSinceObservation = sorted([...observed].filter((symbol) => !current.has(symbol)));
  return {
    current_added_since_observation: addedSinceObservation,
    current_removed_since_observation: removedSinceObservation,
    total_distinct: new Set([...addedSinceObservation, ...removedSinceObservation]).size,
  };
}

function payoutCoverage(result) {
  return {
    constituents_requested: result.requested,
    constituents_with_any_usable_positive_income_and_dividend_statement: result.with_statements,
    any_usable_statement_coverage_ratio: result.requested > 0
      ? round(result.with_statements / result.requested)
      : null,
    newest_statement_period: result.newest_statement_period,
  };
}

function payoutComparisons(currentResult, observedResult) {
  const currentByYear = new Map(currentResult.rows.map((row) => [row.year, row]));
  const observedByYear = new Map(observedResult.rows.map((row) => [row.year, row]));
  const currentPeak = Math.max(0, ...currentResult.rows.map((row) => row.constituents));
  const observedPeak = Math.max(0, ...observedResult.rows.map((row) => row.constituents));
  const years = sorted(new Set([...currentByYear.keys(), ...observedByYear.keys()]));
  return years.map((fiscalYear) => {
    const current = currentByYear.get(fiscalYear) ?? null;
    const observed = observedByYear.get(fiscalYear) ?? null;
    return {
      statement_period_end_year: fiscalYear,
      current_payout_ratio: current?.payout_ratio ?? null,
      reconstructed_payout_ratio: observed?.payout_ratio ?? null,
      delta_percentage_points: current && observed
        ? round((observed.payout_ratio - current.payout_ratio) * 100)
        : null,
      current_positive_income_with_dividend_constituents: current?.constituents ?? null,
      reconstructed_positive_income_with_dividend_constituents: observed?.constituents ?? null,
      current_coverage_of_constituents_with_any_usable_statement: current
        ? round(current.constituents / currentResult.with_statements)
        : null,
      reconstructed_coverage_of_constituents_with_any_usable_statement: observed
        ? round(observed.constituents / observedResult.with_statements)
        : null,
      current_threshold_gate_reporting_share: current && currentPeak > 0
        ? round(current.constituents / currentPeak)
        : null,
      reconstructed_threshold_gate_reporting_share: observed && observedPeak > 0
        ? round(observed.constituents / observedPeak)
        : null,
    };
  });
}

function financeManifest(symbols) {
  const rows = [];
  const missing = [];
  for (const symbol of sorted(new Set(symbols))) {
    const relativePath = `data/yf/finance/${symbol}.json`;
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      missing.push(symbol);
      continue;
    }
    rows.push(`${relativePath}\0${sha256Buffer(fs.readFileSync(absolutePath))}`);
  }
  return {
    path_pattern: "data/yf/finance/{symbol}.json",
    manifest_method: "sha256(sorted(path + NUL + file_sha256) joined with LF)",
    manifest_sha256: sha256Buffer(Buffer.from(`${rows.join("\n")}\n`, "utf8")),
    requested_file_count: new Set(symbols).size,
    present_file_count: rows.length,
    missing_symbols: missing,
  };
}

export function buildArtifact() {
  const membership = readJson(MEMBERSHIP_PATH);
  const indices = {};
  const allSymbols = new Set();

  for (const config of INDEX_CONFIG) {
    const validation = validateMembershipLedger(membership, config.key);
    const currentSymbols = sorted(membership?.indices?.[config.key]?.tickers ?? []);
    const snapshot = readJson(config.snapshotPath);
    const snapshotSymbols = sorted((snapshot.holdings ?? []).map((row) => row.symbol).filter(Boolean));
    const currentPayout = payoutByYear(currentSymbols);
    currentSymbols.forEach((symbol) => allSymbols.add(symbol));

    const observations = observationDates(membership, config.key).map((date) => {
      const symbols = reconstructObservedMembership(membership, config.key, date);
      symbols.forEach((symbol) => allSymbols.add(symbol));
      const observedPayout = payoutByYear(symbols);
      return {
        tracker_recorded_date: date,
        boundary: "state_after_last_tracker_run_recorded_on_utc_date",
        reconstructed_count: symbols.length,
        changed_symbols: changedSymbols(currentSymbols, symbols),
        coverage: payoutCoverage(observedPayout),
        per_statement_period_end_year: payoutComparisons(currentPayout, observedPayout),
      };
    });

    indices[config.key] = {
      name: config.name,
      bootstrap: {
        tracker_recorded_date: validation.bootstrap.date,
        record_type: "bootstrap_exact_observed_set",
        previous_count: validation.bootstrap.previousCount,
        current_count: validation.bootstrap.currentCount,
        exact_symbol_count: validation.exact_symbols.length,
        exact_set_sha256: validation.exact_set_sha256,
        reverse_transition_validation: "passed",
      },
      current: {
        ledger_processed_at: membership.updated ?? null,
        membership_snapshot_collected_at: snapshot.updated ?? null,
        count: currentSymbols.length,
        membership_snapshot_matches_ledger: JSON.stringify(snapshotSymbols) === JSON.stringify(currentSymbols),
        coverage: payoutCoverage(currentPayout),
      },
      observations,
    };
  }

  return {
    schema_version: "fenok_rim_membership_sensitivity.v1",
    analysis_type: "2026_observed_membership_sensitivity",
    deterministic: true,
    eligibility: {
      production_eligible: false,
      historical_survivorship_evidence: false,
      blocking_reasons: [
        "not_effective_date_history",
        "not_2022_2025_point_in_time_membership",
        "finance_files_are_current_local_copies_not_as_of_snapshots",
        "trailing_realised_payout_is_not_forward_policy",
      ],
    },
    payout_basis: {
      formula: "sum(abs(Cash Dividends Paid)) / sum(Net Income)",
      aggregation: "aggregate numerator and denominator across the explicit membership set per statement period end year",
      positive_net_income_required: true,
      loss_making_constituent_periods_excluded: true,
      dividend_measure: "Cash Dividends Paid from current local yfinance cash-flow statements",
      year_retention_threshold: {
        minimum_peak_reporting_share: 0.6,
        denominator: "peak positive_income_with_dividend_constituents across all candidate statement period end years",
        rule: "retain a year when its positive_income_with_dividend_constituents is at least 60% of that peak",
        per_year_gate_share_published: true,
        derivation: "each retained row count divided by the maximum retained row count; the unfiltered peak necessarily survives its own 60% gate",
      },
    },
    source_inputs: [
      fileSource(MEMBERSHIP_PATH),
      ...INDEX_CONFIG.map((config) => fileSource(config.snapshotPath)),
      fileSource(PAYOUT_BUILDER_PATH),
      fileSource(SELF_PATH),
      financeManifest([...allSymbols]),
    ],
    method: "reverse locally observed membership deltas from the current ledger, then rerun the same realised payout calculation for each reconstructed universe",
    limitations: [
      "not_effective_date_history",
      "not_2022_2025_point_in_time_membership",
      "tracker_recorded_dates_are_collector_run_dates",
      "finance_files_are_current_local_copies_not_as_of_snapshots",
      "trailing_realised_payout_is_not_forward_policy",
    ],
    indices,
  };
}

function main() {
  const artifact = buildArtifact();
  const out = path.join(ROOT, OUT_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`written: ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
