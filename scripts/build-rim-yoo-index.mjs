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
const OUT_DIR = path.join(ROOT, "data", "computed", "rim-yoo");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "rim-yoo");

export const YOO_DISCOUNT_SENSITIVITY = [0.08, 0.0971, 0.07];
export const YOO_EXPLICIT_YEARS = 3;
export const YOO_TERMINAL_GROWTH = 0.025;
// No global terminal ROE cap: Yoo's US mega-cap numbers require sustained
// high ROE, and capping crushed them. Where the persona corpus records his
// OWN ROE assumption for an index, that value overrides the Bloomberg spot
// forward ROE instead (see roeOverride below).
export const YOO_TERMINAL_ROE_CAP = null;

const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", retention: 0.65 },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", retention: 0.65 },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", retention: 0.65 },
  { file: "us.json", key: "russell2000", name: "러셀 2000", retention: 0.65 },
  {
    file: "emerging.json", key: "kospi", name: "코스피", retention: 0.75,
    // Yoo's stated assumption: KOSPI 3-year average ROE "slightly above 20%"
    // (persona corpus 2026-06). The Bloomberg spot forward ROE (34.2% on
    // 2026-07-31) is a cyclical peak; compounding it forever produced +300%
    // class upsides far outside his own 10,000-12,000 target band.
    roeOverride: { value: 0.21, source: "yoo_stated_3y_average_roe" },
  },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", retention: 0.65 },
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
  years = YOO_EXPLICIT_YEARS,
  terminalGrowth = YOO_TERMINAL_GROWTH,
  terminalRoeCap = YOO_TERMINAL_ROE_CAP,
}) {
  const observedRoe = roe;
  const usedRoe = Number.isFinite(roeOverride?.value) ? roeOverride.value : roe;
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
  for (let t = 1; t <= years; t += 1) {
    const residual = (usedRoe - discountRate) * book;
    pvExplicit += residual / (1 + discountRate) ** t;
    lastBeginningBook = book;
    book *= 1 + usedRoe * retention;
  }
  const terminalRoe = Number.isFinite(terminalRoeCap) ? Math.min(usedRoe, terminalRoeCap) : usedRoe;
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

export function buildArtifact({ nowIso }) {
  const tables = YOO_DISCOUNT_SENSITIVITY.map((discountRate) => ({
    discount_rate: discountRate,
    headline: discountRate === YOO_DISCOUNT_SENSITIVITY[0],
    rows: INDEX_SOURCES.map((source) => {
      const latest = loadSectionLatest(source.file, source.key);
      if (!latest) return { key: source.key, name: source.name, status: "excluded", reason: "section absent from benchmarks" };
      return computeYooRimRow({
        key: source.key,
        name: source.name,
        retention: source.retention,
        roeOverride: source.roeOverride ?? null,
        ...latest,
        discountRate,
      });
    }),
  }));
  return {
    schema_version: "rim-yoo-index/v2",
    generated_at: nowIso,
    method: "yoo_dongwon_forward_book_compounding_residual_income",
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
    tables,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const artifact = buildArtifact({ nowIso: new Date().toISOString() });
  for (const dir of [OUT_DIR, MIRROR_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fair-values.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  for (const table of artifact.tables) {
    console.log(`--- r = ${table.discount_rate}${table.headline ? " (headline)" : ""} ---`);
    for (const row of table.rows) {
      if (row.status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
      console.log(`${row.name}: px ${row.px_last} | fair ${row.fair_value} | upside ${row.upside_pct}%`);
    }
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
