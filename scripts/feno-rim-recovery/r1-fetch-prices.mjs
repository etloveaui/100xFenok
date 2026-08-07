// R1 data assembly: Yahoo v8 chart closes + splits maps for the frozen R1 universe
// (r1-criteria-v2.json price_source / unit_basis_precommitted). Data assembly only -
// no statistics. Resume-safe. Closes kept for 2019-05-01..2024-08-01 (covers the five
// origins' June-30 scaling dates plus the 2024-06-10 NVDA split for the continuity
// assertion); splits maps kept in full.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const PRICE_DIR = path.join(ROOT, "data/edgar/r1-panel/prices");
fs.mkdirSync(PRICE_DIR, { recursive: true });
const UA = "100xFenok-platform/1.0";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);

const p1 = Math.floor(Date.parse("1990-01-01T00:00:00Z") / 1000);
const p2 = Math.floor(Date.now() / 1000);
const iso = (sec, tzOffset) => new Date((sec + 0) * 1000); // dates taken from the API's own day boundaries below

let done = 0, failed = [];
const t0 = Date.now();
for (const sym of symbols) {
  const out = path.join(PRICE_DIR, sym + ".json");
  if (fs.existsSync(out)) { done++; continue; }
  const q = sym.replace(/\./g, "-");
  let ok = null;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`,
        { headers: { Accept: "application/json", "User-Agent": UA } });
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) { await sleep(1000 * (i + 1)); continue; }
      ok = await res.json(); break;
    } catch (e) { await sleep(1500 * (i + 1)); } }
  const result = ok?.chart?.result?.[0];
  if (!result || !Array.isArray(result.timestamp)) { failed.push({ symbol: sym, reason: ok?.chart?.error?.description ?? "no result" }); console.log("FAIL", sym, ok?.chart?.error?.description ?? "no result"); await sleep(200); continue; }
  const closesArr = result.indicators?.quote?.[0]?.close ?? [];
  const tz = result.meta?.exchangeTimezoneName ?? "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const closes = {};
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = closesArr[i]; if (!Number.isFinite(c)) continue;
    const d = fmt.format(new Date(result.timestamp[i] * 1000));
    if (d >= "2019-05-01" && d <= "2024-08-01") closes[d] = c; }
  const splits = {};
  for (const s of Object.values(result.events?.splits ?? {})) {
    const d = fmt.format(new Date(s.date * 1000));
    splits[d] = (s.numerator ?? 1) / (s.denominator ?? 1); }
  fs.writeFileSync(out, JSON.stringify({ schema_version: "feno_rim_recovery_r1_price_cache.v1", symbol: sym,
    source: "yahoo-v8-chart", timezone: tz, close_window: "2019-05-01..2024-08-01", closes, splits,
    fetched_at_utc: new Date().toISOString() }, null, 1));
  done++;
  if (done % 50 === 0) console.log(`prices ${done}/${symbols.length} elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(200); }
console.log("prices done:", done, "failed:", failed.length);
fs.writeFileSync(path.join(PRICE_DIR, "..", "price-fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r1_price_receipt.v1", generated_at: new Date().toISOString(),
  universe: symbols.length, fetched_or_cached: done, failed,
  note: "data assembly only; origin-basis conversion happens at panel build per frozen criteria" }, null, 2));
console.log("receipt written.");
