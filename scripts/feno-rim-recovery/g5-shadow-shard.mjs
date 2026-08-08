// G5 — live shadow archive shard writer (mandate §12). Append-only, date-sharded, idempotent-by-refusal.
// Schema v1 is FIXED (changing it later breaks archive comparability). No scheduler; run manually/weekly.
// Usage: node g5-shadow-shard.mjs --date YYYY-MM-DD [--out <dir>]
//   Default out: data/computed/feno-rim-recovery/shadow (PRODUCTION). Dry-run/preview: --out _tmp/handoff/g5-run/shadow.
//   Refuses (exit 3) if the shard for --date already exists. Never overwrites, never modifies existing shards.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

// Repo root, resolved the way every committed sibling in this directory resolves it:
// scripts/feno-rim-recovery/<file> -> up two. The draft assumed it lived under _tmp and
// walked out to source/100xFenok explicitly, which silently produced source/source/... once
// the file was promoted — and silently is the problem: the append-only refusal checks a path
// under ROOT, so a wrong ROOT makes the guard pass on a shard that already exists.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUT = path.join(ROOT, "data/computed/feno-rim-recovery/shadow");
const rj = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const ms = (d) => Date.parse(d + "T00:00:00Z"), DAY = 864e5;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const shaFile = (p) => sha(fs.readFileSync(p));

// ---- args ----
const args = process.argv.slice(2);
// indexOf returns -1 when a flag is absent, and args[-1 + 1] is args[0] — so the draft's
// `args[args.indexOf("--out") + 1]` silently resolved --out to the literal string "--date"
// whenever --out was omitted, writing the shard into a directory named "--date". That is not
// a cosmetic bug: the append-only guard tests a path built from OUT_DIR, so a bogus OUT_DIR
// makes the guard pass every time and the archive stops being append-only. The dry run hid
// it because it always passed --out explicitly.
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`missing value for ${name}`); process.exit(2);
  }
  return v;
};
const dateArg = flagValue("--date");
const outArg = flagValue("--out");
const SNAPSHOT_DATE = dateArg || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(SNAPSHOT_DATE)) { console.error("bad --date:", SNAPSHOT_DATE); process.exit(2); }
const OUT_DIR = outArg ? path.resolve(outArg) : DEFAULT_OUT;
const shardPath = path.join(OUT_DIR, SNAPSHOT_DATE + ".json");

// ---- append-only refusal ----
if (fs.existsSync(shardPath)) {
  console.error(`REFUSE: shard already exists (append-only): ${shardPath}`); process.exit(3);
}

// ---- inputs (all committed sources) ----
const SRC = {
  r2: "data/computed/feno-rim-recovery/R2_GLS_ICC.json",
  forecast: "data/computed/feno-rim-recovery/r1-edgar-panel.json",
  successor: "data/computed/feno-rim-recovery/FENO_YOO_SUCCESSOR_SPX_VALUATION.json",
  successorDecision: "data/computed/feno-rim-recovery/FENO_YOO_SUCCESSOR_NEXT_FINAL_DECISION.json",
  rates: "data/macro/fred-banking-daily.json",
  r1prices: "data/edgar/r1-panel/prices",
  r3prices: "data/edgar/r3-panel/prices",
  r3divs: "data/edgar/r3-panel/dividends",
  sic: "data/edgar/r1-panel/sic",
  dei: "data/edgar/r1-panel",
  rec: {
    r1price: "data/edgar/r1-panel/price-fetch-receipt.json",
    r3price: "data/edgar/r3-panel/r3-price-fetch-receipt.json",
    r3div: "data/edgar/r3-panel/r3-dividend-fetch-receipt.json",
    sic: "data/edgar/r1-panel/sic-fetch-receipt.json",
    dei: "data/edgar/r1-panel/dei-refetch-receipt.json",
    duration: "data/edgar/r1-panel/duration-refetch-receipt.json",
    primaryE: "data/edgar/r1-panel/primary-e-fetch-receipt.json",
  },
};
const receiptTime = (rel) => { try { const d = rj(rel); return d.generated_at || d.fetched_at || null; } catch { return null; } };
const receiptMissing = (rel) => !fs.existsSync(path.join(ROOT, rel));

// directory aggregate hash: sha256 of sorted "filename:sha256" lines
function dirHash(dirRel) {
  const dir = path.join(ROOT, dirRel);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  const lines = files.map(f => `${f}:${shaFile(path.join(dir, f))}`).join("\n");
  return { sha256: sha(Buffer.from(lines)), n_files: files.length };
}

// ---- data ----
const r2 = rj(SRC.r2);
const forecast = rj(SRC.forecast);
const rates = rj(SRC.rates).series.DGS10;
const ORIGIN = 2023; // latest evaluation origin of the committed R2 run
const fc = {};
for (const row of forecast.rows) { const k = row.sym + "|" + row.origin; (fc[k] ??= {})[row.tau] = row; }
function rfAt(Y) { const target = `${Y}-06-30`; let r = null; for (const x of rates) { if (x.date <= target) r = x; else break; } return r ? r.value * 0.01 : null; }

const cells = r2.rows.filter(r => r.origin === ORIGIN);
const firms = [];
for (const row of cells) {
  const f = fc[row.sym + "|" + ORIGIN];
  const f1 = f?.[1], f2 = f?.[2], f3 = f?.[3];
  firms.push({
    symbol: row.sym,
    icc_ri: row.icc_ri ?? null,
    icc_ep: row.icc_ep ?? null,
    feps: {
      ri: [f1 ? f1.ri : null, f2 ? f2.ri : null, f3 ? f3.ri : null],
      ep: [f1 ? f1.ep : null, f2 ? f2.ep : null, f3 ? f3.ep : null],
    },
    book_b0: row.B0,
    price: row.price,
    shares_today_basis: row.mcap / row.price,
    shares_basis_note: "today-basis shares = row.mcap / row.price (split-normalized, G0-settled basis); as-reported shares and report dates are not retained in R2 rows and are not reconstructed here",
    payout: row.payout,
    target_roe: row.targetRoe,
    solver: { result: row.icc_ri ?? null, converged: row.icc_ri != null },
  });
}

// ---- aggregates (R2 diag construction, latest origin) ----
const withIcc = cells.filter(r => r.icc_ri != null);
const capSum = withIcc.reduce((a, r) => a + r.mcap, 0);
const cwMean = capSum > 0 ? withIcc.reduce((a, r) => a + r.icc_ri * r.mcap, 0) / capSum : null;
const ewMean = withIcc.length ? withIcc.reduce((a, r) => a + r.icc_ri, 0) / withIcc.length : null;
const rf = rfAt(ORIGIN);
const aggregates = {
  index_cap_weighted_icc: cwMean,
  equal_weighted_icc: ewMean,
  risk_free: rf,
  icc_minus_rf: cwMean != null && rf != null ? cwMean - rf : null,
  n_firms_solved: withIcc.length,
  n_firms_total: cells.length,
  aggregation_note: "cap-weighted mean over cells with icc_ri non-null (R2 diag construction, origin 2023)",
};

// ---- successor FV/P (mandate §10: the shard carries it once P3 produced one) ----
// Recorded as a range per origin across the frozen 16-leg sweep, never a point. The archive's
// purpose is a future out-of-sample test, so a collapsed point estimate would be a lie about
// what was known on this date.
let successor = null;
if (!receiptMissing(SRC.successor)) {
  const sv = rj(SRC.successor);
  const dec = receiptMissing(SRC.successorDecision) ? null : rj(SRC.successorDecision);
  successor = {
    verdict: dec ? dec.spx_successor : null,
    forward_book: dec ? dec.forward_book : null,
    legs: sv.legs ?? null,
    fv_over_p_by_origin: Object.fromEntries(Object.entries(sv.fv_over_p ?? {}).map(([o, v]) => [o, {
      low: v.low, high: v.high,
      per_leg_eligible_min: v.per_leg_eligible ? Math.min(...Object.values(v.per_leg_eligible)) : null,
      per_leg_eligible_max: v.per_leg_eligible ? Math.max(...Object.values(v.per_leg_eligible)) : null,
      roster: v.roster ?? null,
    }])),
    read_with: "P1 corroborated-forward-book weight 0.2250-0.3603. The valuation covers more weight than the forward book is corroborated on; mandate §9 hinges on the smaller number.",
    not_a_signal: "KEEP_QUARANTINED. This block is archival evidence for a future out-of-sample test, not a published or tradable number.",
  };
}

// ---- sources: hashes + first_knowable_at ----
const sources = {
  "R2_GLS_ICC.json": { sha256: shaFile(path.join(ROOT, SRC.r2)), first_knowable_at: null,
    note: "no fetch receipt exists for this computed result; r2-freeze-receipt.json is a criteria-freeze receipt, not a fetch receipt" },
  "r1-edgar-panel.json": { sha256: shaFile(path.join(ROOT, SRC.forecast)), first_knowable_at: null,
    note: "no fetch receipt exists for the forecast panel; its inputs (dei/duration/primary-e/sic) have receipts listed below" },
  "fred-banking-daily.json": { sha256: shaFile(path.join(ROOT, SRC.rates)), first_knowable_at: null,
    note: "no receipt file exists under data/macro/ for this series" },
  "FENO_YOO_SUCCESSOR_SPX_VALUATION.json": receiptMissing(SRC.successor)
    ? { sha256: null, first_knowable_at: null, note: "absent at snapshot time — shards written before P3 carry no successor block" }
    : { sha256: shaFile(path.join(ROOT, SRC.successor)), first_knowable_at: null,
        note: "computed result; p3-freeze-receipt.json is a criteria-freeze receipt, not a fetch receipt" },
  "r1-panel/prices/": { ...dirHash(SRC.r1prices), first_knowable_at: receiptTime(SRC.rec.r1price) },
  "r3-panel/prices/": { ...dirHash(SRC.r3prices), first_knowable_at: receiptTime(SRC.rec.r3price) },
  "r3-panel/dividends/": { ...dirHash(SRC.r3divs), first_knowable_at: receiptTime(SRC.rec.r3div) },
  "r1-panel/sic/": { ...dirHash(SRC.sic), first_knowable_at: receiptTime(SRC.rec.sic) },
  "r1-panel/ (DEI shares)": { ...dirHash(SRC.dei), first_knowable_at: receiptTime(SRC.rec.dei),
    note: "per-symbol DEI/share files under data/edgar/r1-panel/ (505 files, includes DEI + E/duration extracts); directory aggregate hash covers all. Receipts: dei/duration/primary-e at " + receiptTime(SRC.rec.dei) + " / " + receiptTime(SRC.rec.duration) + " / " + receiptTime(SRC.rec.primaryE) },
};

// ---- shard ----
const shard = {
  schema_version: "feno_rim_recovery_g5_shadow.v2",
  snapshot_at: new Date().toISOString(),
  snapshot_date: SNAPSHOT_DATE,
  origin: ORIGIN,
  origin_anchor: `${ORIGIN}-06-30`,
  universe: {
    how_chosen: `R2_GLS_ICC.json rows with origin == ${ORIGIN} (the latest evaluation origin of the committed R2 run, G0-settled market-cap basis). ${cells.length} cells; ${withIcc.length} with a converged ICC.`,
    symbols: cells.map(r => r.sym),
    n: cells.length,
  },
  firms,
  aggregates,
  successor,
  sources,
  first_knowable_at_note: "first_knowable_at is the fetch receipt time (generated_at/fetched_at from the source's receipt file), not a file mtime. Sources without a receipt record null with the reason — no invented times.",
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const tmp = shardPath + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(shard, null, 1) + "\n");
fs.renameSync(tmp, shardPath);
console.log(`WROTE ${shardPath}`);
console.log(`  firms=${firms.length} solved=${withIcc.length} cw_icc=${cwMean?.toFixed(6)} ew_icc=${ewMean?.toFixed(6)} rf=${rf} cw_minus_rf=${(cwMean != null && rf != null ? cwMean - rf : null)?.toFixed(6)}`);
console.log(`  sources hashed: 3 files + ${Object.keys(sources).filter(k => k.endsWith("/")).length} directories`);
