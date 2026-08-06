#!/usr/bin/env node

// FENO RIM v2 — all-adapter contract tests (Phase 4 remainder).
//
// Per adapter, on real repo files with fixed as-of dates: provenance
// validation passes, the engine is id-invariant, public status is NULL with
// core_erp_unidentified while the ERP band is unproven, B2 is excluded with
// a stated reason, the diagnostic hull is finite and ordered. Refusals are
// asserted with their honest reasons. NO INVENTED NUMBERS: every numeric
// input is spot-checked against the repo file it must trace to.

import assert from "node:assert/strict";
import { buildNdxInput } from "./feno-rim-v2/adapters/ndx-panel.mjs";
import { buildCcmpInput, oneqPayoutProxy } from "./feno-rim-v2/adapters/ccmp-panel.mjs";
import { buildRutInput, rutOfficialSnapshot } from "./feno-rim-v2/adapters/rut-panel.mjs";
import { buildKospiInput } from "./feno-rim-v2/adapters/kospi-panel.mjs";
import { buildSoxInput } from "./feno-rim-v2/adapters/sox-panel.mjs";
import { computeFamilyB } from "./feno-rim-v2/engine.mjs";
import { invarianceViolations, validateNormalizedInput } from "./feno-rim-v2/provenance.mjs";
import { lastAtOrBefore, readJson } from "./feno-rim-v2/adapters/panel-common.mjs";

function assertContract(name, input) {
  assert.equal(validateNormalizedInput(input), true, `${name}: provenance validation`);
  assert.deepEqual(invarianceViolations(computeFamilyB, input), [], `${name}: engine must stay id-blind`);
  const result = computeFamilyB(input);
  assert.equal(result.public_status, "NULL", `${name}: NULL while the holdout calibration gate is unmet`);
  assert.ok(input.erp_band, `${name}: restored ERP band wired`);
  assert.ok(result.null_reasons.includes("holdout_interval_calibration_not_met"), `${name}: null reason names the holdout gate`);
  assert.equal(result.b2_admitted, false, `${name}: B2 excluded`);
  assert.ok(typeof result.b2_exclusion_reason === "string" && result.b2_exclusion_reason.length > 0, `${name}: B2 reason stated`);
  assert.ok(Number.isFinite(result.value_hull.low) && Number.isFinite(result.value_hull.high), `${name}: hull finite`);
  assert.ok(result.value_hull.high > result.value_hull.low, `${name}: hull ordered`);
  return result;
}

// --- NDX (2026-08-01) -------------------------------------------------------
{
  const input = buildNdxInput("2026-08-01");
  assertContract("ndx", input);
  const panel = readJson("data/benchmarks/us.json").sections.nasdaq100.data;
  const row = lastAtOrBefore(panel, "2026-08-01");
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10;
  const rate = lastAtOrBefore(rates, "2026-08-01");
  const payout = readJson("data/computed/fenok-rim/payout-history.json").indices.nasdaq100;
  const latest = payout.history[payout.history.length - 1];
  assert.ok(Math.abs(input.book - (row.px_last / row.px_to_book_ratio)) < 1e-9, "ndx: book traces to the panel row");
  assert.ok(Math.abs(input.risk_free - rate.value * 0.01) < 1e-12, "ndx: risk-free traces to DGS10");
  assert.ok(Math.abs(input.payout_scenarios[0].low - latest.payout_ratio) < 1e-12, "ndx: payout traces to payout-history");
  assert.equal(input.universe_id, "nasdaq100_bloomberg_panel");
}

// --- CCMP (2026-08-06; ONEQ proxy present but scoped out while B2 excluded) -
{
  const input = buildCcmpInput("2026-08-06");
  assertContract("ccmp", input);
  const panel = readJson("data/benchmarks/us.json").sections.nasdaq_composite.data;
  const row = lastAtOrBefore(panel, "2026-08-06");
  assert.ok(Math.abs(input.book - (row.px_last / row.px_to_book_ratio)) < 1e-9, "ccmp: book traces to the panel row");
  const proxy = oneqPayoutProxy();
  assert.ok(Math.abs(input.payout_scenarios[0].low - proxy.payout_ratio) < 1e-12, "ccmp: payout traces to the ONEQ fact");
  assert.equal(input.payout_scenarios[0].id, "oneq_tracker_proxy", "ccmp: scenario labelled as the ONEQ proxy");
  assert.equal(input.payout_proxy.coverage_ok, false, "ccmp: proxy coverage_ok=false semantics");
  assert.match(input.b2_exclusion_reason, /ONEQ/, "ccmp: B2 reason names the proxy");
  assert.equal(input.payout_consumed, false, "ccmp: payout scoped out while B2 is excluded");
  // The ONEQ component is a payout component: with b2_admitted=false it no
  // longer refuses an origin before the ONEQ fetch — 2026-08-01 now builds.
  const preOneq = buildCcmpInput("2026-08-01");
  assert.equal(preOneq.first_knowable_at <= "2026-08-01", true, "ccmp: historical origin is point-in-time without the payout component");
}

// --- RUT (2026-08-06; LSEG snapshot first-knowable 2026-08-04) --------------
{
  const input = buildRutInput("2026-08-06");
  assertContract("rut", input);
  const snap = rutOfficialSnapshot();
  const panel = readJson("data/benchmarks/us.json").sections.russell2000.data;
  const row = lastAtOrBefore(panel, "2026-08-06");
  assert.ok(Math.abs(input.book - (row.px_last / snap.priceToBook)) < 1e-9, "rut: book = panel price / factsheet P/B");
  assert.equal(input.roe.band.low, snap.roe, "rut: ROE traces to the LSEG derived ROE");
  assert.equal(input.payout_scenarios[0].low, snap.payout, "rut: payout traces to the LSEG derived payout");
  assert.equal(input.first_knowable_at, "2026-08-04", "rut: first-knowable is the snapshot receipt date");
  assert.equal(input.universe_id, "rut_lseg_factsheet");
  // An asOf before the snapshot was knowable must refuse with the reason.
  assert.throws(() => buildRutInput("2026-08-01"), /not first-knowable/);
}

// --- KOSPI (2026-05-30; KR risk-free stale after 2026-06-01) ----------------
{
  const input = buildKospiInput("2026-05-30");
  assertContract("kospi", input);
  const panel = readJson("data/benchmarks/emerging.json").sections.kospi.data;
  const row = lastAtOrBefore(panel, "2026-05-30");
  const rates = readJson("data/macro/fred-banking-daily.json").series.IRLTLT01KRM156N;
  const rate = lastAtOrBefore(rates, "2026-05-30");
  const payout = readJson("data/computed/fenok-rim/payout-history.json").indices.kospi;
  const latest = payout.history[payout.history.length - 1];
  assert.ok(Math.abs(input.book - (row.px_last / row.px_to_book_ratio)) < 1e-9, "kospi: book traces to the panel row");
  assert.ok(Math.abs(input.risk_free - rate.value * 0.01) < 1e-12, "kospi: risk-free traces to IRLTLT01KRM156N");
  assert.ok(Math.abs(input.payout_scenarios[0].low - latest.payout_ratio) < 1e-12, "kospi: payout traces to payout-history");
  assert.equal(input.currency, "KRW", "kospi: KRW currency");
  // Beyond the KR series' last observation must refuse with the staleness reason.
  assert.throws(() => buildKospiInput("2026-08-01"), /stale/);
}

// --- SOX (2026-08-01; computable, flagged out of scope) ---------------------
{
  const input = buildSoxInput("2026-08-01");
  assertContract("sox", input);
  const panel = readJson("data/benchmarks/micro_sectors.json").sections.philadelphia_semi.data;
  const row = lastAtOrBefore(panel, "2026-08-01");
  const payout = readJson("data/computed/fenok-rim/payout-history.json").indices.philadelphia_semi;
  const latest = payout.history[payout.history.length - 1];
  assert.ok(Math.abs(input.book - (row.px_last / row.px_to_book_ratio)) < 1e-9, "sox: book traces to the panel row");
  assert.ok(Math.abs(input.payout_scenarios[0].low - latest.payout_ratio) < 1e-12, "sox: payout traces to payout-history");
  assert.equal(input.publication_scope, "OUT_OF_SCOPE", "sox: publication scope flagged");
  assert.ok(input.out_of_scope_reason.includes("SOXX"), "sox: out-of-scope reason names the SOXX identity gap");
}

console.log("feno-rim-v2 all-adapter tests passed");
