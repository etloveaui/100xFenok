// R3 data assembly (NOT a result computation): re-fetch closes on an EXTENDED window
// (2019-05-01..2026-08-01) so every origin (2019-2023) has its full 36-month-forward
// return available. Written to a SEPARATE r3 cache so the committed R1/R2 price inputs are
// untouched. Resume-safe with overwrite (r3 cache is dedicated).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const OUT_DIR = path.join(ROOT, "data/edgar/r3-panel/prices");
fs.mkdirSync(OUT_DIR, { recursive: true });
const UA = "100xFenok-platform/1.0";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);

const p1 = Math.floor(Date.parse("2019-01-01T00:00:00Z") / 1000);
const p2 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);
const WIN_LO = "2019-05-01", WIN_HI = "2026-08-01";

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
  if (!result || !Array.isArray(result.timestamp)) { failed.push({ symbol: sym, reason: ok?.chart?.error?.description ?? "no result" }); console.log("FAIL", sym); await sleep(200); continue; }
  const tz = result.meta?.exchangeTimezoneName ?? "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const closes = {};
  const closesArr = result.indicators?.quote?.[0]?.close ?? [];
  for (let i = 0; i < result.timestamp.length; i++) { const c = closesArr[i]; if (!Number.isFinite(c)) continue;
    const d = fmt.format(new Date(result.timestamp[i] * 1000)); if (d >= WIN_LO && d <= WIN_HI) closes[d] = c; }
  const splits = {};
  for (const s of Object.values(result.events?.splits ?? {})) splits[fmt.format(new Date(s.date * 1000))] = (s.numerator ?? 1) / (s.denominator ?? 1);
  fs.writeFileSync(out, JSON.stringify({ schema_version: "feno_rim_recovery_r3_price_cache.v1", symbol: sym,
    source: "yahoo-v8-chart", timezone: tz, close_window: `${WIN_LO}..${WIN_HI}`, closes, splits,
    fetched_at_utc: new Date().toISOString() }, null, 1));
  done++;
  if (done % 50 === 0) console.log(`prices ${done} fetched (${skipped} skipped) elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(200); }
console.log("r3 prices done:", done, "skipped:", skipped, "failed:", failed.length);
fs.writeFileSync(path.join(OUT_DIR, "..", "r3-price-fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r3_price_receipt.v1", generated_at: new Date().toISOString(),
  fetched: done, skipped_already: skipped, failed, window: `${WIN_LO}..${WIN_HI}`,
  note: "extended window for 36m forward returns across all five origins; separate r3 cache, R1/R2 inputs untouched" }, null, 2));
