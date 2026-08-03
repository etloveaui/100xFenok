// Yoo Dong-won style RIM fair-value table for major indices — v2.
//
// v1 (single-stage persistence on CURRENT book) was wrong in shape: Yoo's
// published numbers (S&P 500 ~+10%, Nasdaq 100 +25~30% through YE26 — persona
// corpus, 2026-06 anchors) come from a FORWARD model where book value
// compounds with retained earnings over an explicit window before a terminal
// stage. v2 implements that shape:
//
//   B0 = px_last / px_to_book_ratio
//   for t = 1..3:  RI_t = (ROE - r) * B_{t-1};  B_t = B_{t-1} * (1 + ROE * retention)
//   terminal: RI_3' = (min(ROE, roe_cap) - r) * B_2 ; TV = RI_3' * (1+g) / (r-g), discounted 3y
//   V = B0 + PV(RI_1..3) + PV(TV)
//
// ROE is the Bloomberg forward ROE flowing weekly through the benchmarks
// converter. r, retention, terminal growth g, and the terminal ROE cap are
// HOUSE assumptions and are published as such; r dominates the answer, so a
// sensitivity axis is emitted instead of one authoritative-looking number.
// r = 0.08 reproduces Yoo's published upside ballpark (S&P +6.7%, NDX +13.8%
// on 2026-07-31 inputs); the house ERP-derived 0.0971 and 0.07 bracket it.
// The terminal ROE cap (0.22) prevents a cyclical-peak forward ROE (KOSPI
// 34.2%) from being compounded forever — Yoo's own KOSPI assumption is
// "3-year average ROE slightly above 20%" with a 10,000-12,000 target band.
//
// This builder does not touch build-rim-index.mjs; that artifact keeps its
// multi-period assumption band.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");
const OUT_DIR = path.join(ROOT, "data", "computed", "rim-yoo");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "rim-yoo");

// Yoo's own published ERP band (Kiwoom column, 2016-09-20, owner-supplied):
// "Equity Risk Premium을 5.5%~7%에 두고" — the band, applied over the OBSERVED
// risk-free rate, is what turns his model into a fair RANGE (his 2016 KOSPI
// 1,800-2,100 box). Likely = low ERP, Worst = high ERP, matching the
// Worst/Likely two-point output of his current stock RIM sheets.
export const YOO_ERP_BAND = Object.freeze({ likely: 0.055, worst: 0.07 });

export const YOO_DISCOUNT_SENSITIVITY = [0.08, 0.0971, 0.07];
export const YOO_EXPLICIT_YEARS = 3;
export const YOO_TERMINAL_GROWTH = 0.025;

// Estimated per-market discount rates — part of the methodology estimate, not
// a fit knob: US megacap COE ~8% reproduces his published US upsides, and the
// house ERP-derived 9.71% (country premium included) lands KOSPI inside his
// stated 10,000-12,000 band. Revisit when his published numbers move.
export const YOO_MARKET_RATES = Object.freeze({ us: 0.08, kr: 0.0971 });

// Calibration anchors: Yoo's PUBLISHED model outputs, dated and sourced from
// the persona corpus. Every run compares its own headline upside against
// these and reports the divergence — the system tells us when our estimate
// of his methodology drifts from what he actually publishes. Update this
// table whenever the speaker ledger records fresh numbers.
export const YOO_CALIBRATION_ANCHORS = Object.freeze([
  { key: "sp500", published_upside_pct: [8, 12], as_of: "2026-06-11", source: "persona work.md: RIM upside S&P ~10%" },
  { key: "nasdaq100", published_upside_pct: [25, 30], as_of: "2026-06-10", source: "persona work.md: NDX RIM +30% through YE26" },
  { key: "kospi", published_fair_range: [10000, 12000], as_of: "2026-05-19", source: "speaker ledger 2kV9e8nI3Hw: KOSPI 10,000-12,000" },
]);
// No global terminal ROE cap: Yoo's US mega-cap numbers require sustained
// high ROE, and capping crushed them. Where the persona corpus records his
// OWN ROE assumption for an index, that value overrides the Bloomberg spot
// forward ROE instead (see roeOverride below).
export const YOO_TERMINAL_ROE_CAP = null;

const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", retention: 0.65, market: "us" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", retention: 0.65, market: "us" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", retention: 0.65, market: "us" },
  { file: "us.json", key: "russell2000", name: "러셀 2000", retention: 0.65, market: "us" },
  {
    file: "emerging.json", key: "kospi", name: "코스피", retention: 0.75, market: "kr",
    // Yoo's stated assumption: KOSPI 3-year average ROE "slightly above 20%"
    // (persona corpus 2026-06). The Bloomberg spot forward ROE (34.2% on
    // 2026-07-31) is a cyclical peak; compounding it forever produced +300%
    // class upsides far outside his own 10,000-12,000 target band.
    roeOverride: { value: 0.21, source: "yoo_stated_3y_average_roe" },
  },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", retention: 0.65, market: "us" },
];

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function computeYooRimRow({
  key, name, px, pbr, roe, date, discountRate, retention,
  roeOverride = null,
  roePath = null,
  years = YOO_EXPLICIT_YEARS,
  terminalGrowth = YOO_TERMINAL_GROWTH,
  terminalRoeCap = YOO_TERMINAL_ROE_CAP,
}) {
  const observedRoe = roe;
  const usedRoe = Number.isFinite(roeOverride?.value) ? roeOverride.value : roe;
  // Input priority: a speaker-STATED assumption outranks the derived
  // consensus path, which outranks the spot observation.
  const effectivePath = Number.isFinite(roeOverride?.value) ? null : roePath;
  const missing = [];
  if (!Number.isFinite(px) || px <= 0) missing.push("px_last");
  if (!Number.isFinite(pbr) || pbr <= 0) missing.push("px_to_book_ratio");
  if (!Number.isFinite(usedRoe)) missing.push("roe");
  if (!Number.isFinite(retention) || retention <= 0 || retention >= 1) missing.push("retention");
  if (missing.length > 0) {
    return { key, name, status: "excluded", reason: `missing or invalid inputs: ${missing.join(", ")}` };
  }
  if (discountRate <= terminalGrowth) {
    return { key, name, status: "excluded", reason: "discount rate must exceed terminal growth" };
  }
  const bookValue = px / pbr;
  let book = bookValue;
  let lastBeginningBook = bookValue;
  let pvExplicit = 0;
  let lastYearRoe = usedRoe;
  for (let t = 1; t <= years; t += 1) {
    // Per-year consensus ROE path when available (Yoo's current sheets fade
    // ROE year by year, e.g. Samsung 64->58->42); constant otherwise.
    const yearRoe = Number.isFinite(effectivePath?.[t - 1]) ? effectivePath[t - 1] : usedRoe;
    lastYearRoe = yearRoe;
    const residual = (yearRoe - discountRate) * book;
    pvExplicit += residual / (1 + discountRate) ** t;
    lastBeginningBook = book;
    book *= 1 + yearRoe * retention;
  }
  const baseTerminalRoe = Number.isFinite(effectivePath?.[years - 1]) ? lastYearRoe : usedRoe;
  const terminalRoe = Number.isFinite(terminalRoeCap) ? Math.min(baseTerminalRoe, terminalRoeCap) : baseTerminalRoe;
  const terminalResidual = (terminalRoe - discountRate) * lastBeginningBook;
  const terminalValue = (terminalResidual * (1 + terminalGrowth)) / (discountRate - terminalGrowth)
    / (1 + discountRate) ** years;
  const fairValue = bookValue + pvExplicit + terminalValue;
  return {
    key,
    name,
    status: "ready",
    as_of: date,
    px_last: round(px, 2),
    book_value: round(bookValue, 2),
    forward_roe_observed: round(observedRoe, 4),
    roe_used: round(usedRoe, 4),
    roe_path: Array.isArray(effectivePath) ? effectivePath.map((v) => round(v, 4)) : null,
    roe_override_source: roeOverride?.source ?? null,
    terminal_roe: round(terminalRoe, 4),
    retention,
    discount_rate: discountRate,
    fair_value: round(fairValue, 2),
    upside_pct: round((fairValue / px - 1) * 100, 2),
    components: {
      book: round(bookValue, 2),
      pv_explicit_residual_income: round(pvExplicit, 2),
      pv_terminal: round(terminalValue, 2),
    },
  };
}

function loadSectionLatest(file, key) {
  const payload = JSON.parse(fs.readFileSync(path.join(BENCHMARKS, file), "utf8"));
  const section = payload?.sections?.[key];
  const last = section?.data?.[section.data.length - 1];
  if (!last) return null;
  return {
    date: last.date ?? null,
    px: numberOrNull(last.px_last),
    pbr: numberOrNull(last.px_to_book_ratio),
    roe: numberOrNull(last.roe),
  };
}

// Consensus per-year ROE paths and the observed risk-free rate come from the
// existing rim-index derivation (weighted stock-consensus grids).
const RIM_INDEX_KEY = { sp500: "SPX", nasdaq100: "NDX", kospi: "KOSPI", philadelphia_semi: "SOX", nasdaq_composite: "CCMP" };

export function loadRimDerived() {
  try {
    const payload = JSON.parse(fs.readFileSync(RIM_INPUTS, "utf8"));
    const riskFree = payload?.indices?.SPX?.observed?.risk_free_rate?.value
      ?? Object.values(payload?.indices ?? {})[0]?.observed?.risk_free_rate?.value
      ?? null;
    const paths = {};
    for (const [ourKey, rimKey] of Object.entries(RIM_INDEX_KEY)) {
      const periods = payload?.indices?.[rimKey]?.derived?.forecast_grid_v1?.periods ?? [];
      const roePath = periods
        .map((p) => p?.roe_on_beginning_book?.value)
        .filter((v) => Number.isFinite(v));
      if (roePath.length >= 3) paths[ourKey] = roePath.slice(0, 3);
    }
    return { riskFree: Number.isFinite(riskFree) ? riskFree : null, paths };
  } catch {
    return { riskFree: null, paths: {} };
  }
}

function rowFor(source, discountRate, derived = null) {
  const latest = loadSectionLatest(source.file, source.key);
  if (!latest) return { key: source.key, name: source.name, status: "excluded", reason: "section absent from benchmarks" };
  return computeYooRimRow({
    key: source.key,
    name: source.name,
    retention: source.retention,
    roeOverride: source.roeOverride ?? null,
    roePath: derived?.paths?.[source.key] ?? null,
    ...latest,
    discountRate,
  });
}

export function checkCalibration(headlineRows) {
  return YOO_CALIBRATION_ANCHORS.map((anchor) => {
    const row = headlineRows.find((r) => r.key === anchor.key);
    if (!row || row.status !== "ready") {
      return { key: anchor.key, status: "unavailable", source: anchor.source };
    }
    let within;
    let computed;
    if (anchor.published_upside_pct) {
      computed = row.upside_pct;
      const [lo, hi] = anchor.published_upside_pct;
      within = computed >= lo - 5 && computed <= hi + 5;
    } else {
      computed = row.fair_value;
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
  // Headline table: the methodology estimate — per-market discount rates.
  const headlineRows = INDEX_SOURCES.map((source) => rowFor(source, YOO_MARKET_RATES[source.market], derived));
  const sensitivityTables = YOO_DISCOUNT_SENSITIVITY.map((discountRate) => ({
    discount_rate: discountRate,
    rows: INDEX_SOURCES.map((source) => rowFor(source, discountRate, derived)),
  }));
  // Yoo-article-faithful preset: r derived from the OBSERVED risk-free rate
  // plus his published ERP band; per-year consensus ROE paths where the
  // rim-index grid carries them. Worst/Likely mirrors his sheet output.
  const articlePresets = derived.riskFree === null ? null : Object.fromEntries(
    Object.entries(YOO_ERP_BAND).map(([label, erp]) => [label, {
      discount_rate: round(derived.riskFree + erp, 4),
      erp,
      risk_free_observed: derived.riskFree,
      rows: INDEX_SOURCES.map((source) => rowFor(source, derived.riskFree + erp, derived)),
    }]),
  );
  const calibration = checkCalibration(headlineRows);
  return {
    schema_version: "rim-yoo-index/v3",
    generated_at: nowIso,
    method: "yoo_dongwon_forward_book_compounding_residual_income",
    headline: {
      description: "Methodology estimate: per-market discount rates (us 0.08, kr 0.0971), Yoo-stated ROE overrides where the corpus records them.",
      market_rates: YOO_MARKET_RATES,
      rows: headlineRows,
    },
    calibration_check: {
      description: "Computed headline output vs Yoo's PUBLISHED numbers (dated, sourced). 'diverged' means our estimate of his methodology has drifted from what he publishes — recalibrate anchors from the latest speaker ledger, do not silently refit.",
      results: calibration,
    },
    yoo_article_presets: articlePresets && {
      description: "Faithful to Yoo's own published parameters (Kiwoom column 2016-09-20): r = observed risk-free + his 5.5%~7% ERP band; per-year consensus ROE paths from the rim-index grid where available. Likely = low ERP, Worst = high ERP, matching his sheet's Worst/Likely output.",
      ...articlePresets,
    },
    formula: "V = B0 + PV(RI_1..3, book compounds at ROE*retention) + PV(terminal RI at min(ROE, cap), growth g)",
    assumptions: {
      roe_source: "Bloomberg forward ROE via the weekly benchmarks converter (observed input)",
      explicit_years: YOO_EXPLICIT_YEARS,
      terminal_growth: YOO_TERMINAL_GROWTH,
      terminal_roe_cap: YOO_TERMINAL_ROE_CAP,
      discount_rates: YOO_DISCOUNT_SENSITIVITY,
      discount_rate_note: "0.08 is the headline rate, calibrated so the model reproduces Yoo Dong-won's published upside ballpark (S&P ~+10%, NDX +25~30% through YE26, persona corpus 2026-06); 0.0971 is the house ERP-derived cost of equity; 0.07 is the lower bracket. r is a house assumption and dominates the result.",
      retention_note: "Retention (1 - payout) is a house assumption per index: 0.65 US families, 0.75 KOSPI.",
      terminal_roe_note: "No global terminal ROE cap. Where the persona corpus records Yoo's own ROE assumption for an index (KOSPI: 3-year average slightly above 20% -> 0.21), it overrides the Bloomberg spot forward ROE, with both values published.",
      disclaimer: "Model-implied fair values under stated assumptions. Not price targets, not investment advice.",
    },
    sensitivity_tables: sensitivityTables,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const artifact = buildArtifact({ nowIso: new Date().toISOString() });
  for (const dir of [OUT_DIR, MIRROR_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fair-values.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  console.log("--- headline (per-market rates) ---");
  for (const row of artifact.headline.rows) {
    if (row.status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
    console.log(`${row.name}: px ${row.px_last} | r ${row.discount_rate} | fair ${row.fair_value} | upside ${row.upside_pct}%`);
  }
  console.log("--- calibration vs Yoo published ---");
  for (const check of artifact.calibration_check.results) {
    console.log(`${check.key}: ${check.status} | computed ${check.computed} vs published ${JSON.stringify(check.published)} (${check.published_as_of ?? "?"})`);
  }
  if (artifact.yoo_article_presets) {
    for (const label of ["likely", "worst"]) {
      const preset = artifact.yoo_article_presets[label];
      console.log(`--- article preset ${label} (r = ${preset.discount_rate} = rf ${preset.risk_free_observed} + ERP ${preset.erp}) ---`);
      for (const row of preset.rows) {
        if (row.status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
        console.log(`${row.name}: fair ${row.fair_value} | upside ${row.upside_pct}% | roe_path ${JSON.stringify(row.roe_path)}`);
      }
    }
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
