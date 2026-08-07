// R1 data assembly fix (pre-run, per red-team fh-20260807-072): the PRIMARY earnings concept
// IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity was never fetched,
// so E would fall through to NetIncomeLoss for 100% of rows while the criteria declare the
// primary. Fetch it (and the discontinued-operations tag for the large-unusual screen) and
// merge into every cache. Resume-safe; no statistics.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const CACHE_DIR = path.join(ROOT, "data/edgar/r1-panel");
const UA = process.env.SEC_USER_AGENT ?? "100xFenok RIM recovery R1 panel builder/1.0 (contact: no-reply@100xfenok.local)";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CONCEPTS = ["IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity",
  "IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity"];

const FALLBACK_CIK = { AEP: "0000004902" };
const sp500 = rj("data/slickcharts/sp500.json").holdings.map(h => h.symbol);
const rimDow = fs.readdirSync(path.join(ROOT, "data/edgar/rim-dow")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
const byTicker = {}; for (const t of rj("data/edgar/company_tickers.json").rows) byTicker[t.ticker] = t.cik;
const symbols = [...new Set([...sp500, ...rimDow])].filter(s => byTicker[s] || byTicker[s.replace(/\./g, "-")] || FALLBACK_CIK[s]);
const resolve = (s) => byTicker[s] ? String(byTicker[s]).padStart(10, "0")
  : byTicker[s.replace(/\./g, "-")] ? String(byTicker[s.replace(/\./g, "-")]).padStart(10, "0")
  : FALLBACK_CIK[s] ? String(FALLBACK_CIK[s]).padStart(10, "0") : null;

let done = 0, skipped = 0, failed = [];
const t0 = Date.now();
for (const sym of symbols) {
  const cachePath = path.join(CACHE_DIR, sym + ".json");
  if (!fs.existsSync(cachePath)) { failed.push({ symbol: sym, reason: "no cache file" }); continue; }
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  if (cache.concepts?.[CONCEPTS[0]] !== undefined) { skipped++; continue; } // present (even if empty array) = done
  const cik = resolve(sym);
  if (!cik) { failed.push({ symbol: sym, reason: "no cik" }); continue; }
  let ok = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json", { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      if (res.ok) ok = await res.json(); break;
    } catch (e) { await sleep(1500 * (i + 1)); } }
  if (!ok) { failed.push({ symbol: sym, cik, reason: "fetch failed" }); console.log("FAIL", sym); await sleep(150); continue; }
  const gaap = ok.facts?.["us-gaap"] ?? {};
  for (const c of CONCEPTS) {
    const rows = gaap[c]?.units?.USD ?? [];
    cache.concepts[c] = rows.map(x => ({ end: x.end, start: x.start, val: x.val, accn: x.accn, fy: x.fy, fp: x.fp, form: x.form, filed: x.filed })); }
  cache.primary_e_fetched_at_utc = new Date().toISOString();
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  done++;
  if (done % 50 === 0) console.log(`primary-E ${done} merged (${skipped} skipped) elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  await sleep(150); }
console.log("primary-E merge done:", done, "skipped:", skipped, "failed:", failed.length);
fs.writeFileSync(path.join(CACHE_DIR, "primary-e-fetch-receipt.json"), JSON.stringify({
  schema_version: "feno_rim_recovery_r1_primary_e_receipt.v1", generated_at: new Date().toISOString(),
  merged: done, skipped_already_present: skipped, failed, concepts: CONCEPTS,
  note: "data assembly fix per red-team fh-20260807-072 before the R1 run" }, null, 2));
