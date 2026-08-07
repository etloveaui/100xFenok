// R2-B GLS-ICC: implied cost of equity per (firm, origin) on R1 mechanical forecasts.
// Bound to r2-criteria.json (sha below). R2-A FL3-V/P deferred (industry cost-of-equity
// unanchored). Guards on inputs only - solved ICC is reported as solved, never outcome-truncated.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { glsIcc } from "./r2-gls-solver.mjs";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const CRIT_PATH = "data/computed/feno-rim-recovery/r2-criteria.json";
const FROZEN_SHA = "813d0d562b4dc7d949d7977e4909d62817c4766dc7515a5096c8f437f47a6d20";
const RESULT = "data/computed/feno-rim-recovery/R2_GLS_ICC.json";
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;
const r6 = (x) => Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
const ORIGINS = [2019, 2020, 2021, 2022, 2023];
const T = 12, FADE_START = 4, TRAIL_YEARS = 5;

if (crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, CRIT_PATH))).digest("hex") !== FROZEN_SHA) { console.error("ABORT: criteria changed"); process.exit(3); }
if (fs.existsSync(path.join(ROOT, RESULT))) { console.error("ABORT: result exists:", RESULT); process.exit(3); }

// ---------- price helpers (today-basis) ----------
const priceCache = {};
function loadPrices(sym) { if (!priceCache[sym]) { const p = path.join(ROOT, "data/edgar/r1-panel/prices/" + sym + ".json");
  priceCache[sym] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } return priceCache[sym]; }
function originClose(sym, Y) { const pc = loadPrices(sym); if (!pc) return null;
  const target = `${Y}-06-30`; const dates = Object.keys(pc.closes).filter(d => d <= target).sort();
  const d = dates.at(-1); if (!d) return null; if (ms(target) - ms(d) > 16 * DAY) return null; return pc.closes[d]; }
function sharesFactor(sym, afterMs) { const pc = loadPrices(sym); if (!pc) return 1;
  let F = 1; for (const [sd, f] of Object.entries(pc.splits)) if (ms(sd) > afterMs) F *= f; return F; }

// ---------- annual fact identification (duration-based, same as R1) ----------
function annualDuration(concepts, name) { const rows = concepts?.[name]; if (!rows) return [];
  const byEnd = new Map();
  for (const r of rows) { if (!(r.form === "10-K" || r.form === "10-K/A")) continue;
    if (!r.end || !r.start || !Number.isFinite(r.val)) continue;
    const days = (ms(r.end) - ms(r.start)) / DAY; if (days < 300 || days > 400) continue;
    const cur = byEnd.get(r.end); if (!cur || r.filed < cur.filed) byEnd.set(r.end, r); }
  return [...byEnd.values()].map(r => ({ endMs: ms(r.end), val: r.val, filed: ms(r.filed) })).sort((a, b) => a.endMs - b.endMs); }
function instantSeries(concepts, name) { const rows = concepts?.[name]; if (!rows) return [];
  const byEnd = new Map();
  for (const r of rows) { if (!r.end || !Number.isFinite(r.val)) continue;
    const cur = byEnd.get(r.end); if (!cur || r.filed < cur.filed) byEnd.set(r.end, r); }
  return [...byEnd.values()].map(r => ({ endMs: ms(r.end), val: r.val, filed: ms(r.filed) })).sort((a, b) => a.endMs - b.endMs); }
function matchInstant(series, targetMs, tolDays) { let best = null;
  for (const s of series) { const d = Math.abs(s.endMs - targetMs); if (d > tolDays * DAY) continue;
    if (!best || d < best.d || (d === best.d && s.filed < best.filed)) best = { endMs: s.endMs, val: s.val, filed: s.filed, d }; }
  return best; }
function sharesFacts(concepts) { const rows = concepts?.["EntityCommonStockSharesOutstanding"] ?? []; if (!rows.length) return [];
  const byDate = new Map();
  for (const r of rows) { const date = r.start ?? r.end; if (!date || !Number.isFinite(r.val) || r.val <= 0) continue;
    const cur = byDate.get(date); if (!cur || r.filed < cur.filed) byDate.set(date, r); }
  return [...byDate.values()].map(r => ({ date: r.start ?? r.end, ms: ms(r.start ?? r.end), val: r.val, filed: ms(r.filed) })).sort((a, b) => a.ms - b.ms); }
function sharesAt(f, endMs, asOf) { let best = null;
  for (const s of f.shares) { if (s.filed > asOf) continue;
    if (s.ms < endMs - 183 * DAY || s.ms > endMs + 90 * DAY) continue;
    if (f.shareBasisLo != null && (s.basis < f.shareBasisLo || s.basis > f.shareBasisHi)) continue;
    const d = Math.abs(s.ms - endMs);
    if (!best || d < best.d || (d === best.d && s.ms > best.s.ms)) best = { s, d }; }
  return best?.s ?? null; }

// ---------- build firms (same structure as R1) ----------
const E_PRIMARY = "IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity";
const E_FALLBACK = "NetIncomeLoss";
const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);
const sicOf = {}; for (const s of symbols) { try { sicOf[s] = String(rj("data/edgar/r1-panel/sic/" + s + ".json").sic ?? "").slice(0, 2); } catch { sicOf[s] = ""; } }

const firms = {};
for (const sym of symbols) {
  const p = path.join(ROOT, "data/edgar/r1-panel/" + sym + ".json");
  if (!fs.existsSync(p)) continue;
  const concepts = JSON.parse(fs.readFileSync(p, "utf8")).concepts;
  const eP = annualDuration(concepts, E_PRIMARY), eF = annualDuration(concepts, E_FALLBACK);
  const bookS = instantSeries(concepts, "StockholdersEquity");
  const pstkS = instantSeries(concepts, "PreferredStockValue");
  const assetsS = instantSeries(concepts, "Assets");
  const shares = sharesFacts(concepts);
  if (!eP.length && !eF.length) continue;
  const years = new Map();
  const ensure = (endMs) => { if (!years.has(endMs)) years.set(endMs, { endMs, facts: {} }); return years.get(endMs); };
  for (const r of eP) { const y = ensure(r.endMs); if (!y.facts.E) { y.facts.E = { v: r.val, filed: r.filed }; y.facts.E_src = { v: "primary" }; } }
  for (const r of eF) { const y = ensure(r.endMs); if (!y.facts.E) { y.facts.E = { v: r.val, filed: r.filed }; y.facts.E_src = { v: "fallback" }; } }
  for (const [endMs, y] of years) {
    const bm = matchInstant(bookS, endMs, 45); if (bm) y.facts.book = { v: bm.val, filed: bm.filed };
    const pm = matchInstant(pstkS, endMs, 45); if (pm) y.facts.pstk = { v: pm.val, filed: pm.filed };
    const am = matchInstant(assetsS, endMs, 45); if (am) y.facts.assets = { v: am.val, filed: am.filed }; }
  const sharesTagged = shares.map(sh => ({ ...sh, basis: sh.val * sharesFactor(sym, sh.ms) }));
  const basisSorted = sharesTagged.map(sh => sh.basis).sort((a, b) => a - b);
  const medBasis = basisSorted.length ? basisSorted[Math.floor(basisSorted.length / 2)] : null;
  firms[sym] = { years: [...years.values()].sort((a, b) => a.endMs - b.endMs), shares: sharesTagged,
    shareBasisLo: medBasis != null ? medBasis / 10 : null, shareBasisHi: medBasis != null ? medBasis * 10 : null, sic: sicOf[sym] }; }
console.log("firms built:", Object.keys(firms).length);

// ---------- R1 forecasts, dividends, rates ----------
const panel = rj("data/computed/feno-rim-recovery/r1-edgar-panel.json");
const fc = {}; for (const row of panel.rows) { const k = row.sym + "|" + row.origin; (fc[k] ??= {})[row.tau] = { ep: row.ep, ri: row.ri }; }
const divCache = {}; for (const s of symbols) { const p = path.join(ROOT, "data/edgar/r2-panel/dividends/" + s + ".json");
  divCache[s] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; }
const rates = rj("data/macro/fred-banking-daily.json").series.DGS10;
function rfAt(Y) { const target = `${Y}-06-30`; let r = null; for (const x of rates) { if (x.date <= target) r = x; else break; } return r ? r.value * 0.01 : null; }

// ---------- industry median ROE targets ----------
function industryTargets(Y) {
  const originMs = ms(`${Y}-06-30`), lo = originMs - Math.round((TRAIL_YEARS + 0.5) * 365 * DAY);
  const byInd = {}, all = [];
  for (const [sym, f] of Object.entries(firms)) {
    const ind = f.sic || "X";
    for (const y of f.years) {
      if (y.endMs >= originMs || y.endMs < lo) continue;
      const E = y.facts.E?.v, book = y.facts.book?.v;
      if (!(E > 0) || !(book > 0)) continue; // profitable firm-years only
      const roe = E / book; if (!Number.isFinite(roe)) continue;
      (byInd[ind] ??= []).push(roe); all.push(roe); } }
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const marketMed = med(all);
  const targets = {}; for (const [ind, arr] of Object.entries(byInd)) targets[ind] = arr.length >= 3 ? med(arr) : marketMed;
  return { targets, marketMed }; }

// ---------- GLS solve per (firm, origin) ----------
const rows = []; const diag = { per_origin: {}, nonconverged: 0, excluded_no_dividend: 0, excluded_no_book: 0,
  excluded_no_price: 0, excluded_no_forecast: 0, excluded_nonpositive_book: 0 };
for (const Y of ORIGINS) {
  const originMs = ms(`${Y}-06-30`); const guardEnd = ms(`${Y}-03-31`);
  const rf = rfAt(Y); const { targets, marketMed } = industryTargets(Y);
  const perOrigin = [];
  for (const [sym, f] of Object.entries(firms)) {
    // base year t*: latest usable fiscal year at origin (FYE guard)
    let tIdx = -1;
    for (let i = f.years.length - 1; i >= 0; i--) { const y = f.years[i];
      if (y.endMs > originMs) continue;
      if (y.facts.E == null || y.facts.E.filed > originMs) continue;
      const m = new Date(y.endMs).getUTCMonth() + 1;
      if (m >= 4 && m <= 6 && y.endMs > guardEnd) continue;
      tIdx = i; break; }
    if (tIdx < 0) continue;
    const base = f.years[tIdx];
    const sh = sharesAt(f, base.endMs, originMs); if (!sh) continue;
    const shBasis = sh.val * sharesFactor(sym, sh.ms);
    const book = base.facts.book, pstkV = base.facts.pstk?.v ?? 0, assetsV = base.facts.assets?.v ?? null;
    if (!book || book.filed > originMs) { diag.excluded_no_book++; continue; }
    const B0 = (book.v - pstkV) / shBasis;
    if (!(B0 > 0)) { diag.excluded_nonpositive_book++; continue; }
    const price = originClose(sym, Y); if (price == null) { diag.excluded_no_price++; continue; }
    if (!(price > 1)) { continue; } // FL98/BR price > $1 filter
    const fcast = fc[sym + "|" + Y];
    if (!fcast || fcast[1] == null || fcast[2] == null || fcast[3] == null) { diag.excluded_no_forecast++; continue; }
    // payout k
    const div = divCache[sym]; if (div == null) { diag.excluded_no_dividend++; continue; }
    let ttmDps = 0; for (const [d, amt] of Object.entries(div.dividends)) { const dm = ms(d); if (dm > originMs - 365 * DAY && dm <= originMs) ttmDps += amt; }
    const epsRaw = base.facts.E.v / shBasis;
    let k;
    if (ttmDps === 0) k = 0;
    else if (epsRaw > 0) k = Math.min(1, Math.max(0, ttmDps / epsRaw));
    else { const taPerShare = assetsV != null ? assetsV / shBasis : null;
      k = taPerShare != null && taPerShare > 0 ? Math.min(1, Math.max(0, ttmDps / (0.06 * taPerShare))) : 0; }
    const targetRoe = targets[f.sic || "X"] ?? marketMed;
    if (targetRoe == null) continue;
    // solve RI path (primary) and EP path (sensitivity)
    const iccRI = glsIcc({ price, B0, feps1: fcast[1].ri, feps2: fcast[2].ri, feps3: fcast[3].ri, payout: k, targetRoe, T });
    const iccEP = glsIcc({ price, B0, feps1: fcast[1].ep, feps2: fcast[2].ep, feps3: fcast[3].ep, payout: k, targetRoe, T });
    if (iccRI == null) diag.nonconverged++;
    const mcap = price * shBasis;
    perOrigin.push({ sym, B0: r6(B0), price: r6(price), mcap: r6(mcap), payout: r6(k), targetRoe: r6(targetRoe),
      icc_ri: iccRI != null ? r6(iccRI) : null, icc_ep: iccEP != null ? r6(iccEP) : null,
      icc_minus_rf: iccRI != null && rf != null ? r6(iccRI - rf) : null }); }
  // percentile of icc_ri within origin
  const vals = perOrigin.filter(r => r.icc_ri != null).map(r => r.icc_ri).sort((a, b) => a - b);
  for (const r of perOrigin) { if (r.icc_ri != null && vals.length) {
    let idx = 0; while (idx < vals.length && vals[idx] < r.icc_ri) idx++;
    r.icc_percentile = r6(idx / vals.length); } }
  // aggregation
  const withIcc = perOrigin.filter(r => r.icc_ri != null);
  const capSum = withIcc.reduce((a, r) => a + r.mcap, 0);
  const cw = (field) => capSum > 0 ? withIcc.reduce((a, r) => a + r[field] * r.mcap, 0) / capSum : null;
  const sortedByIcc = [...withIcc].sort((a, b) => a.icc_ri - b.icc_ri);
  const capWeightedMedian = (() => { if (!sortedByIcc.length || capSum <= 0) return null;
    let cum = 0; for (const r of sortedByIcc) { cum += r.mcap; if (cum >= capSum / 2) return r.icc_ri; } return sortedByIcc.at(-1).icc_ri; })();
  const trimmed = (() => { const s = [...withIcc].sort((a, b) => a.icc_ri - b.icc_ri); const nCut = Math.floor(s.length * 0.05);
    const kept = s.slice(nCut, s.length - nCut); const cs = kept.reduce((a, r) => a + r.mcap, 0);
    return cs > 0 ? kept.reduce((a, r) => a + r.icc_ri * r.mcap, 0) / cs : null; })();
  const ew = (field) => withIcc.length ? withIcc.reduce((a, r) => a + r[field], 0) / withIcc.length : null;
  diag.per_origin[Y] = { firms_solved: withIcc.length, firms_attempted: perOrigin.length, rf: r6(rf),
    cap_weighted_mean_icc: r6(cw("icc_ri")), cap_weighted_median_icc: r6(capWeightedMedian),
    cap_weighted_trimmed_icc: r6(trimmed), cap_weighted_mean_icc_minus_rf: r6(cw("icc_minus_rf")),
    equal_weighted_mean_icc: r6(ew("icc_ri")), equal_weighted_mean_icc_minus_rf: r6(ew("icc_minus_rf")) };
  rows.push(...perOrigin.map(r => ({ ...r, origin: Y })));
  console.log(`origin ${Y}: solved ${withIcc.length}/${perOrigin.length}, cw_median_icc ${diag.per_origin[Y].cap_weighted_median_icc}, cw_mean_minus_rf ${diag.per_origin[Y].cap_weighted_mean_icc_minus_rf}`); }

const out = { schema_version: "feno_rim_recovery_r2_gls_icc.v1", phase: "R2-B", research_only: true,
  criteria_sha256: FROZEN_SHA,
  note: "GLS-ICC on R1 mechanical forecasts; RI path primary, EP path sensitivity; guards on inputs only; R2-A FL3-V/P deferred (industry cost-of-equity unanchored).",
  diag, per_origin: diag.per_origin,
  rows, generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, RESULT), JSON.stringify(out, null, 1) + "\n");
console.log("\n== R2-B SUMMARY ==");
console.log("total rows:", rows.length, "with icc_ri:", rows.filter(r => r.icc_ri != null).length, "nonconverged:", diag.nonconverged);
for (const Y of ORIGINS) { const d = diag.per_origin[Y];
  console.log(`${Y}: rf ${d.rf} | cw_mean ${d.cap_weighted_mean_icc} cw_median ${d.cap_weighted_median_icc} trimmed ${d.cap_weighted_trimmed_icc} | minus_rf_mean ${d.cap_weighted_mean_icc_minus_rf}`); }
