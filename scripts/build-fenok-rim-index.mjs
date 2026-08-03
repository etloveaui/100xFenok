// Fenok RIM — self-sustaining index fair-value engine (v8).
//
// The model was identified, not assumed. Two rates do different jobs:
//   Ke   = Rf + RiskPremium        -> the residual only
//   disc = 0.076 + 0.560 * Rf      -> all discounting, no risk premium in it
//   RI_t = B_{t-1} * (ROE_t - Ke)
//   V    = B0 + sum_{t=1..9} RI_t/(1+disc)^t + (RI_9/disc)/(1+disc)^9
//   B_t  = B_{t-1} * (1 + ROE_t * retention)
// Verified against all 54 captured 2025-12-09 grid cells (three indices, each
// printed at the observed 10Y and at a 3.5% scenario): RMS 0.41%, max 1.06%,
// with book values from our own feed. Cross-checked on a separate slide — the
// 선진국/신흥국 master tables reproduce to -1.6%~-6.6%.
// Inputs run on our data alone: observed US 10Y (FRED), KRX KTS 10Y for Korea,
// FY1 consensus ROE de-blended from the vendor 12-month field, observed payout.
// Account of the identification: docs/references/fenok-rim-formula-identification.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");
const KRX_DERIVED_INPUTS = path.join(ROOT, "data", "admin", "fenok-edge-korea-krx-daily-index.json");
const DAMODARAN_ERP = path.join(ROOT, "data", "damodaran", "erp.json");
const OUT_DIR = path.join(ROOT, "data", "computed", "fenok-rim");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "fenok-rim");

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
// Korean indices discount with the DOMESTIC rate (patent-era calc sheets and
// the 2026-08-03 KOSPI sheet both use it; the "US 10Y everywhere" claim from
// the earlier AI-written spec was disproven by the sheets). The observed rate
// comes from the KRX KTS 10Y benchmark government bond captured daily by the
// fenok-edge-korea lane; this dated anchor is only the fallback when that
// capture is missing.
export const RIM_KR_RISK_FREE_ANCHOR = { value: 0.044, as_of: "2026-08-03" };

// The risk premium is the analyst's own judgement input and it does NOT come
// from a derivable market quantity. That was tested, not assumed. Substituting
// the Damodaran country ERP was tried and is refuted by measurement: Korea's
// 5.49% returns a KOSPI fair value of 15,634 against the 10,000~12,000 he
// published, while the 12% printed on his own sheet returns 10,074 — inside the
// range, and the value that reproduces his midpoint is 10.92%. Beta scaling is
// refuted too, since Russell carries the higher beta yet the lower premium.
// So these stay dated anchors read off his sheets, each carrying its capture
// date. Damodaran remains useful as a drift check, not as the input.
const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", market: "us", erp: 0.05, erpSource: "sheet 2026-08-03; Damodaran US 5.03% agrees to 3bp" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "russell2000", name: "러셀 2000", market: "us", erp: 0.045, erpSource: "sheet 2025-12-09" },
  { file: "emerging.json", key: "kospi", name: "코스피", market: "kr", erp: 0.12, erpSource: "sheet 2026-08-03; reproduces his published 10,000~12,000 under the solved formula (10,074), whereas Damodaran 5.49% gives 15,634" },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", market: "us", erp: 0.055, erpSource: "estimated: NASDAQ-family centre, no dedicated sheet" },
];

// Calibration anchors: the source analyst's published outputs, dated. A
// diverged flag means our estimate has drifted from what he publishes —
// refresh anchors from new material, never silently refit.
export const RIM_CALIBRATION_ANCHORS = Object.freeze([
  { key: "sp500", published_upside_pct: [8, 12], as_of: "2026-06-11", source: "internal source catalog" },
  { key: "nasdaq100", published_upside_pct: [25, 30], as_of: "2026-06-10", source: "internal source catalog" },
  { key: "kospi", published_fair_range: [10000, 12000], as_of: "2026-05-19", source: "internal source catalog" },
]);

// Dividend payout, per index. Auditing our live inputs against his 2026-08-03
// sheets showed price, book, ROE, risk-free and risk premium all agreeing within
// 2% while payout was off by -62%~+61% — it is the one input that was actually
// wrong, and the model is sensitive to it because retention drives the book path.
// Our derived payout is not trusted as primary: it reads 20.72% for the S&P
// against the 31.09% printed on his sheet, and 9.71% for NASDAQ 100 against
// 25.65%. So the sheet figure leads, our derived figure follows as a drift
// check, and there is no silent house fallback — an index with neither is
// excluded loudly rather than shipped on a guess.
const RIM_PAYOUT_ANCHOR = {
  sp500: { value: 0.3109, as_of: "2026-08-03" },
  nasdaq100: { value: 0.2565, as_of: "2026-08-03" },
  nasdaq_composite: { value: 0.2180, as_of: "2026-08-03" },
  kospi: { value: 0.3789, as_of: "2026-08-03" },
  russell2000: { value: 0.045, as_of: "2025-12-09 grid, implied by the captured cells" },
};
// A payout outside this band is a broken derivation, not a real distribution
// policy. Widest real value we carry is Russell's 4.5%; the S&P's is 31%.
const RIM_PAYOUT_BOUNDS = [0.01, 0.75];

function resolvePayout(key, derivedRetention) {
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

// One grid cell. The residual carries the risk premium; the discounting does
// not. Years beyond the 3-year consensus path hold the final path year.
export function computeCell({ bookValue, roePath, retention, riskFree, erp, tailShift = 0, years = RIM_EXPLICIT_YEARS }) {
  const ke = riskFree + erp;          // cost of equity: reaches the residual only
  const disc = discountRate(riskFree); // discount rate: a separate rate, no risk premium in it
  let book = bookValue;
  let v = bookValue;
  let residual = 0;
  for (let t = 1; t <= years; t += 1) {
    const base = roePath[Math.min(t - 1, roePath.length - 1)];
    const roe = t > roePath.length ? base + tailShift : base;
    residual = (roe - ke) * book;
    v += residual / (1 + disc) ** t;
    book *= 1 + roe * retention;
  }
  v += residual / (disc * (1 + disc) ** years);
  return v;
}

// One case: 3x3 grid — tail-ROE rows (final-path-year ROE shifted -0.5/0/+0.5%p
// for the years beyond the consensus path) x ERP columns (center +-0.5%p).
// Fair value = mean of the nine cells, matching the sheets' 상승여력 블록.
export function computeCase({ px, bookValue, roePath, retention, riskFree, erpCenter }) {
  const cells = [];
  for (const tailShift of [-RIM_GRID_STEP, 0, RIM_GRID_STEP]) {
    for (const erp of [erpCenter - RIM_GRID_STEP, erpCenter, erpCenter + RIM_GRID_STEP]) {
      cells.push(computeCell({ bookValue, roePath, retention, riskFree, erp, tailShift }));
    }
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
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

// The vendor earnings field is a twelve-month BLEND of FY1 and FY2, so the ROE
// built on it overstates the FY1 consensus ROE the source sheets use. With f the
// fraction of the fiscal year already elapsed and g12 the FY1->FY2 growth,
// BEST = FY1 * (1 + f * g12), so dividing by that factor recovers FY1.
// Measured 2026-08-03: this lands the S&P at 26.34% against the 26.33% backed out
// of his published upside, and puts all three indices within 1.5~4.9% of the FY1
// ROE printed on his own sheets, versus 13~24% too high before.
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
    const retentions = {};
    const elapsed = fiscalYearElapsed(payload?.generated_at);
    for (const [ourKey, rimKey] of Object.entries(RIM_INDEX_KEY)) {
      const derived = payload?.indices?.[rimKey]?.derived;
      const periods = derived?.forecast_grid_v1?.periods ?? [];
      const blended = periods
        .map((p) => p?.roe_on_beginning_book?.value)
        .filter((v) => Number.isFinite(v));
      // The whole path is built off the same blended base, so the FY1 correction
      // carries through it.
      const growthFy2 = periods[1]?.eps_growth?.value;
      const fy1 = deblendRoe({ blendedRoe: blended[0], growthFy2, elapsed });
      const scale = Number.isFinite(fy1) && blended[0] > 0 ? fy1 / blended[0] : null;
      const roePath = scale ? blended.map((v) => v * scale) : blended;
      roeBases[ourKey] = scale
        ? `FY1 consensus ROE, de-blended from the vendor 12-month field (factor ${round(scale, 4)}, ${round(elapsed, 3)} of fiscal year elapsed)`
        : "vendor 12-month blended ROE — de-blend unavailable, reads high versus the source sheets";
      if (roePath.length >= 3) paths[ourKey] = roePath.slice(0, 3);
      const payout = derived?.payout_ratio?.value;
      if (Number.isFinite(payout) && payout > 0 && payout < 1) {
        retentions[ourKey] = { value: 1 - payout, source: `observed derived payout_ratio ${round(payout, 4)}` };
      }
    }
    return { riskFreeUs: Number.isFinite(riskFreeUs) ? riskFreeUs : null, paths, retentions, roeBases };
  } catch {
    return { riskFreeUs: null, paths: {}, retentions: {}, roeBases: {} };
  }
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
    return { us, kr, as_of: payload?.metadata?.source_date ?? null };
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
  return {
    date: last.date ?? null,
    px: Number.isFinite(last.px_last) ? last.px_last : null,
    pbr: Number.isFinite(last.px_to_book_ratio) ? last.px_to_book_ratio : null,
    roe: Number.isFinite(last.roe) ? last.roe : null,
  };
}

export function checkCalibration(rows) {
  return RIM_CALIBRATION_ANCHORS.map((anchor) => {
    const row = rows.find((r) => r.key === anchor.key);
    if (!row || row.status !== "ready") {
      return { key: anchor.key, status: "unavailable", source: anchor.source };
    }
    let within;
    let computed;
    if (anchor.published_upside_pct) {
      computed = row.rate_current.upside_pct;
      const [lo, hi] = anchor.published_upside_pct;
      within = computed >= lo - 5 && computed <= hi + 5;
    } else {
      computed = row.rate_current.fair_value;
      const [lo, hi] = anchor.published_fair_range;
      within = computed >= lo * 0.9 && computed <= hi * 1.1;
    }
    return {
      key: anchor.key,
      status: within ? "within_tolerance" : "diverged",
      computed,
      published: anchor.published_upside_pct ?? anchor.published_fair_range,
      published_as_of: anchor.as_of,
      source: anchor.source,
    };
  });
}

export function buildArtifact({ nowIso }) {
  const derived = loadRimDerived();
  const koreaRiskFree = loadKoreaRiskFree();
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
      ? `${source.erpSource} [drift check: Damodaran ${source.market.toUpperCase()} ${round(damodaranRef, 4)}, workbook ${marketErp.as_of}]`
      : source.erpSource;
    if (!latest || !Number.isFinite(latest.px) || !Number.isFinite(latest.pbr) || latest.pbr <= 0
      || !roePath || !Number.isFinite(riskFree) || !Number.isFinite(erpCenter) || !retention) {
      const missing = !retention ? "payout" : "price/book/ROE/risk-free/ERP";
      return { key: source.key, name: source.name, status: "excluded", reason: `missing ${missing} inputs` };
    }
    const base = {
      px: latest.px,
      bookValue: latest.px / latest.pbr,
      roePath,
      retention: retention.value,
      erpCenter,
    };
    const caseFor = (rf) => computeCase({ ...base, riskFree: rf });
    return {
      key: source.key,
      name: source.name,
      status: "ready",
      as_of: latest.date,
      px_last: round(latest.px, 2),
      pbr: round(latest.pbr, 4),
      book_value: round(latest.px / latest.pbr, 2),
      roe_path: roePath.map((v) => round(v, 4)),
      roe_path_source: roePathSource,
      retention: round(retention.value, 4),
      retention_source: retention.source,
      erp_center: round(erpCenter, 6),
      erp_source: erpSource,
      risk_free: round(riskFree, 4),
      risk_free_source: riskFreeSource,
      rate_current: caseFor(riskFree),
      rate_scenario_35: caseFor(RIM_RATE_SCENARIO_10Y),
    };
  });
  return {
    schema_version: "fenok-rim-index/v6",
    generated_at: nowIso,
    method: "fenok_rim_forward_book_compounding_residual_income",
    display_note: "상대적 매력도 지표이며 목표가가 아님. 컨센서스 변화에 따라 언제든 크게 바뀔 수 있음.",
    // The index cell math is pinned: the engine reproduces the captured
    // 2025-12-09 sheet outputs (S&P -0.4%, Russell -0.8%), enforced as a
    // permanent regression test.
    // The cell maths now reproduces all 54 captured grid cells to 1.06%.
    index_math_pinned: true,
    // Still not display-ready: the formula is settled but the risk premiums are
    // dated sheet anchors and the Korea discount slope is extrapolated from two
    // risk-free points. Surfaces wait until those carry their own evidence.
    display_ready: false,
    display_block_reason: "formula verified on 54 cells; risk premiums remain dated sheet anchors and the discount slope is fitted on two risk-free points only",
    // RESOLVED 2026-08-03. The 2026-08-03 KOSPI sheet's red "Premiumn Adj.
    // 12.00%" cell is NOT his equity risk premium: fed through this formula
    // with his own sheet inputs it returns 6,301 against a spot of 6,690, i.e.
    // it is the premium that makes fair value equal the current index. Four
    // independent lines put the real premium near 7.0% instead, and the engine
    // now ships that. Output is never calibrated toward his published numbers;
    // only inputs are made faithful.
    kospi_erp_resolution: {
      shipped_erp_source: "Damodaran country ERP (KR), automatic",
      sheet_cell_erp: 0.12,
      evidence: [
        "his own 2016-09-20 column states a KOSPI equity risk premium band of 5.5~7%, whose floor matches the Damodaran Korea ERP of 5.49% to 1bp",
        "patent KR20180048140A KOSPI grid is 6.5/7.0/7.5%, so 12% sits outside every band he has published",
        "his published KOSPI fair range 10,000~12,000 (2026-05-19) is reproduced near 7% with his own sheet inputs; 12% instead returns roughly spot",
        "fed through this formula with his own sheet inputs, 12% yields 6,301 against a spot of 6,690 — it is the premium that makes fair value equal the index",
      ],
      note: "The 12% cell is a reverse-solved hurdle rate, not a valuation assumption. Do not restore it as an ERP without new source material that states otherwise.",
    },
    rows,
    calibration_check: {
      description: "Computed Likely upside vs the source analyst's dated published outputs. diverged = refresh anchors from new material; never silently refit.",
      results: checkCalibration(rows),
    },
    constants_provenance: {
      risk_free_us: { why: "observed FRED DGS10 via rim-index inputs", refresh: "daily lane, automatic" },
      risk_free_kr: { why: "domestic rate per the patent-era calc sheets and the current KOSPI sheet; taken from the KRX KTS 10Y benchmark government bond captured by the fenok-edge-korea lane, with the dated 4.4% sheet value as fallback only", refresh: "daily lane, automatic; falls back to the dated anchor and says so in risk_free_source when the capture is missing" },
      roe_paths: { why: "weighted stock-consensus FY1-3 grids; spot ROE held constant only where no grid exists (flagged per row)", refresh: "weekly conversion, automatic" },
      retention: { why: "1 - the payout printed on his source sheets, which our derived payout misses by -62%~+61%; the derived figure rides along as a drift check and there is no silent house fallback — an index with neither is excluded", refresh: "manual with new sheets; the drift check is weekly and automatic" },
      erp_centers: { why: "Damodaran country ERP for each index's own market, applied over that market's risk-free rate — the construction the source sheets themselves use (Damodaran US 5.03% vs his S&P 5.00%, Damodaran Korea 5.49% vs his stated band floor 5.5%). His per-index tilts are judgement values with no derivation and are deliberately not frozen as constants", refresh: "weekly Damodaran lane, automatic; the workbook month travels with the value in erp_source" },
      grid_step: { why: "0.5%p row/column spacing read directly off every captured sheet", refresh: "manual with new sheets" },
      formula: { why: "owner-supplied multi-stage RIM (N=5, terminal RI_5/Ke on B_4), verified against the 2025-12-09 sheet outputs and pinned by regression test", refresh: "only with a new verified source spec" },
      rate_scenario: { why: "3.5% 10Y alternate column shown on every captured index sheet", refresh: "manual with new sheets" },
      calibration_anchors: { why: "dated published outputs from the internal source catalog", refresh: "update on new material; divergence flags, never silent refits" },
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
    if (row.status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
    const C = row.rate_current;
    console.log(`${row.name}: px ${row.px_last} | fair ${C.fair_value} (${C.upside_pct}%) | Ke=${row.risk_free}+${row.erp_center}`);
  }
  for (const check of artifact.calibration_check.results) {
    console.log(`calibration ${check.key}: ${check.status} (${check.computed} vs ${JSON.stringify(check.published)})`);
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
