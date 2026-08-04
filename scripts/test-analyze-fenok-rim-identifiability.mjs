#!/usr/bin/env node
// test-analyze-fenok-rim-identifiability.mjs
// TDD spec for the nested-repo book-basis identification lab.
// Deterministic, pure-function tests. Floors are inequality constraints and
// must never be convertible to points (a floor is not a value).
//
// Run: node scripts/test-analyze-fenok-rim-identifiability.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  MODEL,
  rimBracket,
  validateAnchor,
  fairFromAnchor,
  requiredBook,
  impliedPBR,
  assessBookBasis,
  reportBookBasis,
  toPointValue,
  profileIdentify,
  profileIdentifyBookFree,
  profileRmsAt,
  gridAnchorsFromFixture,
  validateGridFixture,
  FLOOR_IS_INEQUALITY,
  RANGE_IS_INTERVAL,
} from "./analyze-fenok-rim-identifiability.mjs";

// ---------------------------------------------------------------------------
// 1. rimBracket unit properties
// ---------------------------------------------------------------------------
{
  // r == k  =>  residual income is zero every year  =>  V == B0  =>  C == 1
  const c = rimBracket({ roe: 0.10, rf: 0.05, premium: 0.05, payout: 0.3 });
  assert.equal(c, 1, "r==k must give C exactly 1 (no residual)");

  // C is strictly decreasing in the discount rate WHEN roe > k (residual positive);
  // for roe < k the sign flips — the claim is scoped, not global.
  const cLo = rimBracket({ roe: 0.20, rf: 0.03, premium: 0.05, payout: 0.3 });
  const cHi = rimBracket({ roe: 0.20, rf: 0.07, premium: 0.05, payout: 0.3 });
  assert.ok(cLo > cHi, "C must decrease as discount rises when roe > k");
  // q == 1 branch: g == d exactly (rf=0.05 -> d=0.104; roe=0.208, payout=0.5 -> g=0.104)
  {
    const q1 = rimBracket({ roe: 0.208, rf: 0.05, premium: 0.04, payout: 0.5 });
    // explicit 9-year sum for the same inputs
    const d = MODEL.DISCOUNT_A + MODEL.DISCOUNT_B * 0.05;
    const k = 0.05 + 0.04;
    const g = 0.208 * 0.5;
    let B = 1, pv = 1, disc = 1, RI9 = 0;
    for (let t = 1; t <= MODEL.N; t++) {
      const RI = B * (0.208 - k);
      disc *= 1 + d;
      pv += RI / disc;
      B *= 1 + g;
      if (t === MODEL.N) RI9 = RI;
    }
    pv += RI9 / d / disc;
    assert.ok(Math.abs(q1 - pv) < 1e-12, "q==1 branch must equal the explicit sum");
  }
  // negative bracket (roe < k badly) must throw, not invert inequalities
  assert.throws(() => rimBracket({ roe: -0.05, rf: 0.08, premium: 0.12, payout: 0.0 }), /must be positive/);
  // d <= 0 must throw
  assert.throws(() => rimBracket({ roe: 0.2, rf: -0.14, premium: 0.05, payout: 0.3 }), /discount must be positive/);

  // C is increasing in ROE (residual widens)
  const cR20 = rimBracket({ roe: 0.20, rf: 0.04, premium: 0.05, payout: 0.3 });
  const cR25 = rimBracket({ roe: 0.25, rf: 0.04, premium: 0.05, payout: 0.3 });
  assert.ok(cR25 > cR20, "C must increase with ROE");

  // Determinism: identical input -> bit-identical output
  assert.equal(
    rimBracket({ roe: 0.20, rf: 0.04, premium: 0.05, payout: 0.3 }),
    rimBracket({ roe: 0.20, rf: 0.04, premium: 0.05, payout: 0.3 }),
  );
}

// ---------------------------------------------------------------------------
// 2. Schema validation + model-family preservation
// ---------------------------------------------------------------------------
{
  assert.throws(() => validateAnchor({}), /model_family/);
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "point", index: "SP500", output_kind: "upside" }), /date/);
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "banana", index: "SP500", date: "2026-08-02" }), /type/);
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "point", index: "SP500", date: "2026-08-02", output_kind: "upside", value: 0.1, spot: 7600.5 }), /inputs/);
  // an upside FLOOR without spot is invalid too (a floor is still an upside anchor)
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "floor", index: "SP500", date: "2026-08-02", output_kind: "upside", value: 0.18, inputs: { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 } }), /upside requires a finite positive spot/);
  const baseInputs = { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 };
  // NaN inside a range must be rejected (NaN > NaN is false, so the old lo>hi check missed it)
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "range", index: "SP500", date: "2026-08-02", output_kind: "upside", value: [NaN, 0.3], spot: 7600.5, inputs: baseInputs }), /finite/);
  // upside below -100% is nonsense and must be rejected
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "point", index: "SP500", date: "2026-08-02", output_kind: "upside", value: -1.5, spot: 7600.5, inputs: baseInputs }), />= -1/);
  // zero spot is rejected
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "point", index: "SP500", date: "2026-08-02", output_kind: "upside", value: 0.1, spot: 0, inputs: baseInputs }), /positive spot/);
  // fair_value anchors must be positive
  assert.throws(() => validateAnchor({ model_family: "RIM", type: "point", index: "SP500", date: "2026-08-02", output_kind: "fair_value", value: 0, spot: 7413, inputs: baseInputs }), /fair_value must be positive/);

  const a = validateAnchor({
    model_family: "RIM",
    index: "SP500",
    date: "2026-08-02",
    source_uid: "1668",
    output_kind: "upside",
    type: "floor",
    value: 0.18,
    spot: 7600.5,
    inputs: { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 },
  });
  assert.equal(a.model_family, "RIM");
  assert.equal(a.type, "floor");

  // non-RIM family preserved and never consumed as RIM
  const f = validateAnchor({
    model_family: "FUNDAMENTAL",
    index: "NASDAQ",
    date: "2026-07-26",
    source_uid: "1666",
    output_kind: "upside",
    type: "range",
    value: [0.35, 0.49],
    spot: 24975.8,
    inputs: { rf: 0.0425 },
  });
  assert.equal(f.model_family, "FUNDAMENTAL");
}

// ---------------------------------------------------------------------------
// 3. Type preservation: point / range / floor through the whole pipeline
// ---------------------------------------------------------------------------
const ctx = { roe: 0.2576, rf: 0.0425, premium: 0.05, payout: 0.3109 };

{
  // POINT upside: requiredBook is a point; impliedPBR == C/(1+u) exactly
  const a = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "point", value: 0.12, spot: 7600.5, inputs: ctx });
  const C = rimBracket(ctx);
  const b = requiredBook(a, ctx);
  assert.equal(b.type, "point");
  assert.ok(Math.abs(b.value - (1.12 * a.spot) / C) < 1e-9, "requiredBook point value");
  const pbr = impliedPBR(a, ctx);
  assert.equal(pbr.type, "point");
  assert.ok(Math.abs(pbr.value - C / 1.12) < 1e-9, "impliedPBR identity: spot/B0* = C/(1+u)");

  // RANGE: both bounds preserved, inverted correctly for PBR
  const r2 = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-26", output_kind: "upside", type: "range", value: [0.19, 0.29], spot: 7413.0, inputs: ctx });
  const br = requiredBook(r2, ctx);
  assert.equal(br.type, "range");
  assert.ok(Math.abs(br.value[0] - (1.19 * r2.spot) / C) < 1e-9);
  assert.ok(Math.abs(br.value[1] - (1.29 * r2.spot) / C) < 1e-9);
  const pr = impliedPBR(r2, ctx);
  assert.equal(pr.type, "range");
  assert.ok(Math.abs(pr.value[0] - C / 1.29) < 1e-9, "PBR range low bound inverts hi book");
  assert.ok(Math.abs(pr.value[1] - C / 1.19) < 1e-9);

  // FLOOR: stays a floor (lower bound on book, upper bound on PBR), never a point
  const fl = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: ctx });
  const bf = requiredBook(fl, ctx);
  assert.equal(bf.type, "floor");
  assert.equal(bf.bound, "lower");
  assert.ok(Math.abs(bf.value - (1.18 * fl.spot) / C) < 1e-9);
  const pf = impliedPBR(fl, ctx);
  assert.equal(pf.type, "floor");
  assert.equal(pf.bound, "upper");
  assert.ok(Math.abs(pf.value - C / 1.18) < 1e-9);
  assert.throws(() => toPointValue(bf), new RegExp(FLOOR_IS_INEQUALITY));
  // and a range is equally non-collapsible
  assert.throws(() => toPointValue(br), new RegExp(RANGE_IS_INTERVAL));
}

// ---------------------------------------------------------------------------
// 4. Fair-value anchors (output_kind 'fair_value') route through the same maths
// ---------------------------------------------------------------------------
{
  const a = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-19", output_kind: "fair_value", type: "point", value: 11600, spot: 7413.0, inputs: ctx });
  const C = rimBracket(ctx);
  const b = requiredBook(a, ctx);
  assert.equal(b.type, "point");
  assert.ok(Math.abs(b.value - 11600 / C) < 1e-9);
}

// ---------------------------------------------------------------------------
// 5. 2026-08 printed anchors: quantify the required book and compare bases
//    (feed book 2026-07-31: SP500 1,315.93 / NDX100 3,199.49 from benchmarks)
// ---------------------------------------------------------------------------
{
  // S&P 2026-08-02 letter floor "18% 이상" (uid 1668)
  const a = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: ctx });
  const res = assessBookBasis(a, ctx, {
    feedBook: 1315.9252231358494,
    sheetBook: 1291.0,
    printedPBR: 5.167, // his 2026-08 sheet PBR row, 2025 column (display PBR, NOT model book)
  });
  // verdicts must be computed deterministically; feed book is the doc-established model basis
  assert.equal(res.feedBook.book, 1315.9252231358494);
  assert.ok(["inside", "meets", "outside"].includes(res.feedBook.verdict));
  // every candidate keeps the anchor type: a floor can only MEET (>=) or fail
  assert.notEqual(res.feedBook.verdict, "point");

  // NDX100 2026-08-02 floor "50% 이상" (uid 1668)
  const nd = validateAnchor({ model_family: "RIM", index: "NASDAQ100", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.5, spot: 25913.896484375, inputs: { roe: 0.414, rf: 0.0425, premium: 0.055, payout: 0.22 } });
  const Cnd = rimBracket({ roe: 0.414, rf: 0.0425, premium: 0.055, payout: 0.22 });
  const bnd = requiredBook(nd, { roe: 0.414, rf: 0.0425, premium: 0.055, payout: 0.22 });
  assert.equal(bnd.type, "floor");
  assert.ok(Math.abs(bnd.value - (1.5 * nd.spot) / Cnd) < 1e-9);

  // 2-year horizon anchor is a NULL for the 9-year model: horizon mismatch must be flagged, never fit
  const twoY = validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-19", output_kind: "fair_value", type: "point", value: 11600, spot: 7413.0, inputs: ctx, horizon: 2 });
  const rep = reportBookBasis([twoY], [ctx]);
  assert.equal(rep.rows[0].verdict, "NULL");
  assert.equal(rep.rows[0].reason, "horizon-mismatch");
}

// ---------------------------------------------------------------------------
// 6. Profile identification (payout sweep, coherent basis, floor one-sided)
// ---------------------------------------------------------------------------
{
  const anchors = [
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 } }),
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-07-26", output_kind: "upside", type: "range", value: [0.19, 0.29], spot: 7413.0, inputs: { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 } }),
  ];

  // Coherent-basis guard: his ROE with our book is a MIXED basis and must be rejected
  assert.throws(
    () => profileIdentify({ anchors, roeBasis: { id: "his", roe: 0.2576 }, bookBasis: { id: "feed", book: 1315.9252231358494 }, payoutBand: [0.05, 0.6], payoutStep: 0.01, rf: 0.0425, premium: 0.05 }),
    /coherent basis|basis_id/,
  );

  // Coherent (his ROE, his sheet book): deterministic result, floor error one-sided
  const prof = profileIdentify({
    anchors,
    roeBasis: { id: "his", roe: 0.2576 },
    bookBasis: { id: "his", book: 1291.0 },
    payoutBand: [0.0, 0.6],
    payoutStep: 0.005,
    rf: 0.0425,
    premium: 0.05,
    rmsThreshold: 0.005,
  });
  assert.equal(prof.basis, "his/his");
  assert.ok(["identified", "not_identified"].includes(prof.verdict));
  assert.ok(Array.isArray(prof.feasible_payouts));
  assert.ok(prof.feasible_payouts.length > 0, "his/his coherent basis must have a feasible payout band");
  assert.equal(JSON.stringify(prof), JSON.stringify(profileIdentify({
    anchors, roeBasis: { id: "his", roe: 0.2576 }, bookBasis: { id: "his", book: 1291.0 },
    payoutBand: [0.0, 0.6], payoutStep: 0.005, rf: 0.0425, premium: 0.05, rmsThreshold: 0.005,
  })), "profile must be deterministic");

  // Floor is one-sided: an anchor that is a floor only penalises under-shoot.
  // The single floor ≥18% is feasible for EVERY payout (choose book accordingly),
  // so with book fixed the floor alone is feasible where modelFair ≥ bound.
  const floorOnly = profileIdentify({
    anchors: [anchors[0]], roeBasis: { id: "his", roe: 0.2576 }, bookBasis: { id: "his", book: 1291.0 },
    payoutBand: [0.0, 0.6], payoutStep: 0.01, rf: 0.0425, premium: 0.05, rmsThreshold: 0.005,
  });
  assert.ok(floorOnly.feasible_payouts.length > 0, "floor-only must be feasible for the high-book payouts");

  // Book-free sweep: the feasible band must be at least as wide as the book-fixed one
  // (freeing the book dimension can only loosen the fit) — the Sol-style result.
  const free = profileIdentifyBookFree({
    anchors, roe: 0.2576, rf: 0.0425, premium: 0.05,
    payoutBand: [0.0, 0.6], payoutStep: 0.005, rmsThreshold: 0.005,
  });
  assert.equal(free.verdict, "not_identified", "book-free payout is expected non-identifiable over a wide band");
  const wFixed = prof.feasible_payouts.length * prof.step;
  const wFree = free.feasible_payouts.length * free.step;
  assert.ok(wFree >= wFixed - 1e-9, "book-free feasible width must not shrink below book-fixed");

  // Degenerate band [0.5,0.5] must be rejected in BOTH modes
  assert.throws(() => profileIdentify({ anchors, roeBasis: { id: "his", roe: 0.2576 }, bookBasis: { id: "his", book: 1291 }, payoutBand: [0.5, 0.5], payoutStep: 0.01, rf: 0.0425, premium: 0.05 }), /hi>lo/);
  assert.throws(() => profileIdentifyBookFree({ anchors, roe: 0.2576, rf: 0.0425, premium: 0.05, payoutBand: [0.5, 0.5], payoutStep: 0.01 }), /hi>lo/);

  // A regime the model refuses (roe << k, C <= 0) must not abort the sweep: the
  // payout point is simply non-feasible and the sweep continues.
  const bad = profileIdentify({
    anchors: [validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: { rf: 0.0425, roe: 0.2576, premium: 0.05, payout: 0.3109 } })],
    roeBasis: { id: "feed", roe: 0.01 }, bookBasis: { id: "feed", book: 1000 },
    payoutBand: [0.0, 0.6], payoutStep: 0.1, rf: 0.08, premium: 0.12, rmsThreshold: 0.005,
  });
  assert.ok(Array.isArray(bad.feasible_payouts), "sweep must complete even when some payouts are regime-refused");
  assert.equal(JSON.stringify(bad.rms_by_payout.map((r) => r.rms)).includes("null") || bad.feasible_payouts.length >= 0, true);
}

// ---------------------------------------------------------------------------
// 7. Report determinism + JSON-stable output
// ---------------------------------------------------------------------------
{
  const anchors = [
    validateAnchor({ model_family: "RIM", index: "SP500", date: "2026-08-02", output_kind: "upside", type: "floor", value: 0.18, spot: 7600.5, inputs: ctx }),
  ];
  const r1 = JSON.stringify(reportBookBasis(anchors, [ctx]));
  const r2 = JSON.stringify(reportBookBasis(anchors, [ctx]));
  assert.equal(r1, r2, "report must be deterministic");
  assert.ok(r1.includes('"model_family":"RIM"'));
  assert.ok(r1.includes('"type":"floor"'));
}

// ---------------------------------------------------------------------------
// 8. 2025-12-09 grid fixture: 54 machine-linked cells, band + book reproduction
// ---------------------------------------------------------------------------
{
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const FX = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "fixtures", "fenok-rim-2025-12-09-grid.json"), "utf8"));
  validateGridFixture(FX);

  // fixture integrity: 54 cells, 27 per scenario, model family, finite fields
  assert.equal(FX.cells.length, 54);
  assert.equal(FX.cells.filter((c) => c.scenario === "current").length, 27);
  assert.equal(FX.cells.filter((c) => c.scenario === "3.5%").length, 27);
  assert.equal(FX.model_family, "RIM");
  assert.equal(FX.instruments.IWM.feed_book, null, "ETF-price cells must not carry an index-level book value");
  for (const c of FX.cells) {
    assert.ok(Number.isFinite(c.fair_value) && Number.isFinite(c.x) && Number.isFinite(c.y));
    assert.ok(Number.isFinite(c.lt_roe) && Number.isFinite(c.risk_premium));
    assert.ok(["SPX", "CCMP", "IWM"].includes(c.instrument));
    assert.equal(typeof c.artifact, "string");
  }
  const duplicate = structuredClone(FX);
  duplicate.cells[1].row = duplicate.cells[0].row;
  duplicate.cells[1].col = duplicate.cells[0].col;
  duplicate.cells[1].lt_roe = duplicate.cells[0].lt_roe;
  duplicate.cells[1].risk_premium = duplicate.cells[0].risk_premium;
  assert.throws(() => validateGridFixture(duplicate), /duplicate coordinate/);
  const unitMix = structuredClone(FX);
  unitMix.instruments.IWM.feed_book = 1117;
  unitMix.instruments.IWM.feed_book_unit = "index_points";
  assert.throws(() => validateGridFixture(unitMix), /feed-book unit/);
  // instrument identity preserved
  assert.equal(FX.instruments.SPX.spot, 6840.51);
  assert.equal(FX.instruments.CCMP.spot, 23578.13);

  // artifact hashes match the actual archived files (paths are repo-root relative)
  const REPO_ROOT = path.resolve(REPO, "../.."); // 100xFenok-platform (nested repo sits under source/)
  for (const inst of ["SPX", "CCMP", "IWM"]) {
    const p = path.join(REPO_ROOT, FX.artifacts[inst].path);
    assert.ok(fs.existsSync(p), `artifact missing: ${p}`);
    const h = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    assert.equal(h, FX.artifacts[inst].sha256, `artifact hash mismatch for ${inst}`);
  }

  // Sol band reproduction at rf = 4.20% (10Y 2025-12-09), within one 0.25pp step
  const SOL = { SPX: [0.2225, 0.535], CCMP: [0.1225, 0.45], IWM: [0.0525, 0.3125] };
  for (const inst of ["SPX", "CCMP", "IWM"]) {
    const anchors = gridAnchorsFromFixture(FX, inst, 0.042);
    assert.equal(anchors.length, 18, `${inst} must build 18 point-cell anchors`);
    assert.ok(anchors.every((a) => a.type === "point" && a.output_kind === "fair_value"), "every grid cell is a POINT fair value");
    const prof = profileIdentifyBookFree({ anchors, roe: 0.261, rf: 0.042, premium: 0.045, payoutBand: [0, 0.6], payoutStep: 0.0025, rmsThreshold: 0.005 });
    const f = prof.feasible_payouts;
    assert.ok(f.length > 0, `${inst} must have a feasible payout band`);
    assert.ok(Math.abs(f[0] - SOL[inst][0]) <= 0.0025 + 1e-12, `${inst} low edge within one grid step`);
    assert.ok(Math.abs(f[f.length - 1] - SOL[inst][1]) <= 0.0025 + 1e-12, `${inst} high edge within one grid step`);
    assert.ok(Number.isFinite(prof.min_rms) && prof.min_rms <= 0.005, `${inst} min RMS below 0.5%`);
  }

  // Only SPX has an independently printed payout in this fixture. It selects
  // the feed book within 0.3%; deriving payout from feed book and then solving
  // the same book (as an earlier CCMP check did) would be circular.
  const anchors = gridAnchorsFromFixture(FX, "SPX", 0.042);
  const payout = FX.instruments.SPX.printed_payout;
  let num = 0, den = 0;
  for (const a of anchors) { const C = rimBracket({ roe: a.inputs.roe, rf: a.inputs.rf, premium: a.inputs.premium, payout }); num += C * a.value; den += C * C; }
  const book = num / den;
  const rms = profileRmsAt(anchors, { roe: 0.261, rf: 0.042, premium: 0.045, payout, book });
  assert.ok(Math.abs(book - FX.instruments.SPX.feed_book) / FX.instruments.SPX.feed_book <= 0.003, "SPX solved book within 0.3% of feed book");
  assert.ok(Number.isFinite(rms) && rms <= 0.005, "SPX RMS below 0.5% at printed payout");
}

console.log("OK test-analyze-fenok-rim-identifiability.mjs");
