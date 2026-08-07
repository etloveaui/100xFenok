// GLS (2001) implied cost of capital solver - R2-B infrastructure (pre-freeze draft).
// Equations per R2_FL3_GLS_SPEC_DRAFT.md section A (GLS eq. 4/5/6, fade rule, payout rule).
// Self-test against the paper's GM worked example (GLS:2591-2621): book roll 22.437/28.652,
// FROE path 0.397/0.345/0.289 fading -0.0144/yr to 0.160 at year 12, solved r = 13.94%.
// NOT a recovery result; the R2 criteria freeze will pin inputs and thresholds before any panel run.

const T_DEFAULT = 12;

export function glsRoePath({ B0, feps1, feps2, feps3, payout, targetRoe, T = T_DEFAULT }) {
  const B = [B0], feps = [null, feps1, feps2, feps3], froe = [null];
  froe[1] = feps1 / B0;
  B[1] = B0 + feps1 * (1 - payout);
  froe[2] = feps2 / B[1];
  B[2] = B[1] + feps2 * (1 - payout);
  froe[3] = feps3 / B[2];
  B[3] = B[2] + feps3 * (1 - payout);
  const step = (froe[3] - targetRoe) / (T - 3); // 9 equal steps for T=12, target attained at T
  for (let i = 4; i <= T; i++) {
    froe[i] = froe[3] - (i - 3) * step;
    feps[i] = froe[i] * B[i - 1];
    B[i] = B[i - 1] + feps[i] * (1 - payout); }
  return { B, feps, froe }; }

// RHS of GLS eq. 5+6 at discount rate r: B0 + sum_{i=1..T-1} RI_i/(1+r)^i + RI_T/(r(1+r)^{T-1})
export function glsValueAt({ B0, path, r, T = T_DEFAULT }) {
  const { B, froe } = path;
  let v = B0;
  for (let i = 1; i <= T - 1; i++) v += (froe[i] - r) * B[i - 1] / Math.pow(1 + r, i);
  v += (froe[T] - r) * B[T - 1] / (r * Math.pow(1 + r, T - 1));
  return v; }

// Solve glsValueAt(r) = price by bisection; f(r) is decreasing in r.
export function glsIcc({ price, B0, feps1, feps2, feps3, payout, targetRoe, T = T_DEFAULT,
  lo = 0.001, hi = 0.60, tol = 1e-9, maxIter = 200 }) {
  if (!(price > 0) || !(B0 > 0) || !Number.isFinite(feps1) || !Number.isFinite(feps2) || !Number.isFinite(feps3)) return null;
  const path = glsRoePath({ B0, feps1, feps2, feps3, payout, targetRoe, T });
  const f = (r) => glsValueAt({ B0, path, r, T }) - price;
  let flo = f(lo), fhi = f(hi);
  if (!(flo > 0) || !(fhi < 0)) return null; // no root in bracket (non-convergence, counted by caller)
  let a = lo, b = hi;
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
    if (fm > 0) a = m; else b = m; }
  return (a + b) / 2; }

// ---------- self-test: GM worked example ----------
if (process.argv[1]?.endsWith("r2-gls-solver.mjs")) {
  const gm = { B0: 17.01, feps1: 6.75, feps2: 7.73, feps3: 7.73 * 1.073, payout: 0.196, targetRoe: 0.160 };
  const path = glsRoePath(gm);
  const close = (a, b, t) => Math.abs(a - b) <= t;
  const checks = [
    ["B1 = 22.437", close(path.B[1], 22.437, 1e-3)],
    ["B2 = 28.652", close(path.B[2], 28.652, 1e-3)],
    ["FROE1 = 0.397", close(path.froe[1], 0.397, 1e-3)],
    ["FROE2 = 0.345", close(path.froe[2], 0.345, 1e-3)],
    ["FROE3 = 0.289", close(path.froe[3], 0.2893, 1e-3)],
    ["FROE4 = 0.2749", close(path.froe[4], 0.2749, 1e-3)],
    ["FROE12 = 0.160", close(path.froe[12], 0.160, 1e-6)] ];
  // round-trip: price implied at r=13.94% must recover r=13.94%
  const price = glsValueAt({ B0: gm.B0, path, r: 0.1394 });
  const rSolved = glsIcc({ price, ...gm });
  checks.push([`round-trip r = 13.94% (price ${price.toFixed(3)}, solved ${(rSolved * 100).toFixed(4)}%)`, close(rSolved, 0.1394, 1e-4)]);
  let pass = true;
  for (const [name, ok] of checks) { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) pass = false; }
  console.log(pass ? "GLS SOLVER SELF-TEST: ALL PASS" : "GLS SOLVER SELF-TEST: FAILURES");
  process.exit(pass ? 0 : 1); }
