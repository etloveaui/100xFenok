// Yoo Dong-won style single-value RIM table for major indices (owner mandate
// 2026-08-03: the assumption-band-only presentation is not the requested
// product; a single fair value with upside % per index must be shown, with
// every assumption labeled).
//
// Formula (single-stage residual-income persistence form, the shape Yoo
// Dong-won quotes on air):
//   B0 = px_last / px_to_book_ratio                (current book value)
//   V  = B0 + (ROE - r) * B0 * w / (1 + r - w)     (w = persistence factor)
//   upside = V / px_last - 1
//
// ROE is the Bloomberg forward ROE already flowing weekly through the
// benchmarks converter; r is a HOUSE assumption, so the artifact publishes a
// discount-rate sensitivity axis instead of pretending one rate is observed.
// This builder deliberately does NOT touch build-rim-index.mjs — that
// artifact keeps its multi-period assumption band; this one answers the
// owner's single-value question and says exactly what it assumed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const OUT_DIR = path.join(ROOT, "data", "computed", "rim-yoo");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "rim-yoo");

// House persistence scenarios: w = 1.0 (residual income persists), 0.9, 0.8
// (fades). Published in this order; none of them is a forecast.
export const YOO_PERSISTENCE_SCENARIOS = [1.0, 0.9, 0.8];

// Discount-rate sensitivity: the house cost of equity (0.0971, from the
// rim-index derivation risk_free + ERP) plus lower alternatives, because r is
// the dominant lever of this model and readers must see that, not a single
// authoritative-looking number.
export const YOO_DISCOUNT_SENSITIVITY = [0.0971, 0.08, 0.07];

const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합" },
  { file: "us.json", key: "russell2000", name: "러셀 2000" },
  { file: "emerging.json", key: "kospi", name: "코스피" },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체" },
];

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function computeYooRimRow({ key, name, px, pbr, roe, date, discountRate }) {
  const missing = [];
  if (!Number.isFinite(px) || px <= 0) missing.push("px_last");
  if (!Number.isFinite(pbr) || pbr <= 0) missing.push("px_to_book_ratio");
  if (!Number.isFinite(roe)) missing.push("roe");
  if (missing.length > 0) {
    return { key, name, status: "excluded", reason: `missing or non-positive inputs: ${missing.join(", ")}` };
  }
  const bookValue = px / pbr;
  const scenarios = YOO_PERSISTENCE_SCENARIOS.map((w) => {
    const fairValue = bookValue + ((roe - discountRate) * bookValue * w) / (1 + discountRate - w);
    return {
      w,
      fair_value: round(fairValue, 2),
      upside_pct: round((fairValue / px - 1) * 100, 2),
    };
  });
  return {
    key,
    name,
    status: "ready",
    as_of: date,
    px_last: round(px, 2),
    book_value: round(bookValue, 2),
    forward_roe: round(roe, 4),
    discount_rate: discountRate,
    scenarios,
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
    rows: INDEX_SOURCES.map((source) => {
      const latest = loadSectionLatest(source.file, source.key);
      if (!latest) return { key: source.key, name: source.name, status: "excluded", reason: "section absent from benchmarks" };
      return computeYooRimRow({ key: source.key, name: source.name, ...latest, discountRate });
    }),
  }));
  return {
    schema_version: "rim-yoo-index/v1",
    generated_at: nowIso,
    method: "yoo_dongwon_single_stage_residual_income_persistence",
    formula: "V = B0 + (ROE - r) * B0 * w / (1 + r - w); B0 = px_last / px_to_book_ratio",
    assumptions: {
      roe_source: "Bloomberg forward ROE via the weekly benchmarks converter (observed input)",
      discount_rates: YOO_DISCOUNT_SENSITIVITY,
      discount_rate_note: "0.0971 is the house cost of equity (risk_free + ERP, rim-index derivation); 0.08 and 0.07 are sensitivity alternatives. r is a house assumption, not an observation, and it dominates the result.",
      persistence_scenarios: YOO_PERSISTENCE_SCENARIOS,
      persistence_note: "w = 1.0 keeps residual income perpetual; 0.9 / 0.8 fade it. House assumptions, not forecasts.",
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
  const house = artifact.tables[0];
  for (const row of house.rows) {
    if (row.status !== "ready") { console.log(`${row.name}: excluded (${row.reason})`); continue; }
    const w1 = row.scenarios[0];
    console.log(`${row.name}: px ${row.px_last} | fair(w=1, r=${house.discount_rate}) ${w1.fair_value} | upside ${w1.upside_pct}%`);
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
