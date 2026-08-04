#!/usr/bin/env node

// FENO RIM residual-value ranges for six indices.
//
// One rule, defined once in FENO_RULE. Every operand refreshes from a panel
// that carries its own history; every frozen constant carries a receipt this
// build recomputes. `yoo_convention_replication` re-runs the same structure on
// the cash dividend payout Yoo hand-enters, and exists only so the rule can be
// scored against his dated published claims.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FENO_RULE,
  FROZEN_CALIBRATION,
  PANEL_SOURCES,
  VERIFIED_STRUCTURE,
  buildPanelIndexRow,
  runBookIdentityCheck,
  runLtRoeCalibration,
  runPayoutCalibration,
  runPublishedUpsideHoldout,
  runStructuralReproduction,
} from "./fenok-rim-yoo-panel-engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data/computed/fenok-rim/sustainable-index-ranges.json");
const SCOPE = ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"];
const MAX_PANEL_AGE_DAYS = 14;
const MAX_RATE_AGE_DAYS = 45;
// Tracker distribution yields move slowly, but a quarter-old one is stale.
const MAX_PAYOUT_AGE_DAYS = 90;

function writeJsonAtomic(destination, payload) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

function ageDays(asOf, generatedAt) {
  const start = Date.parse(`${String(asOf).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(generatedAt).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.floor((end - start) / 86400000) : null;
}

function freshness(row, generatedAt) {
  const items = [
    { id: "panel", as_of: row.as_of, max_age_days: MAX_PANEL_AGE_DAYS },
    { id: "risk_free", as_of: row.inputs.risk_free_as_of, max_age_days: MAX_RATE_AGE_DAYS },
    { id: "payout", as_of: row.inputs.payout_as_of, max_age_days: MAX_PAYOUT_AGE_DAYS },
  ].map((item) => {
    const age = ageDays(item.as_of, generatedAt);
    return { ...item, age_days: age, status: Number.isFinite(age) && age >= 0 && age <= item.max_age_days ? "passed" : "failed" };
  });
  return { status: items.every((item) => item.status === "passed") ? "passed" : "failed", items };
}

function laneView(lane) {
  return {
    book_growth: lane.growth,
    convexity: lane.convexity,
    range: { low: lane.fair_value.low, high: lane.fair_value.high },
    upside: { low: lane.upside.low, high: lane.upside.high },
    point_estimate: null,
  };
}

/** Fail closed: a row that cannot be trusted must not carry a range. */
function gateRow(row, generatedAt) {
  const blockers = [];
  const inputFreshness = freshness(row, generatedAt);
  if (inputFreshness.status !== "passed") blockers.push("stale_or_future_input");
  for (const lane of [row.feno, row.measured_growth_diagnostic]) {
    if (![lane.fair_value.low, lane.fair_value.high].every(Number.isFinite) || lane.fair_value.low > lane.fair_value.high) {
      blockers.push("non_finite_or_inverted_range");
    }
  }
  if (!Number.isFinite(row.inputs.price) || row.inputs.price <= 0) blockers.push("no_current_price");
  if (!Number.isFinite(row.inputs.book) || row.inputs.book <= 0) blockers.push("no_positive_book");
  return { blockers, input_freshness: inputFreshness };
}

export function buildSustainableIndexRanges({ root = ROOT, asOf = null, generatedAt = new Date().toISOString() } = {}) {
  const effectiveAsOf = asOf ?? generatedAt.slice(0, 10);
  const structural = runStructuralReproduction(root);
  const bookIdentity = runBookIdentityCheck(root);
  const ltRoeFit = runLtRoeCalibration(root);
  const payoutFit = runPayoutCalibration(root, effectiveAsOf);
  const holdout = runPublishedUpsideHoldout(root);

  const rows = SCOPE.map((id) => {
    const row = buildPanelIndexRow(root, id, { asOf: effectiveAsOf });
    const { blockers, input_freshness: inputFreshness } = gateRow(row, generatedAt);
    const publicationStatus = blockers.length ? "NULL" : "RANGE";
    return {
      id,
      label: row.label,
      publication_status: publicationStatus,
      blocking_reasons: blockers,
      as_of: row.as_of,
      input_freshness: inputFreshness,
      current_price: row.inputs.price,
      inputs: row.inputs,
      value: publicationStatus === "RANGE" ? laneView(row.feno) : null,
      measured_growth_diagnostic: publicationStatus === "RANGE" ? laneView(row.measured_growth_diagnostic) : null,
      confidence: row.feno.convexity.status === "bounded" ? "medium" : "low",
      source_notes: {
        panel: `${PANEL_SOURCES[id].file}#sections.${PANEL_SOURCES[id].section}`,
        risk_free: row.inputs.risk_free_series,
        erp: FROZEN_CALIBRATION.erp_provenance[id],
        payout: row.inputs.payout_source,
        forward_roe_basis: row.inputs.forward_roe_basis,
      },
      runtime_yoo_value_injection: false,
    };
  });

  return {
    schema_version: "fenok_rim_sustainable_index_ranges.v2",
    generated_at: generatedAt,
    as_of: effectiveAsOf,
    status: rows.every((row) => row.publication_status === "RANGE")
      ? "six_index_residual_value_ranges_ready"
      : "partial_six_index_coverage",
    scope: SCOPE,
    runtime_contract: {
      output_type: "FENO_residual_value_range",
      point_estimate: false,
      runtime_yoo_value_injection: false,
      runtime_target_level_injection: false,
      frozen_historical_yoo_calibration_parameters_used: true,
      automatic_refresh: true,
      panel_history_available: true,
    },
    structure: VERIFIED_STRUCTURE,
    calibration: {
      version: FROZEN_CALIBRATION.version,
      structural_reproduction: structural,
      book_identity: bookIdentity,
      lt_roe_rule: {
        frozen: FROZEN_CALIBRATION.lt_roe_rule,
        refit: {
          intercept: ltRoeFit.intercept,
          gap_coefficient: ltRoeFit.gap_coefficient,
          stock_gap_share: ltRoeFit.stock_gap_share,
          max_abs_residual_pp: ltRoeFit.max_abs_residual_pp,
          residuals: ltRoeFit.residuals,
          observations: ltRoeFit.observations.map((row) => ({ id: row.id, kind: row.kind, median_roe: row.median_roe, model_forward_roe: row.model_forward_roe, lt_roe: row.printed_lt_roe })),
        },
      },
      payout_multiplier: { frozen: FROZEN_CALIBRATION.payout_multiplier, refit: payoutFit },
      published_upside_holdout: holdout,
      feno_rule: FENO_RULE,
    },
    interpretation:
      "One rule. Every operand refreshes automatically from a panel that carries its own history, and every frozen constant "
      + "carries a calibration receipt. The payout is Yoo's own cash dividend ratio, read from the automatic trailing series "
      + "rather than hand-entered. A row whose book growth runs far above the discount rate is flagged convex or amplifying; "
      + "the flag is disclosed and the value is left alone. No point estimate, no runtime Yoo value.",
    rows,
  };
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let asOf = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--output requires a path");
      output = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--as-of") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--as-of requires a date");
      asOf = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--stdout") {
      output = null;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  return { output, asOf };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildSustainableIndexRanges({ asOf: args.asOf });
  if (args.output) writeJsonAtomic(args.output, artifact);
  else process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}
