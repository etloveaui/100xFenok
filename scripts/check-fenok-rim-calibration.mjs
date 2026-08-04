// Fenok RIM calibration harness.
//
// The engine is a conditional structural hypothesis, not an identified level
// model. This harness falsifies candidate ROE definitions against dated,
// RIM-labelled outputs while preserving floors as one-sided constraints. A green
// diagnostic never promotes publication by itself.
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
import {
  computeCell,
  resolvePayout,
  RIM_KR_RISK_FREE_ANCHOR,
} from "./build-fenok-rim-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARKS = path.join(ROOT, "data", "benchmarks");
const RIM_INPUTS = path.join(ROOT, "data", "computed", "rim-index", "inputs.json");
const CALIBRATION_EVIDENCE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/fenok-rim-calibration-evidence.json"), "utf8"));
const CALIBRATION_CLAIMS = new Map(CALIBRATION_EVIDENCE.claims.map((row) => [row.evidence_id, row]));

// Where each index lives in our feeds, and the risk premium the engine uses.
const INDEX = {
  sp500: { file: "us.json", section: "sp500", rimKey: "SPX", label: "S&P 500", rp: 0.05, market: "us" },
  nasdaq100: { file: "us.json", section: "nasdaq100", rimKey: "NDX", label: "NASDAQ 100", rp: 0.055, market: "us" },
  nasdaq_composite: { file: "us.json", section: "nasdaq_composite", rimKey: "CCMP", label: "NASDAQ Composite", rp: 0.055, market: "us" },
  kospi: { file: "emerging.json", section: "kospi", rimKey: "KOSPI", label: "KOSPI", rp: 0.12, market: "kr" },
  // The row the formula record called the one most likely to be wrong and least
  // likely to be caught: it ships +360% with no published figure to score it
  // against. It has three now. Its ROE sits at 2.21x its own five-year median,
  // just inside the 2.3x bound, so nothing currently restrains it.
  philadelphia_semi: {
    file: "micro_sectors.json", section: "philadelphia_semi", rimKey: "SOX",
    label: "Philadelphia Semi", rp: 0.055, market: "us", identityStatus: "unresolved",
  },
};

// His own RIM-labelled outputs, dated, from his weekly letters and English
// write-ups. `upside` is a fraction; `fair` is an index level. A range is stored
// as [lo, hi] and scored as a hit anywhere inside it. "over X%" is stored as a
// as [X, X] plus `floor: true`; scoring treats it as an inequality, never a point.
export const PUBLISHED = [
  { evidence_id: "rim-7041d3d1604bd6d9b5683c04", evidence_label: "RIM", raw_value: "49.5", date: "2026-06-14", key: "kospi", upside: [0.495, 0.495], note: "12m attractiveness" },
  { evidence_id: "rim-8c8130ac9b05e797d4168d85", evidence_label: "RIM", raw_value: "28 이상", date: "2026-06-21", key: "nasdaq100", upside: [0.28, 0.28], floor: true, note: "over 28%, 12m" },
  { evidence_id: "rim-657138512272497b9d28fa5e", evidence_label: "RIM", raw_value: "14 이상", date: "2026-07-12", key: "sp500", upside: [0.14, 0.14], floor: true, note: "over 14%, 6-12m" },
  { evidence_id: "rim-694e999c6f76b4d205ede3c2", evidence_label: "RIM", raw_value: "24 이상", date: "2026-07-12", key: "nasdaq_composite", upside: [0.24, 0.24], floor: true, note: "over 24%, 6-12m" },
  { evidence_id: "rim-00269321d964013833efea9f", evidence_label: "RIM", raw_value: "36 이상", date: "2026-07-12", key: "nasdaq100", upside: [0.36, 0.36], floor: true, note: "over 36%, 6-12m" },
  { evidence_id: "rim-ccea4d31accf70a35d5a095e", evidence_label: "RIM", raw_value: "19~29", date: "2026-07-26", key: "sp500", upside: [0.19, 0.29], note: "12m range" },
  // Philadelphia Semi — RIM-labelled only. He also states 89.4%, 74% and 40~55%
  // for semis on nearby dates without naming the model, and those are excluded
  // for the same reason his bottom-up 적정가 is: they would train the ROE rule on
  // a different model. Identity caveat: he quotes SOXX, the ETF, while our feed
  // section is the Philadelphia Semi index. Near-identical baskets, but this is
  // the exact shape of the Russell 2000/3000 mislabel that invalidated months of
  // comparisons, so it is recorded rather than assumed away.
  {
    evidence_id: "rim-433b0e766bf14890b224bda4", evidence_label: "RIM", raw_value: "94.5",
    date: "2026-04-26", key: "philadelphia_semi", upside: [0.945, 0.945],
    note: "RIM 상 상승여력 94.5% (uid 1609)",
  },
  {
    evidence_id: "rim-23aa64927d1639a5e1fc0e7d", evidence_label: "RIM", raw_value: "56.3~147.3",
    date: "2026-06-21", key: "philadelphia_semi", upside: [0.563, 1.473],
    note: "잔존 가치 모델 상 향후 1년간 56.3~147.3% (uid 1643, verified at source)",
  },
  {
    evidence_id: "rim-1d69c85650aa0c41e37616c7", evidence_label: "RIM", raw_value: "63",
    date: "2026-06-28", key: "philadelphia_semi", upside: [0.63, 0.63], floor: true,
    note: "RIM 모델 상 6~12개월 최소 63% (uid 1647)",
  },
];

export const QUARANTINED_PUBLISHED = Object.freeze([
  { evidence_id: "rim-ffdf5e468c603d9c7354fa5a", date: "2026-06-21", key: "sp500", raw_value: "8854.61", evidence_label: "BOTTOM_UP", reason: "wrong_model_family" },
  { evidence_id: "rim-90a8da619869cbeb67f2418c", date: "2026-07-19", key: "kospi", raw_value: "59", evidence_label: "FUNDAMENTAL", reason: "wrong_model_family" },
  { evidence_id: "rim-0ea2852fec748faa7f94dfdd", date: "2026-08-02", key: "sp500", raw_value: "AMBIGUOUS:적정가치 산출 모델 문장에 미명시 18 이상", evidence_label: "RIM", reason: "model_not_named_in_sentence" },
  { evidence_id: "rim-261c0932730c11c55dcff82c", date: "2026-08-02", key: "nasdaq100", raw_value: "AMBIGUOUS:RIM 문단 내 인용이나 해당 문장에 모델 미명시 50 이상", evidence_label: "RIM", reason: "model_not_named_in_sentence" },
]);

const EXPECTED_ASSET = { kospi: "KOSPI", nasdaq100: "NASDAQ100", sp500: "SP500", nasdaq_composite: "NASDAQ", philadelphia_semi: "SOXX" };
for (const anchor of PUBLISHED) {
  const claim = CALIBRATION_CLAIMS.get(anchor.evidence_id);
  if (!claim || claim.date !== anchor.date || claim.asset !== EXPECTED_ASSET[anchor.key]) throw new Error(`${anchor.evidence_id}: calibration evidence join failed`);
  if (claim.label !== "RIM") throw new Error(`${anchor.evidence_id}: ledger claim is not RIM-labelled`);
  if (String(claim.raw_value).startsWith("AMBIGUOUS:")) throw new Error(`${anchor.evidence_id}: ambiguous ledger claim must be quarantined`);
  if (claim.label !== anchor.evidence_label || claim.raw_value !== anchor.raw_value) throw new Error(`${anchor.evidence_id}: copied evidence metadata drifted from ledger extract`);
}
for (const anchor of QUARANTINED_PUBLISHED) {
  const claim = CALIBRATION_CLAIMS.get(anchor.evidence_id);
  if (!claim || claim.date !== anchor.date || claim.asset !== EXPECTED_ASSET[anchor.key]) throw new Error(`${anchor.evidence_id}: quarantine evidence join failed`);
  if (claim.label !== anchor.evidence_label || claim.raw_value !== anchor.raw_value) throw new Error(`${anchor.evidence_id}: quarantine metadata drifted from ledger extract`);
  if (claim.label === "RIM" && !String(claim.raw_value).startsWith("AMBIGUOUS:")) throw new Error(`${anchor.evidence_id}: admissible RIM claim cannot be quarantined`);
}

// Retention comes from the ENGINE's resolver, never from a table kept here.
// This file used to carry its own: measured filings-based payouts of
// sp500 20.72% / nasdaq100 9.71% / kospi 13.82%, while the build resolved
// 31.09% / 25.65% / 37.89% from the sheet anchors. Every ranking printed here
// therefore described an engine that does not exist, and KOSPI — the row the
// 2.3x ROE bound was fitted on — was scored 2.7x away from what ships.
//
// This is the same failure the formula record names as the trap to check first,
// firing for the third time in this track: a test that exercises different
// inputs from the build. The fix is structural, not a corrected copy — there is
// one resolver and both callers use it.
//
// The measured filings series still exists and is still worth scoring, but it is
// a CANDIDATE basis to be ranked, not the harness's silent default. It lives in
// data/computed/fenok-rim/payout-history.json, produced daily.

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

// Every row must be scored at the risk-free rate that was observable ON ITS OWN
// DATE. Scoring dated rows at today's rate lets a ROE candidate absorb rate-date
// error and be rewarded for it — the harness was doing exactly that, running all
// six US dates at 4.68% and both KOSPI dates at the engine's 4.4% anchor.
//
// The US side needs no table: our own FRED capture carries the daily series, so
// it refreshes itself and a new anchor date is priced automatically.
function usRiskFreeOn(dateIso, fred) {
  const raw = fred?.series?.DGS10;
  const series = Array.isArray(raw) ? raw : raw?.observations ?? [];
  let best = null;
  for (const row of series) {
    const value = Number(row.value);
    if (!Number.isFinite(value) || row.date > dateIso) continue;
    if (!best || row.date > best.date) best = { date: row.date, value: value / 100 };
  }
  return best;
}

// Korea has no dated series in this repo — the KRX artifact publishes only its
// latest observation, so a past date is not recoverable at runtime. These are
// the KOSPI anchor dates, each read from the 국고 10년 지표물 capture that was
// current on that date. Values are historical and cannot change once observed.
// Refresh: add one row per new KOSPI anchor, sourced the same way. A KOSPI date
// missing here is scored at the engine's anchor and reported as a fallback
// rather than silently priced at today's rate.
const KR_RISK_FREE_ON = {
  "2026-06-14": {
    value: 0.04201,
    observed: "2026-06-12",
    source: "_private/.../krx_backfill_20d_20260626/raw/bond_commodity_esg/kts_bydd_trd/20260612.json 국고04250-3606 지표",
  },
  "2026-07-19": {
    value: 0.04294,
    observed: "2026-07-16",
    source: "data/admin/fenok-edge-korea-krx-daily-index.json at 160b6c48dc, korea_10y observed 2026-07-16",
  },
};

export function loadContext() {
  const feeds = {};
  for (const cfg of Object.values(INDEX)) {
    if (!feeds[cfg.file]) feeds[cfg.file] = JSON.parse(fs.readFileSync(path.join(BENCHMARKS, cfg.file), "utf8"));
  }
  const rim = JSON.parse(fs.readFileSync(RIM_INPUTS, "utf8"));
  const fredPath = path.join(ROOT, "data", "macro", "fred-banking-daily.json");
  const fred = fs.existsSync(fredPath) ? JSON.parse(fs.readFileSync(fredPath, "utf8")) : null;
  return { feeds, rim, fred };
}

export function evaluate({ feeds, rim, fred }) {
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
    // Measured filings beat the derived surface: the derived payout is a
    // point-in-time forward figure and reads zero for KOSPI.
    // The engine's own resolver, with the same derived-retention argument the
    // build passes it, so the sheet anchor leads here exactly as it does there.
    const derivedRetention = Number.isFinite(derivedPayout)
      ? { value: 1 - derivedPayout, source: "forecast_grid_v1 period 0" }
      : null;
    const resolved = resolvePayout(target.key, derivedRetention);
    const retention = resolved?.value ?? null;
    let riskFree;
    let riskFreeSource;
    if (cfg.market === "kr") {
      const dated = KR_RISK_FREE_ON[target.date];
      riskFree = dated?.value ?? RIM_KR_RISK_FREE_ANCHOR.value;
      riskFreeSource = dated
        ? `KR 10Y observed ${dated.observed}`
        : `FALLBACK engine anchor ${RIM_KR_RISK_FREE_ANCHOR.value} (${RIM_KR_RISK_FREE_ANCHOR.as_of}) — no dated capture for ${target.date}`;
    } else {
      const dated = usRiskFreeOn(target.date, fred);
      riskFree = dated?.value ?? rim.indices?.SPX?.observed?.risk_free_rate?.value ?? 0.0468;
      riskFreeSource = dated
        ? `US DGS10 observed ${dated.date}`
        : "FALLBACK current SPX risk-free — FRED capture unavailable";
    }
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
      if (cfg.identityStatus === "unresolved") { scored[name] = null; continue; }
      const roe = cand.fn(inputs);
      if (!Number.isFinite(roe) || !Number.isFinite(retention)) { scored[name] = null; continue; }
      const fair = computeCell({ bookValue: book, roePath: [roe], retention, riskFree, erp: cfg.rp });
      const lo = target.fair ? target.fair[0] : px * (1 + target.upside[0]);
      const hi = target.fair ? target.fair[1] : px * (1 + target.upside[1]);
      if (target.floor) {
        // A floor is a one-sided constraint. A satisfied floor has no point
        // error and cannot improve MAE; an undershoot is a constraint failure.
        const constraintSatisfied = fair >= lo;
        scored[name] = {
          roe,
          fair,
          err: null,
          bounded: false,
          inside: constraintSatisfied,
          constraint_satisfied: constraintSatisfied,
          constraint_gap: constraintSatisfied ? 0 : fair / lo - 1,
        };
      } else {
        const err = fair < lo ? fair / lo - 1 : fair <= hi ? 0 : fair / hi - 1;
        scored[name] = {
          roe,
          fair,
          err,
          bounded: true,
          inside: err === 0,
          constraint_satisfied: null,
          constraint_gap: null,
        };
      }
    }
    // retention is published on the row so a test can assert the harness scored
    // the retention the build resolves, rather than trusting that it imported
    // the right function.
    results.push({
      ...target, label: cfg.label, px, book,
      // derivedRetention travels with the row so a test can re-run the engine's
      // resolver on the SAME argument this scoring used. Indices with a sheet
      // anchor ignore it; Philadelphia Semi has none and resolves through it.
      derivedRetention, retention, retentionSource: resolved?.source ?? null,
      riskFree, riskFreeSource, gapDays: hit.gapDays, scored,
      scoreable: cfg.identityStatus !== "unresolved",
      exclusion_reason: cfg.identityStatus === "unresolved" ? "asset_identity_unverified" : null,
    });
  }
  return results;
}

export function summarizeCalibration(rows, names = Object.keys(CANDIDATES)) {
  return names.map((n) => {
    const available = rows.map((r) => r.scored[n]).filter(Boolean);
    const bounded = available.filter((score) => score.bounded === true);
    const floors = available.filter((score) => score.bounded === false);
    const boundedMae = bounded.length
      ? bounded.reduce((sum, score) => sum + Math.abs(score.err), 0) / bounded.length
      : null;
    const floorViolations = floors.filter((score) => score.constraint_satisfied === false).length;
    return {
      n,
      count: available.length,
      bounded_count: bounded.length,
      bounded_hits: bounded.filter((score) => score.inside).length,
      bounded_mae: boundedMae,
      floor_count: floors.length,
      floor_violations: floorViolations,
      admissible: floors.length > 0 && floorViolations === 0,
    };
  });
}

function main() {
  const ctx = loadContext();
  const rows = evaluate(ctx);
  const names = Object.keys(CANDIDATES);
  console.log("Fenok RIM calibration — his own dated RIM outputs vs our engine\n");
  console.log("Point/range rows measure error. Floors are pass/fail constraints and never enter MAE.\n");
  const head = "date        index               his figure".padEnd(48) + names.map((n) => n.padStart(16)).join("");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    const shown = r.fair ? `${r.fair[0]}` : `${(r.upside[0] * 100).toFixed(1)}~${(r.upside[1] * 100).toFixed(1)}%`;
    const cells = names.map((n) => {
      const s = r.scored[n];
      if (!s) return "  n/a".padStart(16);
      if (r.floor) {
        return (s.constraint_satisfied ? "  floor pass" : `${(s.constraint_gap * 100).toFixed(1)}% fail`).padStart(16);
      }
      return (s.inside ? "  hit" : `${(s.err * 100).toFixed(1)}%`).padStart(16);
    }).join("");
    console.log(`${r.date}  ${r.label.padEnd(18)} ${shown.padEnd(14)}${cells}`);
  }
  console.log("-".repeat(head.length));
  const summary = summarizeCalibration(rows, names);
  console.log("bounded scored".padEnd(48) + summary.map((s) => `${s.bounded_count}`.padStart(16)).join(""));
  console.log("bounded inside".padEnd(48) + summary.map((s) => `${s.bounded_hits}`.padStart(16)).join(""));
  console.log("floor constraints".padEnd(48) + summary.map((s) => `${s.floor_count}`.padStart(16)).join(""));
  console.log("floor violations".padEnd(48) + summary.map((s) => `${s.floor_violations}`.padStart(16)).join(""));
  console.log("bounded mean abs err".padEnd(48) + summary.map((s) => (s.bounded_mae === null ? "n/a" : `${(s.bounded_mae * 100).toFixed(1)}%`).padStart(16)).join(""));
  const best = summary
    .filter((s) => s.admissible && s.bounded_mae !== null)
    .sort((a, b) => a.bounded_mae - b.bounded_mae || b.bounded_hits - a.bounded_hits)[0];
  console.log(`\nBest admissible candidate: ${best ? `${best.n} (${best.bounded_hits}/${best.bounded_count} bounded rows inside, bounded mean abs err ${(best.bounded_mae * 100).toFixed(1)}%)` : "none — every candidate violates at least one floor or lacks bounded evidence"}`);
  console.log("\nRanked only among candidates satisfying every floor. Floor overshoot contributes no error.");
  console.log("A candidate that wins on one index and loses on another is not a winner.");
  console.log("Read the per-row column before changing the engine.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
