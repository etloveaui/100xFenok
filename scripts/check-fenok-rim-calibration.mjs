// Fenok RIM calibration harness.
//
// The engine's formula is settled. Its long-run ROE input is not, and single-date
// comparisons have produced contradictory answers twice — one index favours one
// definition, another index favours a different one. This scores candidate ROE
// definitions against a TIME SERIES of the analyst's own dated, RIM-labelled
// outputs, so a definition that only wins on one row cannot win overall.
//
// Run it whenever new source material arrives:
//   node scripts/check-fenok-rim-calibration.mjs
//
// Targets are his published RIM figures only. His bottom-up 적정가 is a different
// model (bottom-up EPS x target PER) and is deliberately excluded — mixing it in
// would train the ROE rule on the wrong thing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCell } from "./build-fenok-rim-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");

// Where each index lives in our feeds, and the risk premium the engine uses.
const INDEX = {
  sp500: { file: "us.json", section: "sp500", rimKey: "SPX", label: "S&P 500", rp: 0.05, market: "us" },
  nasdaq100: { file: "us.json", section: "nasdaq100", rimKey: "NDX", label: "NASDAQ 100", rp: 0.055, market: "us" },
  nasdaq_composite: { file: "us.json", section: "nasdaq_composite", rimKey: "CCMP", label: "NASDAQ Composite", rp: 0.055, market: "us" },
  kospi: { file: "emerging.json", section: "kospi", rimKey: "KOSPI", label: "KOSPI", rp: 0.12, market: "kr" },
};

// His own RIM-labelled outputs, dated, from his weekly letters and English
// write-ups. `upside` is a fraction; `fair` is an index level. A range is stored
// as [lo, hi] and scored as a hit anywhere inside it. "over X%" is stored as a
// range from X to X+0.10, because he means a floor rather than a point.
export const PUBLISHED = [
  { date: "2026-06-14", key: "kospi", upside: [0.495, 0.495], note: "12m attractiveness" },
  { date: "2026-06-21", key: "nasdaq100", upside: [0.28, 0.28], floor: true, note: "over 28%, 12m" },
  { date: "2026-06-21", key: "sp500", fair: [8854.61, 8854.61], note: "fair value" },
  { date: "2026-07-12", key: "sp500", upside: [0.14, 0.14], floor: true, note: "over 14%, 6-12m" },
  { date: "2026-07-12", key: "nasdaq_composite", upside: [0.24, 0.24], floor: true, note: "over 24%, 6-12m" },
  { date: "2026-07-12", key: "nasdaq100", upside: [0.36, 0.36], floor: true, note: "over 36%, 6-12m" },
  { date: "2026-07-19", key: "kospi", upside: [0.59, 0.59], note: "12m, after the July drawdown" },
  { date: "2026-07-26", key: "sp500", upside: [0.19, 0.29], note: "12m range" },
  { date: "2026-08-02", key: "sp500", upside: [0.18, 0.18], floor: true, note: "over 18%, 6-12m" },
  { date: "2026-08-02", key: "nasdaq100", upside: [0.50, 0.50], floor: true, note: "over 50%, 6-12m" },
];

// Forward-basis payouts for indices whose derived value is unusable. KOSPI is
// market-cap weighted across 269 Korean names in data/global-scouter (2026-07-31).
const PAYOUT_FALLBACK = { kospi: 0.1382, nasdaq_composite: 0.2180 };

function nearestRow(section, dateIso) {
  const target = new Date(dateIso).getTime();
  let best = null;
  let bestGap = Infinity;
  for (const row of section?.data ?? []) {
    const gap = Math.abs(new Date(row.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = row; }
  }
  return best ? { row: best, gapDays: Math.round(bestGap / 86400000) } : null;
}

function fiscalYearElapsed(dateIso) {
  const d = new Date(dateIso);
  return (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
}

// Candidate long-run ROE definitions. Each returns null when its inputs are
// missing, so a candidate is never silently scored on a fallback.
export const CANDIDATES = {
  raw: {
    label: "raw vendor ROE (best_eps / book)",
    fn: ({ rawRoe }) => rawRoe,
  },
  fy1_beginning: {
    label: "FY1 earnings over BEGINNING book",
    fn: ({ rawRoe, growthFy2, elapsed }) => {
      if (![rawRoe, growthFy2, elapsed].every(Number.isFinite)) return null;
      const factor = 1 + elapsed * growthFy2;
      return factor > 0.5 && factor < 3 ? rawRoe / factor : null;
    },
  },
  median_5y: {
    label: "the index's own 5-year median ROE",
    fn: ({ history }) => history?.median5y ?? null,
  },
  median_10y: {
    label: "the index's own 10-year median ROE",
    fn: ({ history }) => history?.median10y ?? null,
  },
  blend_spot_median: {
    label: "midpoint of spot and the 10-year median",
    fn: ({ rawRoe, history }) => (Number.isFinite(rawRoe) && Number.isFinite(history?.median10y)
      ? (rawRoe + history.median10y) / 2 : null),
  },
  capped_2_3x: {
    label: "raw ROE, capped at 2.3x the index's own 5-year median",
    fn: ({ rawRoe, history }) => (Number.isFinite(rawRoe) && Number.isFinite(history?.median5y)
      ? Math.min(rawRoe, 2.3 * history.median5y) : rawRoe ?? null),
  },
  fy1_ending: {
    label: "FY1 earnings over END-of-FY1 book",
    fn: ({ rawRoe, growthFy2, elapsed, retention, book }) => {
      if (![rawRoe, growthFy2, elapsed, retention, book].every(Number.isFinite)) return null;
      const factor = 1 + elapsed * growthFy2;
      if (!(factor > 0.5) || factor > 3) return null;
      const eps = (rawRoe / factor) * book;
      return eps / (book + eps * retention);
    },
  },
};

function loadContext() {
  const feeds = {};
  for (const cfg of Object.values(INDEX)) {
    if (!feeds[cfg.file]) feeds[cfg.file] = JSON.parse(fs.readFileSync(path.join(BENCHMARKS, cfg.file), "utf8"));
  }
  const rim = JSON.parse(fs.readFileSync(RIM_INPUTS, "utf8"));
  return { feeds, rim };
}

export function evaluate({ feeds, rim }) {
  const results = [];
  for (const target of PUBLISHED) {
    const cfg = INDEX[target.key];
    if (!cfg) continue;
    const hit = nearestRow(feeds[cfg.file]?.sections?.[cfg.section], target.date);
    if (!hit || !Number.isFinite(hit.row.px_last) || !Number.isFinite(hit.row.px_to_book_ratio)) continue;
    const px = hit.row.px_last;
    const book = px / hit.row.px_to_book_ratio;
    const periods = rim.indices?.[cfg.rimKey]?.derived?.forecast_grid_v1?.periods ?? [];
    const derivedPayout = periods[0]?.payout_ratio?.value;
    // KOSPI's derived payout is zero — the Korean dividend join covers almost no
    // weight — so every KOSPI row scored n/a and the index that matters most was
    // invisible. A market-cap weighting of the Korean names in the Global Scouter
    // export gives a real forward-basis payout.
    const payout = Number.isFinite(derivedPayout) && derivedPayout > 0 && derivedPayout < 1
      ? derivedPayout
      : PAYOUT_FALLBACK[target.key] ?? null;
    const retention = Number.isFinite(payout) ? 1 - payout : null;
    const riskFree = cfg.market === "kr"
      ? 0.0426
      : rim.indices?.SPX?.observed?.risk_free_rate?.value ?? 0.0468;
    const all = (feeds[cfg.file]?.sections?.[cfg.section]?.data ?? [])
      .filter((r) => r.date <= target.date && Number.isFinite(r.roe))
      .map((r) => r.roe);
    const medianOf = (arr) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const inputs = {
      history: { median5y: medianOf(all.slice(-260)), median10y: medianOf(all.slice(-520)) },
      rawRoe: hit.row.roe,
      growthFy2: periods[1]?.eps_growth?.value,
      elapsed: fiscalYearElapsed(target.date),
      retention,
      book,
    };
    const scored = {};
    for (const [name, cand] of Object.entries(CANDIDATES)) {
      const roe = cand.fn(inputs);
      if (!Number.isFinite(roe) || !Number.isFinite(retention)) { scored[name] = null; continue; }
      const fair = computeCell({ bookValue: book, roePath: [roe], retention, riskFree, erp: cfg.rp });
      const lo = target.fair ? target.fair[0] : px * (1 + target.upside[0]);
      const hi = target.fair ? target.fair[1] : px * (1 + target.upside[1]);
      // A floor has no upper edge: anything at or above it satisfies what he said.
      const err = fair < lo ? fair / lo - 1 : (target.floor || fair <= hi) ? 0 : fair / hi - 1;
      scored[name] = { roe, fair, err, inside: err === 0 };
    }
    results.push({ ...target, label: cfg.label, px, book, gapDays: hit.gapDays, scored });
  }
  return results;
}

function main() {
  const ctx = loadContext();
  const rows = evaluate(ctx);
  const names = Object.keys(CANDIDATES);
  console.log("Fenok RIM calibration — his own dated RIM outputs vs our engine\n");
  console.log("A row scores 0 when the engine lands inside his stated figure or range.\n");
  const head = "date        index               his figure".padEnd(48) + names.map((n) => n.padStart(16)).join("");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    const shown = r.fair ? `${r.fair[0]}` : `${(r.upside[0] * 100).toFixed(1)}~${(r.upside[1] * 100).toFixed(1)}%`;
    const cells = names.map((n) => {
      const s = r.scored[n];
      return (s ? (s.inside ? "  hit" : `${(s.err * 100).toFixed(1)}%`) : "  n/a").padStart(16);
    }).join("");
    console.log(`${r.date}  ${r.label.padEnd(18)} ${shown.padEnd(14)}${cells}`);
  }
  console.log("-".repeat(head.length));
  const summary = names.map((n) => {
    const scored = rows.map((r) => r.scored[n]).filter(Boolean);
    if (!scored.length) return { n, hits: 0, mae: null, count: 0 };
    const mae = scored.reduce((a, s) => a + Math.abs(s.err), 0) / scored.length;
    return { n, hits: scored.filter((s) => s.inside).length, mae, count: scored.length };
  });
  console.log("scored".padEnd(48) + summary.map((s) => `${s.count}`.padStart(16)).join(""));
  console.log("inside".padEnd(48) + summary.map((s) => `${s.hits}`.padStart(16)).join(""));
  console.log("mean abs err".padEnd(48) + summary.map((s) => (s.mae === null ? "n/a" : `${(s.mae * 100).toFixed(1)}%`).padStart(16)).join(""));
  const best = summary.filter((s) => s.mae !== null).sort((a, b) => b.hits - a.hits || a.mae - b.mae)[0];
  console.log(`\nBest across the series: ${best ? `${best.n} (${best.hits}/${best.count} inside, mean abs err ${(best.mae * 100).toFixed(1)}%)` : "none scorable"}`);
  console.log("\nA candidate that wins on one index and loses on another is not a winner.");
  console.log("Read the per-row column before changing the engine.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
