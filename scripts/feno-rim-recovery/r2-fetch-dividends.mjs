// R2 data assembly (NOT a result computation): fetch per-share dividends for the R1 universe
// from the Yahoo v8 chart API (events=div), needed for the GLS payout ratio k and the
// clean-surplus book roll-forward. Window 2018-01-01..2024-12-31 covers the five origins
// (2019-2023) trailing windows. Resume-safe; writes data/edgar/r2-panel/dividends/{SYM}.json.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const OUT_DIR = path.join(ROOT, "data/edgar/r2-panel/dividends");
fs.mkdirSync(OUT_DIR, { recursive: true });
const UA = "100xFenok-platform/1.0";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);

const p1 = Math.floor(Date.parse("2018-01-01T00:00:00Z") / 1000);
const p2 = Math.floor(Date.parse("2024-12-31T00:00:00Z") / 1000);

let done = 0, skipped = 0, failed = [];
const t0 = Date.now();
for (const sym of symbols) {
  const q = sym.replace(/\./g, "-");
  const out = path.join(OUT_DIR, sym + ".json");
  if (fs.existsSync(out)) { skipped++; continue; }
  let ok = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`,
        { headers: { Accept: "application/json", "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      if (res.ok) ok = await res.json(); break;
    } catch (e) { await sleep(1500 * (i + 1)); } }
  const result = ok?.chart?.result?.[0];
  if (!result) { failed.push({ symbol: sym, reason: ok?.chart?.error?.description ?? "no result" }); console.log("FAIL", sym); await sleep(200); continue; }
  const tz = result.meta?.exchangeTimezoneName ?? "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const divs = {};
  for (const d of Object.values(result.events?.dividends ?? {})) {
    if (Number.isFinite(d.amount) && d.amount > 0) divs[fmt.format(new Date(d.date * 1000))] = d.amount; }
  fs.writeFileSync(out, JSON.stringify({ schema_version: "feno_rim_recovery_r2_dividend_cache.v1", symbol: sym,
    source: "yahoo-v8-chart", timezone: tz, window: "2018-01-01..2024-12-31", dividends: divs,
    n_dividends: Object.keys(divs).length, fetched_at_utc: new Date().toISOString() }, null, 1));
  done++;
  if (done % 50 === 0) console.log(`dividends ${done} fetched (${skipped} skipped) elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(200); }
console.log("dividends done:", done, "skipped:", skipped, "failed:", failed.length);
fs.writeFileSync(path.join(OUT_DIR, "..", "dividend-fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r2_dividend_receipt.v1", generated_at: new Date().toISOString(),
  fetched: done, skipped_already: skipped, failed, window: "2018-01-01..2024-12-31",
  note: "data assembly for GLS payout ratio k and clean-surplus roll-forward; not a result computation" }, null, 2));
