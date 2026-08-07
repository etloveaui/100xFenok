// R3-S5 (red-team fh-20260807-098, the deciding spec): separate the RIM structure from the
// mechanical forecast earnings yield it is built on. ICC is solved from FEPS and price, so it is
// mechanically close to "forecast earnings yield adjusted for book and payout". The competing
// explanation for R3 is that FEPS1/price predicts returns and ICC is that ratio wearing a
// residual-income coat. Controlling B/P does not touch it (B/P is a book yield; corr(ICC,BP)=0.446).
// S5: tr ~ 1 + bp + FEPS1/price + icc. If ICC survives controlling the mechanical FY1 forecast
// yield, the RIM structure earned its keep. If not, R3 reduces to "forecast earnings yield
// predicts returns" (no residual-income machinery needed).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const priceCache = {}, divCache = {};
function loadP(sym) { if (!priceCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/prices/" + sym + ".json"); priceCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return priceCache[sym]; }
function loadD(sym) { if (!divCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/dividends/" + sym + ".json"); divCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return divCache[sym]; }
function closeAt(sym, targetISO) { const pc = loadP(sym); if (!pc) return null; const dates = Object.keys(pc.closes).filter(d => d <= targetISO).sort(); const d = dates.at(-1); if (!d) return null; if (ms(targetISO) - ms(d) > 16 * DAY) return null; return pc.closes[d]; }

// FEPS1 = R1 tau=1 RI-path forecast per (sym, origin)
const r1 = rj("data/computed/feno-rim-recovery/r1-edgar-panel.json");
const feps1 = {}; for (const row of r1.rows) if (row.tau === 1 && row.ri != null) feps1[row.sym + "|" + row.origin] = row.ri;

// rebuild R3 panel (identical to r3-incremental.mjs) and attach FEPS1/price
const r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json");
const panel = []; let dropped_no_feps = 0;
for (const row of r2.rows) {
  if (row.icc_ri == null) continue;
  const Y = row.origin, o0 = `${Y}-06-30`, o1 = `${Y + 3}-06-30`;
  const p0 = closeAt(row.sym, o0), p1 = closeAt(row.sym, o1); if (p0 == null || p1 == null) continue;
  const d0 = ms(o0), d1 = ms(o1); const div = loadD(row.sym); let divSum = 0;
  if (div) for (const [dd, amt] of Object.entries(div.dividends)) { const dm = ms(dd); if (dm > d0 && dm <= d1) divSum += amt; }
  const tr = Math.pow((p1 + divSum) / p0, 1 / 3) - 1; if (!Number.isFinite(tr)) continue;
  const f1 = feps1[row.sym + "|" + Y]; if (f1 == null) { dropped_no_feps++; continue; }
  panel.push({ sym: row.sym, origin: Y, tr, bp: row.B0 / row.price, icc: row.icc_ri, feps_yield: f1 / row.price }); }
console.log("S5 panel rows:", panel.length, "dropped_no_feps:", dropped_no_feps);

// OLS + origin-cluster SE
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
function fitPooled(rows, vars) { const X = rows.map(r => [1, ...vars.map(v => r[v])]); const y = rows.map(r => r.tr);
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
  const names = ["const", ...vars];
  const out = Object.fromEntries(names.map((nm, j) => [nm, { beta: r6(fit.beta[j]), se: r6(se[j]),
    tstat: se[j] > 0 ? r6(fit.beta[j] / se[j]) : null, pval: se[j] > 0 ? r6(2 * (1 - normCdf(Math.abs(fit.beta[j] / se[j])))) : null }]));
  out.n = fit.n; return out; }
function fitPerOrigin(rows, vars) { const byOrigin = {}; rows.forEach(r => (byOrigin[r.origin] ??= []).push(r));
  const out = {}; for (const [o, rs] of Object.entries(byOrigin)) {
    const X = rs.map(r => [1, ...vars.map(v => r[v])]); const y = rs.map(r => r.tr);
    const fit = ols(X, y); if (fit) out[o] = Object.fromEntries(["const", ...vars].map((nm, j) => [nm, r6(fit.beta[j])])); }
  return out; }

// correlations
const corr = (a, b) => { const n = a.length; const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return num / Math.sqrt(da * db); };
console.log("corr(icc, feps_yield):", corr(panel.map(r => r.icc), panel.map(r => r.feps_yield)).toFixed(3));
console.log("corr(feps_yield, tr):", corr(panel.map(r => r.feps_yield), panel.map(r => r.tr)).toFixed(3));
console.log("corr(bp, feps_yield):", corr(panel.map(r => r.bp), panel.map(r => r.feps_yield)).toFixed(3));

// S2 (bp + icc) vs S5 (bp + feps_yield + icc)
const varsS2 = ["bp", "icc"], varsS5 = ["bp", "feps_yield", "icc"];
const s2 = fitPooled(panel, varsS2), s5 = fitPooled(panel, varsS5);
const poS2 = fitPerOrigin(panel, varsS2), poS5 = fitPerOrigin(panel, varsS5);
const fm = (po, v) => { const bs = Object.values(po).map(r => r[v]).filter(Number.isFinite); const T = bs.length;
  const mean = bs.reduce((a, b) => a + b, 0) / T;
  const sd = T > 1 ? Math.sqrt(bs.reduce((a, b) => a + (b - mean) ** 2, 0) / (T - 1)) : 0;
  return { mean: r6(mean), sd: r6(sd), n: T, per_origin: Object.fromEntries(Object.entries(po).map(([o, r]) => [o, r[v]])) }; };
console.log("\nS2 (bp+icc) pooled icc:", JSON.stringify(s2.icc), "FM:", JSON.stringify(fm(poS2, "icc")));
console.log("S5 (bp+feps_yield+icc) pooled:");
console.log("   icc:", JSON.stringify(s5.icc));
console.log("   feps_yield:", JSON.stringify(s5.feps_yield));
console.log("   bp:", JSON.stringify(s5.bp));
console.log("   FM icc:", JSON.stringify(fm(poS5, "icc")));
console.log("   FM feps_yield:", JSON.stringify(fm(poS5, "feps_yield")));

const out = { schema_version: "feno_rim_recovery_r3_s5.v1", phase: "R3-S5", research_only: true,
  note: "Red-team fh-20260807-098 deciding spec: separate RIM structure from the mechanical forecast earnings yield it is built on. FEPS1 = R1 tau=1 RI-path forecast.",
  panel_rows: panel.length, dropped_no_feps,
  correlations: { icc_feps_yield: r6(corr(panel.map(r => r.icc), panel.map(r => r.feps_yield))),
    feps_yield_tr: r6(corr(panel.map(r => r.feps_yield), panel.map(r => r.tr))),
    bp_feps_yield: r6(corr(panel.map(r => r.bp), panel.map(r => r.feps_yield))) },
  S2_bp_icc: { pooled_icc: s2.icc, fm_icc: fm(poS2, "icc") },
  S5_bp_fepsyield_icc: { pooled_icc: s5.icc, pooled_feps_yield: s5.feps_yield, pooled_bp: s5.bp,
    fm_icc: fm(poS5, "icc"), fm_feps_yield: fm(poS5, "feps_yield") },
  significance_note: "Effective independent observations ~2 (5 origins, 36m windows overlap 24/36 months). No t-stat on 5 overlapping origins is meaningful; point estimates + decoupling robustness are reported, significance is not establishable at this T.",
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R3_S5.json"), JSON.stringify(out, null, 1) + "\n");
console.log("\nS5 written. ICC survives controlling FEPS1/price?",
  s5.icc.beta > 0 && Math.abs(s5.icc.tstat) >= 2 ? "YES (significant)" : (s5.icc.beta > 0 ? "positive but significance not establishable at T=5" : "NO"));
