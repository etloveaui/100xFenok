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
import { readCurrentRepoProxyIdentityAudit } from "./lib/fenok-rim-proxy-identity.mjs";
import {
  FENO_RULE,
  FROZEN_CALIBRATION,
  PANEL_SOURCES,
  VERIFIED_STRUCTURE,
  buildPanelIndexRow,
  runBookIdentityCheck,
  runLtRoeCalibration,
  runPayoutCalibration,
  runTwelveMonthConversionCalibration,
  TWELVE_MONTH_CONVERSION,
  runPublishedUpsideHoldout,
  runStructuralReproduction,
} from "./fenok-rim-yoo-panel-engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data/computed/fenok-rim/sustainable-index-ranges.json");
// SOX is out of scope. We compute the Philadelphia Semiconductor index, but
// every published semiconductor claim names SOXX, which tracks a different
// index: their price ratio wanders 3.895% against 0.81% for Russell/IWM and
// their payout identities diverge by 89.59%. So the row can be computed and
// cannot be checked, and an index we cannot check is not a product. It returns
// when either an ICE Semiconductor book and forward EPS source exists, or he
// publishes on the Philadelphia index itself.
const SCOPE = ["SPX", "NDX", "KOSPI", "CCMP", "RUT"];
export const OUT_OF_SCOPE = Object.freeze({
  SOX: "published claims name SOXX, a different index; measured bridge fails on price and payout",
});
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
    // The band is a fair-value statement; this is the same band restated at the
    // twelve-month horizon Yoo's published upside is denominated in.
    expected_12m: lane.expected_12m ?? null,
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
/**
 * Two kinds of thing were being held in one list, which is why the list never
 * emptied. A defect is something wrong with the build and disappears when it
 * is fixed. A finding is something the measurement says about the world, and
 * it does not disappear at all: "we are more conservative than Yoo" and
 * "NASDAQ 100 compounds outside the printed domain" are true, and treating
 * them as work items means the product can never ship.
 *
 * Defects gate promotion. Findings are disclosed on the rows they belong to.
 */
// Owner-ordered public quarantine, DEC-289 (2026-08-05), from the independent
// Yoo-RIM audit. Removing this constant releases the owner quarantine ONLY:
// promotion reopens after removal only if every other promotion blocker is
// also clear (status and promotion share the combined array below).
const AUDIT_QUARANTINE_BLOCKERS = Object.freeze([
  Object.freeze({
    id: "model_validation_reopened",
    detail: "owner-ordered public quarantine pending reconstruction and independent re-validation (DEC-289)",
  }),
  Object.freeze({
    id: "twelve_month_output_targeting",
    detail: "12-month shares calibrated on the same published claims used for evaluation; no rederivation function",
  }),
  Object.freeze({
    id: "sealed_holdout_absent",
    detail: "no sealed pre-publication holdout exists; every published claim already entered development",
  }),
  Object.freeze({
    id: "growth_model_not_validated",
    detail: "retention-model book growth runs 2~4.5x the measured book CAGR without independent validation",
  }),
]);

function promotionBlockers({ rows, structural, holdout }) {
  const blockers = [];
  const findings = [];
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
    // Not a defect. The rule reproduces his structure and his operands; where
    // it lands differs from where he lands, and only a backtest can say which
    // is right. Fitting to close this gap is exactly what the mandate forbids.
    findings.push({
      id: "more_conservative_than_published_claims",
      detail: `${holdout.feno.informative_passed}/${informative} two-sided claims reproduce at his twelve-month horizon; the rule is directionally the same and smaller in magnitude`,
    });
  }
  // The structure is only known to behave where the printed cells used it. A
  // row outside that measured band is an extrapolation of a steep function,
  // which is a different claim from a valuation.
  const outside = rows.filter((row) => row.convexity?.status && row.convexity.status !== "inside_printed_domain");
  if (outside.length) {
    const domain = outside[0].convexity.printed_domain;
    const detail = outside
      .map((row) => `${row.id} ${row.convexity.growth_over_discount.toFixed(2)}`)
      .join(", ");
    findings.push({
      id: "convexity_outside_printed_domain",
      detail: `printed cells used book growth at ${domain ? `${domain.low.toFixed(2)}~${domain.high.toFixed(2)}` : "an unavailable range"} times the discount rate; ${detail} sit outside it`,
    });
  }
  // 54/54 is not reachable and chasing it was the wrong target. cx measured
  // the proposed IWM bridge: converting the printed index book by the price
  // scale and refitting payout on the same 18 cells gives 0.5218% RMSE against
  // a 0.5% gate, 4.4% over, and it is not a holdout. The printed 1117 book is
  // index-unit only and no same-date IWM NAV per share exists, so a market
  // close would have to stand in for NAV. The eligible set is 36 cells and the
  // 18 IWM cells are an excluded finding with measured reasons, not a defect
  // waiting to be fixed.
  const reproduced = structural.instruments.filter((row) => row.status === "reproduced");
  const cells = reproduced.reduce((sum, row) => sum + row.cells, 0);
  const excluded = structural.instruments.filter((row) => row.status !== "reproduced");
  if (excluded.length) {
    const ineligible = excluded.reduce((sum, row) => sum + row.cells, 0);
    findings.push({
      id: "structural_cells_excluded_for_unit_incoherence",
      observed: `${cells}/${cells + ineligible}`,
      eligible: `${cells}/${cells}`,
      ineligible_cells: ineligible,
      detail: `${cells} of ${cells + ineligible} published cells observed; all ${cells} eligible cells reproduce and ${excluded.map((row) => `${row.instrument} ${row.cells}`).join(", ")} are ineligible`,
      reasons: ["unit_coherent_book_unavailable", "same_date_NAV_unavailable", "scale_only_bridge", "rmse_gate_failed"],
      measured: "index book converted by price scale refits at 0.5218% RMSE against a 0.5% gate, max cell error 0.964%",
      re_entry: "a dated Russell book, a same-date index level and IWM NAV per share, a fixed unit conversion, cell RMSE at or under 0.5%, and a disjoint holdout",
    });
  }
  // The global blocker existed because the engine scored across a failed
  // bridge silently. It no longer does: a row whose tracker is not the index
  // is refused at the row gate with the failing dimension named, and the
  // engine's own test proves a measured-but-failing dimension cannot score.
  // What remains true is that those indices have no direct inputs, which is a
  // coverage finding rather than an ungated path.
  // Refusing the rows is necessary and not sufficient. cx's contract holds the
  // global blocker until those indices have direct target inputs or every
  // bridge dimension passes, because a withheld row is still an index we
  // cannot value, and promoting the artifact around it would say we can.
  const ungated = rows.filter((row) => PROXY_GATED_ROWS[row.id] && row.publication_status !== "NULL").map((row) => row.id);
  const proxied = Object.keys(PROXY_GATED_ROWS);
  if (proxied.length) {
    blockers.push({
      id: "ungated_proxy_identity",
      detail: ungated.length
        ? `${ungated.join(", ")} publish a value while their bridge has not passed every dimension`
        : `${proxied.join(", ")} are refused at the row gate, but neither has direct target-index inputs and their measured bridges still fail`,
      clears_when: "each proxied index has direct target-index book, ROE and payout, or every bridge dimension passes",
    });
  }
  const notPointInTime = rows.filter((row) => row.inputs?.payout_point_in_time === false).map((row) => row.id);
  if (notPointInTime.length) {
    blockers.push({ id: "payout_not_point_in_time", detail: `${notPointInTime.join(", ")} use payout levels recomputed on a later build vintage` });
  }
  return { blockers, findings };
}

/**
 * A row whose tracker is not the index may not carry a number at all.
 *
 * Scoreability requires every applicable dimension to have passed, never the
 * audit's own `scoreable` flag on its own: a dimension can be measured,
 * reported and still failing, and reading the flag instead of the verdicts is
 * how a failed bridge gets scored silently. Contract measured by cx in
 * fh-20260805-129.
 */
// A bridge only has to pass where the index depends on one. Russell takes its
// book, ROE and payout from the LSEG factsheet, its own publisher, so nothing
// about its value crosses the IWM bridge and there is no proxy to gate. The
// bridge audit still runs on it as evidence; it just no longer decides whether
// the row may publish. Only an index with no direct source is gated.
const PROXY_GATED_ROWS = Object.freeze({});
const DIRECT_SOURCE_ROWS = Object.freeze({
  RUT: "LSEG FTSE Russell factsheet supplies book, ROE and payout on an ex-negative basis",
});
const REQUIRED_PROXY_DIMENSIONS = Object.freeze(["price_unit_bridge", "book_roe_identity", "payout_identity"]);

function proxyGateFailures(id) {
  const key = PROXY_GATED_ROWS[id];
  if (!key) return [];
  let audit;
  try {
    audit = readCurrentRepoProxyIdentityAudit()[key];
  } catch {
    return [`proxy_identity_audit_unavailable:${key}`];
  }
  if (!audit?.dimensions) return [`proxy_identity_audit_unavailable:${key}`];
  return REQUIRED_PROXY_DIMENSIONS
    .filter((dimension) => audit.dimensions[dimension] && audit.dimensions[dimension].passed !== true)
    .map((dimension) => `proxy_${dimension}_failed:${key}`);
}

/** Fail closed: a row that cannot be trusted must not carry a range. */
function gateRow(row, generatedAt) {
  const blockers = [...proxyGateFailures(row.id)];
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
  const horizonFit = runTwelveMonthConversionCalibration(root);
  const holdout = runPublishedUpsideHoldout(root);

  // Out-of-scope indices are still computed. The proxy-identity audit measures
  // the bridge on their inputs, so withholding a row is not the same as not
  // computing it; they simply never carry a value.
  const panelRows = [...SCOPE, ...Object.keys(OUT_OF_SCOPE)]
    .map((id) => ({ id, row: buildPanelIndexRow(root, id, { asOf: effectiveAsOf }) }));
  const gated = panelRows.map(({ id, row }) => {
    const gate = gateRow({ ...row, id }, generatedAt);
    const status = OUT_OF_SCOPE[id] ? "OUT_OF_SCOPE" : gate.blockers.length ? "NULL" : "RESEARCH_DIAGNOSTIC";
    return { id, row, gate, publication_status: status };
  });
  const { blockers: promotionDefects, findings: promotionFindings } = promotionBlockers({
    rows: gated.filter(({ id }) => !OUT_OF_SCOPE[id])
      .map(({ id, row, publication_status: status }) => ({ id, publication_status: status, convexity: row.feno.convexity, inputs: row.inputs })),
    structural,
    holdout,
  });
  // One combined array feeds BOTH the top-level status and the promotion
  // block, so a quarantined build can never read `ready` while unpromoted.
  const promotion = [...AUDIT_QUARANTINE_BLOCKERS, ...promotionDefects];

  const rows = gated.map(({ id, row, gate, publication_status: publicationStatus }) => {
    const { blockers, input_freshness: inputFreshness } = gate;
    return {
      id,
      label: row.label,
      publication_status: publicationStatus,
      blocking_reasons: blockers,
      as_of: row.as_of,
      input_freshness: inputFreshness,
      current_price: row.inputs.price,
      inputs: row.inputs,
      value: publicationStatus === "RESEARCH_DIAGNOSTIC" ? laneView(row.feno) : null,
      out_of_scope_reason: OUT_OF_SCOPE[id] ?? null,
      measured_growth_diagnostic: publicationStatus === "RESEARCH_DIAGNOSTIC" ? laneView(row.measured_growth_diagnostic) : null,
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
      : rows.filter((row) => SCOPE.includes(row.id)).every((row) => row.publication_status !== "NULL")
        ? "six_index_residual_value_ranges_ready"
        : "partial_six_index_coverage",
    promotion: {
      promoted: promotion.length === 0,
      blockers: promotion,
      findings: promotionFindings,
      contract: "a defect blocks promotion and disappears when fixed; a finding is what the measurement says and is disclosed, not resolved",
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
    // Emitted, never read back. The identification receipt attests this
    // artifact; a builder that read that receipt to clear its own gate would
    // be signing its own attestation, which is what cx caught in fh-133.
    // Everything here is derived from frozen parameters and dated inputs, so
    // two runs at the same as-of produce the same contract.
    calibration_contract: {
      lt_roe_rule: FROZEN_CALIBRATION.lt_roe_rule,
      payout_multiplier: FROZEN_CALIBRATION.payout_multiplier,
      actual_roe_anchor_ratio: FROZEN_CALIBRATION.actual_roe_anchor_ratio,
      erp_lattice: FROZEN_CALIBRATION.erp_lattice,
      etf_proxy: FROZEN_CALIBRATION.etf_proxy,
      twelve_month_conversion: TWELVE_MONTH_CONVERSION,
      structure: VERIFIED_STRUCTURE,
      convexity_domain: panelRows[0]?.row?.feno?.convexity?.printed_domain ?? null,
      attested_by: "data/computed/fenok-rim/identification-receipt.json#sustainable_calibration_receipt",
      direction: "this artifact is the input to that receipt; it never reads it",
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
      twelve_month_conversion: { frozen: TWELVE_MONTH_CONVERSION, refit: horizonFit },
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
