import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifact,
  reconstructObservedMembership,
  validateMembershipLedger,
} from "./build-fenok-rim-membership-sensitivity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const synthetic = {
  indices: { demo: { count: 2, tickers: ["C", "D"] } },
  changes: [
    {
      date: "2026-07-10",
      index: "demo",
      added: ["D"],
      removed: ["B"],
      previousCount: 2,
      currentCount: 2,
    },
    {
      date: "2026-07-10",
      index: "demo",
      added: ["C"],
      removed: ["A"],
      previousCount: 2,
      currentCount: 2,
    },
    {
      date: "2026-01-09",
      index: "demo",
      added: ["A", "B"],
      removed: [],
      previousCount: 0,
      currentCount: 2,
    },
  ],
};

assert.deepEqual(
  reconstructObservedMembership(synthetic, "demo", "2026-07-10"),
  ["C", "D"],
  "the date boundary is the state after the last tracker run recorded on that UTC date",
);
assert.deepEqual(
  reconstructObservedMembership(synthetic, "demo", "2026-01-09"),
  ["A", "B"],
  "same-day transitions reverse newest-first to recover the exact bootstrap set",
);
const syntheticValidation = validateMembershipLedger(synthetic, "demo");
assert.equal(syntheticValidation.bootstrap.currentCount, 2);
assert.deepEqual(syntheticValidation.exact_symbols, ["A", "B"]);
assert.throws(
  () => validateMembershipLedger({ ...synthetic, indices: { demo: { count: 3, tickers: ["C", "D"] } } }, "demo"),
  /current count does not match exact set/,
  "inconsistent current counts fail closed",
);
assert.throws(
  () => validateMembershipLedger({
    ...synthetic,
    changes: synthetic.changes.map((change, index) => index === 0 ? { ...change, added: ["X"] } : change),
  }, "demo"),
  /added symbol absent from later state/,
  "inconsistent reverse transitions fail closed",
);

const first = buildArtifact();
const second = buildArtifact();
assert.deepEqual(first, second, "the artifact must not depend on wall-clock time");
assert.equal(first.analysis_type, "2026_observed_membership_sensitivity");
assert.equal(first.deterministic, true);
assert.equal(first.eligibility.production_eligible, false);
assert.equal(first.eligibility.historical_survivorship_evidence, false);
assert.ok(first.limitations.includes("not_effective_date_history"));
assert.ok(first.limitations.includes("not_2022_2025_point_in_time_membership"));
assert.equal(first.payout_basis.year_retention_threshold.minimum_peak_reporting_share, 0.6);
assert.equal(first.payout_basis.year_retention_threshold.per_year_gate_share_published, true);

for (const [key, index] of Object.entries(first.indices)) {
  assert.equal(index.current.membership_snapshot_matches_ledger, true, `${key}: source snapshots must agree`);
  assert.match(index.current.ledger_processed_at, /^2026-\d{2}-\d{2}T/);
  assert.match(index.current.membership_snapshot_collected_at, /^2026-\d{2}-\d{2}T/);
  assert.ok(index.current.count > 0, `${key}: current membership is required`);
  assert.equal(index.bootstrap.record_type, "bootstrap_exact_observed_set");
  assert.equal(index.bootstrap.current_count, index.bootstrap.exact_symbol_count);
  assert.equal(index.bootstrap.reverse_transition_validation, "passed");
  assert.match(index.bootstrap.exact_set_sha256, /^[0-9a-f]{64}$/);
  assert.ok(index.observations.length > 0, `${key}: at least one observed vintage is required`);
  for (const observation of index.observations) {
    assert.match(observation.tracker_recorded_date, /^2026-\d{2}-\d{2}$/);
    assert.equal(observation.boundary, "state_after_last_tracker_run_recorded_on_utc_date");
    assert.ok(observation.reconstructed_count > 0);
    assert.ok(observation.coverage.constituents_requested > 0);
    assert.ok(observation.per_statement_period_end_year.length > 0);
    const currentPeak = Math.max(...observation.per_statement_period_end_year
      .map((row) => row.current_positive_income_with_dividend_constituents));
    const reconstructedPeak = Math.max(...observation.per_statement_period_end_year
      .map((row) => row.reconstructed_positive_income_with_dividend_constituents));
    for (const row of observation.per_statement_period_end_year) {
      assert.match(row.statement_period_end_year, /^20\d{2}$/);
      if (row.delta_percentage_points !== null) assert.ok(Number.isFinite(row.delta_percentage_points));
      assert.ok(row.current_positive_income_with_dividend_constituents > 0);
      assert.ok(row.reconstructed_positive_income_with_dividend_constituents > 0);
      assert.ok(row.current_threshold_gate_reporting_share >= 0.6);
      assert.ok(row.reconstructed_threshold_gate_reporting_share >= 0.6);
      assert.equal(
        row.current_threshold_gate_reporting_share,
        Math.round((row.current_positive_income_with_dividend_constituents / currentPeak) * 1e6) / 1e6,
      );
      assert.equal(
        row.reconstructed_threshold_gate_reporting_share,
        Math.round((row.reconstructed_positive_income_with_dividend_constituents / reconstructedPeak) * 1e6) / 1e6,
      );
    }
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const financeSource = first.source_inputs.find((source) => source.path_pattern);
assert.match(financeSource.manifest_sha256, /^[0-9a-f]{64}$/);
assert.equal(financeSource.missing_symbols.length, 0);
for (const source of first.source_inputs.filter((item) => item.path)) {
  assert.match(source.sha256, /^[0-9a-f]{64}$/, source.path);
  assert.equal(
    source.sha256,
    sha256(fs.readFileSync(path.join(ROOT, source.path))),
    `${source.path}: published source hash must rederive`,
  );
}

const membership = JSON.parse(fs.readFileSync(path.join(ROOT, "data/slickcharts/membership-changes.json"), "utf8"));
const financeSymbols = new Set();
for (const indexKey of ["sp500", "nasdaq100"]) {
  for (const symbol of membership.indices[indexKey].tickers) financeSymbols.add(symbol);
  for (const date of new Set(membership.changes.filter((row) => row.index === indexKey).map((row) => row.date))) {
    for (const symbol of reconstructObservedMembership(membership, indexKey, date)) financeSymbols.add(symbol);
  }
}
const financeRows = [...financeSymbols].sort().map((symbol) => {
  const relativePath = `data/yf/finance/${symbol}.json`;
  return `${relativePath}\0${sha256(fs.readFileSync(path.join(ROOT, relativePath)))}`;
});
assert.equal(
  financeSource.manifest_sha256,
  sha256(Buffer.from(`${financeRows.join("\n")}\n`, "utf8")),
  "finance manifest hash must independently rederive",
);

const committed = JSON.parse(fs.readFileSync(
  path.join(ROOT, "data/computed/fenok-rim/membership-sensitivity-2026.json"),
  "utf8",
));
assert.deepEqual(committed, first, "committed artifact must equal buildArtifact output exactly");

console.log("build-fenok-rim-membership-sensitivity tests passed");
