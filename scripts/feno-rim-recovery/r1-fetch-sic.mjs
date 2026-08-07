// R1 data assembly stage 2 (NOT a result computation): SEC submissions metadata for the
// frozen R1 universe - SIC codes (industry-bucket reporting) and fiscalYearEnd (FYE
// April-June look-ahead guard). Also recovers the three unmapped symbols declared below.
// Resume-safe.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const CACHE_DIR = path.join(ROOT, "data/edgar/r1-panel");
const SIC_DIR = path.join(CACHE_DIR, "sic");
fs.mkdirSync(SIC_DIR, { recursive: true });
const UA = process.env.SEC_USER_AGENT ?? "100xFenok RIM recovery R1 panel builder/1.0 (contact: no-reply@100xfenok.local)";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Pre-declared mapping rules (criteria universe_precommitted, declared deviations):
// 1) share-class dot to SEC dash: BRK.B -> BRK-B, BF.B -> BF-B (normalization, not a pick)
// 2) explicit fallback for symbols absent from SEC company_tickers.json entirely:
const FALLBACK_CIK = { AEP: "0000004902" }; // American Electric Power, verified via SEC EDGAR browse

const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const tickers = rj("data/edgar/company_tickers.json").rows;
const byTicker = {}; for (const t of tickers) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])];
const resolve = (s) => byTicker[s] ? String(byTicker[s]).padStart(10, "0")
  : byTicker[s.replace(/\./g, "-")] ? String(byTicker[s.replace(/\./g, "-")]).padStart(10, "0")
  : FALLBACK_CIK[s] ? String(FALLBACK_CIK[s]).padStart(10, "0") : null;

let done = 0, failed = [];
const t0 = Date.now();
for (const sym of symbols) {
  const out = path.join(SIC_DIR, sym + ".json");
  if (fs.existsSync(out)) { done++; continue; }
  const cik = resolve(sym);
  if (!cik) { failed.push({ symbol: sym, reason: "no cik" }); continue; }
  let ok = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://data.sec.gov/submissions/CIK" + cik + ".json", { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (res.ok) ok = await res.json(); break;
    } catch (e) { await sleep(1000 * (i + 1)); } }
  if (!ok) { failed.push({ symbol: sym, cik, reason: "fetch failed" }); console.log("FAIL", sym); await sleep(150); continue; }
  fs.writeFileSync(out, JSON.stringify({ schema_version: "feno_rim_recovery_r1_sic_cache.v1", symbol: sym, cik,
    name: ok.name, sic: ok.sic, sicDescription: ok.sicDescription, fiscalYearEnd: ok.fiscalYearEnd,
    exchanges: ok.exchanges, tickers: ok.tickers, fetched_at_utc: new Date().toISOString() }, null, 1));
  done++;
  if (done % 50 === 0) console.log(`sic ${done}/${symbols.length} elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(150); }
console.log("sic done:", done, "failed:", failed.length, JSON.stringify(failed));
fs.writeFileSync(path.join(CACHE_DIR, "sic-fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r1_sic_receipt.v1", generated_at: new Date().toISOString(),
  universe: symbols.length, fetched_or_cached: done, failed,
  mapping_rules: ["dot-to-dash share-class normalization", "FALLBACK_CIK explicit list"],
  note: "data assembly only; no statistics" }, null, 2));
