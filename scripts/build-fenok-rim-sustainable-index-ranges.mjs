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

/**
 * Promotion gates, computed from what the run actually measured.
 *
 * The previous builder set RANGE from freshness and finiteness alone, which is
 * how six rows shipped as ready while nothing had independently validated the
 * rule. A gate that cannot fail is not a gate.
 */
function promotionBlockers({ rows, structural, holdout }) {
  const blockers = [];
  if (holdout.feno.not_evaluable > 0) {
    blockers.push({
      id: "historical_holdout_not_point_in_time",
      detail: `${holdout.feno.not_evaluable}/${holdout.rows.length} historical anchors use a later-vintage input and are excluded from pass/fail: ${holdout.feno.not_evaluable_ids.join(", ")}`,
    });
  }
  const informative = holdout.feno.informative_total;
  if (informative === 0) {
    blockers.push({
      id: "no_discriminating_out_of_sample_anchor",
      detail: `every evaluation anchor outside the fit set is a one-sided floor; ${holdout.feno.in_sample} two-sided claims were consumed by the LTROE fit`,
    });
  } else if (holdout.feno.informative_passed < informative) {
    blockers.push({ id: "out_of_sample_anchor_failed", detail: `${holdout.feno.informative_passed}/${informative} two-sided evaluation anchors reproduce` });
  }
  const amplifying = rows.filter((row) => row.convexity?.status === "amplifying").map((row) => row.id);
  if (amplifying.length) {
    blockers.push({ id: "amplifying_convexity", detail: `book growth exceeds twice the discount rate for ${amplifying.join(", ")}, so the answer tracks the ROE input rather than valuing it` });
  }
  const reproduced = structural.instruments.filter((row) => row.status === "reproduced");
  const cells = reproduced.reduce((sum, row) => sum + row.cells, 0);
  const total = structural.instruments.reduce((sum, row) => sum + row.cells, 0);
  if (cells < total) {
    const skipped = structural.instruments.filter((row) => row.status !== "reproduced").map((row) => row.instrument);
    blockers.push({ id: "partial_structural_reproduction", detail: `${cells}/${total} published cells reproduce; ${skipped.join(", ")} lack a unit-coherent book` });
  }
  const proxyIdentity = rows.filter((row) => ["SOX", "RUT"].includes(row.id)).map((row) => row.id);
  if (proxyIdentity.length) {
    blockers.push({ id: "ungated_proxy_identity", detail: "SOX uses a SOXX payout proxy while SOXX claims remain excluded, and RUT uses IWM cells/payout; measured book/ROE and payout identity gates fail" });
  }
  const notPointInTime = rows.filter((row) => row.inputs?.payout_point_in_time === false).map((row) => row.id);
  if (notPointInTime.length) {
    blockers.push({ id: "payout_not_point_in_time", detail: `${notPointInTime.join(", ")} use payout levels recomputed on a later build vintage` });
  }
  blockers.push({ id: "sustainable_calibration_receipt_not_integrated", detail: "the immutable receipt primitive now gates the stock structural identification artifact, but the sustainable LTROE/payout calibration has not yet wired its cutoff, evidence IDs, and parameter hashes into that contract" });
  return blockers;
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

  const panelRows = SCOPE.map((id) => ({ id, row: buildPanelIndexRow(root, id, { asOf: effectiveAsOf }) }));
  const promotion = promotionBlockers({
    rows: panelRows.map(({ id, row }) => ({ id, convexity: row.feno.convexity, inputs: row.inputs })),
    structural,
    holdout,
  });

  const rows = panelRows.map(({ id, row }) => {
    const { blockers, input_freshness: inputFreshness } = gateRow(row, generatedAt);
    // A row can only ever be a research diagnostic while a promotion blocker
    // stands. Freshness still decides whether it is computable at all.
    const publicationStatus = blockers.length ? "NULL" : "RESEARCH_DIAGNOSTIC";
    return {
      id,
      label: row.label,
      publication_status: publicationStatus,
      blocking_reasons: blockers,
      as_of: row.as_of,
      input_freshness: inputFreshness,
      current_price: row.inputs.price,
      inputs: row.inputs,
      value: publicationStatus === "NULL" ? null : laneView(row.feno),
      measured_growth_diagnostic: publicationStatus === "NULL" ? null : laneView(row.measured_growth_diagnostic),
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
    status: promotion.length
      ? "research_diagnostic_not_promoted"
      : rows.every((row) => row.publication_status !== "NULL")
        ? "six_index_residual_value_ranges_ready"
        : "partial_six_index_coverage",
    promotion: {
      promoted: promotion.length === 0,
      blockers: promotion,
      contract: "every blocker must clear before a row may be published as a usable fair-value range",
    },
    scope: SCOPE,
    runtime_contract: {
      output_type: "FENO_residual_value_research_diagnostic",
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
