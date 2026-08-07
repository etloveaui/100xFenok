// R0-CORRECTED: X2/R0 re-run on unit-consistent market caps.
// Frozen criteria: data/computed/feno-rim-recovery/r0-criteria-v3.json
//   sha256 f721c73b0a3ee1002e8acfbe227c8082f33e4896f56c5c57a4371c7533f60c60 (commit ccb76949e7 lineage)
// Only input change vs r0-adjudication-v2.mjs: shares_corrected = shares x F,
// F = product of splits dated strictly after the period_end of the EDGAR share
// fact used for that cell. V construction, returns, filters, sets, statistics
// and verdict mapping are verbatim.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sha256str = (s) => crypto.createHash("sha256").update(s).digest("hex");
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5, H = 3, FADE = 3, TERM = 10;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
const CRIT_PATH = "data/computed/feno-rim-recovery/r0-criteria-v3.1.json";
const FROZEN_SHA = "3f71fceaefb22eeaccab49b6125475d7847bd64891ba2a65852f2c4174bacf7f";
const SEED = 20260807;

// ---------- integrity gates ----------
if (sha256(path.join(ROOT, CRIT_PATH)) !== FROZEN_SHA) { console.error("ABORT: v3 criteria changed since freeze"); process.exit(3); }
for (const p of rj(CRIT_PATH).planned_result_paths) {
  if (fs.existsSync(path.join(ROOT, p))) { console.error("ABORT: CORRECTED result path already exists:", p); process.exit(3); } }

// ---------- verbatim x2 primitives ----------
const rank = (v) => { const s = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; let i = 0;
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; const a = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[s[k][1]] = a; i = j + 1; } return r; };
const sp = (x, y) => { if (x.length < 4) return null; const rx = rank(x), ry = rank(y), n = x.length, mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let nu = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; nu += a * b; dx += a * a; dy += b * b; } return dx && dy ? nu / Math.sqrt(dx * dy) : null; };
function riValue(book0, pathArr, ke) { if (!(book0 > 0) || !(ke > 0) || !pathArr.length) return null;
  let v = book0, pb = book0, last = null;
  for (let k = 0; k < pathArr.length; k++) { const { earnings, book } = pathArr[k];
    if (!Number.isFinite(earnings) || !Number.isFinite(book)) return null;
    const ri = earnings - ke * pb; v += ri / (1 + ke) ** (k + 1); pb = book; last = ri; }
  if (last !== null) { const n = pathArr.length;
    for (let k = 1; k <= TERM; k++) v += last * ((TERM - k) / TERM) / (1 + ke) ** (n + k); }
  return v; }
function deployPath(m) { const { book, roe, roe_band: bd } = m;
  if (!(book > 0) || !Number.isFinite(roe)) return null;
  const tgt = Number.isFinite(bd?.low) && Number.isFinite(bd?.high) ? (bd.low + bd.high) / 2 : roe;
  const p = []; let pb = book;
  for (let y = 1; y <= H; y++) { const w = Math.min(1, y / FADE); const r = roe + (tgt - roe) * w; const e = r * pb; const nb = pb + e; p.push({ earnings: e, book: nb }); pb = nb; }
  return p; }

// ---------- RNG / inference (verbatim v2) ----------
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function mbb(v, block, seed, reps = 10000) { if (v.length < 4) return null; const rnd = makeRng(seed);
  const d = []; for (let r = 0; r < reps; r++) { const b = []; while (b.length < v.length) { const st = Math.floor(rnd() * v.length);
    for (let k = 0; k < block && b.length < v.length; k++) b.push(v[(st + k) % v.length]); }
    d.push(b.reduce((a, x) => a + x, 0) / b.length); }
  d.sort((a, b) => a - b);
  return { mean: r6(d.reduce((a, x) => a + x, 0) / d.length), ci_lower: r6(d[Math.floor(d.length * 0.025)]), ci_upper: r6(d[Math.floor(d.length * 0.975)]),
    reps: d.length, block, seed, independent_blocks: Math.floor(v.length / block),
    degenerate_note: block >= Math.floor(v.length * 2 / 3) ? "block >= 2T/3: sensitivity only (ISSUE 3)" : undefined }; }
function acf1(v) { const T = v.length, m = v.reduce((a, x) => a + x, 0) / T;
  let num = 0, den = 0; for (let i = 0; i < T; i++) den += (v[i] - m) ** 2;
  for (let i = 1; i < T; i++) num += (v[i] - m) * (v[i - 1] - m);
  return den ? num / den : 0; }
function essInference(v) { const T = v.length; if (T < 5) return null;
  const m = v.reduce((a, x) => a + x, 0) / T;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (T - 1));
  const rho = acf1(v);
  const ess = Math.max(3, Math.min(T, T * (1 - rho) / (1 + rho)));
  const half = 1.96 * sd / Math.sqrt(ess);
  return { T, rho1: r6(rho), ess: r6(ess), mean: r6(m), sd: r6(sd), ci_lower: r6(m - half), ci_upper: r6(m + half), mde: r6(half) }; }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const q = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - q : q; }
function nwMean(v, lag) { const T = v.length; if (T < 5) return null;
  const m = v.reduce((a, x) => a + x, 0) / T; const x = v.map(a => a - m);
  let g = 0; for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
    const d = Math.abs(i - j); if (d <= lag) g += (1 - d / (lag + 1)) * x[i] * x[j]; }
  const se = Math.sqrt(Math.max(g / (T * T), 0));
  if (!(se > 0)) return { mean: r6(m), se: 0, t: null, p: null, lag, T };
  const t = m / se; return { mean: r6(m), se: r6(se), t: r6(t), p: r6(2 * (1 - normCdf(Math.abs(t)))), lag, T }; }
const TCrit = { 34: 2.0345, 18: 2.1098 };
function ols(X, y) { const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
  const beta = new Array(k);
  for (let r = k - 1; r >= 0; r--) { let s = A[r][k]; for (let q = r + 1; q < k; q++) s -= A[r][q] * beta[q]; beta[r] = s / A[r][r]; }
  return beta; }
function olsWithSe(X, y) { const beta = ols(X, y); if (!beta) return null;
  const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
  const A = XtX.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    const pv = A[c][c]; for (let q = 0; q < 2 * k; q++) A[c][q] /= pv;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let q = 0; q < 2 * k; q++) A[r][q] -= f * A[c][q]; } }
  const inv = A.map(row => row.slice(k));
  const resid = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  const ssr = resid.reduce((s, e) => s + e * e, 0); const sigma2 = ssr / (n - k);
  const se = inv.map((_, j) => Math.sqrt(Math.max(sigma2 * inv[j][j], 0)));
  return { beta, se }; }

// ---------- share-fact recovery (v3.1 value-anchored) + split correction ----------
// v3.1 value-anchored recovery: basis date = latest fact date whose val equals the
// panel's own shares value with date <= origin and filed <= origin. The panel is what
// X2 consumed; the builder script drifted after panel generation, so the panel value,
// not a re-run of the current builder rule, anchors the basis date.
const sharesRawCache = {};
function findShareBasis(sym, sharesVal, t0) {
  if (!sharesRawCache[sym]) {
    const cache = rj("data/edgar/rim-dow/" + sym + ".json").concepts;
    sharesRawCache[sym] = [...(cache.EntityCommonStockSharesOutstanding ?? []), ...(cache.SharesFallback ?? [])]
      .filter(r => Number.isFinite(r.val) && (r.start ?? r.end))
      .map(r => ({ ms: ms(r.start ?? r.end), date: r.start ?? r.end, val: r.val, filed: ms(r.filed) })); }
  let basis = null;
  for (const f of sharesRawCache[sym]) {
    if (f.val === sharesVal && f.ms <= t0 && f.filed <= t0 && (basis === null || f.ms > basis.ms)) basis = f; }
  return basis; }
const splitCache = {};
function splitFactorAfter(sym, afterMs) {
  if (!splitCache[sym]) splitCache[sym] = Object.entries(rj("data/yf/finance/" + sym + ".json").data.splits ?? {})
    .map(([d, f]) => ({ ms: ms(d), f })).sort((a, b) => a.ms - b.ms);
  let F = 1; for (const s of splitCache[sym]) if (s.ms > afterMs) F *= s.f;
  return F; }

// ---------- rebuild panel ----------
const panel = rj("data/computed/feno-rim-v2/e2-basket-panel.json");
const audit = rj("data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json");
const rates = rj("data/macro/fred-banking-daily.json").series.DGS10;
const erp = rj("data/computed/feno-rim-v2/erp-archive-restoration.json").observations
  .map(o => ({ t: ms(o.first_knowable), us: o.us_erp })).sort((a, b) => a.t - b.t);
const complete = new Set(audit.p0_adjudications.p0_3_baseline_truncation.evidence.e2_baseline_windows
  .window_rows_per_origin.filter(w => w.years >= 9.5).map(w => w.as_of));
const px = {}, dv = {};
for (const f of fs.readdirSync(path.join(ROOT, "data/yf/finance"))) {
  if (!f.endsWith(".unadjusted.json")) continue; const s = f.replace(".unadjusted.json", "");
  const d = rj("data/yf/finance/" + f).data;
  px[s] = (d.history_unadjusted || []).map(r => ({ t: ms(r.date), c: r.Close })).sort((a, b) => a.t - b.t);
  dv[s] = Object.entries(d.dividends || {}).map(([k, v]) => ({ t: ms(k), a: v })).sort((a, b) => a.t - b.t); }
const atIdx = (a, t) => { let f = -1; for (let i = 0; i < a.length; i++) { if (a[i].t <= t) f = i; else break; } return f; };

const origins = []; let droppedMismatch = 0, correctedCells = 0, totalCells = 0; const fBySymbol = {};
for (const o of panel.origin_rows) {
  const t0 = ms(o.as_of), t1 = t0 + 36 * 30.44 * DAY;
  let rate = null; for (const r of rates) { if (r.date <= o.as_of) rate = r; else break; }
  const pe = erp.filter(x => x.t <= t0).at(-1);
  if (!rate || !pe) continue;
  const ke = rate.value * 0.01 + pe.us, rf0 = rate.value * 0.01;
  const members = [];
  for (const m of o.members) {
    if (!m.ok || !(m.book > 0) || !(m.price > 0) || !(m.shares > 0) || !Number.isFinite(m.roe)) continue;
    const p = px[m.symbol]; if (!p?.length) continue;
    const ia = atIdx(p, t0), ib = atIdx(p, t1);
    const a = ia >= 0 ? p[ia] : null, b = ib >= 0 ? p[ib] : null;
    if (!a || !b || t0 - a.t > 45 * DAY || t1 - b.t > 45 * DAY) continue;
    const dp = deployPath(m); const V = dp ? riValue(m.book, dp, ke) : null;
    if (!Number.isFinite(V) || V <= 0) continue;
    // --- share-basis correction (v3.1 pre-committed rule, value-anchored) ---
    const basis = findShareBasis(m.symbol, m.shares, t0);
    if (basis === null) { droppedMismatch++; continue; }
    const F = splitFactorAfter(m.symbol, basis.ms);
    totalCells++; if (F !== 1) correctedCells++;
    fBySymbol[m.symbol] = fBySymbol[m.symbol] || []; if (F !== 1) fBySymbol[m.symbol].push({ as_of: o.as_of, F, shares_basis: basis.date });
    const sharesCorr = m.shares * F, mcapCorr = m.price * sharesCorr;
    const mcapPub = m.price * m.shares;
    const div = (dv[m.symbol] || []).filter(x => x.t > t0 && x.t <= t1).reduce((s, x) => s + x.a, 0);
    const tr = Math.pow((b.c + div) / a.c, 1 / 3) - 1;
    let mom = null; if (ia >= 252) mom = p[ia - 21].c / p[ia - 252].c - 1;
    members.push({ symbol: m.symbol, F: r6(F), vp_pub: V / mcapPub, bp_pub: m.book / mcapPub,
      vp: V / mcapCorr, bp: m.book / mcapCorr, ret: tr, exc: tr - rf0, mcap: mcapCorr, mcap_pub: mcapPub,
      size: Math.log(mcapCorr), mom, shares_basis: basis.date }); }
  if (members.length < 20) continue;
  const icV_pub = sp(members.map(x => x.vp_pub), members.map(x => x.ret));
  const icB_pub = sp(members.map(x => x.bp_pub), members.map(x => x.ret));
  const icV = sp(members.map(x => x.vp), members.map(x => x.ret));
  const icB = sp(members.map(x => x.bp), members.map(x => x.ret));
  if (icV === null || icB === null) continue;
  origins.push({ as_of: o.as_of, ke: r6(ke), rf0: r6(rf0), n: members.length,
    ic_vp_pub: r6(icV_pub), ic_bp_pub: r6(icB_pub), ic_vp: r6(icV), ic_bp: r6(icB),
    complete: complete.has(o.as_of), members }); }

// ---------- gates ----------
const x2 = rj("data/computed/feno-rim-v2/RIM_CROSS_SECTIONAL_BOTTOM_UP.json");
const gateErrors = [];
// (a) uncorrected pipeline must reproduce X2 (construction unchanged)
for (let i = 0; i < Math.min(origins.length, x2.per_origin_rows.length); i++) {
  const a = origins[i], b = x2.per_origin_rows[i];
  if (a.as_of !== b.as_of || a.n !== b.n) gateErrors.push(`${a.as_of}: as_of/n mismatch vs X2`);
  if (Math.abs(a.ic_vp_pub - b.ic_vp) > 1e-6 || Math.abs(a.ic_bp_pub - b.ic_bp) > 1e-6) gateErrors.push(`${a.as_of}: published-mode IC mismatch`);
  if (a.complete !== b.complete) gateErrors.push(`${a.as_of}: complete flag mismatch`); }
// (b) unit-consistency assertions (v3.1: JPM/KO are the true no-split controls;
//     MMM 2015 was itself contaminated and is asserted as a corrected cell)
const find = (sym, d) => origins.find(o => o.as_of === d)?.members.find(x => x.symbol === sym);
const aa = find("AAPL", "2015-03-27"), nv = find("NVDA", "2021-03-19");
const jm = find("JPM", "2015-03-27"), ko = find("KO", "2015-03-27"), mm = find("MMM", "2015-03-27");
const near = (v, t, tol) => Math.abs(v - t) <= tol * t;
if (!aa || !near(aa.mcap, 718e9, 0.05)) gateErrors.push(`AAPL 2015 mc ${aa?.mcap} not within 5% of 718B`);
if (!nv || !near(nv.mcap, 319e9, 0.05)) gateErrors.push(`NVDA 2021 mc ${nv?.mcap} not within 5% of 319B`);
for (const [c, exp] of [[jm, 230.2e9], [ko, 177.5e9]]) {
  if (!c || c.F !== 1 || Math.abs(c.mcap - c.mcap_pub) > 1e-6 || !near(c.mcap, exp, 0.03)) gateErrors.push(`no-split control ${c?.symbol} failed`); }
// MMM: spinoff-adjusted correction must land near the true 2015 cap (~103.8B), not the contaminated 88.4B
if (!mm || mm.F === 1 || !near(mm.mcap, 103.8e9, 0.05)) gateErrors.push(`MMM 2015 corrected mc ${mm?.mcap} (F=${mm?.F}) not within 5% of 103.8B`);
if (gateErrors.length) {
  console.error("ABORT: gates failed:\n" + gateErrors.join("\n"));
  fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R0_ADJUDICATION_CORRECTED.json"),
    JSON.stringify({ phase: "R0-CORRECTED", status: "ABORTED_GATE", gate_errors: gateErrors, generated_at: new Date().toISOString() }, null, 2) + "\n");
  process.exit(4); }
console.log("gates PASSED. origins:", origins.length, "corrected cells:", correctedCells, "/", totalCells, "dropped share-recovery mismatches:", droppedMismatch);

const setOf = (flag) => origins.filter(o => flag === "wc" ? o.complete : true);

// ---------- R0-A/B/C/D on CORRECTED ratios (verbatim v2 machinery) ----------
function r0a(set, label) {
  const D = set.map(o => o.ic_vp - o.ic_bp), T = D.length;
  const mean = D.reduce((a, x) => a + x, 0) / T;
  const sorted = [...D].sort((a, b) => a - b);
  const median = T % 2 ? sorted[(T - 1) / 2] : (sorted[T / 2 - 1] + sorted[T / 2]) / 2;
  const sd = Math.sqrt(D.reduce((a, x) => a + (x - mean) ** 2, 0) / (T - 1));
  const tc = TCrit[T] ?? 2;
  return { set: label, T, mean_d: r6(mean), median_d: r6(median), share_positive: r6(D.filter(x => x > 0).length / T),
    primary: { ess_ci: essInference(D), nw_lag11: nwMean(D, 11) },
    sensitivity: { nw_lag2: nwMean(D, 2), naive_paired_ci: { ci_lower: r6(mean - tc * sd / Math.sqrt(T)), ci_upper: r6(mean + tc * sd / Math.sqrt(T)), t_crit: tc },
      block_bootstrap_ci: { b4: mbb(D, 4, SEED), b8: mbb(D, 8, SEED), b12: mbb(D, 12, SEED) } },
    series_D: D.map(r6) }; }
function r0b(set, label) {
  const partial = [], regOnly = [];
  for (const o of set) {
    const rV = rank(o.members.map(x => x.vp)), rB = rank(o.members.map(x => x.bp));
    const ret = o.members.map(x => x.ret);
    const bV = ols(o.members.map((_, i) => [1, rB[i]]), rV);
    const bR = ols(o.members.map((_, i) => [1, rB[i]]), ret);
    if (!bV || !bR) continue;
    const residV = rV.map((v, i) => v - (bV[0] + bV[1] * rB[i]));
    const residR = ret.map((v, i) => v - (bR[0] + bR[1] * rB[i]));
    const pc = sp(residV, residR);
    const ro = sp(residV, ret);
    if (pc !== null) partial.push({ as_of: o.as_of, partial_ic: r6(pc), n: o.members.length });
    if (ro !== null) regOnly.push({ as_of: o.as_of, resid_ic: r6(ro), n: o.members.length }); }
  const agg = (rows, key, name) => { const v = rows.map(x => x[key]);
    return { statistic: name, T: v.length, mean: r6(v.reduce((a, x) => a + x, 0) / v.length),
      share_positive: r6(v.filter(x => x > 0).length / v.length),
      primary: { ess_ci: essInference(v), nw_lag11: nwMean(v, 11) },
      sensitivity: { nw_lag2: nwMean(v, 2), block_bootstrap_ci: { b4: mbb(v, 4, SEED), b8: mbb(v, 8, SEED), b12: mbb(v, 12, SEED) } },
      per_origin: rows }; };
  return { set: label,
    primary_partial_correlation: agg(partial, "partial_ic", "sp(resid_vp, resid_ret) both residualized on rank(B/P)"),
    sensitivity_regressor_only: agg(regOnly, "resid_ic", "sp(resid_vp, ret)") }; }
function r0c(set, label) {
  const m1 = [], m2 = [], m2void = [], inflation = [];
  for (const o of set) {
    const n1 = o.members.length;
    const rB = rank(o.members.map(x => x.bp)), rV = rank(o.members.map(x => x.vp));
    const uB = rB.map(r => (r - 1) / (n1 - 1)), uV = rV.map(r => (r - 1) / (n1 - 1));
    const fit1 = olsWithSe(o.members.map((_, i) => [1, uB[i], uV[i]]), o.members.map(x => x.exc));
    if (fit1) m1.push({ as_of: o.as_of, b2: fit1.beta[2], se_b2: fit1.se[2], n: n1 });
    const sub = o.members.filter(x => Number.isFinite(x.mom));
    if (sub.length < 20) { m2void.push({ as_of: o.as_of, n_m2: sub.length }); continue; }
    const n2 = sub.length;
    const sB = rank(sub.map(x => x.bp)), sV = rank(sub.map(x => x.vp)), sS = rank(sub.map(x => x.size)), sM = rank(sub.map(x => x.mom));
    const u = (r) => (r - 1) / (n2 - 1);
    const fit2 = olsWithSe(sub.map((_, i) => [1, u(sB[i]), u(sV[i]), u(sS[i]), u(sM[i])]), sub.map(x => x.exc));
    if (fit2) { m2.push({ as_of: o.as_of, b2: fit2.beta[2], se_b2: fit2.se[2], n: n2 });
      if (fit1) inflation.push({ as_of: o.as_of, se_ratio_m2_over_m1: r6(fit2.se[2] / fit1.se[2]) }); } }
  const agg = (rows, name) => { const v = rows.map(x => x.b2);
    return { model: name, T: v.length, mean_b2: r6(v.reduce((a, x) => a + x, 0) / v.length),
      share_positive: r6(v.filter(x => x > 0).length / v.length),
      primary: { ess_ci: essInference(v), nw_lag11: nwMean(v, 11) },
      sensitivity: { nw_lag2: nwMean(v, 2), block_bootstrap_ci: { b4: mbb(v, 4, SEED), b8: mbb(v, 8, SEED), b12: mbb(v, 12, SEED) } },
      leave_one_out: (() => { const T = v.length, mean = v.reduce((a, x) => a + x, 0) / T; let mx = 0, flip = false;
        for (let i = 0; i < T; i++) { const m2v = (v.reduce((a, x) => a + x, 0) - v[i]) / (T - 1);
          mx = Math.max(mx, Math.abs(m2v - mean)); if (m2v * mean < 0) flip = true; }
        return { max_abs_delta_mean: r6(mx), sign_flip: flip }; })(),
      series_b2: rows }; };
  return { set: label, model1: agg(m1, "M1"), model2: agg(m2, "M2"), model2_voided: m2void,
    variance_inflation_m2_vs_m1: { mean_se_ratio: inflation.length ? r6(inflation.reduce((a, x) => a + x.se_ratio_m2_over_m1, 0) / inflation.length) : null, per_origin: inflation } }; }
function r0d(set, label, seedBase) {
  const per = [];
  set.forEach((o, idx) => {
    const n = o.members.length;
    const rB = rank(o.members.map(x => x.bp));
    const groups = [[], [], []];
    o.members.forEach((m, i) => { groups[Math.min(2, Math.floor(3 * (rB[i] - 1) / n))].push(m.exc); });
    const obsGroups = [[], [], []];
    o.members.forEach((m, i) => { obsGroups[Math.min(2, Math.floor(3 * (rB[i] - 1) / n))].push(m); });
    const Sobs = (() => { const diffs = [];
      for (const g of obsGroups) { if (g.length < 2) continue;
        const s = [...g].sort((a, b) => a.vp - b.vp);
        const nLow = Math.ceil(s.length / 2); const low = s.slice(0, nLow), high = s.slice(nLow);
        if (!high.length) continue;
        diffs.push(high.reduce((a, x) => a + x.exc, 0) / high.length - low.reduce((a, x) => a + x.exc, 0) / low.length); }
      return diffs.length ? diffs.reduce((a, x) => a + x, 0) / diffs.length : null; })();
    if (Sobs === null) { per.push({ as_of: o.as_of, S: null, p_one_sided: null }); return; }
    const rnd = makeRng(seedBase + idx);
    let ge = 0; const B = 10000;
    for (let r = 0; r < B; r++) {
      const diffs = [];
      for (const g of groups) { if (g.length < 2) continue;
        const arr = [...g];
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        const nLow = Math.ceil(arr.length / 2);
        const low = arr.slice(0, nLow), high = arr.slice(nLow);
        if (!high.length) continue;
        diffs.push(high.reduce((a, x) => a + x, 0) / high.length - low.reduce((a, x) => a + x, 0) / low.length); }
      const S = diffs.length ? diffs.reduce((a, x) => a + x, 0) / diffs.length : null;
      if (S !== null && S >= Sobs) ge++; }
    per.push({ as_of: o.as_of, S: r6(Sobs), p_one_sided: r6((ge + 1) / (B + 1)), reps: B }); });
  const ok = per.filter(x => x.S !== null);
  const S = ok.map(x => x.S);
  const sigCount = ok.filter(x => x.S > 0 && x.p_one_sided < 0.05).length;
  return { set: label, T: ok.length,
    combined_test_primary: { mean_S: r6(S.reduce((a, x) => a + x, 0) / S.length), ess_ci: essInference(S), nw_lag11: nwMean(S, 11) },
    sensitivity: { block_bootstrap_ci: { b4: mbb(S, 4, SEED), b8: mbb(S, 8, SEED), b12: mbb(S, 12, SEED) } },
    per_origin_significance: { count_sig_positive: sigCount, null_expectation: r6(ok.length * 0.05), share_positive_S: r6(ok.filter(x => x.S > 0).length / ok.length) },
    per_origin: per }; }

const A_all = r0a(setOf("all"), "all_origins"), A_wc = r0a(setOf("wc"), "window_complete");
const B_all = r0b(setOf("all"), "all_origins"), B_wc = r0b(setOf("wc"), "window_complete");
const C_all = r0c(setOf("all"), "all_origins"), C_wc = r0c(setOf("wc"), "window_complete");
const D_all = r0d(setOf("all"), "all_origins", SEED), D_wc = r0d(setOf("wc"), "window_complete", SEED + 1000);

// ---------- verdict (verbatim v2 mapping) ----------
function verdict() {
  const cWC = C_wc.model1, cALL = C_all.model1;
  const pWC = B_wc.primary_partial_correlation, pALL = B_all.primary_partial_correlation;
  const eWC = cWC.primary.ess_ci, eALL = cALL.primary.ess_ci;
  const pNW = cWC.primary.nw_lag11;
  const peWC = pWC.primary.ess_ci;
  const disagreement = (cWC.mean_b2 > 0) !== (cALL.mean_b2 > 0) || (pWC.mean > 0) !== (pALL.mean > 0);
  const pos = !disagreement && cWC.mean_b2 > 0 && pNW.p !== null && pNW.p <= 0.05 && eWC.ci_lower > 0 && cALL.mean_b2 > 0
    && pWC.mean > 0 && peWC.ci_lower > 0;
  const neg = !disagreement && cWC.mean_b2 < 0 && pNW.p !== null && pNW.p <= 0.05 && eWC.ci_upper < 0 && cALL.mean_b2 < 0
    && pWC.mean < 0 && peWC.ci_upper < 0;
  const inBand = (ci, lo, hi) => ci && ci.ci_lower >= lo && ci.ci_upper <= hi;
  const zero = inBand(eWC, -0.01, 0.01) && inBand(eALL, -0.01, 0.01)
    && inBand(pWC.primary.ess_ci, -0.05, 0.05) && inBand(pALL.primary.ess_ci, -0.05, 0.05)
    && inBand(A_wc.primary.ess_ci, -0.05, 0.05) && inBand(A_all.primary.ess_ci, -0.05, 0.05);
  let label = "R0_INCONCLUSIVE";
  if (pos) label = "R0_INCREMENTAL_POSITIVE"; else if (neg) label = "R0_INCREMENTAL_NEGATIVE"; else if (zero) label = "R0_INCREMENTAL_ZERO";
  return { label, disagreement_between_sets: disagreement,
    zero_unreachable: { declared: true, band_b2: 0.01, min_achievable_ci_halfwidth_b2: { all: eALL.mde, wc: eWC.mde } },
    effective_n: { all_origins_ess_b2: eALL.ess, window_complete_ess_b2: eWC.ess },
    regime_span: { all_origins: [origins[0].as_of, origins[origins.length - 1].as_of],
      window_complete: [setOf("wc")[0].as_of, setOf("wc").at(-1).as_of] },
    survivorship_bound: "Current Dow 30 fixed list applied to all origins from 2015; NVDA and SHW joined the index only in 2024." }; }

// ---------- instrument-free 12-phase binomials ----------
function phaseSigns(v) { const out = [];
  for (let p = 0; p < 12; p++) { const s = []; for (let i = p; i < v.length; i += 12) s.push(v[i]);
    if (s.length) out.push(s.reduce((a, x) => a + x, 0) / s.length); }
  return out; }
const b2phAll = phaseSigns(C_all.model1.series_b2.map(x => x.b2));
const b2phWc = phaseSigns(C_wc.model1.series_b2.map(x => x.b2));
const DphAll = phaseSigns(A_all.series_D), DphWc = phaseSigns(A_wc.series_D);
const SphAll = phaseSigns(D_all.per_origin.filter(x => x.S !== null).map(x => x.S));
const SphWc = phaseSigns(D_wc.per_origin.filter(x => x.S !== null).map(x => x.S));

const v = verdict();
const firmPanel = { schema_version: "feno_rim_recovery_r0_firm_panel.CORRECTED.v1", criteria_sha256: FROZEN_SHA,
  correction: { rule: "shares_corrected = shares x product(splits dated after share-fact period_end)", corrected_cells: correctedCells, total_cells: totalCells,
    dropped_share_recovery_mismatches: droppedMismatch, nonzero_F_by_symbol: fBySymbol,
    spinoff_note: "HON IBM MMM MRK spinoff ratios ARE in data.splits (MMM 1.196, IBM 1.046, HON fractional 2016-2025, MRK 1.048) and ARE included in F: the price series is back-adjusted for spinoffs identically to splits (v3.1)" },
  gate_checksums: { tr_sha256: sha256str(origins.map(o => o.members.map(m => Math.round(m.ret * 1e9)).join(",")).join("|")),
    rf0_sha256: sha256str(origins.map(o => o.rf0).join(",")) },
  origins: origins.map(o => ({ as_of: o.as_of, complete: o.complete, ke: o.ke, rf0: o.rf0, n: o.n,
    ic_vp: o.ic_vp, ic_bp: o.ic_bp, ic_vp_pub: o.ic_vp_pub, ic_bp_pub: o.ic_bp_pub,
    members: o.members.map(m => ({ symbol: m.symbol, F: m.F, vp: r6(m.vp), bp: r6(m.bp), vp_pub: r6(m.vp_pub), bp_pub: r6(m.bp_pub),
      ret: r6(m.ret), exc: r6(m.exc), mcap: r6(m.mcap), mcap_pub: r6(m.mcap_pub), mom: r6(m.mom), shares_basis: m.shares_basis })) })),
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/r0-firm-panel-CORRECTED.json"), JSON.stringify(firmPanel, null, 1) + "\n");
const adj = { schema_version: "feno_rim_recovery_r0_adjudication.CORRECTED.v1", phase: "R0-CORRECTED", research_only: true,
  criteria_sha256: FROZEN_SHA,
  voids: "R0_ADJUDICATION.json and R0_ADJUDICATION_V2.json (ratios contaminated by mixed share bases) and the ratio evidence behind X2/DEC-290; returns were never affected",
  gates: { x2_reproduction_uncorrected: "PASSED", unit_consistency: "PASSED (AAPL 2015, NVDA 2021, JPM/KO/MMM controls)" },
  inference_contract: "verbatim r0-criteria-v2: ESS CI + NW lag 11 primary; block battery sensitivity; disagreement rule; instrument-free phase binomials",
  r0a_paired_ic_difference: { all_origins: A_all, window_complete: A_wc },
  r0b_partial_correlation: { all_origins: B_all, window_complete: B_wc },
  r0c_fama_macbeth: { all_origins: C_all, window_complete: C_wc },
  r0d_stratified_permutation: { all_origins: D_all, window_complete: D_wc },
  instrument_free_phases: { b2_all: { phases: b2phAll.map(r6), positive: b2phAll.filter(x => x > 0).length, of: b2phAll.length },
    b2_wc: { phases: b2phWc.map(r6), positive: b2phWc.filter(x => x > 0).length, of: b2phWc.length },
    D_all: { phases: DphAll.map(r6), negative: DphAll.filter(x => x < 0).length, of: DphAll.length },
    D_wc: { phases: DphWc.map(r6), negative: DphWc.filter(x => x < 0).length, of: DphWc.length },
    S_all: { phases: SphAll.map(r6), positive: SphAll.filter(x => x > 0).length, of: SphAll.length },
    S_wc: { phases: SphWc.map(r6), positive: SphWc.filter(x => x > 0).length, of: SphWc.length } },
  verdict: v,
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R0_ADJUDICATION_CORRECTED.json"), JSON.stringify(adj, null, 2) + "\n");

console.log("\n== R0-CORRECTED SUMMARY ==");
const fmt = (e, nw) => `ess ${e.ess} CI[${e.ci_lower},${e.ci_upper}] NW11 p=${nw.p}`;
console.log("A all :", A_all.mean_d, fmt(A_all.primary.ess_ci, A_all.primary.nw_lag11));
console.log("A wc  :", A_wc.mean_d, fmt(A_wc.primary.ess_ci, A_wc.primary.nw_lag11));
console.log("B all partial:", B_all.primary_partial_correlation.mean, fmt(B_all.primary_partial_correlation.primary.ess_ci, B_all.primary_partial_correlation.primary.nw_lag11));
console.log("B wc  partial:", B_wc.primary_partial_correlation.mean, fmt(B_wc.primary_partial_correlation.primary.ess_ci, B_wc.primary_partial_correlation.primary.nw_lag11));
console.log("C1 all b2:", C_all.model1.mean_b2, fmt(C_all.model1.primary.ess_ci, C_all.model1.primary.nw_lag11));
console.log("C1 wc  b2:", C_wc.model1.mean_b2, fmt(C_wc.model1.primary.ess_ci, C_wc.model1.primary.nw_lag11));
console.log("D wc  meanS:", D_wc.combined_test_primary.mean_S, fmt(D_wc.combined_test_primary.ess_ci, D_wc.combined_test_primary.nw_lag11));
console.log("\nVERDICT:", v.label, "disagreement:", v.disagreement_between_sets);
