// R1 data assembly (NOT a result computation): fetch SEC EDGAR companyfacts for the frozen
// R1 universe (r1-criteria.json universe_precommitted) and Stooq daily closes for error
// scaling. Raw caches only; the PIT panel and every statistic are built later, after the
// red-team criteria review returns. Resume-safe: existing cache files are skipped.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const CACHE_DIR = path.join(ROOT, "data/edgar/r1-panel");
const STOOQ_DIR = path.join(CACHE_DIR, "stooq");
fs.mkdirSync(STOOQ_DIR, { recursive: true });

const UA = process.env.SEC_USER_AGENT ?? "100xFenok RIM recovery R1 panel builder/1.0 (contact: no-reply@100xfenok.local)";
const CONCEPTS = [
  // earnings (primary + fallback)
  "IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity", "NetIncomeLoss",
  // book / shares
  "StockholdersEquity", "PreferredStockValue", "CommonStockSharesOutstanding",
  // TACC components
  "Assets", "AssetsCurrent", "CashAndCashEquivalentsAtCarryingValue", "LiabilitiesCurrent",
  "LongTermDebtCurrent", "Liabilities", "LongTermDebtNoncurrent", "LongTermDebt",
  "ShortTermInvestments", "MarketableSecuritiesCurrent", "OtherNoncurrentAssets"
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) return { error: "HTTP " + res.status };
      return { ok: await res.json() };
    } catch (e) { await sleep(1000 * (i + 1)); }
  }
  return { error: "retries exhausted" }; }

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(1200 * (i + 1)); continue; }
      if (!res.ok) return { error: "HTTP " + res.status };
      return { ok: await res.text() };
    } catch (e) { await sleep(800 * (i + 1)); }
  }
  return { error: "retries exhausted" }; }

// ---------- universe ----------
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const tickers = rj("data/edgar/company_tickers.json").rows;
const byTicker = {}; for (const t of tickers) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])];
const unmapped = symbols.filter(s => !byTicker[s]);
const mapped = symbols.filter(s => byTicker[s]);
console.log("universe:", symbols.length, "mapped:", mapped.length, "unmapped:", unmapped.join(","));

// ---------- SEC cik-ticker-sic (industry buckets) ----------
const sicPath = path.join(CACHE_DIR, "cik-ticker-sic.json");
if (!fs.existsSync(sicPath)) {
  const s = await fetchJson("https://www.sec.gov/files/cik-ticker-sic.json");
  if (s.ok) fs.writeFileSync(sicPath, JSON.stringify(s.ok));
  else console.log("sic fetch failed:", s.error);
  await sleep(200); }

// ---------- companyfacts ----------
let done = 0, failed = [];
const t0 = Date.now();
for (const sym of mapped) {
  const out = path.join(CACHE_DIR, sym + ".json");
  if (fs.existsSync(out)) { done++; continue; }
  const cik = String(byTicker[sym]).padStart(10, "0");
  const r = await fetchJson("https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json");
  if (!r.ok) { failed.push({ symbol: sym, cik, reason: r.error }); console.log("FAIL", sym, r.error); await sleep(150); continue; }
  const facts = r.ok.facts?.["us-gaap"] || {};
  const concepts = {};
  for (const c of CONCEPTS) {
    const units = facts[c]?.units; if (!units) continue;
    const rows = units.USD || units.shares || [];
    const annual = rows.filter(x => (x.form === "10-K" || x.form === "10-K/A") && (x.fp === "FY"))
      .map(x => ({ end: x.end, val: x.val, accn: x.accn, fy: x.fy, fp: x.fp, form: x.form, filed: x.filed, unit: units.USD ? "USD" : "shares" }));
    if (annual.length) concepts[c] = annual; }
  fs.writeFileSync(out, JSON.stringify({ schema_version: "feno_rim_recovery_r1_edgar_cache.v1", symbol: sym, cik,
    fetched_at_utc: new Date().toISOString(), source: "https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json", concepts }, null, 1));
  done++;
  if (done % 25 === 0) console.log(`edgar ${done}/${mapped.length} elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(150); }
console.log("edgar done:", done, "failed:", failed.length, "elapsed", Math.round((Date.now() - t0) / 1000) + "s");

// ---------- stooq closes around June-30 origins ----------
const stooqT0 = Date.now(); let sdone = 0, sfailed = [];
for (const sym of mapped) {
  const out = path.join(STOOQ_DIR, sym + ".json");
  if (fs.existsSync(out)) { sdone++; continue; }
  const r = await fetchText(`https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`);
  if (!r.ok || !r.ok.includes("Date")) { sfailed.push({ symbol: sym, reason: r.error ?? "no csv" }); console.log("STOOQ FAIL", sym, r.error ?? "no csv"); await sleep(300); continue; }
  const lines = r.ok.trim().split("\n");
  const hdr = lines[0].split(",");
  const di = hdr.indexOf("Date"), ci = hdr.indexOf("Close");
  const picks = {};
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(","); const d = p[di];
    if (d >= "2019-06-01" && d <= "2023-07-20") picks[d] = Number(p[ci]); }
  fs.writeFileSync(out, JSON.stringify({ symbol: sym, source: "stooq", window: "2019-06-01..2023-07-20", closes: picks }, null, 1));
  sdone++;
  if (sdone % 50 === 0) console.log(`stooq ${sdone}/${mapped.length} elapsed ${Math.round((Date.now() - stooqT0) / 1000)}s`);
  await sleep(250); }
console.log("stooq done:", sdone, "failed:", sfailed.length);

fs.writeFileSync(path.join(CACHE_DIR, "fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r1_fetch_receipt.v1", generated_at: new Date().toISOString(),
  universe_total: symbols.length, mapped: mapped.length, unmapped,
  edgar: { fetched_or_cached: done, failed }, stooq: { fetched_or_cached: sdone, failed: sfailed },
  note: "data assembly only; no statistics computed here" }, null, 2));
console.log("receipt written.");
