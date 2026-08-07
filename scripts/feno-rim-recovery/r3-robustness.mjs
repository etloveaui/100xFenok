// R3 ROBUSTNESS (red-team fh-20260807-096 pre-committed asks): bound the outcome-dependent
// survivorship and add the bi-dimensional portfolio leg, so the R3 verdict rests on agreement
// of two legs rather than one regression on a selection-biased universe.
//   (a) survivorship bound: drop the most-appreciated names (most outcome-dependent) and re-run
//       the pooled ICC coefficient (S3: BP + ICC + size).
//   (b) bi-dimensional leg: within B/P terciles, ICC high-vs-low 36m return spread (Frankel-Lee
//       bi-dimensional logic adapted to small cross-sections).
//   (c) verdict from agreement/disagreement of the two legs.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const priceCache = {}, divCache = {};
function loadP(sym) { if (!priceCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/prices/" + sym + ".json"); priceCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return priceCache[sym]; }
function loadD(sym) { if (!divCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/dividends/" + sym + ".json"); divCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return divCache[sym]; }
function closeAt(sym, targetISO) { const pc = loadP(sym); if (!pc) return null; const dates = Object.keys(pc.closes).filter(d => d <= targetISO).sort(); const d = dates.at(-1); if (!d) return null; if (ms(targetISO) - ms(d) > 16 * DAY) return null; return pc.closes[d]; }

// ---------- rebuild R3 panel (identical to r3-incremental.mjs) ----------
const r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json");
const panel = [];
for (const row of r2.rows) {
  if (row.icc_ri == null) continue;
  const Y = row.origin, o0 = `${Y}-06-30`, o1 = `${Y + 3}-06-30`;
  const p0 = closeAt(row.sym, o0), p1 = closeAt(row.sym, o1); if (p0 == null || p1 == null) continue;
  const d0 = ms(o0), d1 = ms(o1); const div = loadD(row.sym); let divSum = 0;
  if (div) for (const [dd, amt] of Object.entries(div.dividends)) { const dm = ms(dd); if (dm > d0 && dm <= d1) divSum += amt; }
  const tr = Math.pow((p1 + divSum) / p0, 1 / 3) - 1; if (!Number.isFinite(tr)) continue;
  panel.push({ sym: row.sym, origin: Y, tr, bp: row.B0 / row.price, icc: row.icc_ri, size: Math.log(row.mcap) }); }
console.log("panel rows:", panel.length);

// ---------- OLS + cluster SE (same as r3-incremental) ----------
function ols(X, y) { const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
  const beta = new Array(k); for (let r = k - 1; r >= 0; r--) { let s = A[r][k]; for (let q = r + 1; q < k; q++) s -= A[r][q] * beta[q]; beta[r] = s / A[r][r]; }
  return { beta, n, k, XtX }; }
function invert(M) { const k = M.length; const A = M.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    const pv = A[c][c]; for (let q = 0; q < 2 * k; q++) A[c][q] /= pv;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let q = 0; q < 2 * k; q++) A[r][q] -= f * A[c][q]; } }
  return A.map(row => row.slice(k)); }
function mulMat(A, B) { const k = A.length; const C = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { let s = 0; for (let q = 0; q < k; q++) s += A[i][q] * B[q][j]; C[i][j] = s; } return C; }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const q = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return z >= 0 ? 1 - q : q; }
function fitS3(rows) { const X = rows.map(r => [1, r.bp, r.icc, r.size]); const y = rows.map(r => r.tr);
  const fit = ols(X, y); if (!fit) return null;
  const resid = y.map((yi, i) => yi - X[i].reduce((a, x, j) => a + x * fit.beta[j], 0));
  const meat = Array.from({ length: fit.k }, () => new Array(fit.k).fill(0));
  const byOrigin = {}; rows.forEach((r, i) => (byOrigin[r.origin] ??= []).push(i));
  for (const idxs of Object.values(byOrigin)) { const gk = new Array(fit.k).fill(0);
    for (const i of idxs) for (let a = 0; a < fit.k; a++) gk[a] += X[i][a] * resid[i];
    for (let a = 0; a < fit.k; a++) for (let b = 0; b < fit.k; b++) meat[a][b] += gk[a] * gk[b]; }
  const inv = invert(fit.XtX); if (!inv) return null;
  const prod = mulMat(mulMat(inv, meat), inv);
  const se = prod.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  const iccIdx = 2; const t = se[iccIdx] > 0 ? fit.beta[iccIdx] / se[iccIdx] : null;
  return { icc_beta: r6(fit.beta[iccIdx]), tstat: t != null ? r6(t) : null, pval: t != null ? r6(2 * (1 - normCdf(Math.abs(t)))) : null, n: fit.n }; }

// ---------- (a) survivorship bound: per-symbol appreciation, drop top quintile ----------
const symAppr = {};
for (const sym of Object.keys(priceCache)) { const pc = priceCache[sym]; if (!pc) continue;
  const dates = Object.keys(pc.closes).sort(); if (dates.length < 2) continue;
  const lo = pc.closes[dates[0]], hi = pc.closes[dates[dates.length - 1]];
  if (lo > 0) symAppr[sym] = hi / lo; }
const apprVals = Object.values(symAppr).sort((a, b) => a - b);
const q80 = apprVals[Math.floor(apprVals.length * 0.8)];
const topAppr = new Set(Object.entries(symAppr).filter(([, v]) => v >= q80).map(([s]) => s));
const panelBounded = panel.filter(r => !topAppr.has(r.sym));
const s3Full = fitS3(panel);
const s3Bounded = fitS3(panelBounded);
console.log("(a) survivorship bound: dropped", topAppr.size, "top-appreciation symbols");
console.log("    S3 full    :", JSON.stringify(s3Full));
console.log("    S3 bounded :", JSON.stringify(s3Bounded));

// ---------- (b) bi-dimensional leg: ICC high-vs-low within B/P terciles ----------
function biDim(rows) {
  const byOrigin = {}; rows.forEach(r => (byOrigin[r.origin] ??= []).push(r));
  const spreads = []; const perOrigin = {};
  for (const [o, rs] of Object.entries(byOrigin)) {
    const bpSorted = [...rs].sort((a, b) => a.bp - b.bp);
    const terc = [bpSorted.slice(0, Math.floor(bpSorted.length / 3)),
      bpSorted.slice(Math.floor(bpSorted.length / 3), Math.floor(2 * bpSorted.length / 3)),
      bpSorted.slice(Math.floor(2 * bpSorted.length / 3))];
    const tSpreads = [];
    for (const g of terc) { if (g.length < 6) continue;
      const iccSorted = [...g].sort((a, b) => a.icc - b.icc);
      const half = Math.floor(iccSorted.length / 2); if (half < 3) continue;
      const low = iccSorted.slice(0, half), high = iccSorted.slice(iccSorted.length - half);
      const mh = high.reduce((a, r) => a + r.tr, 0) / high.length, ml = low.reduce((a, r) => a + r.tr, 0) / low.length;
      tSpreads.push(mh - ml); }
    if (tSpreads.length) { const s = tSpreads.reduce((a, b) => a + b, 0) / tSpreads.length; spreads.push(s); perOrigin[o] = r6(s); } }
  const n = spreads.length; const mean = spreads.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(spreads.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  return { mean_spread: r6(mean), tstat: t != null ? r6(t) : null, n_origins: n, per_origin: perOrigin,
    positive_origins: spreads.filter(s => s > 0).length }; }
const bd = biDim(panel);
console.log("(b) bi-dimensional:", JSON.stringify({ mean_spread: bd.mean_spread, tstat: bd.tstat, n_origins: bd.n_origins, positive_origins: bd.positive_origins }));
console.log("    per-origin:", JSON.stringify(bd.per_origin));

// ---------- (c) agreement / disagreement ----------
const legA = s3Bounded.icc_beta != null && s3Bounded.tstat != null && s3Bounded.icc_beta > 0 && Math.abs(s3Bounded.tstat) >= 2;
const legB = bd.mean_spread != null && bd.mean_spread > 0 && bd.tstat != null && Math.abs(bd.tstat) >= 2;
const agree = legA === legB;
const verdict = legA && legB ? "ROBUST_INCREMENTAL" : (!legA && !legB ? "NOT_ROBUST" : "MIXED_LEGS_DISAGREE");
console.log("(c) legA(bounded S3 sig):", legA, "legB(biDim sig):", legB, "-> verdict:", verdict);

const out = { schema_version: "feno_rim_recovery_r3_robustness.v1", phase: "R3-robustness", research_only: true,
  note: "Red-team fh-20260807-096 pre-committed robustness: survivorship bound + bi-dimensional leg.",
  panel_rows: panel.length, dropped_top_appreciation: topAppr.size, bounded_rows: panelBounded.length,
  survivorship_bound: { s3_full: s3Full, s3_bounded: s3Bounded },
  bi_dimensional: bd,
  verdict: { legA_bounded_S3_significant: legA, legB_biDim_significant: legB, agreement: agree, label: verdict },
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R3_ROBUSTNESS.json"), JSON.stringify(out, null, 1) + "\n");
console.log("\nVERDICT:", verdict);
