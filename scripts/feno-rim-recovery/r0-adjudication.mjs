// R0 re-adjudication of the X2 "no incremental information over B/P" basis.
// Frozen criteria: data/computed/feno-rim-recovery/r0-criteria.json
//   sha256 5d2758840814a9ec8bec8ce15d0f406adf5d949e1fd6b6b0eb7a48382e1ca5f2
//   (committed earlier than any result: 6d3ec4f29c)
// Pipeline below reuses x2-cross-sectional.mjs construction VERBATIM
// (deployPath/riValue/rank/sp, filters, ke, returns). No model change.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5, H = 3, FADE = 3, TERM = 10;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const CRIT_PATH = "data/computed/feno-rim-recovery/r0-criteria.json";
const FROZEN_SHA = "5d2758840814a9ec8bec8ce15d0f406adf5d949e1fd6b6b0eb7a48382e1ca5f2";
const SEED = 20260807;

// ---------- integrity gates ----------
const critSha = sha256(path.join(ROOT, CRIT_PATH));
if (critSha !== FROZEN_SHA) { console.error("ABORT: criteria file changed since freeze", critSha); process.exit(3); }
const crit = rj(CRIT_PATH);
for (const [p, sha] of Object.entries(crit.data_contract.sha256)) {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || sha256(fp) !== sha) { console.error("ABORT: input hash mismatch", p); process.exit(3); }
}
for (const [s, sha] of Object.entries(crit.data_contract.yf_unadjusted_sha256)) {
  const fp = path.join(ROOT, "data/yf/finance/" + s + ".unadjusted.json");
  if (!fs.existsSync(fp) || sha256(fp) !== sha) { console.error("ABORT: yf hash mismatch", s); process.exit(3); }
}
for (const p of crit.planned_result_paths) {
  if (fs.existsSync(path.join(ROOT, p))) { console.error("ABORT: result path already exists (freeze violation):", p); process.exit(3); }
}

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

// ---------- deterministic RNG (same LCG family as x2 boot) ----------
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function mbb(v, block, seed, reps = 10000) { if (v.length < 4) return null; const rnd = makeRng(seed);
  const d = []; for (let r = 0; r < reps; r++) { const b = []; while (b.length < v.length) { const st = Math.floor(rnd() * v.length);
    for (let k = 0; k < block && b.length < v.length; k++) b.push(v[(st + k) % v.length]); }
    d.push(b.reduce((a, x) => a + x, 0) / b.length); }
  d.sort((a, b) => a - b);
  return { mean: r6(d.reduce((a, x) => a + x, 0) / d.length), ci_lower: r6(d[Math.floor(d.length * 0.025)]), ci_upper: r6(d[Math.floor(d.length * 0.975)]), reps: d.length, block, seed }; }
// Newey-West HAC on the mean of a series, Bartlett kernel, frozen lag=2, normal approx two-sided p
function nwMean(v, lag = 2) { const T = v.length; if (T < 5) return null;
  const m = v.reduce((a, x) => a + x, 0) / T; const x = v.map(a => a - m);
  let g = 0; for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
    const d = Math.abs(i - j); if (d <= lag) g += (1 - d / (lag + 1)) * x[i] * x[j]; }
  const varMean = g / (T * T); const se = Math.sqrt(Math.max(varMean, 0));
  if (!(se > 0)) return { mean: r6(m), se: 0, t: null, p: null, lag, T };
  const t = m / se; const p = 2 * (1 - normCdf(Math.abs(t)));
  return { mean: r6(m), se: r6(se), t: r6(t), p: r6(p), lag, T }; }
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); // Phi(z), Abramowitz-Stegun
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const q = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - q : q; }
const TCrit = { 34: 2.0345, 18: 2.1098 }; // two-sided 95%, df T-1

// ---------- OLS via normal equations ----------
function ols(X, y) { const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  // Gaussian elimination with partial pivoting
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
  const beta = new Array(k);
  for (let r = k - 1; r >= 0; r--) { let s = A[r][k]; for (let q = r + 1; q < k; q++) s -= A[r][q] * beta[q]; beta[r] = s / A[r][r]; }
  return beta; }

// ---------- rebuild firm panel (verbatim X2 construction) ----------
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

const origins = [];
for (const o of panel.origin_rows) {
  const t0 = ms(o.as_of), t1 = t0 + 36 * 30.44 * DAY;
  let rate = null; for (const r of rates) { if (r.date <= o.as_of) rate = r; else break; }
  const pe = erp.filter(x => x.t <= t0).at(-1);
  if (!rate || !pe) continue;
  const ke = rate.value * 0.01 + pe.us;
  const rf0 = rate.value * 0.01;
  const members = [];
  for (const m of o.members) {
    if (!m.ok || !(m.book > 0) || !(m.price > 0) || !(m.shares > 0) || !Number.isFinite(m.roe)) continue;
    const p = px[m.symbol]; if (!p?.length) continue;
    const ia = atIdx(p, t0), ib = atIdx(p, t1);
    const a = ia >= 0 ? p[ia] : null, b = ib >= 0 ? p[ib] : null;
    if (!a || !b || t0 - a.t > 45 * DAY || t1 - b.t > 45 * DAY) continue;
    const dp = deployPath(m); const V = dp ? riValue(m.book, dp, ke) : null;
    if (!Number.isFinite(V) || V <= 0) continue;
    const mcap = m.price * m.shares;
    const div = (dv[m.symbol] || []).filter(x => x.t > t0 && x.t <= t1).reduce((s, x) => s + x.a, 0);
    const tr = Math.pow((b.c + div) / a.c, 1 / 3) - 1;
    // momentum per frozen criteria: c[i0-21]/c[i0-252]-1, i0 = last obs <= t0 (same 45d tolerance)
    let mom = null;
    if (ia >= 252) mom = p[ia - 21].c / p[ia - 252].c - 1;
    members.push({ symbol: m.symbol, vp: V / mcap, bp: m.book / mcap, ret: tr, exc: tr - rf0, mcap, size: Math.log(mcap), mom }); }
  if (members.length < 20) continue;
  const icV = sp(members.map(x => x.vp), members.map(x => x.ret));
  const icB = sp(members.map(x => x.bp), members.map(x => x.ret));
  if (icV === null || icB === null) continue;
  origins.push({ as_of: o.as_of, ke: r6(ke), rf0: r6(rf0), n: members.length, ic_vp: r6(icV), ic_bp: r6(icB), complete: complete.has(o.as_of), members }); }

// ---------- reproduction gate: must match X2 per-origin rows within 1e-6 ----------
const x2 = rj("data/computed/feno-rim-v2/RIM_CROSS_SECTIONAL_BOTTOM_UP.json");
const gateErrors = [];
if (origins.length !== x2.per_origin_rows.length) gateErrors.push(`origin count ${origins.length} != ${x2.per_origin_rows.length}`);
for (let i = 0; i < Math.min(origins.length, x2.per_origin_rows.length); i++) {
  const a = origins[i], b = x2.per_origin_rows[i];
  if (a.as_of !== b.as_of) gateErrors.push(`origin ${i}: as_of ${a.as_of} != ${b.as_of}`);
  if (a.n !== b.n) gateErrors.push(`${a.as_of}: n ${a.n} != ${b.n}`);
  if (Math.abs(a.ic_vp - b.ic_vp) > 1e-6) gateErrors.push(`${a.as_of}: ic_vp ${a.ic_vp} != ${b.ic_vp}`);
  if (Math.abs(a.ic_bp - b.ic_bp) > 1e-6) gateErrors.push(`${a.as_of}: ic_bp ${a.ic_bp} != ${b.ic_bp}`);
  if (a.complete !== b.complete) gateErrors.push(`${a.as_of}: complete flag mismatch`); }
if (gateErrors.length) {
  console.error("ABORT: X2 reproduction gate failed:\n" + gateErrors.join("\n"));
  fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R0_ADJUDICATION.json"),
    JSON.stringify({ phase: "R0", status: "ABORTED_REPRODUCTION_GATE", gate_errors: gateErrors, generated_at: new Date().toISOString() }, null, 2) + "\n");
  process.exit(4); }
console.log("reproduction gate PASSED:", origins.length, "origins match X2 to 1e-6");

const setOf = (flag) => origins.filter(o => flag === "wc" ? o.complete : true);

// ---------- R0-A paired IC difference ----------
function r0a(set, label) {
  const D = set.map(o => o.ic_vp - o.ic_bp), T = D.length;
  const mean = D.reduce((a, x) => a + x, 0) / T;
  const sorted = [...D].sort((a, b) => a - b);
  const median = T % 2 ? sorted[(T - 1) / 2] : (sorted[T / 2 - 1] + sorted[T / 2]) / 2;
  const sd = Math.sqrt(D.reduce((a, x) => a + (x - mean) ** 2, 0) / (T - 1));
  const tc = TCrit[T] ?? 2;
  const naive = { mean: r6(mean), ci_lower: r6(mean - tc * sd / Math.sqrt(T)), ci_upper: r6(mean + tc * sd / Math.sqrt(T)), t_crit: tc };
  const boots = { b4: mbb(D, 4, SEED), b8: mbb(D, 8, SEED), b12: mbb(D, 12, SEED) };
  const nw = nwMean(D, 2);
  return { set: label, T, mean_d: r6(mean), median_d: r6(median), share_positive: r6(D.filter(x => x > 0).length / T), naive_paired_ci: naive, block_bootstrap_ci: boots, newey_west: nw, series_D: D.map(r6) }; }

// ---------- R0-B residualized V/P ----------
function r0b(set, label) {
  const per = [];
  for (const o of set) {
    const rV = rank(o.members.map(x => x.vp)), rB = rank(o.members.map(x => x.bp));
    const beta = ols(o.members.map((_, i) => [1, rB[i]]), rV);
    if (!beta) continue;
    const resid = rV.map((v, i) => v - (beta[0] + beta[1] * rB[i]));
    const ic = sp(resid, o.members.map(x => x.ret));
    if (ic === null) continue;
    per.push({ as_of: o.as_of, ic_resid: r6(ic), n: o.members.length }); }
  const v = per.map(x => x.ic_resid), T = v.length;
  const mean = v.reduce((a, x) => a + x, 0) / T;
  const sorted = [...v].sort((a, b) => a - b);
  const median = T % 2 ? sorted[(T - 1) / 2] : (sorted[T / 2 - 1] + sorted[T / 2]) / 2;
  return { set: label, T, mean_resid_ic: r6(mean), median_resid_ic: r6(median),
    share_positive: r6(v.filter(x => x > 0).length / T),
    block_bootstrap_ci: { b4: mbb(v, 4, SEED), b8: mbb(v, 8, SEED), b12: mbb(v, 12, SEED) },
    newey_west: nwMean(v, 2), per_origin: per }; }

// ---------- R0-C Fama-MacBeth ----------
function r0c(set, label) {
  const m1 = [], m2 = [], m2void = [];
  for (const o of set) {
    const n1 = o.members.length;
    const rB = rank(o.members.map(x => x.bp)), rV = rank(o.members.map(x => x.vp));
    const uB = rB.map(r => (r - 1) / (n1 - 1)), uV = rV.map(r => (r - 1) / (n1 - 1));
    const b1 = ols(o.members.map((_, i) => [1, uB[i], uV[i]]), o.members.map(x => x.exc));
    if (b1) m1.push({ as_of: o.as_of, b2: b1[2], n: n1 });
    // model 2 with size + momentum (members lacking momentum excluded from M2 only)
    const sub = o.members.filter(x => Number.isFinite(x.mom));
    if (sub.length < 20) { m2void.push({ as_of: o.as_of, n_m2: sub.length }); continue; }
    const n2 = sub.length;
    const sB = rank(sub.map(x => x.bp)), sV = rank(sub.map(x => x.vp)), sS = rank(sub.map(x => x.size)), sM = rank(sub.map(x => x.mom));
    const u = (r) => (r - 1) / (n2 - 1);
    const b2v = ols(sub.map((_, i) => [1, u(sB[i]), u(sV[i]), u(sS[i]), u(sM[i])]), sub.map(x => x.exc));
    if (b2v) m2.push({ as_of: o.as_of, b2: b2v[2], n: n2 }); }
  const agg = (rows, name) => { const v = rows.map(x => x.b2), T = v.length;
    const mean = v.reduce((a, x) => a + x, 0) / T;
    const sorted = [...v].sort((a, b) => a - b);
    const median = T % 2 ? sorted[(T - 1) / 2] : (sorted[T / 2 - 1] + sorted[T / 2]) / 2;
    // leave-one-out
    let maxDelta = 0, signFlip = false;
    for (let i = 0; i < T; i++) { const m = (v.reduce((a, x) => a + x, 0) - v[i]) / (T - 1);
      maxDelta = Math.max(maxDelta, Math.abs(m - mean)); if (m * mean < 0) signFlip = true; }
    return { model: name, T, mean_b2: r6(mean), median_b2: r6(median), share_positive: r6(v.filter(x => x > 0).length / T),
      newey_west: nwMean(v, 2), block_bootstrap_ci: { b4: mbb(v, 4, SEED), b8: mbb(v, 8, SEED), b12: mbb(v, 12, SEED) },
      leave_one_out: { max_abs_delta_mean: r6(maxDelta), sign_flip: signFlip }, series_b2: rows }; };
  return { set: label, model1: agg(m1, "M1"), model2: agg(m2, "M2"), model2_voided: m2void }; }

// ---------- R0-D stratified permutation ----------
function r0d(set, label, seedBase) {
  const per = [];
  set.forEach((o, idx) => {
    const n = o.members.length;
    const rB = rank(o.members.map(x => x.bp));
    const groups = [[], [], []];
    o.members.forEach((m, i) => { groups[Math.min(2, Math.floor(3 * (rB[i] - 1) / n))].push(m.exc); });
    // observed: V/P assignment = actual member order inside tercile by vp
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
        // Fisher-Yates shuffle of exc labels
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
  return { set: label, T: ok.length, mean_S: r6(ok.reduce((a, x) => a + x.S, 0) / ok.length),
    share_sig_positive: r6(ok.filter(x => x.S > 0 && x.p_one_sided < 0.05).length / ok.length),
    share_positive_S: r6(ok.filter(x => x.S > 0).length / ok.length), per_origin: per }; }

// ---------- run all on both sets ----------
const A_all = r0a(setOf("all"), "all_origins"), A_wc = r0a(setOf("wc"), "window_complete");
const B_all = r0b(setOf("all"), "all_origins"), B_wc = r0b(setOf("wc"), "window_complete");
const C_all = r0c(setOf("all"), "all_origins"), C_wc = r0c(setOf("wc"), "window_complete");
const D_all = r0d(setOf("all"), "all_origins", SEED), D_wc = r0d(setOf("wc"), "window_complete", SEED + 1000);

// ---------- frozen verdict mapping ----------
function verdict() {
  const cWC = C_wc.model1, cALL = C_all.model1, bWC = B_wc;
  const blocksOK = (ci) => ci.b4.ci_lower > 0, blocksNeg = (ci) => ci.b4.ci_upper < 0;
  const robust = (ci) => ci.b4.ci_lower > 0 && ci.b8.ci_lower > 0 && ci.b12.ci_lower > 0;
  const robustNeg = (ci) => ci.b4.ci_upper < 0 && ci.b8.ci_upper < 0 && ci.b12.ci_upper < 0;
  const unstable = [A_wc, A_all].some(a => { const s = [a.block_bootstrap_ci.b4, a.block_bootstrap_ci.b8, a.block_bootstrap_ci.b12].map(x => x.ci_lower > 0 ? 1 : (x.ci_upper < 0 ? -1 : 0)); return new Set(s.filter(v => v !== 0)).size > 1; });
  const pos = cWC.mean_b2 > 0 && cWC.newey_west.p !== null && cWC.newey_west.p <= 0.05 && blocksOK(cWC.block_bootstrap_ci)
    && cALL.mean_b2 > 0 && bWC.mean_resid_ic > 0 && blocksOK(bWC.block_bootstrap_ci);
  const neg = cWC.mean_b2 < 0 && cWC.newey_west.p !== null && cWC.newey_west.p <= 0.05 && blocksNeg(cWC.block_bootstrap_ci)
    && cALL.mean_b2 < 0 && bWC.mean_resid_ic < 0 && blocksNeg(bWC.block_bootstrap_ci);
  const inBand = (x, lo, hi) => x.ci_lower >= lo && x.ci_upper <= hi;
  const zero = inBand(cWC.block_bootstrap_ci.b4, -0.01, 0.01) && inBand(cALL.block_bootstrap_ci.b4, -0.01, 0.01)
    && inBand(bWC.block_bootstrap_ci.b4, -0.05, 0.05) && inBand(B_all.block_bootstrap_ci.b4, -0.05, 0.05)
    && inBand(A_wc.block_bootstrap_ci.b4, -0.05, 0.05) && inBand(A_all.block_bootstrap_ci.b4, -0.05, 0.05);
  let label = "R0_INCONCLUSIVE";
  if (pos) label = "R0_INCREMENTAL_POSITIVE";
  else if (neg) label = "R0_INCREMENTAL_NEGATIVE";
  else if (zero) label = "R0_INCREMENTAL_ZERO";
  if (unstable && label !== "R0_INCONCLUSIVE") label = "R0_INCONCLUSIVE";
  const flags = { unstable_block_sensitivity: unstable };
  if (label === "R0_INCREMENTAL_POSITIVE") flags.robust_across_blocks = robust(cWC.block_bootstrap_ci) && robust(bWC.block_bootstrap_ci);
  if (label === "R0_INCREMENTAL_NEGATIVE") flags.robust_across_blocks = robustNeg(cWC.block_bootstrap_ci) && robustNeg(bWC.block_bootstrap_ci);
  return { label, flags }; }

const v = verdict();
const firmPanel = { schema_version: "feno_rim_recovery_r0_firm_panel.v1", criteria_sha256: FROZEN_SHA,
  origins: origins.map(o => ({ as_of: o.as_of, complete: o.complete, ke: o.ke, rf0: o.rf0, n: o.n, ic_vp: o.ic_vp, ic_bp: o.ic_bp,
    members: o.members.map(m => ({ symbol: m.symbol, vp: r6(m.vp), bp: r6(m.bp), ret: r6(m.ret), exc: r6(m.exc), mcap: r6(m.mcap), mom: r6(m.mom) })) })),
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/r0-firm-panel.json"), JSON.stringify(firmPanel, null, 1) + "\n");
const adj = { schema_version: "feno_rim_recovery_r0_adjudication.v1", phase: "R0", research_only: true,
  criteria_sha256: FROZEN_SHA, reproduction_gate: "PASSED (34 origins, per-origin ic_vp/ic_bp/n/complete match X2 within 1e-6)",
  r0a_paired_ic_difference: { all_origins: A_all, window_complete: A_wc },
  r0b_residualized_vp: { all_origins: B_all, window_complete: B_wc },
  r0c_fama_macbeth: { all_origins: C_all, window_complete: C_wc },
  r0d_stratified_permutation: { all_origins: D_all, window_complete: D_wc },
  verdict: v,
  note: "R0-A/B/C/D computed on the unchanged X2 firm-level pipeline per frozen criteria; excess return = total return minus origin DGS10 (location shift; slopes invariant).",
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/R0_ADJUDICATION.json"), JSON.stringify(adj, null, 2) + "\n");

console.log("\n== R0 SUMMARY ==");
for (const [k, x] of [["A all", A_all], ["A wc", A_wc]]) console.log(k, "meanD", x.mean_d, "share>0", x.share_positive, "NW p", x.newey_west.p, "b4CI", x.block_bootstrap_ci.b4.ci_lower, x.block_bootstrap_ci.b4.ci_upper);
for (const [k, x] of [["B all", B_all], ["B wc", B_wc]]) console.log(k, "residIC", x.mean_resid_ic, "share>0", x.share_positive, "NW p", x.newey_west.p, "b4CI", x.block_bootstrap_ci.b4.ci_lower, x.block_bootstrap_ci.b4.ci_upper);
for (const [k, x] of [["C1 all", C_all.model1], ["C1 wc", C_wc.model1]]) console.log(k, "b2", x.mean_b2, "share>0", x.share_positive, "NW p", x.newey_west.p, "b4CI", x.block_bootstrap_ci.b4.ci_lower, x.block_bootstrap_ci.b4.ci_upper, "LOOflip", x.leave_one_out.sign_flip);
for (const [k, x] of [["D all", D_all], ["D wc", D_wc]]) console.log(k, "meanS", x.mean_S, "sig+ share", x.share_sig_positive);
console.log("\nVERDICT:", v.label, JSON.stringify(v.flags));
