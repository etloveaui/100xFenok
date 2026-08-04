#!/usr/bin/env node
// analyze-fenok-rim-identifiability.mjs
// Nested-repo system-identification lab (book-basis phase only).
//
// Scope: quantify the book value (and implied PBR) that each dated published
// RIM anchor REQUIRES under the candidate model, before any ERP inversion.
// Floors are inequality constraints — a floor is a bound, never a point, and
// never a half-weight value. The I/O schema preserves model family and the
// point/range/floor type through every transformation.
//
// The discount relation 0.076 + 0.560*Rf is treated as the HYPOTHESIS under
// test (it survives out-of-sample pairs at 0.525-0.700); the module reports
// the required book under both the central and the band estimates.
//
//   node scripts/analyze-fenok-rim-identifiability.mjs   # prints the 2026-08 report
//
// The exported math functions are pure and deterministic and read no files;
// node:fs is imported only for the CLI entry (--grid-profile loads the fixture).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FLOOR_IS_INEQUALITY = "FLOOR_IS_INEQUALITY: a floor is a bound, not a value";
export const RANGE_IS_INTERVAL = "RANGE_IS_INTERVAL: a range is an interval, not a point";

// The only way to obtain a point from a transformed result. Anything that is
// not a point throws: floors and ranges are never silently collapsed.
export function toPointValue(result) {
  if (result?.type === "point") return result.value;
  if (result?.type === "floor") throw new Error(FLOOR_IS_INEQUALITY);
  if (result?.type === "range") throw new Error(RANGE_IS_INTERVAL);
  throw new Error(`NULL_${result?.reason ?? "unknown"}: null results are not convertible`);
}

export const MODEL = Object.freeze({
  N: 9,
  DISCOUNT_A: 0.076, // central estimate (hypothesis)
  DISCOUNT_B: 0.560,
  DISCOUNT_B_BAND: [0.525, 0.700], // measured out-of-sample band
  SCHEMA: "fenok-rim-anchor.v1",
  FAMILIES: Object.freeze(["RIM", "FUNDAMENTAL", "M2", "BOTTOM_UP", "PER_METHOD", "UNLABELED"]),
  TYPES: Object.freeze(["point", "range", "floor"]),
  KINDS: Object.freeze(["upside", "fair_value"]),
  HORIZON: 9, // explicit years; a 2y fair value is a NULL for this model
});

// V / B0 bracket of the documented model:
//   Ke_gap = rf + premium ;  g = roe*(1-payout) ;  d = DISCOUNT_A + DISCOUNT_B*rf
//   V = B0 + sum_{t=1..N} RI_t/(1+d)^t + (RI_N/d)/(1+d)^N
//   RI_t = B_{t-1}*(roe - Ke_gap) ; B_t = B_{t-1}*(1+g)
export function rimBracket({ roe, rf, premium, payout, discount, N = MODEL.N, a = MODEL.DISCOUNT_A, b = MODEL.DISCOUNT_B }) {
  if (!Number.isFinite(roe) || !Number.isFinite(rf) || !Number.isFinite(premium) || !Number.isFinite(payout)) {
    throw new TypeError("rimBracket requires finite roe, rf, premium, payout");
  }
  if (payout < 0 || payout > 1) throw new RangeError("payout must be in [0,1]");
  const d = discount ?? a + b * rf;
  if (!(d > 0)) throw new RangeError("discount must be positive (rf too low for the linear form)");
  const k = rf + premium; // Ke_gap
  const g = roe * (1 - payout); // book growth
  const q = (1 + g) / (1 + d);
  // S = sum_{t=1..N} (1+g)^{t-1}/(1+d)^t = (1/(1+d)) * (1-q^N)/(1-q)
  let S;
  if (Math.abs(1 - q) < 1e-12) {
    S = N / (1 + d); // q == 1 limit: each term is 1/(1+d)
  } else {
    S = (1 / (1 + d)) * ((1 - Math.pow(q, N)) / (1 - q));
  }
  const terminal = Math.pow(1 + g, N - 1) / (d * Math.pow(1 + d, N)); // (1+g)^{N-1}/(d*(1+d)^N)  [RI_N = B0*(1+g)^{N-1}*(roe-k)]
  const C = 1 + (roe - k) * (S + terminal);
  if (!(C > 0)) {
    // A non-positive bracket inverts the book/PBR inequality direction; the
    // model is unusable there (loss-making or ke_gap >> roe regimes).
    throw new RangeError(`rimBracket must be positive (C=${C}); roe-k=${(roe - k).toFixed(4)}`);
  }
  return C;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function validateAnchor(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("anchor must be an object");
  const err = (m) => new Error(`anchor invalid: ${m}`);
  if (!MODEL.FAMILIES.includes(raw.model_family)) throw err("model_family");
  if (!MODEL.TYPES.includes(raw.type)) throw err("type");
  if (!MODEL.KINDS.includes(raw.output_kind)) throw err("output_kind");
  if (typeof raw.index !== "string" || raw.index.length === 0) throw err("index");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")) throw err("date");
  if (!raw.inputs || typeof raw.inputs !== "object") throw err("inputs");
  if (raw.type === "point" && !Number.isFinite(raw.value)) throw err("point value");
  if (raw.type === "range" && (!Array.isArray(raw.value) || raw.value.length !== 2 || !raw.value.every(Number.isFinite) || raw.value[0] > raw.value[1])) throw err("range value [lo,hi] finite");
  if (raw.type === "floor" && !Number.isFinite(raw.value)) throw err("floor lower bound");
  if (raw.output_kind === "upside") {
    if (!Number.isFinite(raw.spot) || !(raw.spot > 0)) throw err("upside requires a finite positive spot (floors included)");
    if (raw.type === "point" && raw.value < -1) throw err("upside point value must be >= -1");
    if (raw.type === "range" && raw.value[0] < -1) throw err("upside range low must be >= -1");
    if (raw.type === "floor" && raw.value < -1) throw err("upside floor must be >= -1");
  }
  if (raw.output_kind === "fair_value" && raw.type !== "floor" && !(raw.value > 0)) throw err("fair_value must be positive");
  const out = { ...raw, inputs: { ...raw.inputs }, _schema: MODEL.SCHEMA };
  if (raw.horizon !== undefined) out.horizon = raw.horizon;
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Fair-value space conversion (type-preserving)
// ---------------------------------------------------------------------------
export function fairFromAnchor(a) {
  const base = a.output_kind === "upside" ? a.spot : 0;
  if (a.type === "point") {
    const f = a.output_kind === "upside" ? (1 + a.value) * a.spot : a.value;
    return { type: "point", value: f };
  }
  if (a.type === "range") {
    const lo = a.output_kind === "upside" ? (1 + a.value[0]) * a.spot : a.value[0];
    const hi = a.output_kind === "upside" ? (1 + a.value[1]) * a.spot : a.value[1];
    return { type: "range", value: [lo, hi] };
  }
  // floor
  const f = a.output_kind === "upside" ? (1 + a.value) * a.spot : a.value;
  return { type: "floor", bound: "lower", value: f };
}

// ---------------------------------------------------------------------------
// Required book: B0* = fair / C  (type-preserving)
// ---------------------------------------------------------------------------
export function requiredBook(a, inputs) {
  if (a.model_family !== "RIM") {
    return { type: "null", reason: `family-${a.model_family}-not-RIM`, value: null };
  }
  if (a.horizon !== undefined && a.horizon !== MODEL.HORIZON) {
    return { type: "null", reason: "horizon-mismatch", value: null };
  }
  const C = rimBracket({ ...inputs });
  const fair = fairFromAnchor(a);
  if (fair.type === "point") return { type: "point", value: fair.value / C };
  if (fair.type === "range") return { type: "range", value: [fair.value[0] / C, fair.value[1] / C] };
  return { type: "floor", bound: "lower", value: fair.value / C };
}

// ---------------------------------------------------------------------------
// Implied PBR = spot / B0*  (type-preserving; floor inverts to an upper bound)
// ---------------------------------------------------------------------------
export function impliedPBR(a, inputs, spot = a.spot) {
  if (a.model_family !== "RIM") {
    return { type: "null", reason: `family-${a.model_family}-not-RIM`, value: null };
  }
  if (a.horizon !== undefined && a.horizon !== MODEL.HORIZON) {
    return { type: "null", reason: "horizon-mismatch", value: null };
  }
  if (!Number.isFinite(spot) || !(spot > 0)) {
    // fair_value anchors carry no spot; a PBR against an undefined spot is NaN.
    throw new TypeError("impliedPBR requires a finite positive spot (fair_value anchors need one passed explicitly)");
  }
  const C = rimBracket({ ...inputs });
  const fair = fairFromAnchor(a);
  if (fair.type === "point") return { type: "point", value: spot / (fair.value / C) };
  if (fair.type === "range") {
    // B0* in [lo,hi]  =>  PBR in [spot/hi, spot/lo]
    return { type: "range", value: [spot / (fair.value[1] / C), spot / (fair.value[0] / C)] };
  }
  // floor: B0* >= L  =>  PBR <= spot/L
  return { type: "floor", bound: "upper", value: spot / (fair.value / C) };
}

// ---------------------------------------------------------------------------
// Basis assessment: which candidate book basis satisfies the anchor
// ---------------------------------------------------------------------------
export function assessBookBasis(a, inputs, candidates) {
  if (a.model_family !== "RIM") {
    return { verdict: "NULL", reason: `family-${a.model_family}-not-RIM` };
  }
  if (a.horizon !== undefined && a.horizon !== MODEL.HORIZON) {
    return { verdict: "NULL", reason: "horizon-mismatch" };
  }
  const C = rimBracket({ ...inputs });
  const fair = fairFromAnchor(a);
  const res = {};
  for (const [key, book] of Object.entries(candidates)) {
    if (!Number.isFinite(book)) {
      res[key] = { book, verdict: "NULL", reason: "non-finite-book" };
      continue;
    }
    const modelFair = C * book;
    let verdict;
    if (fair.type === "point") verdict = Math.abs(modelFair - fair.value) <= 1e-6 * Math.max(1, fair.value) ? "point" : "outside";
    else if (fair.type === "range") verdict = modelFair >= fair.value[0] - 1e-9 && modelFair <= fair.value[1] + 1e-9 ? "inside" : "outside";
    else verdict = modelFair >= fair.value - 1e-9 ? "meets" : "outside"; // floor: meets or fails, never a point
    res[key] = { book, modelFair, verdict };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Report (deterministic; used by CLI and by the integration harness)
// ---------------------------------------------------------------------------
export function reportBookBasis(anchors, ctxs) {
  const rows = anchors.map((a, i) => {
    const ctx = ctxs[i] ?? ctxs[0];
    const b = requiredBook(a, ctx);
    const pbr = impliedPBR(a, ctx);
    const C = rimBracket({ ...ctx });
    let verdict = "OK";
    let reason = null;
    if (b.type === "null") { verdict = "NULL"; reason = b.reason; }
    else if (b.type === "floor") verdict = "FLOOR";
    else if (b.type === "range") verdict = "RANGE";
    return {
      model_family: a.model_family,
      index: a.index,
      date: a.date,
      source_uid: a.source_uid ?? null,
      horizon: a.horizon ?? MODEL.HORIZON,
      output_kind: a.output_kind,
      type: a.type,
      spot: a.spot ?? null,
      inputs: { rf: ctx.rf, roe: ctx.roe, premium: ctx.premium, payout: ctx.payout },
      bracket_C: C,
      required_book: b,
      implied_pbr: pbr,
      verdict,
      reason,
    };
  });
  return { schema: "fenok-rim-bookbasis-report.v1", model: { ...MODEL }, rows };
}

// ---------------------------------------------------------------------------
// Profile identification: sweep payout over an explicit band, hold a COHERENT
// (ROE, book) basis, and report the feasible payout set + an identified /
// not_identified verdict. Floors contribute one-sided error only (under-shoot).
// A mixed basis (his ROE with our book) is rejected, not silently allowed.
// ---------------------------------------------------------------------------
export function assertCoherentBasis(roeBasis, bookBasis) {
  if (!roeBasis || !bookBasis) throw new TypeError("roeBasis and bookBasis are required");
  if (roeBasis.id === undefined || bookBasis.id === undefined) throw new TypeError("basis_id required on both roeBasis and bookBasis");
  if (roeBasis.id !== bookBasis.id) {
    throw new Error(`mixed basis rejected: roeBasis.id='${roeBasis.id}' != bookBasis.id='${bookBasis.id}'; ROE and book must share a basis_id`);
  }
}

// RMS of the model fair values against the anchors, for a fixed payout.
// Point: |fair - target|/target. Range: 0 inside, else distance/hi.
// Floor: 0 at/above bound, else (bound - fair)/bound (ONE-SIDED, never rewarded above).
// Per-anchor inputs: an anchor carrying inputs.{roe,rf,premium} overrides the
// sweep-level defaults — grid cells each have their own (LT ROE, ERP, rate).
export function profileRmsAt(anchors, { roe, rf, premium, payout, book }) {
  const errs = [];
  for (const a of anchors) {
    if (a.model_family !== "RIM") continue;
    if (a.horizon !== undefined && a.horizon !== MODEL.HORIZON) continue;
    const C = rimBracket({
      roe: a.inputs?.roe ?? roe,
      rf: a.inputs?.rf ?? rf,
      premium: a.inputs?.premium ?? premium,
      payout,
    });
    const fair = fairFromAnchor(a);
    const modelFair = C * book;
    if (fair.type === "point") {
      errs.push(Math.abs(modelFair - fair.value) / fair.value);
    } else if (fair.type === "range") {
      if (modelFair >= fair.value[0] && modelFair <= fair.value[1]) errs.push(0);
      else errs.push(Math.min(Math.abs(modelFair - fair.value[0]), Math.abs(modelFair - fair.value[1])) / fair.value[1]);
    } else {
      // floor: only under-shoot counts
      errs.push(modelFair >= fair.value ? 0 : (fair.value - modelFair) / fair.value);
    }
  }
  if (errs.length === 0) return NaN;
  return Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
}

export function profileIdentify({ anchors, roeBasis, bookBasis, payoutBand, payoutStep, rf, premium, rmsThreshold = 0.005 }) {
  assertCoherentBasis(roeBasis, bookBasis);
  const [lo, hi] = payoutBand;
  if (!(lo >= 0 && hi > lo && payoutStep > 0)) throw new RangeError("payoutBand [lo,hi] with hi>lo>=0 and positive step required");
  const n = Math.round((hi - lo) / payoutStep + 1e-9) + 1; // index-based, drift-free
  const feasible = [];
  const rmsByPayout = [];
  for (let i = 0; i < n; i++) {
    const p = lo + i * payoutStep;
    let rms = NaN;
    try {
      rms = profileRmsAt(anchors, { roe: roeBasis.roe, rf, premium, payout: p, book: bookBasis.book });
    } catch {
      rms = NaN; // rimBracket refuses the regime (C<=0); non-feasible, never abort the sweep
    }
    if (Number.isFinite(rms) && rms <= rmsThreshold) feasible.push(p);
    rmsByPayout.push({ payout: p, rms });
  }
  // verdict: identified only if the feasible set is a single interval no wider
  // than two steps (payout pinned); otherwise not_identified.
  let verdict = "not_identified";
  if (feasible.length > 0) {
    let intervals = 1;
    for (let i = 1; i < feasible.length; i++) if (feasible[i] - feasible[i - 1] > payoutStep * 1.5) intervals++;
    if (intervals === 1 && (feasible[feasible.length - 1] - feasible[0]) <= 2 * payoutStep) verdict = "identified";
  }
  return {
    basis: `${roeBasis.id}/${bookBasis.id}`,
    roe: roeBasis.roe,
    book: bookBasis.book,
    rf,
    premium,
    payout_band: [lo, hi],
    step: payoutStep,
    rms_threshold: rmsThreshold,
    feasible_payouts: feasible,
    feasible_width: feasible.length ? feasible[feasible.length - 1] - feasible[0] : 0,
    min_rms: rmsByPayout.length ? Math.min(...rmsByPayout.map((r) => r.rms)) : NaN,
    verdict,
    rms_by_payout: rmsByPayout,
  };
}

// Book-free variant: for each payout, choose the book that minimises the
// level-normalised least squares sum((C*book - target)^2) over point/range/floor
// targets (ranges use their mid, floors their bound as pseudo-targets).
// Freeing the book can only loosen the fit — this is the Sol-style wide-band result.
export function profileIdentifyBookFree({ anchors, roe, rf, premium, payoutBand, payoutStep, rmsThreshold = 0.005 }) {
  const [lo, hi] = payoutBand;
  if (!(lo >= 0 && hi > lo && payoutStep > 0)) throw new RangeError("payoutBand [lo,hi] with hi>lo>=0 and positive step required");
  const n = Math.round((hi - lo) / payoutStep + 1e-9) + 1; // index-based, drift-free
  const feasible = [];
  const fits = [];
  for (let i = 0; i < n; i++) {
    const p = lo + i * payoutStep;
    // least-squares book over the level targets: minimise sum((C_i*book - t_i)^2)
    // where C_i uses the anchor's OWN inputs (roe/rf/premium) — grid cells each
    // sit on their own (LT ROE, ERP, rate) axes.
    let num = 0, den = 0, cnt = 0;
    let regimeRefused = false;
    for (const a of anchors) {
      if (a.model_family !== "RIM") continue;
      if (a.horizon !== undefined && a.horizon !== MODEL.HORIZON) continue;
      let C;
      try {
        C = rimBracket({
          roe: a.inputs?.roe ?? roe,
          rf: a.inputs?.rf ?? rf,
          premium: a.inputs?.premium ?? premium,
          payout: p,
        });
      } catch {
        regimeRefused = true;
        break;
      }
      const fair = fairFromAnchor(a);
      const t = fair.type === "point" ? fair.value : fair.type === "range" ? (fair.value[0] + fair.value[1]) / 2 : fair.value;
      num += C * t;
      den += C * C;
      cnt++;
    }
    if (regimeRefused || cnt === 0 || den === 0) {
      fits.push({ payout: p, book: NaN, rms: NaN });
      continue;
    }
    const book = num / den;
    const rms = profileRmsAt(anchors, { roe, rf, premium, payout: p, book });
    fits.push({ payout: p, book, rms });
    if (Number.isFinite(rms) && rms <= rmsThreshold) feasible.push(p);
  }
  let verdict = "not_identified";
  if (feasible.length > 0) {
    let intervals = 1;
    for (let i = 1; i < feasible.length; i++) if (feasible[i] - feasible[i - 1] > payoutStep * 1.5) intervals++;
    if (intervals === 1 && (feasible[feasible.length - 1] - feasible[0]) <= 2 * payoutStep) verdict = "identified";
  }
  return {
    basis: "book-free",
    roe,
    rf,
    premium,
    payout_band: [lo, hi],
    step: payoutStep,
    rms_threshold: rmsThreshold,
    feasible_payouts: feasible,
    feasible_width: feasible.length ? feasible[feasible.length - 1] - feasible[0] : 0,
    min_rms: fits.length ? Math.min(...fits.map((f) => f.rms)) : NaN,
    verdict,
    fits,
  };
}

// ---------------------------------------------------------------------------
// CLI: run the book-basis quantification on the measured 2026-08 anchors.
// Fixtures are measured (this session): sheet inputs from
// docs/archive/2026-08/yoo-rim-sheets, feed book from data/benchmarks/us.json
// (2026-07-31), spot from data/indices/*.json.
// ---------------------------------------------------------------------------
function cli() {
  const ctxSP = { roe: 0.2576, rf: 0.0425, premium: 0.05, payout: 0.3109 }; // sheet 2026E ROE, doc 2026-08-03 premium, engine payout
  const ctxND = { roe: 0.414, rf: 0.0425, premium: 0.055, payout: 0.22 }; // feed NDX100 ROE, doc premium, realised-mean payout
  const anchors = [
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", source_uid: "1668", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: ctxSP }),
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-26", source_uid: "1666", output_kind: "upside", type: "range", value: [0.19, 0.29], spot: 7413.0, inputs: ctxSP }),
    validateAnchor({ model_family: "RIM", index: "NASDAQ100", date: "2026-08-02", source_uid: "1668", output_kind: "upside", type: "floor", value: 0.5, spot: 25913.896484375, inputs: ctxND }),
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-19", source_uid: "1661", output_kind: "fair_value", type: "point", value: 11600, spot: 7413.0, inputs: ctxSP, horizon: 2 }),
    validateAnchor({ model_family: "FUNDAMENTAL", index: "NASDAQ", date: "2026-07-26", source_uid: "1666", output_kind: "upside", type: "range", value: [0.35, 0.49], spot: 24975.8, inputs: ctxND }),
  ];
  const ctxs = [ctxSP, ctxSP, ctxND, ctxSP, ctxND];
  const rep = reportBookBasis(anchors, ctxs);

  // Band sensitivity: required book at the measured discount-slope band edges,
  // plus the basis assessment against the three candidate books.
  const candidates = {
    feedBook: { SP500: 1315.9252231358494, NASDAQ100: 3199.48851998959 },
    sheetBook: { SP500: 1291.0, NASDAQ100: 3781.0 }, // his 2026-08 sheet: SP500 2025 col; NDX100 2026E col
  };
  for (const row of rep.rows) {
    if (row.verdict === "NULL") continue;
    const a = anchors[rep.rows.indexOf(row)];
    const band = {};
    for (const b of MODEL.DISCOUNT_B_BAND) {
      band[`b=${b}`] = requiredBook(a, { ...a.inputs, b }); // typed envelope, same shape as required_book
    }
    row.band_required_book = band;
    row.basis = assessBookBasis(a, a.inputs, {
      feedBook: candidates.feedBook[a.index],
      sheetBook: candidates.sheetBook[a.index],
    });
  }
  console.log(JSON.stringify(rep, null, 2));
}

// Validate the machine-link contract. This proves shape, units, hashes/paths and
// coordinate uniqueness; semantic transcription from pixels remains a declared
// human audit, not a machine/OCR claim.
export function validateGridFixture(fx) {
  const fail = (message) => { throw new Error(`grid fixture invalid: ${message}`); };
  if (fx?.schema_version !== "fenok-rim-grid-2025-12-09.v1") fail("schema_version");
  if (fx?.model_family !== "RIM") fail("model_family");
  if (!Array.isArray(fx?.cells) || fx.cells.length !== 54) fail("exactly 54 cells required");
  if (fx?.rate_scenarios?.current !== 0.042 || fx?.rate_scenarios?.["3.5%"] !== 0.035) fail("rate scenarios");
  const instruments = ["SPX", "CCMP", "IWM"];
  if (JSON.stringify(Object.keys(fx.instruments ?? {}).sort()) !== JSON.stringify([...instruments].sort())) fail("instrument set");
  for (const instrument of instruments) {
    const meta = fx.instruments[instrument];
    const artifact = fx.artifacts?.[instrument];
    if (!(Number.isFinite(meta?.spot) && meta.spot > 0)) fail(`${instrument} spot`);
    if (typeof meta?.spot_unit !== "string" || meta.spot_unit !== meta.fair_value_unit) fail(`${instrument} spot/fair unit`);
    if (meta.feed_book !== null && (!(Number.isFinite(meta.feed_book) && meta.feed_book > 0) || meta.feed_book_unit !== meta.fair_value_unit)) fail(`${instrument} feed-book unit`);
    if (!Array.isArray(meta.lt_roe_axis) || meta.lt_roe_axis.length !== 3 || !meta.lt_roe_axis.every(Number.isFinite)) fail(`${instrument} ROE axis`);
    if (!Array.isArray(meta.erp_axis) || meta.erp_axis.length !== 3 || !meta.erp_axis.every(Number.isFinite)) fail(`${instrument} ERP axis`);
    if (typeof artifact?.path !== "string" || !/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? "")) fail(`${instrument} artifact`);
    for (const scenario of ["current", "3.5%"]) {
      const cells = fx.cells.filter((cell) => cell.instrument === instrument && cell.scenario === scenario);
      if (cells.length !== 9) fail(`${instrument}/${scenario} must have nine cells`);
      const coordinates = new Set();
      for (const cell of cells) {
        if (!Number.isInteger(cell.row) || cell.row < 0 || cell.row > 2 || !Number.isInteger(cell.col) || cell.col < 0 || cell.col > 2) fail(`${instrument}/${scenario} row/col`);
        coordinates.add(`${cell.row}:${cell.col}`);
        if (cell.lt_roe !== meta.lt_roe_axis[cell.row] || cell.risk_premium !== meta.erp_axis[cell.col]) fail(`${instrument}/${scenario} axis membership`);
        if (!(Number.isFinite(cell.fair_value) && cell.fair_value > 0)) fail(`${instrument}/${scenario} fair value`);
        if (!(Number.isFinite(cell.x) && cell.x >= 0 && cell.x <= 1 && Number.isFinite(cell.y) && cell.y >= 0 && cell.y <= 1)) fail(`${instrument}/${scenario} image coordinates`);
        if ((scenario === "current" && cell.x >= 0.5) || (scenario === "3.5%" && cell.x <= 0.5)) fail(`${instrument}/${scenario} image partition`);
        if (cell.artifact !== artifact.path) fail(`${instrument}/${scenario} artifact link`);
      }
      if (coordinates.size !== 9) fail(`${instrument}/${scenario} duplicate coordinate`);
    }
  }
  return fx;
}

// Build 54 point-cell anchors from the machine-linked 2025-12-09 grid fixture.
// Every fixture cell is a POINT fair value; no floors/ranges are used as
// pseudo-targets in this profile. rate_scenario is preserved per cell.
export function gridAnchorsFromFixture(fx, instrument, rfCurrent) {
  validateGridFixture(fx);
  if (!Object.hasOwn(fx.instruments, instrument)) throw new Error(`unknown fixture instrument: ${instrument}`);
  return fx.cells
    .filter((c) => c.instrument === instrument)
    .map((c) =>
      validateAnchor({
        model_family: fx.model_family ?? "RIM",
        index: instrument,
        date: "2025-12-09",
        output_kind: "fair_value",
        type: "point",
        value: c.fair_value,
        spot: fx.instruments[instrument].spot,
        inputs: { roe: c.lt_roe, rf: c.scenario === "3.5%" ? 0.035 : rfCurrent, premium: c.risk_premium, payout: 0.3 },
      }),
    );
}

// CLI: --grid-profile <fixture-path> [--rf <decimal>] prints the Sol-style
// book-free payout bands per instrument. None of these sheets prints a payout,
// so no instrument can prove a payout-to-book link from this fixture.
function cliGridProfile(fixturePath, rfCurrent) {
  const fx = validateGridFixture(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
  const cells = fx.cells;
  if (cells.length !== 54) throw new Error(`fixture must have 54 cells, got ${cells.length}`);
  const out = { schema: "fenok-rim-grid-profile.v1", rf_current: rfCurrent, bands: {} };
  for (const inst of ["SPX", "CCMP", "IWM"]) {
    const anchors = gridAnchorsFromFixture(fx, inst, rfCurrent);
    const prof = profileIdentifyBookFree({ anchors, roe: 0.261, rf: rfCurrent, premium: 0.045, payoutBand: [0, 0.6], payoutStep: 0.0025, rmsThreshold: 0.005 });
    const f = prof.feasible_payouts;
    out.bands[inst] = {
      feasible: f.length ? [f[0], f[f.length - 1]] : null,
      n_payouts: f.length,
      min_rms: Number.isFinite(prof.min_rms) ? prof.min_rms : null,
      verdict: prof.verdict,
      cells: anchors.length,
    };
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const gridIdx = process.argv.indexOf("--grid-profile");
  if (gridIdx !== -1) {
    const pathArg = process.argv[gridIdx + 1];
    const rfIdx = process.argv.indexOf("--rf");
    const rf = rfIdx !== -1 ? Number(process.argv[rfIdx + 1]) : 0.042;
    cliGridProfile(pathArg, rf);
  } else {
    cli();
  }
}
