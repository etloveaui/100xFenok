// Fenok RIM — self-sustaining index fair-value engine (v6).
//
// Owner mandate 2026-08-03: with the full set of source sheets captured, the
// calculation must now run on OUR data alone, daily, with no further source
// material required. Every fixed value states why it is that value and what
// refreshes it (constants_provenance) — no silent magic numbers.
//
// Model (reconstructed cell-for-cell from the captured sheets; provenance in
// docs/references/fenok-rim-source-catalog.md):
//   B0 = px_last / px_to_book_ratio
//   explicit years t=1..3: RI_t = (ROE_t - r) * B_{t-1};
//                          B_t = B_{t-1} * (1 + ROE_t * retention)
//   terminal: flat perpetuity (ROE_LT - r) * B_3 / r, discounted 3y
//   fair value = mean of a 3x3 grid: LT-ROE rows (center ± 0.5%p) x ERP
//   columns (center ± 0.5%p); r = market risk-free + ERP.
//   Cases: Likely / Worst (LT-ROE haircut variants) x rate scenarios
//   (current 10Y / 3.5% 10Y).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");
const OUT_DIR = path.join(ROOT, "data", "computed", "fenok-rim");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "fenok-rim");

export const RIM_EXPLICIT_YEARS = 3;
export const RIM_GRID_STEP = 0.005;
export const RIM_RATE_SCENARIO_10Y = 0.035;
// Korean 10Y has no local automated source yet (data gap): dated anchor from
// the 2026-08-03 source sheets until a KR-10Y lane exists.
export const RIM_KR_RISK_FREE_ANCHOR = { value: 0.044, as_of: "2026-08-03" };
// LT-ROE haircuts vs the 3-year consensus-path average. likely 0.93 is the one
// cross-vintage measurable ratio (source LT 26.1% vs current SPX path average
// 27.99%); worst applies the stock-sheet worst/likely ratio (0.735/0.81 =
// 0.907). Both are estimates pending a same-vintage sheet pair.
export const RIM_LT_HAIRCUT = Object.freeze({ likely: 0.93, worst: 0.85 });

// Per-index ERP centers measured off the source sheets (2025-12-09 index
// sheets + 2026-08-03 input sheets). philadelphia_semi has no sheet of its
// own; it inherits the NASDAQ-family center as an estimate.
const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", market: "us", erp: 0.05, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", market: "us", erp: 0.055, erpSource: "sheet 2026-08-03" },
  { file: "us.json", key: "russell2000", name: "러셀 2000", market: "us", erp: 0.045, erpSource: "sheet 2025-12-09" },
  { file: "emerging.json", key: "kospi", name: "코스피", market: "kr", erp: 0.12, erpSource: "sheet 2026-08-03" },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", market: "us", erp: 0.055, erpSource: "estimated: NASDAQ-family center, no dedicated sheet" },
];

// Calibration anchors: the source analyst's published outputs, dated. A
// diverged flag means our estimate has drifted from what he publishes —
// refresh anchors from new material, never silently refit.
export const RIM_CALIBRATION_ANCHORS = Object.freeze([
  { key: "sp500", published_upside_pct: [8, 12], as_of: "2026-06-11", source: "internal source catalog" },
  { key: "nasdaq100", published_upside_pct: [25, 30], as_of: "2026-06-10", source: "internal source catalog" },
  { key: "kospi", published_fair_range: [10000, 12000], as_of: "2026-05-19", source: "internal source catalog" },
]);

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// One grid cell: explicit consensus-path years then a flat terminal
// perpetuity at the LT ROE. Flat (g=0) is deliberate: the sheets carry a
// long-term payout of 50%, but a perpetuity growing at ROE_LT * 0.5 diverges
// for every high-ROE index (growth > r), so the LT payout is recorded as a
// sheet fact and not wired into terminal growth.
export function computeCell({ bookValue, roePath, retention, riskFree, erp, ltRoe, years = RIM_EXPLICIT_YEARS }) {
  const r = riskFree + erp;
  let book = bookValue;
  let pvExplicit = 0;
  for (let t = 1; t <= years; t += 1) {
    const yearRoe = roePath[Math.min(t - 1, roePath.length - 1)];
    pvExplicit += ((yearRoe - r) * book) / (1 + r) ** t;
    book *= 1 + yearRoe * retention;
  }
  const terminal = ((ltRoe - r) * book) / r / (1 + r) ** years;
  return bookValue + pvExplicit + terminal;
}

// One case (Likely or Worst, one rate scenario): 3x3 grid, mean = fair value,
// with the min/max upsides the sheets print as 상승여력 최저/최고.
export function computeCase({ px, bookValue, roePath, retention, riskFree, erpCenter, haircut }) {
  const pathAvg = roePath.reduce((a, b) => a + b, 0) / roePath.length;
  const ltCenter = pathAvg * haircut;
  const cells = [];
  for (const ltRoe of [ltCenter - RIM_GRID_STEP, ltCenter, ltCenter + RIM_GRID_STEP]) {
    for (const erp of [erpCenter - RIM_GRID_STEP, erpCenter, erpCenter + RIM_GRID_STEP]) {
      cells.push(computeCell({ bookValue, roePath, retention, riskFree, erp, ltRoe }));
    }
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  return {
    lt_roe_center: round(ltCenter, 4),
    erp_center: erpCenter,
    risk_free: round(riskFree, 4),
    fair_value: round(mean, 2),
    upside_pct: round((mean / px - 1) * 100, 2),
    upside_min_pct: round((Math.min(...cells) / px - 1) * 100, 2),
    upside_max_pct: round((Math.max(...cells) / px - 1) * 100, 2),
  };
}

const RIM_INDEX_KEY = { sp500: "SPX", nasdaq100: "NDX", kospi: "KOSPI", philadelphia_semi: "SOX", nasdaq_composite: "CCMP" };

export function loadRimDerived() {
  try {
    const payload = JSON.parse(fs.readFileSync(RIM_INPUTS, "utf8"));
    const riskFreeUs = payload?.indices?.SPX?.observed?.risk_free_rate?.value
      ?? Object.values(payload?.indices ?? {})[0]?.observed?.risk_free_rate?.value
      ?? null;
    const paths = {};
    const retentions = {};
    for (const [ourKey, rimKey] of Object.entries(RIM_INDEX_KEY)) {
      const derived = payload?.indices?.[rimKey]?.derived;
      const periods = derived?.forecast_grid_v1?.periods ?? [];
      const roePath = periods
        .map((p) => p?.roe_on_beginning_book?.value)
        .filter((v) => Number.isFinite(v));
      if (roePath.length >= 3) paths[ourKey] = roePath.slice(0, 3);
      const payout = derived?.payout_ratio?.value;
      if (Number.isFinite(payout) && payout > 0 && payout < 1) {
        retentions[ourKey] = { value: 1 - payout, source: `observed derived payout_ratio ${round(payout, 4)}` };
      }
    }
    return { riskFreeUs: Number.isFinite(riskFreeUs) ? riskFreeUs : null, paths, retentions };
  } catch {
    return { riskFreeUs: null, paths: {}, retentions: {} };
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
      computed = row.likely.rate_current.upside_pct;
      const [lo, hi] = anchor.published_upside_pct;
      within = computed >= lo - 5 && computed <= hi + 5;
    } else {
      computed = row.likely.rate_current.fair_value;
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
  const rows = INDEX_SOURCES.map((source) => {
    const latest = loadSectionLatest(source.file, source.key);
    const roePath = derived.paths[source.key]
      ?? (Number.isFinite(latest?.roe) ? [latest.roe, latest.roe, latest.roe] : null);
    const roePathSource = derived.paths[source.key]
      ? "weekly consensus grid (rim-index)"
      : "spot forward ROE held constant (no consensus grid for this index)";
    const riskFree = source.market === "kr" ? RIM_KR_RISK_FREE_ANCHOR.value : derived.riskFreeUs;
    const riskFreeSource = source.market === "kr"
      ? `KR 10Y anchor ${RIM_KR_RISK_FREE_ANCHOR.value} (sheet ${RIM_KR_RISK_FREE_ANCHOR.as_of}; automated KR-10Y lane is an open data gap)`
      : "observed US 10Y (FRED DGS10 via rim-index, daily)";
    const retention = derived.retentions[source.key]
      ?? { value: 0.65, source: "house fallback (observed payout blocked or unavailable)" };
    if (!latest || !Number.isFinite(latest.px) || !Number.isFinite(latest.pbr) || latest.pbr <= 0
      || !roePath || !Number.isFinite(riskFree)) {
      return { key: source.key, name: source.name, status: "excluded", reason: "missing price/book/ROE/risk-free inputs" };
    }
    const base = {
      px: latest.px,
      bookValue: latest.px / latest.pbr,
      roePath,
      retention: retention.value,
      erpCenter: source.erp,
    };
    const caseFor = (haircut, rf) => computeCase({ ...base, riskFree: rf, haircut });
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
      erp_center: source.erp,
      erp_source: source.erpSource,
      risk_free: round(riskFree, 4),
      risk_free_source: riskFreeSource,
      likely: {
        rate_current: caseFor(RIM_LT_HAIRCUT.likely, riskFree),
        rate_scenario_35: caseFor(RIM_LT_HAIRCUT.likely, RIM_RATE_SCENARIO_10Y),
      },
      worst: {
        rate_current: caseFor(RIM_LT_HAIRCUT.worst, riskFree),
        rate_scenario_35: caseFor(RIM_LT_HAIRCUT.worst, RIM_RATE_SCENARIO_10Y),
      },
    };
  });
  return {
    schema_version: "fenok-rim-index/v6",
    generated_at: nowIso,
    method: "fenok_rim_forward_book_compounding_residual_income",
    display_note: "상대적 매력도 지표이며 목표가가 아님. 컨센서스 변화에 따라 언제든 크게 바뀔 수 있음.",
    rows,
    calibration_check: {
      description: "Computed Likely upside vs the source analyst's dated published outputs. diverged = refresh anchors from new material; never silently refit.",
      results: checkCalibration(rows),
    },
    constants_provenance: {
      risk_free_us: { why: "observed FRED DGS10 via rim-index inputs", refresh: "daily lane, automatic" },
      risk_free_kr: { why: `sheet-dated anchor ${RIM_KR_RISK_FREE_ANCHOR.value} (${RIM_KR_RISK_FREE_ANCHOR.as_of})`, refresh: "OPEN DATA GAP — replace with an automated KR-10Y source lane" },
      roe_paths: { why: "weighted stock-consensus FY1-3 grids; spot ROE held constant only where no grid exists (flagged per row)", refresh: "weekly conversion, automatic" },
      retention: { why: "1 - observed derived payout per index; house 0.65 fallback only where the payout derivation is blocked", refresh: "weekly, automatic" },
      erp_centers: { why: "measured per index off the source sheets (values and dates on each row); semi index inherits the NASDAQ-family center as an estimate", refresh: "manual — remeasure when a newer sheet is supplied" },
      grid_step: { why: "0.5%p row/column spacing read directly off every captured sheet", refresh: "manual with new sheets" },
      lt_haircut: { why: "likely 0.93 = the one cross-vintage LT/path-average ratio measurable today; worst = likely x 0.907 (the stock-sheet worst/likely ratio). Estimates pending a same-vintage pair", refresh: "manual — a same-vintage sheet pair confirms or re-fits" },
      terminal: { why: "flat perpetuity at LT ROE; the sheets' 50% long-term payout is recorded but NOT wired as terminal growth because ROE_LT x 0.5 exceeds r for every high-ROE index (divergent perpetuity)", refresh: "owner decision" },
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
    const L = row.likely.rate_current;
    const W = row.worst.rate_current;
    console.log(`${row.name}: px ${row.px_last} | Likely ${L.fair_value} (${L.upside_pct}%) | Worst ${W.fair_value} (${W.upside_pct}%) | r=${row.risk_free}+${row.erp_center}`);
  }
  for (const check of artifact.calibration_check.results) {
    console.log(`calibration ${check.key}: ${check.status} (${check.computed} vs ${JSON.stringify(check.published)})`);
  }
  console.log(`written: ${path.join(OUT_DIR, "fair-values.json")} (+ public mirror)`);
}
