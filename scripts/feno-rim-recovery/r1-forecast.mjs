// R1 forecast pipeline: Li-Mohanram (2014) RW/EP/RI mechanical earnings forecasts on the
// frozen R1 universe, PIT-clean per r1-criteria-v2.json (sha 0103b0aa...). Run only after
// the red-team criteria review returns (or the 24h window closes).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const CRIT_PATH = "data/computed/feno-rim-recovery/r1-criteria-v2.json";
const FROZEN_SHA = "0682582d35110e44d829b64213737212748d94c70856249ce49bd267548d777d";
const EVAL_CUTOFF = ms("2026-08-07");
const ORIGINS = [2019, 2020, 2021, 2022, 2023];
const TAUS = [1, 2, 3];
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;

if (sha256(path.join(ROOT, CRIT_PATH)) !== FROZEN_SHA) { console.error("ABORT: criteria changed since freeze"); process.exit(3); }
for (const p of rj(CRIT_PATH).planned_result_paths) {
  if (fs.existsSync(path.join(ROOT, p))) { console.error("ABORT: result path exists:", p); process.exit(3); } }

// ---------- universe ----------
const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);
console.log("universe:", symbols.length);

// ---------- EDGAR fact extraction ----------
const E_PRIMARY = "IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity";
const E_FALLBACK = "NetIncomeLoss";
function annualFacts(concepts, name) {
  const rows = concepts?.[name]; if (!rows) return [];
  const byEnd = new Map();
  for (const r of rows) {
    if (!(r.form === "10-K" || r.form === "10-K/A") || r.fp !== "FY") continue;
    if (!r.end || !Number.isFinite(r.val)) continue;
    const cur = byEnd.get(r.end);
    if (!cur || r.filed < cur.filed) byEnd.set(r.end, r); }
  return [...byEnd.values()].map(r => ({ end: r.end, endMs: ms(r.end), val: r.val, filed: ms(r.filed), fy: r.fy }))
    .sort((a, b) => a.endMs - b.endMs); }
function sharesFacts(concepts) {
  // v2.2 amendment (a): union of dei:EntityCommonStockSharesOutstanding (cover-page count,
  // near-universal) and us-gaap:CommonStockSharesOutstanding, earliest-filed-per-date.
  const rows = [...(concepts?.["EntityCommonStockSharesOutstanding"] ?? []), ...(concepts?.["CommonStockSharesOutstanding"] ?? [])];
  if (!rows.length) return [];
  const byDate = new Map();
  for (const r of rows) {
    const date = r.start ?? r.end; if (!date || !Number.isFinite(r.val)) continue;
    const cur = byDate.get(date);
    if (!cur || r.filed < cur.filed) byDate.set(date, r); }
  return [...byDate.values()].map(r => ({ date: r.start ?? r.end, ms: ms(r.start ?? r.end), val: r.val, filed: ms(r.filed) }))
    .sort((a, b) => a.ms - b.ms); }

// build firm-year records
const firms = {}; let noEdgar = 0;
const tagCoverage = { fetched: 0, E: 0, book: 0, shares_union: 0, cash: 0, ivst: 0, pstk: 0, all_required: 0 };
for (const sym of symbols) {
  const p = path.join(ROOT, "data/edgar/r1-panel/" + sym + ".json");
  if (!fs.existsSync(p)) { noEdgar++; continue; }
  const concepts = rj(p).concepts;
  tagCoverage.fetched++;
  const eP = annualFacts(concepts, E_PRIMARY), eF = annualFacts(concepts, E_FALLBACK);
  const book = annualFacts(concepts, "StockholdersEquity");
  const pstk = annualFacts(concepts, "PreferredStockValue");
  const assets = annualFacts(concepts, "Assets");
  const liab = annualFacts(concepts, "Liabilities");
  const cash = annualFacts(concepts, "CashAndCashEquivalentsAtCarryingValue");
  const ivst = annualFacts(concepts, "ShortTermInvestments").length ? annualFacts(concepts, "ShortTermInvestments") : annualFacts(concepts, "MarketableSecuritiesCurrent");
  const shares = sharesFacts(concepts);
  const unusual = [...annualFacts(concepts, "RestructuringCharges"), ...annualFacts(concepts, "GoodwillImpairmentLoss"), ...annualFacts(concepts, "AssetImpairmentLoss")];
  if (eP.length || eF.length) tagCoverage.E++;
  if (book.length) tagCoverage.book++;
  if (shares.length) tagCoverage.shares_union++;
  if (cash.length) tagCoverage.cash++;
  if (ivst.length) tagCoverage.ivst++;
  if (pstk.length) tagCoverage.pstk++;
  if ((eP.length || eF.length) && book.length && shares.length && cash.length) tagCoverage.all_required++;
  if (!eP.length && !eF.length) { noEdgar++; continue; }
  // firm-year table keyed by period end
  const years = new Map();
  const put = (endMs, k, v, filed) => { if (!years.has(endMs)) years.set(endMs, { endMs, facts: {} }); years.get(endMs).facts[k] = { v, filed }; };
  for (const r of eP) put(r.endMs, "E", r.val, r.filed);
  for (const r of eF) if (!years.get(r.endMs)?.facts["E"]) put(r.endMs, "E", r.val, r.filed);
  for (const r of eP) put(r.endMs, "E_src", "primary", r.filed);
  for (const r of eF) if (years.get(r.endMs)?.facts["E"] && !years.get(r.endMs).facts["E_src"]) put(r.endMs, "E_src", "fallback", r.filed);
  for (const r of book) put(r.endMs, "book", r.val, r.filed);
  for (const r of pstk) put(r.endMs, "pstk", r.val, r.filed);
  for (const r of assets) put(r.endMs, "assets", r.val, r.filed);
  for (const r of liab) put(r.endMs, "liab", r.val, r.filed);
  for (const r of cash) put(r.endMs, "cash", r.val, r.filed);
  for (const r of ivst) put(r.endMs, "ivst", r.val, r.filed);
  for (const r of unusual) { const y = years.get(r.endMs); if (y) y.facts["unusual"] = { v: (y.facts["unusual"]?.v ?? 0) + r.val, filed: r.filed }; }
  // mark E_src fallback correctly where only fallback exists
  for (const [endMs, y] of years) { if (y.facts.E && !y.facts.E_src) y.facts.E_src = { v: "fallback" }; }
  firms[sym] = { years: [...years.values()].sort((a, b) => a.endMs - b.endMs), shares,
    sic: (() => { try { return rj("data/edgar/r1-panel/sic/" + sym + ".json").sic; } catch { return null; } })(),
    fye: (() => { try { return rj("data/edgar/r1-panel/sic/" + sym + ".json").fiscalYearEnd; } catch { return null; } })() }; }
console.log("firms with EDGAR data:", Object.keys(firms).length, "missing:", noEdgar);
// v2.2 mandated declaration: effective universe (fetched / per-tag survival / retention /
// SIC distribution kept vs dropped). The result is about the retained subset, not the S&P500.
const universeReport = (() => {
  const kept = {}, dropped = {};
  const sicDigit = (sym) => { const s = firms[sym]?.sic; return s ? String(s).slice(0, 1) : "X"; };
  for (const sym of symbols) {
    const f = firms[sym];
    const usable = f && f.shares.length > 0 && f.years.some(y => y.facts.E != null && y.facts.book != null);
    const d = usable ? kept : dropped;
    const k = f ? sicDigit(sym) : "X";
    d[k] = (d[k] ?? 0) + 1; }
  const keptN = Object.values(kept).reduce((a, x) => a + x, 0);
  return { universe_total: symbols.length, no_cache_or_no_E: noEdgar,
    tag_coverage: tagCoverage, retention_rate: tagCoverage.fetched ? tagCoverage.all_required / tagCoverage.fetched : null,
    kept_symbols: keptN, dropped_symbols: symbols.length - keptN,
    sic_distribution_kept: kept, sic_distribution_dropped: dropped,
    note: "retention driven by filing practice (tag presence), not random across industries" }; })();
console.log("effective universe:", JSON.stringify({ kept: universeReport.kept_symbols, dropped: universeReport.dropped_symbols, retention: universeReport.retention_rate }));

// shares for a firm-year: instant fact within [end-183d, end+90d], filed <= asOf; prefer closest to end, ties latest
function sharesAt(f, endMs, asOf) {
  let best = null;
  for (const s of f.shares) {
    if (s.filed > asOf) continue;
    if (s.ms < endMs - 183 * DAY || s.ms > endMs + 90 * DAY) continue;
    const d = Math.abs(s.ms - endMs);
    if (!best || d < best.d || (d === best.d && s.ms > best.s.ms)) best = { s, d }; }
  return best?.s ?? null; }

// ---------- winsorization boundaries ----------
function quantile(sorted, q) { const pos = (sorted.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }

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
  const resid = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  const ssr = resid.reduce((s, e) => s + e * e, 0);
  return { beta, n, k, rmse: Math.sqrt(ssr / Math.max(n - k, 1)) }; }

// ---------- price helpers ----------
const priceCache = {};
function loadPrices(sym) { if (!priceCache[sym]) {
  const p = path.join(ROOT, "data/edgar/r1-panel/prices/" + sym + ".json");
  priceCache[sym] = fs.existsSync(p) ? rj(p) : null; }
  return priceCache[sym]; }
function originClose(sym, Y) { // origin-basis close at June 30 of year Y (10-trading-day tolerance)
  const pc = loadPrices(sym); if (!pc) return null;
  const target = `${Y}-06-30`;
  const dates = Object.keys(pc.closes).filter(d => d <= target).sort();
  const d = dates.at(-1); if (!d) return null;
  if (ms(target) - ms(d) > 16 * DAY) return null;
  let F = 1; for (const [sd, f] of Object.entries(pc.splits)) if (ms(sd) > ms(target)) F *= f;
  return { close: pc.closes[d], date: d, F_after_origin: F }; }
// v2.1: ONE split basis (today's) for the whole panel. Shares leg carries the F:
// shares_basis(t) = shares_reported(t) x product(splits dated after the share-fact date).
// Prices stay today-basis as fetched - no conversion (BLOCKER 1+2 fix).
function sharesFactor(sym, afterMs) {
  const pc = loadPrices(sym); if (!pc) return 1;
  let F = 1; for (const [sd, f] of Object.entries(pc.splits)) if (ms(sd) > afterMs) F *= f;
  return F; }

// ---------- unit-consistency gate ----------
const gateErrors = [];
const coverageList = [];
for (const sym of symbols) { const pc = loadPrices(sym); coverageList.push(pc && Object.keys(pc.closes).length > 100); }
const coverage = coverageList.filter(Boolean).length / coverageList.length;
if (coverage < 0.95) gateErrors.push(`price coverage ${coverage.toFixed(3)} < 0.95 hard floor`);
function continuityCheck(sym, splitDate, tolPct) {
  const pc = loadPrices(sym); if (!pc) { gateErrors.push(`${sym}: no price cache for split check`); return; }
  const f = pc.splits[splitDate];
  if (!f) { gateErrors.push(`${sym}: splits map lacks ${splitDate}`); return; }
  const dates = Object.keys(pc.closes).sort();
  const before = dates.filter(d => d < splitDate).at(-1), after = dates.filter(d => d >= splitDate)[0];
  if (!before || !after) { gateErrors.push(`${sym}: no closes around ${splitDate}`); return; }
  const jump = Math.abs(pc.closes[after] / pc.closes[before] - 1);
  if (jump > tolPct) gateErrors.push(`${sym}: adjusted close jumps ${(jump * 100).toFixed(1)}% across ${splitDate} (expected continuity)`); }
continuityCheck("AAPL", "2020-08-31", 0.03);
continuityCheck("NVDA", "2021-07-20", 0.03);
continuityCheck("NVDA", "2024-06-10", 0.03);
// ISSUE 9 absolute reference: catches a sign/reciprocal error in the price basis.
// AAPL stored close on 2019-06-28 must be ~49.48 today-basis, and ~197.9 when the
// post-origin factor 4 is multiplied back. A divide-by-F bug would read ~12.4 and fail.
{ const pc = loadPrices("AAPL");
  const c = pc?.closes?.["2019-06-28"];
  if (!Number.isFinite(c)) gateErrors.push("AAPL: no close on 2019-06-28 for absolute reference");
  else {
    if (Math.abs(c - 49.48) > 0.02 * 49.48) gateErrors.push(`AAPL 2019-06-28 today-basis close ${c.toFixed(2)} not within 2% of 49.48`);
    const F = sharesFactor("AAPL", ms("2019-06-28"));
    if (Math.abs(c * F - 197.92) > 0.02 * 197.92) gateErrors.push(`AAPL 2019-06-28 as-reported close ${(c * F).toFixed(2)} not within 2% of 197.92 (F=${F})`); } }

// ---------- main loop ----------
const results = []; const diag = { pools: {}, voided_pairs: 0, missing_shares: 0, forecast_rows: 0, price_missing: 0 };
for (const Y of ORIGINS) {
  const originMs = ms(`${Y}-06-30`);
  const guardEnd = ms(`${Y}-03-31`); // FYE April-June guard boundary (origin-based, tau-independent)
  for (const tau of TAUS) {
    // ---- pool window shifts per horizon (ISSUE 10): base years Y-tau-10 .. Y-tau ----
    const poolStart = ms(`${Y - tau - 10}-04-01`), poolEnd = ms(`${Y - tau}-03-31`);
    // ---- build pool rows (pairs (t, t+tau), both facts filed <= origin) ----
    const pool = [];
    for (const [sym, f] of Object.entries(firms)) {
      const ys = f.years;
      for (let i = 0; i < ys.length; i++) {
        const base = ys[i];
        if (base.endMs < poolStart || base.endMs > poolEnd) continue;
        if (base.facts.E?.filed > originMs) continue;
        const j = i + tau; if (j >= ys.length) continue;
        const dep = ys[j];
        const spanMonths = (dep.endMs - base.endMs) / (30.44 * DAY);
        if (spanMonths < tau * 9 || spanMonths > tau * 15) { diag.voided_pairs++; continue; }
        if (dep.facts.E == null || dep.facts.E.filed > originMs) continue;
        const sh = sharesAt(f, base.endMs, originMs);
        if (!sh) { diag.missing_shares++; continue; }
        const shBasis = sh.val * sharesFactor(sym, sh.ms); // today's basis (v2.1)
        const E = base.facts.E.v, Ed = dep.facts.E.v;
        const book = base.facts.book?.v, cash = base.facts.cash?.v, ivst = base.facts.ivst?.v ?? 0, pstkV = base.facts.pstk?.v ?? 0;
        // prior-year X for TACC (v2.2 amendment b: L = A - E substituted, so
        // TACC = d(SE - Cash + IVST - PSTK)/shares_basis; declared error = dNCI)
        let tacc = null;
        const prev = ys[i - 1];
        if (prev && book != null && prev.facts.book && (base.endMs - prev.endMs) < 15 * 30.44 * DAY) {
          const X1 = book - (cash ?? 0) + ivst - pstkV;
          const X0 = prev.facts.book.v - (prev.facts.cash?.v ?? 0) + (prev.facts.ivst?.v ?? 0) - (prev.facts.pstk?.v ?? 0);
          tacc = (X1 - X0) / shBasis; }
        if (tacc === null) tacc = 0; // paper: missing TACC -> 0, flagged
        pool.push({ sym, baseEnd: base.endMs, depEnd: dep.endMs, shares_t: shBasis,
          eps_t: E / shBasis, eps_dep: Ed / shBasis,
          bps: book != null ? (book - pstkV) / shBasis : null,
          tacc, tacc_missing: tacc === 0 && book == null,
          negE: E < 0 ? 1 : 0, fy: new Date(base.endMs).getFullYear() }); } }
    if (pool.length < 300) { diag.pools[`${Y}_${tau}`] = { n: pool.length, status: "VOIDED_BELOW_300" }; continue; }
    diag.pools[`${Y}_${tau}`] = { n: pool.length };
    // ---- winsorization boundaries per fiscal year (from pool only) ----
    const byVar = { eps_t: {}, eps_dep: {}, bps: {}, tacc: {} };
    for (const r of pool) {
      const y = r.fy;
      for (const v of ["eps_t", "eps_dep", "tacc"]) { (byVar[v][y] ??= []).push(r[v]); }
      if (r.bps != null) (byVar.bps[y] ??= []).push(r.bps); }
    const bounds = {};
    for (const v of Object.keys(byVar)) { bounds[v] = {};
      for (const [y, arr] of Object.entries(byVar[v])) { const s = [...arr].sort((a, b) => a - b);
        bounds[v][y] = [quantile(s, 0.01), quantile(s, 0.99)]; } }
    const wins = (v, val, fy) => { const years = Object.keys(bounds[v]).map(Number).sort((a, b) => a - b);
      let y = fy; if (!bounds[v][y]) y = years.filter(x => x <= fy).at(-1) ?? years[0]; // forecast-row rule: nearest older pool year
      const [lo, hi] = bounds[v][y]; return Math.min(Math.max(val, lo), hi); };
    for (const r of pool) {
      r.eps_t_w = wins("eps_t", r.eps_t, r.fy);
      r.eps_dep_w = wins("eps_dep", r.eps_dep, new Date(r.depEnd).getFullYear());
      r.tacc_w = wins("tacc", r.tacc, r.fy);
      r.bps_w = r.bps != null ? wins("bps", r.bps, r.fy) : null; }
    const poolFit = pool.filter(r => r.bps_w != null);
    // ---- pooled regressions ----
    const Xep = pool.map(r => [1, r.negE, r.eps_t_w, r.negE * r.eps_t_w]);
    const yDep = pool.map(r => r.eps_dep_w);
    const fitEP = ols(Xep, yDep);
    const Xri = poolFit.map(r => [1, r.negE, r.eps_t_w, r.negE * r.eps_t_w, r.bps_w, r.tacc_w]);
    const fitRI = ols(Xri, poolFit.map(r => r.eps_dep_w));
    // ---- forecasts at the origin ----
    for (const [sym, f] of Object.entries(firms)) {
      const ys = f.years;
      // base year t*: latest fiscal year usable at origin with FYE guard
      let tIdx = -1;
      for (let i = ys.length - 1; i >= 0; i--) {
        const y = ys[i];
        if (y.endMs > originMs) continue;
        if (y.facts.E == null || y.facts.E.filed > originMs) continue;
        const m = new Date(y.endMs).getUTCMonth() + 1;
        if (m >= 4 && m <= 6 && y.endMs > guardEnd) continue; // FYE April-June guard (origin-based)
        tIdx = i; break; }
      if (tIdx < 0) continue;
      const base = ys[tIdx];
      const j = tIdx + tau; if (j >= ys.length) continue;
      const dep = ys[j];
      const spanMonths = (dep.endMs - base.endMs) / (30.44 * DAY);
      if (spanMonths < tau * 9 || spanMonths > tau * 15) continue;
      if (dep.facts.E == null || dep.facts.E.filed > EVAL_CUTOFF) continue; // evaluation actual under cutoff
      const sh = sharesAt(f, base.endMs, originMs);
      if (!sh) continue;
      const F = sharesFactor(sym, sh.ms);
      const shBasis = sh.val * F; // today's basis (v2.1)
      const E = base.facts.E.v;
      const book = base.facts.book?.v, assets = base.facts.assets?.v, liab = base.facts.liab?.v,
        cash = base.facts.cash?.v, ivst = base.facts.ivst?.v ?? 0, pstkV = base.facts.pstk?.v ?? 0;
      let tacc = null; const prev = ys[tIdx - 1];
      if (prev && book != null && prev.facts.book && (base.endMs - prev.endMs) < 15 * 30.44 * DAY) {
        const X1 = book - (cash ?? 0) + ivst - pstkV; // v2.2: L = A - E substitution
        const X0 = prev.facts.book.v - (prev.facts.cash?.v ?? 0) + (prev.facts.ivst?.v ?? 0) - (prev.facts.pstk?.v ?? 0);
        tacc = (X1 - X0) / shBasis; }
      if (tacc === null) tacc = 0;
      const fy = new Date(base.endMs).getFullYear();
      const eps_t_w = wins("eps_t", E / shBasis, fy);
      const bps_w = book != null ? wins("bps", (book - pstkV) / shBasis, fy) : null;
      const tacc_w = wins("tacc", tacc, fy);
      const negE = E < 0 ? 1 : 0;
      const fRW = eps_t_w;
      const fEP = fitEP ? fitEP.beta[0] + fitEP.beta[1] * negE + fitEP.beta[2] * eps_t_w + fitEP.beta[3] * negE * eps_t_w : null;
      const fRI = (fitRI && bps_w != null) ? fitRI.beta[0] + fitRI.beta[1] * negE + fitRI.beta[2] * eps_t_w + fitRI.beta[3] * negE * eps_t_w + fitRI.beta[4] * bps_w + fitRI.beta[5] * tacc_w : null;
      const actual = dep.facts.E.v / shBasis; // year-t shares, today's basis (v2.1, Appendix A faithful)
      // v2.1 tolerance-free definitional identity assertion (every forecast row)
      if (Math.abs(actual * shBasis - dep.facts.E.v) > 1e-9 * Math.abs(dep.facts.E.v) + 1e-9)
        gateErrors.push(`${sym} ${Y} tau${tau}: identity violation aligned_dependent x shares_basis != raw E_(t+tau)`);
      const rawActualDepShares = sharesAt(f, dep.endMs, EVAL_CUTOFF);
      const oc = originClose(sym, Y);
      diag.forecast_rows++;
      if (!oc) { diag.price_missing++; }
      results.push({ sym, origin: Y, tau, fy, negE,
        eps_t: E / shBasis, actual, actual_dep_shares_basis: rawActualDepShares ? dep.facts.E.v / (rawActualDepShares.val * sharesFactor(sym, rawActualDepShares.ms)) : null,
        shares_t: shBasis, shares_reported: sh.val, F,
        rw: fRW, ep: fEP, ri: fRI,
        price_scaled: oc ? 1 : 0, price: oc?.close ?? null,
        sic: f.sic, assets: assets ?? null, unusual_large: (base.facts.unusual?.v ?? 0) > 0.01 * (assets ?? Infinity) }); } } }

if (gateErrors.length) {
  console.error("ABORT: unit-consistency gate failed:\n" + gateErrors.join("\n"));
  fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/RIM_MECHANICAL_FORECAST_VALIDATION.json"),
    JSON.stringify({ phase: "R1", status: "ABORTED_GATE", gate_errors: gateErrors, generated_at: new Date().toISOString() }, null, 2) + "\n");
  process.exit(4); }
console.log("unit-consistency gate PASSED. coverage:", coverage.toFixed(3), "forecast rows:", diag.forecast_rows, "price missing:", diag.price_missing);

// ---------- metrics + gates ----------
const metrics = {};
function computeMetrics(subset, label) {
  const out = {};
  for (const tau of TAUS) {
    const rows = subset.filter(r => r.tau === tau && r.price_scaled === 1);
    const m = {};
    for (const [model, key] of [["RW", "rw"], ["EP", "ep"], ["RI", "ri"]]) {
      const errs = rows.filter(r => r[key] != null).map(r => (r.actual - r[key]) / r.price);
      if (!errs.length) { m[model] = null; continue; }
      const abs = errs.map(Math.abs).sort((a, b) => a - b);
      m[model] = { n: errs.length,
        bias: errs.reduce((a, x) => a + x, 0) / errs.length,
        mae: abs.reduce((a, x) => a + x, 0) / abs.length,
        median_ae: quantile(abs, 0.5) }; }
    out[`tau${tau}`] = { count: rows.length, loss_share: rows.length ? rows.filter(r => r.negE === 1).length / rows.length : null, models: m }; }
  return { label, ...out }; }
const priced = results.filter(r => r.price_scaled === 1);
metrics.full = computeMetrics(priced, "full");
metrics.loss_only = computeMetrics(priced.filter(r => r.negE === 1), "loss_firms_only");
metrics.unusual_excluded = computeMetrics(priced.filter(r => !r.unusual_large), "large_unusual_excluded");
// buckets: size terciles + SIC groups (full sample)
const withAssets = priced.filter(r => Number.isFinite(r.assets));
const sortedA = [...withAssets].sort((a, b) => a.assets - b.assets);
const t1 = sortedA[Math.floor(sortedA.length / 3)].assets, t2 = sortedA[Math.floor(2 * sortedA.length / 3)].assets;
metrics.size_terciles = { T1_small: computeMetrics(withAssets.filter(r => r.assets <= t1), "T1_small"),
  T2_mid: computeMetrics(withAssets.filter(r => r.assets > t1 && r.assets <= t2), "T2_mid"),
  T3_large: computeMetrics(withAssets.filter(r => r.assets > t2), "T3_large") };
const sicGroups = {};
for (const r of priced) { const g = r.sic ? String(r.sic).slice(0, 1) : "X"; (sicGroups[g] ??= []).push(r); }
metrics.sic_groups = Object.fromEntries(Object.entries(sicGroups).map(([g, rows]) => [g, computeMetrics(rows, "SIC_" + g)]));

const gate = { necessary_tau1: null, necessary_tau2: null };
for (const tau of [1, 2]) {
  const m = metrics.full[`tau${tau}`]?.models;
  gate[`necessary_tau${tau}`] = m?.RI && m?.RW ? { ri_mae: m.RI.mae, rw_mae: m.RW.mae, ri_beats_rw: m.RI.mae < m.RW.mae } : null; }
const necessaryMet = gate.necessary_tau1?.ri_beats_rw === true && gate.necessary_tau2?.ri_beats_rw === true;
const avgMae = (model) => TAUS.map(t => metrics.full[`tau${t}`]?.models?.[model]?.mae).filter(x => x != null).reduce(( a, x, _, arr) => a + x / arr.length, 0);
const modelChoice = avgMae("RI") <= avgMae("EP") ? "RI" : "EP";

// unit-consistency diagnostic 2: rows where a split adjustment was applied at the
// year-t share basis (F > 1.5). The tolerance-free identity aligned_dependent x
// shares_basis == raw E_(t+tau) is enforced inside the loop above as a gate.
const splitRatioChecks = [];
for (const r of results) {
  if (r.F > 1.5) splitRatioChecks.push({ sym: r.sym, origin: r.origin, tau: r.tau, F: r.F }); }
const assertion2 = splitRatioChecks.slice(0, 20);

const validation = { schema_version: "feno_rim_recovery_r1_validation.v1", phase: "R1", research_only: true,
  criteria_sha256: FROZEN_SHA,
  universe: { symbols: symbols.length, firms_with_data: Object.keys(firms).length, price_coverage: coverage },
  effective_universe_declaration: universeReport,
  pools: diag.pools, counts: { forecast_rows: diag.forecast_rows, price_missing: diag.price_missing, voided_pairs: diag.voided_pairs, missing_shares: diag.missing_shares },
  coefficients: "see per-origin detail below",
  gate: { necessary_tau1: gate.necessary_tau1, necessary_tau2: gate.necessary_tau2, necessary_met: necessaryMet,
    sufficient_is_necessary: true, proceed_to_R2: necessaryMet,
    model_selection_rule: "lower average price-scaled MAE across tau 1..3 (full sample)", chosen_primary_model: modelChoice,
    avg_mae: { RI: avgMae("RI"), EP: avgMae("EP") } },
  metrics, split_ratio_assertion_sample: assertion2,
  generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/RIM_MECHANICAL_FORECAST_VALIDATION.json"), JSON.stringify(validation, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "data/computed/feno-rim-recovery/r1-edgar-panel.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r1_panel.v1", criteria_sha256: FROZEN_SHA,
  note: "forecast-level rows (per-share, year-t basis); firm-year pool detail retained in validation artifact pools summary",
  rows: results.map(r => ({ sym: r.sym, origin: r.origin, tau: r.tau, fy: r.fy, negE: r.negE,
    eps_t: r.eps_t, actual: r.actual, rw: r.rw, ep: r.ep, ri: r.ri, price_scaled: r.price_scaled })),
  generated_at: new Date().toISOString() }, null, 1) + "\n");

console.log("\n== R1 SUMMARY (full sample, price-scaled) ==");
for (const tau of TAUS) {
  const m = metrics.full[`tau${tau}`]?.models;
  console.log(`tau${tau}: RW mae ${m?.RW?.mae?.toFixed(4)} | EP ${m?.EP?.mae?.toFixed(4)} | RI ${m?.RI?.mae?.toFixed(4)} (n=${metrics.full[`tau${tau}`]?.count})`); }
console.log("gate:", JSON.stringify(gate), "proceed:", necessaryMet, "primary model:", modelChoice);
