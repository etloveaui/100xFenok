// Fenok RIM — conditional index RIM diagnostic (v8 hypothesis).
//
// The captured grids support this structural hypothesis conditionally on the
// chosen book/payout inputs. They do not identify those inputs jointly. Two
// rates do different jobs inside the reproduced candidate:
//   Ke   = Rf + RiskPremium        -> the residual only
//   disc = 0.076 + 0.560 * Rf      -> all discounting, no risk premium in it
//   RI_t = B_{t-1} * (ROE_t - Ke)
//   V    = B0 + sum_{t=1..9} RI_t/(1+disc)^t + (RI_9/disc)/(1+disc)^9
//   B_t  = B_{t-1} * (1 + ROE_t * retention)
// Verified against all 54 captured 2025-12-09 grid cells (three indices, each
// printed at the observed 10Y and at a 3.5% scenario): RMS 0.41%, max 1.06%,
// with book values from our own feed. Cross-checked on a separate slide — the
// 선진국/신흥국 master tables reproduce to -1.6%~-6.6%.
// Observed price/rate/ROE candidates refresh from our data, while payout and
// risk premium remain dated anchors. Therefore every emitted value is a
// diagnostic and every publication state is NULL.
// Account of the identification: docs/references/fenok-rim-formula-identification.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRimPublication } from "./fenok-rim-publication-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");
const KRX_DERIVED_INPUTS = path.join(ROOT, "data", "admin", "fenok-edge-korea-krx-daily-index.json");
const DAMODARAN_ERP = path.join(ROOT, "data", "damodaran", "erp.json");
const PAYOUT_HISTORY = path.join(ROOT, "data", "computed", "fenok-rim", "payout-history.json");
const OUT_DIR = path.join(ROOT, "data", "computed", "fenok-rim");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "fenok-rim");
const CALIBRATION_EVIDENCE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/fenok-rim-calibration-evidence.json"), "utf8"));
const CALIBRATION_CLAIMS = new Map(CALIBRATION_EVIDENCE.claims.map((row) => [row.evidence_id, row]));

export const RIM_EXPLICIT_YEARS = 9;
export const RIM_GRID_STEP = 0.005;
export const RIM_RATE_SCENARIO_10Y = 0.035;

// The source model discounts at a rate that is NOT the cost of equity. The two
// are separate columns on the patent's own tool screen (Government bond rate |
// Risk premium | Cost of capital | ... | Discount rate), and the sheets prove
// they behave differently: on the 2025-12-09 S&P grid a 1%p move in the risk
// free rate shifts fair value 11.2% while a 1%p move in the risk premium shifts
// it only 4.77%. If both travelled through Ke = Rf + RP those would be equal.
// So the risk premium reaches the residual only, and the discount rate follows
// the risk-free rate on its own slope. Fitted across all 54 captured grid cells
// (three indices x two rate scenarios): RMS 0.41%, max 1.06%.
// CAUTION: the slope is identified from two risk-free points (4.2% and 3.5%)
// only. Outside roughly 3~5% it is an extrapolation.
export const RIM_DISCOUNT = { intercept: 0.076, slope: 0.560, fitted_rf_range: [0.035, 0.042] };
export function discountRate(riskFree) {
  if (!Number.isFinite(riskFree)) return null;
  return RIM_DISCOUNT.intercept + RIM_DISCOUNT.slope * riskFree;
}

// How far outside the fitted band a risk-free rate sits, and whether that is
// tolerable. This is not a theoretical caution: his 2021-01 KOSPI grid, at a
// Korean 10Y near 1.7%, implies a 5.04~6.61% discount across explicit payout
// assumptions of 60~5%, while this relation returns 8.55%. The old 5.6% point
// silently assumed a 39.35% payout and is withdrawn. Extrapolation to low rates
// fails across the full tested band, so a row that strays must say so.
export const RIM_DISCOUNT_TOLERANCE = 0.005;
export function discountExtrapolation(riskFree) {
  const [lo, hi] = RIM_DISCOUNT.fitted_rf_range;
  if (!Number.isFinite(riskFree)) return null;
  const gap = riskFree < lo ? riskFree - lo : riskFree > hi ? riskFree - hi : 0;
  return {
    gap,
    outside: gap !== 0,
    beyondTolerance: Math.abs(gap) > RIM_DISCOUNT_TOLERANCE,
    note: gap === 0
      ? `risk-free ${round(riskFree, 4)} is inside the fitted band ${lo}~${hi}`
      : `risk-free ${round(riskFree, 4)} is ${round(Math.abs(gap) * 10000, 0)}bp ${gap < 0 ? "below" : "above"} the fitted band ${lo}~${hi}`
        + (Math.abs(gap) > RIM_DISCOUNT_TOLERANCE
          ? " — BEYOND TOLERANCE; the relation is known to fail at low rates (his 2021 KOSPI grid implies 5.04~6.61% across payout assumptions 60~5%, while this returns 8.55%)"
          : " — within tolerance"),
  };
}
// Korean indices discount with the DOMESTIC rate (patent-era calc sheets and
// the 2026-08-03 KOSPI sheet both use it; the "US 10Y everywhere" claim from
// the earlier AI-written spec was disproven by the sheets). The observed rate
// comes from the KRX KTS 10Y benchmark government bond captured daily by the
// fenok-edge-korea lane; this dated anchor is only the fallback when that
// capture is missing.
export const RIM_KR_RISK_FREE_ANCHOR = { value: 0.044, as_of: "2026-08-03" };

// The risk premium is not yet separately identified from payout. Damodaran and
// beta substitutions have both failed as direct replacements, while inversion
// remains conditional on which dated payout basis is fixed before scoring.
// These values therefore stay dated sheet anchors, not automatically derived
// market quantities. Damodaran is a drift check only.
const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", market: "us", erp: 0.05, erpSource: "sheet 2026-08-03; Damodaran US 5.03% agrees to 3bp" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "russell2000", name: "러셀 2000", market: "us", erp: 0.045, erpSource: "sheet 2025-12-09" },
  { file: "emerging.json", key: "kospi", name: "코스피", market: "kr", erp: 0.12, erpSource: "sheet 2026-08-03; reproduces his published 10,000~12,000 under the solved formula (10,074), whereas Damodaran 5.49% gives 15,634" },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", market: "us", erp: 0.055, erpSource: "estimated: NASDAQ-family centre, no dedicated sheet" },
];

// Calibration anchors: the source analyst's published outputs, dated. A diverged
// flag means our estimate has drifted from what he publishes — refresh anchors
// from new material, never silently refit.
//
// These replace an earlier set attributed vaguely to an internal catalogue. He
// publishes current residual-income outputs in English under his own byline, so
// each row below is a dated figure with a retrievable source rather than a
// remembered range. His employer is Yuanta and has been since 2019-09-02, so all
// captured material is Yuanta-era; the earlier Kiwoom framing was wrong.
export const RIM_CALIBRATION_ANCHORS = Object.freeze([
  {
    key: "nasdaq100",
    evidence_id: "rim-df8e2e5aa81bfca036c8b547",
    evidence_label: "RIM",
    raw_value: "30 이상",
    published_upside_floor_pct: 30,
    as_of: "2026-04-18",
    source: "https://yellow.kr/blog/economy-board/?mod=document&uid=1606",
  },
  {
    key: "kospi",
    evidence_id: "rim-7041d3d1604bd6d9b5683c04",
    evidence_label: "RIM",
    raw_value: "49.5",
    published_upside_pct: [49.5, 49.5],
    as_of: "2026-06-14",
    source: "https://yellow.kr/blog/economy-board/?mod=document&uid=1638",
  },
]);

for (const anchor of RIM_CALIBRATION_ANCHORS) {
  const claim = CALIBRATION_CLAIMS.get(anchor.evidence_id);
  const expectedAsset = anchor.key === "nasdaq100" ? "NASDAQ100" : anchor.key.toUpperCase();
  if (!claim || claim.asset !== expectedAsset || claim.date !== anchor.as_of || claim.label !== "RIM"
    || claim.label !== anchor.evidence_label || claim.raw_value !== anchor.raw_value
    || claim.source !== anchor.source || String(claim.raw_value).startsWith("AMBIGUOUS:")) {
    throw new Error("invalid RIM calibration anchor evidence join");
  }
}

// Dividend payout, per index. Auditing our live inputs against his 2026-08-03
// sheets showed price, book, ROE, risk-free and risk premium all agreeing within
// 2% while payout was off by -62%~+61% — it is the one input that was actually
// wrong, and the model is sensitive to it because retention drives the book path.
// Our derived payout is not trusted as primary: it reads 20.72% for the S&P
// against the 31.09% printed on his sheet, and 9.71% for NASDAQ 100 against
// 25.65%. So the sheet figure leads, our derived figure follows as a drift
// check, and there is no silent house fallback — an index with neither is
// excluded loudly rather than shipped on a guess.
// Exported because the calibration harness must score the retention THIS build
// resolves, not a copy of it. It previously kept its own table and drifted:
// the harness scored KOSPI at a 13.82% payout while the build shipped 37.89%,
// so every candidate ranking it printed described an engine we do not run.
export const RIM_PAYOUT_ANCHOR = {
  sp500: { value: 0.3109, as_of: "2026-08-03" },
  nasdaq100: { value: 0.2565, as_of: "2026-08-03" },
  nasdaq_composite: { value: 0.2180, as_of: "2026-08-03" },
  kospi: { value: 0.3789, as_of: "2026-08-03" },
  russell2000: { value: 0.045, as_of: "2025-12-09 grid, implied by the captured cells" },
};
// A payout outside this band is a broken derivation, not a real distribution
// policy. Widest real value we carry is Russell's 4.5%; the S&P's is 31%.
const RIM_PAYOUT_BOUNDS = [0.01, 0.75];

export function resolvePayout(key, derivedRetention) {
  const anchor = RIM_PAYOUT_ANCHOR[key];
  const derivedPayout = derivedRetention ? 1 - derivedRetention.value : null;
  const sane = (v) => Number.isFinite(v) && v >= RIM_PAYOUT_BOUNDS[0] && v <= RIM_PAYOUT_BOUNDS[1];
  if (anchor && sane(anchor.value)) {
    const drift = sane(derivedPayout)
      ? ` [drift check: our derived payout ${round(derivedPayout, 4)}, ${round((derivedPayout / anchor.value - 1) * 100, 1)}% off]`
      : " [drift check unavailable: our derived payout is missing or out of bounds]";
    return { value: 1 - anchor.value, source: `sheet payout ${anchor.value} (${anchor.as_of})${drift}` };
  }
  if (sane(derivedPayout)) {
    return { value: derivedRetention.value, source: `${derivedRetention.source} — no sheet anchor for this index` };
  }
  return null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// One grid cell. The residual carries the risk premium; the discounting does not.
//
// A SINGLE long-run ROE runs the whole horizon. That is what his sheets do: the
// grid axis is labelled LT ROE and carries one value, and the master tables print
// one ROE column per index. Every reproduction in the test suite — 90 cells across
// two weeks — holds ROE flat. Later input sheets do print three-year ROE paths,
// and those paths reproduce the forecast-equity roll-forward. They are not the
// singular LT ROE grid axis: feeding them into that axis moved fair values by up
// to 35% against the form that reproduces the grids.
export function computeCell({ bookValue, roePath, retention, riskFree, erp, roeShift = 0, years = RIM_EXPLICIT_YEARS }) {
  const ke = riskFree + erp;          // cost of equity: reaches the residual only
  const disc = discountRate(riskFree); // discount rate: a separate rate, no risk premium in it
  const roe = (Array.isArray(roePath) ? roePath[0] : roePath) + roeShift;
  let book = bookValue;
  let v = bookValue;
  let residual = 0;
  for (let t = 1; t <= years; t += 1) {
    residual = (roe - ke) * book;
    v += residual / (1 + disc) ** t;
    book *= 1 + roe * retention;
  }
  v += residual / (disc * (1 + disc) ** years);
  return v;
}

// One case: the 3x3 grid his sheets print — LT ROE rows (centre +-0.5%p) x risk
// premium columns (centre +-0.5%p). The sheets report both a 적정가 (the centre
// cell) and a 평균 (the mean of nine); we publish the centre, which is what his
// master tables' 적정지수 column matches.
export function computeCase({ px, bookValue, roePath, retention, riskFree, erpCenter }) {
  const cells = [];
  for (const roeShift of [-RIM_GRID_STEP, 0, RIM_GRID_STEP]) {
    for (const erp of [erpCenter - RIM_GRID_STEP, erpCenter, erpCenter + RIM_GRID_STEP]) {
      cells.push(computeCell({ bookValue, roePath, retention, riskFree, erp, roeShift }));
    }
  }
  const centre = computeCell({ bookValue, roePath, retention, riskFree, erp: erpCenter });
  const mean = centre;
  return {
    erp_center: erpCenter,
    risk_free: Math.round(riskFree * 10000) / 10000,
    fair_value: Math.round(mean * 100) / 100,
    upside_pct: Math.round((mean / px - 1) * 10000) / 100,
    upside_min_pct: Math.round((Math.min(...cells) / px - 1) * 10000) / 100,
    upside_max_pct: Math.round((Math.max(...cells) / px - 1) * 10000) / 100,
  };
}

const RIM_INDEX_KEY = { sp500: "SPX", nasdaq100: "NDX", kospi: "KOSPI", philadelphia_semi: "SOX", nasdaq_composite: "CCMP" };

// RETIRED, kept as a record of a tested and rejected idea. The vendor earnings
// field is a twelve-month blend of FY1 and FY2, and de-blending it to FY1 does
// bring it close to the FY1 ROE printed on his INPUT sheets. But the model does
// not consume that quantity: its grid axis is the LT ROE, which matches the ROE
// column of his master tables, and that column is the raw aggregate. Feeding his
// 2025-11-28 tables through the model settles it — his own ROE reproduces the
// published 적정지수 to +0.3%/-4.2%/-2.5%, the raw field to -12%/-3%/-27%, and the
// de-blended field to -35%/-33%/-48%. De-blending is the worst of the three.
export function fiscalYearElapsed(dateIso) {
  const d = dateIso ? new Date(dateIso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  // Index constituents are overwhelmingly December fiscal-year-end.
  return (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
}

export function deblendRoe({ blendedRoe, growthFy2, elapsed }) {
  if (!Number.isFinite(blendedRoe) || !Number.isFinite(growthFy2) || !Number.isFinite(elapsed)) return null;
  const factor = 1 + elapsed * growthFy2;
  // A non-positive or extreme factor means the growth input is broken, not that
  // the ROE should be rescaled: refuse rather than emit a silently wrong number.
  if (!(factor > 0.5) || factor > 3) return null;
  return blendedRoe / factor;
}

export function loadRimDerived() {
  try {
    const payload = JSON.parse(fs.readFileSync(RIM_INPUTS, "utf8"));
    const riskFreeUs = payload?.indices?.SPX?.observed?.risk_free_rate?.value
      ?? Object.values(payload?.indices ?? {})[0]?.observed?.risk_free_rate?.value
      ?? null;
    const paths = {};
    const roeBases = {};
    const medians = {};
    const retentions = {};
    const elapsed = fiscalYearElapsed(payload?.generated_at);
    for (const [ourKey, rimKey] of Object.entries(RIM_INDEX_KEY)) {
      const derived = payload?.indices?.[rimKey]?.derived;
      const periods = derived?.forecast_grid_v1?.periods ?? [];
      const blended = periods
        .map((p) => p?.roe_on_beginning_book?.value)
        .filter((v) => Number.isFinite(v));
      // The vendor field is used AS PUBLISHED. It is already an index-level
      // earnings/book aggregate — recomputing best_eps / (px / pbr) matches it to
      // 0.46bp across thirteen indices — and it is the family his own ROE column
      // belongs to, correlating 0.982 with it once Russell is excluded.
      const roePath = blended;
      roeBases[ourKey] = "vendor index-level aggregate ROE (best_eps / book), used as published";
      medians[ourKey] = null; // filled from the benchmark history at row build time
      if (roePath.length >= 3) paths[ourKey] = roePath.slice(0, 3);
      const payout = derived?.payout_ratio?.value;
      if (Number.isFinite(payout) && payout > 0 && payout < 1) {
        retentions[ourKey] = { value: 1 - payout, source: `observed derived payout_ratio ${round(payout, 4)}` };
      }
    }
    return { riskFreeUs: Number.isFinite(riskFreeUs) ? riskFreeUs : null, paths, retentions, roeBases, medians };
  } catch {
    return { riskFreeUs: null, paths: {}, retentions: {}, roeBases: {} };
  }
}

// Experimental long-run ROE cap retained for continuity in computation-only
// rows. It was fitted on two KOSPI observations, one since withdrawn as
// FUNDAMENTAL rather than RIM; on the sole admissible KOSPI row it misses by
// -24.5%. It changes under another payout basis and is not an identified rule.
// Once floors are treated as
// constraints and SOXX observations are excluded from the Philadelphia index,
// the calibration harness finds no admissible ROE candidate. Every public row
// is therefore NULL-gated; a row still says when this experimental cap binds.
export const RIM_ROE_CAP_MULTIPLE = 2.3;
export function capLongRunRoe(roe, median5y) {
  if (!Number.isFinite(roe)) return { value: null, capped: false };
  if (!Number.isFinite(median5y) || median5y <= 0) {
    return { value: roe, capped: false, note: "no 5-year median available; uncapped" };
  }
  const ceiling = RIM_ROE_CAP_MULTIPLE * median5y;
  if (roe <= ceiling) {
    return { value: roe, capped: false, note: `spot ${round(roe, 4)} is ${round(roe / median5y, 2)}x its 5-year median, inside the ${RIM_ROE_CAP_MULTIPLE}x bound` };
  }
  return {
    value: ceiling,
    capped: true,
    note: `spot ${round(roe, 4)} is ${round(roe / median5y, 2)}x its 5-year median of ${round(median5y, 4)}; capped to ${round(ceiling, 4)} at the ${RIM_ROE_CAP_MULTIPLE}x bound`,
  };
}

// Damodaran republishes the country workbook a few times a year, so anything
// past roughly two quarters is a figure the world has moved on from. This does
// not block — the premium is a drift check, not an input — but it must be
// visible rather than implied by a green workflow run.
export const RIM_ERP_MAX_AGE_DAYS = 180;

// The benchmark workbook and the Global Scouter export arrive weekly, by hand,
// and that is not going to change. What must change is that a missed week is
// currently invisible: the daily build reuses the previous export without
// comment. Anything past this is late enough to say so on the row.
export const RIM_WEEKLY_EXPORT_MAX_AGE_DAYS = 10;

function ageInDays(dateish) {
  const t = dateish ? Date.parse(dateish) : NaN;
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400000) : null;
}

// A hand-delivered export cannot be chased by a workflow, so the engine reports
// its age instead of assuming it arrived.
export function weeklyExportAge(label, dateish) {
  const days = ageInDays(dateish);
  if (days === null) return { label, as_of: dateish ?? null, age_days: null, late: null, note: `${label}: no source date to check` };
  const late = days > RIM_WEEKLY_EXPORT_MAX_AGE_DAYS;
  return {
    label,
    as_of: dateish,
    age_days: days,
    late,
    note: `${label} export is ${days} days old`
      + (late ? ` — LATE past the ${RIM_WEEKLY_EXPORT_MAX_AGE_DAYS}-day weekly window; the build is reusing a prior export` : ", within the weekly window"),
  };
}

// Country equity risk premium from the Damodaran shadow converter. Refreshes
// with that weekly lane; the workbook month travels with the value so a stale
// publication is visible instead of silent.
export function loadMarketErp() {
  try {
    const payload = JSON.parse(fs.readFileSync(DAMODARAN_ERP, "utf8"));
    const us = payload?.us_erp;
    const kr = payload?.countries?.Korea?.equity_risk_premium;
    const sane = (v) => Number.isFinite(v) && v > 0.01 && v < 0.15;
    if (!sane(us) || !sane(kr)) return null;
    // The weekly lane refreshes the FILE; it does not refresh the workbook the
    // file is built from. Damodaran republishes on his own cadence, so a
    // successful run proves nothing about the figure's age — today the workbook
    // is dated 2026-04-01. Carry the age so a stale premium cannot pass as
    // current just because the job went green.
    const sourceDate = payload?.metadata?.source_date ?? null;
    const parsed = sourceDate ? Date.parse(sourceDate) : NaN;
    const ageDays = Number.isFinite(parsed) ? Math.round((Date.now() - parsed) / 86400000) : null;
    return {
      us,
      kr,
      as_of: sourceDate,
      age_days: ageDays,
      stale: Number.isFinite(ageDays) ? ageDays > RIM_ERP_MAX_AGE_DAYS : null,
    };
  } catch {
    return null;
  }
}

// KRX KTS 10Y benchmark government bond yield, captured daily by the
// fenok-edge-korea lane. Derived aggregate only: no raw per-issuer row is read
// or republished here.
export function loadKoreaRiskFree() {
  try {
    const payload = JSON.parse(fs.readFileSync(KRX_DERIVED_INPUTS, "utf8"));
    const block = payload?.derived_rim_inputs?.korea_10y;
    const value = block?.value;
    // Sanity gate: a Korean 10Y outside 0.5%~15% is a broken capture, not a rate.
    if (!Number.isFinite(value) || value < 0.005 || value > 0.15) return null;
    return { value, as_of: block?.date ?? payload?.derived_rim_inputs?.as_of ?? null, label: block?.label ?? null };
  } catch {
    return null;
  }
}

function loadSectionLatest(file, key) {
  const payload = JSON.parse(fs.readFileSync(path.join(BENCHMARKS, file), "utf8"));
  const section = payload?.sections?.[key];
  const last = section?.data?.[section.data.length - 1];
  if (!last) return null;
  // Five years of weekly rows, for the mean-reversion bound on the long-run ROE.
  const window = section.data.slice(-260).map((r) => r.roe).filter(Number.isFinite);
  const sorted = [...window].sort((a, b) => a - b);
  return {
    date: last.date ?? null,
    px: Number.isFinite(last.px_last) ? last.px_last : null,
    pbr: Number.isFinite(last.px_to_book_ratio) ? last.px_to_book_ratio : null,
    roe: Number.isFinite(last.roe) ? last.roe : null,
    roeMedian5y: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}

export function checkCalibration(rows) {
  return RIM_CALIBRATION_ANCHORS.map((anchor) => {
    const row = rows.find((r) => r.key === anchor.key);
    if (!row || row.computation_status !== "ready") {
      return { key: anchor.key, evidence_id: anchor.evidence_id, evidence_label: anchor.evidence_label, status: "unavailable", source: anchor.source };
    }
    let within;
    let computed;
    let targetKind;
    let published;
    let status;
    let floorMultiple = null;
    if (Number.isFinite(anchor.published_upside_floor_pct)) {
      computed = row.diagnostic.rate_current.upside_pct;
      published = anchor.published_upside_floor_pct;
      targetKind = "lower_bound";
      status = computed >= published ? "constraint_satisfied" : "constraint_violated";
      floorMultiple = computed / published;
    } else if (anchor.published_upside_pct) {
      computed = row.diagnostic.rate_current.upside_pct;
      const [lo, hi] = anchor.published_upside_pct;
      within = computed >= lo - 5 && computed <= hi + 5;
      published = anchor.published_upside_pct;
      targetKind = lo === hi ? "point" : "range";
      status = within ? "within_tolerance" : "diverged";
    } else {
      computed = row.diagnostic.rate_current.fair_value;
      const [lo, hi] = anchor.published_fair_range;
      within = computed >= lo * 0.9 && computed <= hi * 1.1;
      published = anchor.published_fair_range;
      targetKind = "range";
      status = within ? "within_tolerance" : "diverged";
    }
    return {
      key: anchor.key,
      evidence_id: anchor.evidence_id,
      evidence_label: anchor.evidence_label,
      status,
      computed,
      published,
      target_kind: targetKind,
      floor_multiple: floorMultiple,
      published_as_of: anchor.as_of,
      source: anchor.source,
    };
  });
}

export function buildArtifact({ nowIso }) {
  const derived = loadRimDerived();
  const payoutHistory = (() => {
    try { return JSON.parse(fs.readFileSync(PAYOUT_HISTORY, "utf8")); }
    catch { return null; }
  })();
  const koreaRiskFree = loadKoreaRiskFree();
  const latestSourceDate = (() => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(BENCHMARKS, "us.json"), "utf8"));
      const d = p?.sections?.sp500?.data;
      return d?.[d.length - 1]?.date ?? null;
    } catch { return null; }
  })();
  const scouterSourceDate = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "global-scouter", "core", "stocks_analyzer.json"), "utf8"))?.source_date ?? null;
    } catch { return null; }
  })();
  const marketErp = loadMarketErp();
  const rows = INDEX_SOURCES.map((source) => {
    const latest = loadSectionLatest(source.file, source.key);
    const roePath = derived.paths[source.key]
      ?? (Number.isFinite(latest?.roe) ? [latest.roe, latest.roe, latest.roe] : null);
    const roePathSource = derived.paths[source.key]
      ? `weekly consensus grid (rim-index) — ${derived.roeBases?.[source.key] ?? "basis unrecorded"}`
      : "spot forward ROE held constant (no consensus grid for this index)";
    const riskFree = source.market === "kr"
      ? (koreaRiskFree?.value ?? RIM_KR_RISK_FREE_ANCHOR.value)
      : derived.riskFreeUs;
    const riskFreeSource = source.market === "kr"
      ? (koreaRiskFree
        ? `observed KRX KTS 10Y benchmark government bond ${koreaRiskFree.value} (as of ${koreaRiskFree.as_of}, fenok-edge-korea lane, daily)`
        : `FALLBACK dated anchor ${RIM_KR_RISK_FREE_ANCHOR.value} (sheet ${RIM_KR_RISK_FREE_ANCHOR.as_of}) — KRX 10Y capture unavailable`)
      : "observed US 10Y (FRED DGS10 via rim-index, daily)";
    const retention = resolvePayout(source.key, derived.retentions[source.key]);
    const erpCenter = source.erp;
    const damodaranRef = marketErp?.[source.market];
    const erpSource = Number.isFinite(damodaranRef)
      ? `${source.erpSource} [drift check: Damodaran ${source.market.toUpperCase()} ${round(damodaranRef, 4)}, workbook ${marketErp.as_of}`
        + (marketErp.stale ? `, STALE at ${marketErp.age_days} days` : `, ${marketErp.age_days} days old`) + "]"
      : source.erpSource;
    if (!latest || !Number.isFinite(latest.px) || !Number.isFinite(latest.pbr) || latest.pbr <= 0
      || !roePath || !Number.isFinite(riskFree) || !Number.isFinite(erpCenter) || !retention) {
      const missing = !retention ? "payout" : "price/book/ROE/risk-free/ERP";
      return { key: source.key, name: source.name, status: "excluded", reason: `missing ${missing} inputs` };
    }
    const cap = capLongRunRoe(roePath[0], latest.roeMedian5y);
    const base = {
      px: latest.px,
      bookValue: latest.px / latest.pbr,
      roePath: [cap.value],
      retention: retention.value,
      erpCenter,
    };
    const caseFor = (rf) => computeCase({ ...base, riskFree: rf });
    const discountGuard = discountExtrapolation(riskFree);
    const payoutCandidate = payoutHistory?.indices?.[source.key] ?? null;
    const sheetPayout = RIM_PAYOUT_ANCHOR[source.key]?.value ?? null;
    const forwardPayout = Number.isFinite(derived.retentions[source.key]?.value)
      ? 1 - derived.retentions[source.key].value
      : null;
    const payoutBasisComparison = {
      sheet_anchor: {
        value: sheetPayout,
        basis: "printed dated sheet field",
        production_eligible: false,
        reason: "manual anchor; no sustainable refresh rule",
      },
      forward_current: {
        value: round(forwardPayout, 6),
        basis: "current index dividend yield / forward benchmark earnings yield",
        production_eligible: false,
        reason: "forward denominator is observable but the model role has not passed held-out bounded validation",
      },
      realised_trailing: {
        range: payoutCandidate?.summary
          ? [payoutCandidate.summary.min, payoutCandidate.summary.max]
          : null,
        mean: payoutCandidate?.summary?.mean ?? null,
        basis: payoutHistory?.basis_id ?? null,
        production_eligible: false,
        reason: payoutCandidate?.eligibility?.blocking_reasons ?? ["candidate unavailable"],
      },
    };
    const publication = classifyRimPublication({
      identity_status: source.key === "philadelphia_semi" ? "unresolved" : "verified",
      inputs: [
        { name: "price", kind: "point", observable: true, current: true },
        { name: "book_value", kind: "point", observable: true, current: true },
        { name: "roe", kind: "point", observable: true, current: true },
        { name: "risk_free", kind: "point", observable: true, current: true },
        // These are observed sheet anchors, but their sustainable bases are not
        // identified independently. Marking them latent prevents a computed
        // row from being mistaken for a publishable point estimate.
        { name: "book_roe_basis", kind: "latent", observable: false, current: true },
        { name: "payout", kind: "latent", observable: false, current: true },
        { name: "risk_premium", kind: "latent", observable: false, current: true },
      ],
      holdout: null,
      fitted_relations: [
        { name: "discount_relation", inside_domain: discountGuard?.outside === false },
      ],
    });
    return {
      key: source.key,
      name: source.name,
      status: "NULL",
      computation_status: "ready",
      as_of: latest.date,
      px_last: round(latest.px, 2),
      pbr: round(latest.pbr, 4),
      book_value: round(latest.px / latest.pbr, 2),
      roe_path: [round(cap.value, 4)],
      roe_path_source: roePathSource,
      roe_observed: round(roePath[0], 4),
      roe_median_5y: round(latest.roeMedian5y, 4),
      roe_cap: { applied: cap.capped, multiple: RIM_ROE_CAP_MULTIPLE, note: cap.note },
      retention: round(retention.value, 4),
      retention_source: retention.source,
      payout_basis_comparison: payoutBasisComparison,
      payout_candidate_band: payoutCandidate
        ? {
          basis_id: payoutHistory.basis_id ?? null,
          generated_at: payoutHistory.generated_at ?? null,
          newest_statement_period: payoutCandidate.newest_statement_period ?? null,
          summary: payoutCandidate.summary ?? null,
          eligibility: payoutCandidate.eligibility ?? null,
        }
        : null,
      erp_center: round(erpCenter, 6),
      erp_source: erpSource,
      risk_free: round(riskFree, 4),
      risk_free_source: riskFreeSource,
      discount_rate: round(discountRate(riskFree), 6),
      discount_extrapolation: discountGuard,
      publication,
      diagnostic: {
        rate_current: caseFor(riskFree),
        rate_scenario_35: caseFor(RIM_RATE_SCENARIO_10Y),
      },
    };
  });
  return {
    schema_version: "fenok-rim-index/v7",
    generated_at: nowIso,
    method: "fenok_rim_forward_book_compounding_residual_income",
    display_note: "상대적 매력도 지표이며 목표가가 아님. 컨센서스 변화에 따라 언제든 크게 바뀔 수 있음.",
    // The index cell math is pinned: the engine reproduces the captured
    // 2025-12-09 sheet outputs (S&P -0.4%, Russell -0.8%), enforced as a
    // permanent regression test.
    // The cell maths now reproduces all 54 captured grid cells to 1.06%.
    weekly_exports: [
      weeklyExportAge("benchmark workbook", latestSourceDate),
      weeklyExportAge("global scouter", scouterSourceDate),
    ],
    index_math_pinned: true,
    // Still not display-ready: only conditional structural reproduction is
    // established. Book/payout/ERP/ROE bases remain unresolved and the discount
    // slope is fitted from two risk-free points.
    display_ready: false,
    display_block_reason: "formula structure reproduces the captured grids, but risk premium and payout are not separately identified, bounded holdout reproduction is incomplete, and the discount slope remains fitted",
    // The row consumes the 12% value printed on the 2026-08-03 sheet. An older
    // disclosure falsely said the row shipped an automatic Damodaran ERP even
    // though the arithmetic used 12%. The meaning of the printed cell remains
    // unresolved because premium and payout trade off in the same output.
    kospi_erp_resolution: {
      status: "unresolved_not_separately_identified_from_payout",
      current_erp: 0.12,
      current_erp_source: "sheet 2026-08-03 dated anchor; not independently identified from payout",
      sheet_cell_erp: 0.12,
      evidence: [
        "the 2026-08-03 sheet prints 12% and the current row consumes 12%",
        "Damodaran Korea ERP is a comparison series and is not the row input",
        "premium inversion is conditional on a payout basis declared before scoring",
      ],
      note: "Do not interpret the 12% anchor as a sustainable ERP rule or publish its implied point value until payout is fixed ex ante and bounded holdouts pass.",
    },
    rows,
    calibration_check: {
      description: "Computed Likely upside vs the source analyst's dated published outputs. diverged = refresh anchors from new material; never silently refit.",
      results: checkCalibration(rows),
    },
    // Every number the model consumes, what justifies it, and what refreshes it.
    // Kept exhaustive on purpose: an omitted constant is an unexamined one.
    constants_provenance: {
      // --- fed from data, no judgement ---
      price: { why: "the benchmark feed's index close, which matches the 현재지수 printed on his master tables to the decimal — same vendor, same close", refresh: "weekly conversion, automatic", kind: "observed" },
      book_value: { why: "price divided by the benchmark feed's PBR. His master tables print a PBR too, and it is NOT this: feeding his displayed PBR misses his own published fair values by +14~41% while the feed's book reproduces them", refresh: "weekly conversion, automatic", kind: "observed" },
      roe_cap: { why: "2.3x the index's own 5-year median was fitted on two KOSPI observations, one since withdrawn as FUNDAMENTAL rather than RIM; against the sole admissible KOSPI row it misses by -24.5%. It remains only in computation-ready rows for continuity and is not a sustainable publication rule", refresh: "replace only after a pre-declared candidate passes bounded held-out rows and every floor constraint in scripts/check-fenok-rim-calibration.mjs", kind: "fitted", open: "no admissible candidate remains after floors are removed from MAE and SOXX observations are excluded from the Philadelphia index" },
      roe: { why: "the benchmark feed's index-level aggregate — recomputing best_eps/(price/PBR) reproduces it to 0.46bp, so it is earnings over book, not a cap-weighted mean of constituents (that returns 47.6% for the S&P against his 26.0%)", refresh: "weekly conversion, automatic", kind: "observed", open: "his long-run ROE is NOT this number and no mechanical transform of it reproduces his series — see calibration_check and docs/references/fenok-rim-formula-identification.md" },
      risk_free_us: { why: "observed FRED DGS10 via rim-index inputs", refresh: "daily lane, automatic", kind: "observed" },
      risk_free_kr: { why: "KRX KTS 10Y benchmark government bond captured by the fenok-edge-korea lane; the domestic rate is what his Korean sheets discount with", refresh: "daily lane, automatic; falls back to a dated 4.4% sheet value and says so in risk_free_source", kind: "observed" },

      // --- fitted to his own outputs, reproducible, no story behind the value ---
      explicit_years: { why: "9 explicit years is the current fitted hypothesis and reproduces the 54 machine-linked cells under anchored book/payout inputs; the present suite does not independently identify N against alternatives", refresh: "only against new captured grids with frozen alternative-N tests", kind: "fitted" },
      discount_rate: { why: "0.076 + 0.560 x risk-free. The risk premium does NOT enter discounting inside the candidate: on the captured grids a 1%p risk-free move shifts value 11.2% against 4.77% for a 1%p premium move. Conditional 54-cell reproduction is RMS 0.41% under anchored book/payout inputs", refresh: "only against new captured grids", kind: "fitted", open: "the coefficient has no identified mechanism and is calibrated only over risk-free 3.5~4.2%; conditional reproduction does not identify the full level model" },

      // --- read directly off his sheets ---
      grid_step: { why: "0.5%p row and column spacing printed on every captured sheet", refresh: "manual with new sheets", kind: "read" },
      rate_scenario: { why: "the 3.5% 10Y alternate column printed on every captured index sheet", refresh: "manual with new sheets", kind: "read" },
      fair_value_definition: { why: "the centre cell, not the mean of nine. His sheets print both — 상승여력 적정가 and 평균 — and his master tables' 적정지수 matches the centre: his week1 S&P grid centres on 7,193 against the table's 7,195", refresh: "manual with new sheets", kind: "read" },

      // --- dated anchors whose joint basis is still being identified ---
      erp_centers: { why: "read off dated sheets per index. Damodaran and beta substitutions failed as direct replacements, but the premium is not separately identified from payout; it remains an anchor rather than a sustainable derived rule", refresh: "manual with new sheets until an ex-ante payout estimator and bounded holdouts identify a replacement", kind: "anchor", open: "premium and payout trade off; never select either by minimising the same outputs later used to score it" },
      retention: { why: "1 minus the payout printed on dated sheets. The engine now exposes filings-based trailing and current-forward candidates beside that anchor, but does not promote either candidate into the valuation because their denominator, horizon, and historical-membership bases are not production-eligible", refresh: "daily candidate history plus manual sheet anchor; production replacement requires a pre-declared basis and held-out bounded validation", kind: "anchor", open: "the payout-history candidates are comparison evidence only; the valuation still consumes the dated sheet anchor" },

      // --- what we measure ourselves against ---
      discount_extrapolation_guard: { why: "the discount relation is calibrated over risk-free 3.5~4.2% and fails in the 2021 low-rate grid across the tested payout band: at Korean 10Y near 1.7%, the grid implies discount 5.04~6.61% for payout 60~5%, while the linear relation returns 8.55%. The previously quoted 5.6% point hid a 39.35% payout assumption", refresh: "widens only when a captured grid at a new rate extends the calibration", kind: "fitted" },
      calibration_anchors: { why: "dated outputs admitted only when the evidence ledger labels the exact sentence RIM and its raw value is not ambiguous; bottom-up, fundamental, and model-unnamed values are quarantined", refresh: "he publishes weekly; scripts/check-fenok-rim-calibration.mjs scores candidate inputs against the whole admissible series", kind: "target" },
    },
    disclaimer: "Model-implied fair values under stated assumptions. Not price targets, not investment advice.",
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const artifact = buildArtifact({ nowIso: new Date().toISOString() });
  for (const dir of [OUT_DIR, MIRROR_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fair-values.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  for (const row of artifact.rows) {
    if (row.computation_status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
    const C = row.diagnostic.rate_current;
    console.log(`${row.name}: computed fair ${C.fair_value} (${C.upside_pct}%) | publication=${row.publication.status} | Ke=${row.risk_free}+${row.erp_center}`);
  }
  for (const check of artifact.calibration_check.results) {
    console.log(`diagnostic ${check.key}: ${check.status} ${check.target_kind ?? "unknown"} (${check.computed} vs ${JSON.stringify(check.published)})`);
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
