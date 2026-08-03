// Fenok RIM — self-sustaining index fair-value engine (v7).
//
// Formula (owner-supplied spec, VERIFIED by reproducing the captured
// 2025-12-09 index sheet outputs: S&P -0.4%, Russell -0.8%):
//   V = B0 + sum_{t=1..5} (ROE_t - Ke) * B_{t-1} / (1+Ke)^t
//          + (ROE_5 - Ke) * B_4 / (Ke * (1+Ke)^5)
//   B_t = B_{t-1} * (1 + ROE_t * retention),  Ke = US 10Y + ERP.
// Per the spec the risk-free leg is the US 10Y for every index (global
// allocation basis) — this removes the KR-10Y data gap.
// Inputs run on our data alone, daily: observed US 10Y, weekly consensus
// ROE paths, observed payout retention, sheet-measured per-index ERP centers.
// The reproduction check lives in the test suite as a permanent regression.

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

export const RIM_EXPLICIT_YEARS = 5;
export const RIM_GRID_STEP = 0.005;
export const RIM_RATE_SCENARIO_10Y = 0.035;
// Korean indices discount with the DOMESTIC rate (patent-era calc sheets and
// the 2026-08-03 KOSPI sheet both use it; the "US 10Y everywhere" claim from
// the earlier AI-written spec was disproven by the sheets). The observed rate
// comes from the KRX KTS 10Y benchmark government bond captured daily by the
// fenok-edge-korea lane; this dated anchor is only the fallback when that
// capture is missing.
export const RIM_KR_RISK_FREE_ANCHOR = { value: 0.044, as_of: "2026-08-03" };

// ERP centres come from the Damodaran country file, not from hand-copied sheet
// cells. The construction is total country ERP over that market's own
// risk-free rate, which is what the source sheets themselves use: Damodaran US
// 5.03% against his S&P 5.00% is a 3bp match, and Damodaran Korea 5.49%
// against his stated KOSPI band floor of 5.5% is a 1bp match. His per-index
// tilts (NASDAQ +0.5, Russell -0.5) are judgement values with no derivation —
// beta scaling does not reproduce them (Russell carries the higher beta yet the
// lower premium) — so they are deliberately dropped rather than frozen as
// manual constants. RIM_MARKET_ERP_FALLBACK applies only if the Damodaran file
// is unreadable, and the row says so when it does.
const RIM_MARKET_ERP_FALLBACK = { us: 0.0503, kr: 0.0549 };

const INDEX_SOURCES = [
  { file: "us.json", key: "sp500", name: "S&P 500", market: "us" },
  { file: "us.json", key: "nasdaq100", name: "나스닥 100", market: "us" },
  { file: "us.json", key: "nasdaq_composite", name: "나스닥 종합", market: "us" },
  { file: "us.json", key: "russell2000", name: "러셀 2000", market: "us" },
  { file: "emerging.json", key: "kospi", name: "코스피", market: "kr" },
  { file: "micro_sectors.json", key: "philadelphia_semi", name: "필라델피아 반도체", market: "us" },
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

// One grid cell — the owner-supplied multi-stage RIM, VERIFIED by
// reproducing the captured 2025-12-09 index sheet outputs (S&P -0.4%,
// Russell -0.8%; NASDAQ -10% traces to its unknown then-payout):
//   V = B0 + sum_{t=1..N} (ROE_t - Ke) * B_{t-1} / (1+Ke)^t
//          + (ROE_N - Ke) * B_{N-1} / (Ke * (1+Ke)^N)
//   B_t = B_{t-1} * (1 + ROE_t * retention),  Ke = US10Y + ERP,  N = 5.
// Years beyond the 3-year consensus path hold the final path year.
export function computeCell({ bookValue, roePath, retention, riskFree, erp, tailShift = 0, years = RIM_EXPLICIT_YEARS }) {
  const ke = riskFree + erp;
  let book = bookValue;
  let v = bookValue;
  let residual = 0;
  for (let t = 1; t <= years; t += 1) {
    const base = roePath[Math.min(t - 1, roePath.length - 1)];
    const roe = t > roePath.length ? base + tailShift : base;
    residual = (roe - ke) * book;
    v += residual / (1 + ke) ** t;
    book *= 1 + roe * retention;
  }
  v += residual / (ke * (1 + ke) ** years);
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
      ? "weekly consensus grid (rim-index)"
      : "spot forward ROE held constant (no consensus grid for this index)";
    const riskFree = source.market === "kr"
      ? (koreaRiskFree?.value ?? RIM_KR_RISK_FREE_ANCHOR.value)
      : derived.riskFreeUs;
    const riskFreeSource = source.market === "kr"
      ? (koreaRiskFree
        ? `observed KRX KTS 10Y benchmark government bond ${koreaRiskFree.value} (as of ${koreaRiskFree.as_of}, fenok-edge-korea lane, daily)`
        : `FALLBACK dated anchor ${RIM_KR_RISK_FREE_ANCHOR.value} (sheet ${RIM_KR_RISK_FREE_ANCHOR.as_of}) — KRX 10Y capture unavailable`)
      : "observed US 10Y (FRED DGS10 via rim-index, daily)";
    const retention = derived.retentions[source.key]
      ?? { value: 0.65, source: "house fallback (observed payout blocked or unavailable)" };
    const erpCenter = marketErp?.[source.market] ?? RIM_MARKET_ERP_FALLBACK[source.market];
    const erpSource = marketErp
      ? `Damodaran country ERP for ${source.market.toUpperCase()} market (workbook ${marketErp.as_of}, weekly lane)`
      : `FALLBACK ${source.market.toUpperCase()} ERP ${RIM_MARKET_ERP_FALLBACK[source.market]} — Damodaran country file unreadable`;
    if (!latest || !Number.isFinite(latest.px) || !Number.isFinite(latest.pbr) || latest.pbr <= 0
      || !roePath || !Number.isFinite(riskFree) || !Number.isFinite(erpCenter)) {
      return { key: source.key, name: source.name, status: "excluded", reason: "missing price/book/ROE/risk-free/ERP inputs" };
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
    index_math_pinned: true,
    display_ready: true,
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
      retention: { why: "1 - observed derived payout per index; house 0.65 fallback only where the payout derivation is blocked", refresh: "weekly, automatic" },
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
