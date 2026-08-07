// R3 incremental-information test: does mechanical-forecast GLS-ICC carry 36m forward-return
// information beyond B/P (+size, +momentum)? Bound to r3-criteria.json (sha below).
// Fama-MacBeth across 5 origins (thin, reported) + pooled origin-FE with origin-cluster SEs
// (higher power). All four specs reported; no post-result selection.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const CRIT_PATH = "data/computed/feno-rim-recovery/r3-criteria.json";
const RESULT = "data/computed/feno-rim-recovery/R3_INCREMENTAL.json";
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const ORIGINS = [2019, 2020, 2021, 2022, 2023];
const FROZEN_SHA = "33f06ab1e888b8b7bc297516c7c6bba211e0e5bc28f8c6d9998d35d110d84ceb";
if (crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, CRIT_PATH))).digest("hex") !== FROZEN_SHA) { console.error("ABORT: criteria sha mismatch"); process.exit(3); }
if (fs.existsSync(path.join(ROOT, RESULT))) { console.error("ABORT: result exists"); process.exit(3); }

// ---------- caches ----------
const priceCache = {}, divCache = {};
function loadP(sym) { if (!priceCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/prices/" + sym + ".json"); priceCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return priceCache[sym]; }
function loadD(sym) { if (!divCache[sym]) { const p = path.join(ROOT, "data/edgar/r3-panel/dividends/" + sym + ".json"); divCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return divCache[sym]; }
function closeAt(sym, targetISO) { const pc = loadP(sym); if (!pc) return null;
  const dates = Object.keys(pc.closes).filter(d => d <= targetISO).sort(); const d = dates.at(-1);
  if (!d) return null; if (ms(targetISO) - ms(d) > 16 * DAY) return null; return pc.closes[d]; }

// ---------- OLS ----------
function ols(X, y) { const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
  const beta = new Array(k);
  for (let r = k - 1; r >= 0; r--) { let s = A[r][k]; for (let q = r + 1; q < k; q++) s -= A[r][q] * beta[q]; beta[r] = s / A[r][r]; }
  // invert XtX for cluster-robust covariance
  const inv = invert(XtX); if (!inv) return null;
  return { beta, n, k, inv }; }
function invert(M) { const k = M.length; const A = M.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    const pv = A[c][c]; for (let q = 0; q < 2 * k; q++) A[c][q] /= pv;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let q = 0; q < 2 * k; q++) A[r][q] -= f * A[c][q]; } }
  return A.map(row => row.slice(k)); }
function matVec(M, v) { return M.map(row => row.reduce((a, m, j) => a + m * v[j], 0)); }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const q = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return z >= 0 ? 1 - q : q; }

// ---------- build the R3 panel ----------
const r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json");
const panel = []; const diag = { rows_r2: r2.rows.length, dropped_no_return: 0, dropped_no_price: 0, kept: 0, with_momentum: 0 };
for (const row of r2.rows) {
  if (row.icc_ri == null) continue;
  const origin = row.origin, Y = origin;
  const o0 = `${Y}-06-30`, o1 = `${Y + 3}-06-30`;
  const p0 = closeAt(row.sym, o0); if (p0 == null) { diag.dropped_no_price++; continue; }
  const p1 = closeAt(row.sym, o1); if (p1 == null) { diag.dropped_no_return++; continue; }
  const d0 = ms(o0), d1 = ms(o1);
  const div = loadD(row.sym); let divSum = 0;
  if (div) for (const [dd, amt] of Object.entries(div.dividends)) { const dm = ms(dd); if (dm > d0 && dm <= d1) divSum += amt; }
  const tr = Math.pow((p1 + divSum) / p0, 1 / 3) - 1; // annualized total return over 36m
  if (!Number.isFinite(tr)) { diag.dropped_no_return++; continue; }
  const bp = row.B0 / row.price;
  const size = Math.log(row.mcap);
  // momentum 12-1
  let mom = null;
  const mDate = (shift) => { const dt = new Date(Date.UTC(Y, 5, 30)); dt.setUTCDate(dt.getUTCDate() - shift); return dt.toISOString().slice(0, 10); };
  const pm1 = closeAt(row.sym, mDate(30)), pm12 = closeAt(row.sym, mDate(365));
  if (pm1 != null && pm12 != null && pm12 > 0) mom = pm1 / pm12 - 1;
  if (mom != null) diag.with_momentum++;
  diag.kept++;
  panel.push({ sym: row.sym, origin, tr, bp, icc: row.icc_ri, icc_ep: row.icc_ep, size, mom }); }
console.log("R3 panel:", JSON.stringify(diag));

// ---------- specs ----------
const SPECS = {
  S1: ["bp"], S2: ["bp", "icc"], S3: ["bp", "icc", "size"], S4: ["bp", "icc", "size", "mom"] };
function designMatrix(rows, vars) { return rows.map(r => [1, ...vars.map(v => r[v])]); }
function fitSpec(rows, vars) { const X = designMatrix(rows, vars); const y = rows.map(r => r.tr);
  const fit = ols(X, y); if (!fit) return null;
  // origin-cluster-robust covariance: V = inv(X'X) * (sum_g X_g' e_g e_g' X_g) * inv(X'X)
  const resid = y.map((yi, i) => yi - X[i].reduce((a, x, j) => a + x * fit.beta[j], 0));
  const meat = Array.from({ length: fit.k }, () => new Array(fit.k).fill(0));
  const byOrigin = {}; rows.forEach((r, i) => (byOrigin[r.origin] ??= []).push(i));
  for (const idxs of Object.values(byOrigin)) {
    const gk = new Array(fit.k).fill(0);
    for (const i of idxs) for (let a = 0; a < fit.k; a++) gk[a] += X[i][a] * resid[i];
    for (let a = 0; a < fit.k; a++) for (let b = 0; b < fit.k; b++) meat[a][b] += gk[a] * gk[b]; }
  // cluster-robust covariance: V = inv(X'X) * meat * inv(X'X)
  const prod = mulMat(mulMat(fit.inv, meat), fit.inv);
  const se = prod.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  const tstat = fit.beta.map((b, i) => se[i] > 0 ? b / se[i] : null);
  const pval = tstat.map(t => t != null ? 2 * (1 - normCdf(Math.abs(t))) : null);
  return { beta: fit.beta.map(r6), se: se.map(r6), tstat: tstat.map(r6), pval: pval.map(r6), n: fit.n, clusters: Object.keys(byOrigin).length, vars: ["const", ...vars] }; }
function mulMat(A, B) { const k = A.length; const C = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { let s = 0; for (let q = 0; q < k; q++) s += A[i][q] * B[q][j]; C[i][j] = s; } return C; }

const results = { pooled: {}, fama_macbeth: {} };
for (const [spec, vars] of Object.entries(SPECS)) {
  let rows = panel;
  if (spec === "S4") rows = panel.filter(r => r.mom != null); // momentum-available
  rows = rows.filter(r => vars.every(v => r[v] != null && Number.isFinite(r[v])));
  results.pooled[spec] = fitSpec(rows, vars);
  results.pooled[spec].rows = rows.length;
  // Fama-MacBeth
  const perOrigin = []; const byOrigin = {}; rows.forEach(r => (byOrigin[r.origin] ??= []).push(r));
  for (const [o, rs] of Object.entries(byOrigin)) { const f = fitSpec(rs, vars); if (f) perOrigin.push(f); }
  const names = ["const", ...vars];
  const fm = names.map((nm, j) => { const bs = perOrigin.map(f => f.beta[j]).filter(Number.isFinite);
    const T = bs.length; if (!T) return null; const mean = bs.reduce((a, b) => a + b, 0) / T;
    if (T < 2) return { mean: r6(mean), tstat: null, n: T };
    const sd = Math.sqrt(bs.reduce((a, b) => a + (b - mean) ** 2, 0) / (T - 1));
    // NW lag1 for FM
    const x = bs.map(b => b - mean); let g = 0;
    for (let i = 0; i < T; i++) for (let k = 0; k < T; k++) { const d = Math.abs(i - k); if (d <= 1) g += (1 - d / 2) * x[i] * x[k]; }
    const se = Math.sqrt(Math.max(g / (T * T), 0)); const t = se > 0 ? mean / se : null;
    return { mean: r6(mean), tstat: t != null ? r6(t) : null, pval: t != null ? r6(2 * (1 - normCdf(Math.abs(t)))) : null, n: T }; });
  results.fama_macbeth[spec] = { vars: names, coefficients: Object.fromEntries(names.map((nm, j) => [nm, fm[j]])), origins_used: perOrigin.length }; }

// ---------- verdict ----------
const iccIdx = (spec) => results.pooled[spec].vars.indexOf("icc");
function sig(read, spec) { const i = iccIdx(spec); if (i == null || !read) return null;
  const t = read.tstat[i]; return t != null ? Math.abs(t) >= 2 : null; }
const s2 = results.pooled.S2, s3 = results.pooled.S3, s4 = results.pooled.S4;
const fm2 = results.fama_macbeth.S2.coefficients.icc, fm3 = results.fama_macbeth.S3.coefficients.icc;
const pooledSigS2 = sig(s2, "S2"), pooledSigS3 = sig(s3, "S3");
const iccBetaS2 = s2 ? s2.beta[iccIdx("S2")] : null, iccBetaS3 = s3 ? s3.beta[iccIdx("S3")] : null;
const fmSignS2 = fm2?.mean != null ? Math.sign(fm2.mean) : null, fmSignS3 = fm3?.mean != null ? Math.sign(fm3.mean) : null;
const posS2 = iccBetaS2 > 0 && pooledSigS2 === true && fmSignS2 === 1;
const posS3 = iccBetaS3 > 0 && pooledSigS3 === true && fmSignS3 === 1;
const s4sign = s4 && iccIdx("S4") != null && s4.beta[iccIdx("S4")] != null ? Math.sign(s4.beta[iccIdx("S4")]) : null;
let verdict = "icc_incremental_none";
if (posS2 && posS3 && (s4sign === 1 || s4sign === null)) verdict = "icc_incremental_positive";
else if (iccBetaS3 != null && iccBetaS3 < 0 && sig(s3, "S3") === true && fmSignS3 === -1) verdict = "icc_incremental_negative";

const out = { schema_version: "feno_rim_recovery_r3_incremental.v1", phase: "R3", research_only: true,
  criteria_sha256: FROZEN_SHA, diag,
  results, verdict: { label: verdict, icc_beta_S2: iccBetaS2, icc_beta_S3: iccBetaS3,
    pooled_t_S2: s2?.tstat?.[iccIdx("S2")], pooled_t_S3: s3?.tstat?.[iccIdx("S3")],
    fm_icc_S2: fm2, fm_icc_S3: fm3, s4_sign: s4sign,
    note: "pooled origin-FE with origin-cluster SEs is the higher-power read; FM across 5 origins is thin and reported transparently." },
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, RESULT), JSON.stringify(out, null, 1) + "\n");
console.log("\n== R3 SUMMARY ==");
for (const spec of Object.keys(SPECS)) { const p = results.pooled[spec]; if (!p) { console.log(spec, "no fit"); continue; }
  const i = iccIdx(spec);
  console.log(`${spec} pooled: icc_beta ${i != null ? p.beta[i] : "-"} (t ${i != null ? p.tstat[i] : "-"}, p ${i != null ? p.pval[i] : "-"}) n=${p.rows}`);
  const fm = results.fama_macbeth[spec].coefficients.icc;
  console.log(`      FM: icc mean ${fm?.mean} t ${fm?.tstat} p ${fm?.pval} n=${fm?.n}`); }
console.log("\nVERDICT:", verdict);
