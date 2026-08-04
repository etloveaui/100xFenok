// Index payout history, aggregated from the constituents' own filings.
//
// Until now the payout was either a point-in-time forward surface that derived to
// zero for KOSPI, or a figure copied off the analyst's sheet. Neither could be
// checked. This builds the real thing: for each index, sum Cash Dividends Paid
// and sum Net Income across its constituents per fiscal year, out of the yfinance
// statements we already collect, and emit the ratio per year.
//
// It is a SANITY BAND, not the model's input. Retention drives future book, so
// the model wants a forward payout; this is trailing and realised. Its job is to
// tell us when a forward figure has drifted somewhere a real distribution policy
// never goes — and to have caught, on the first run, that the analyst's own sheet
// values sit inside or beside every band, which is the first independent evidence
// that his payout inputs are measured rather than assumed.
//
//   node scripts/build-index-payout-history.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const YF = path.join(ROOT, "data", "yf", "finance");
const STOCK_ACTION = path.join(ROOT, "data", "computed", "stock_action_index.json");
const SOX_CONSTITUENTS = path.join(ROOT, "data", "indices", "nasdaq-giw-sox-constituents.json");
const OUT = path.join(ROOT, "data", "computed", "fenok-rim", "payout-history.json");
const MIRROR = path.join(ROOT, "100xfenok-next", "public", "data", "computed", "fenok-rim", "payout-history.json");

// A year is kept only when most of the constituents that ever report have
// reported for it. An absolute count cannot do this job: it lets a partial
// current year through for a 500-name index while discarding every year of a
// 30-name one. The current fiscal year fails this until reporting completes.
const MIN_REPORTING_SHARE = 0.6;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function indexMembers(stockAction, indexKey) {
  const rows = Array.isArray(stockAction?.rows) ? stockAction.rows : [];
  return rows
    .filter((row) => (row?.indexWeights ?? []).some((w) => w?.index === indexKey && Number(w?.weight) > 0))
    .map((row) => row.symbol)
    .filter(Boolean);
}

function koreanMembers() {
  try {
    return fs.readdirSync(YF)
      .filter((name) => name.endsWith(".KS.json"))
      .map((name) => name.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export function payoutByYear(symbols) {
  const years = new Map();
  let withStatements = 0;
  for (const symbol of symbols) {
    const payload = readJson(path.join(YF, `${symbol}.json`))?.data;
    if (!payload) continue;
    const income = payload.income_statement ?? {};
    const cash = payload.cash_flow ?? {};
    let used = false;
    for (const [period, figures] of Object.entries(income)) {
      const netIncome = figures?.["Net Income"];
      const dividends = cash?.[period]?.["Cash Dividends Paid"];
      // Loss-making years cannot carry a payout ratio; excluding them keeps the
      // aggregate an earnings-weighted distribution rate rather than a nonsense
      // number driven by a negative denominator.
      if (!Number.isFinite(netIncome) || !Number.isFinite(dividends) || netIncome <= 0) continue;
      const year = String(period).slice(0, 4);
      const bucket = years.get(year) ?? { dividends: 0, netIncome: 0, constituents: 0 };
      bucket.dividends += Math.abs(dividends);
      bucket.netIncome += netIncome;
      bucket.constituents += 1;
      years.set(year, bucket);
      used = true;
    }
    if (used) withStatements += 1;
  }
  const peak = Math.max(0, ...[...years.values()].map((b) => b.constituents));
  const rows = [...years.entries()]
    .filter(([, b]) => b.netIncome > 0 && peak > 0 && b.constituents >= peak * MIN_REPORTING_SHARE)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, b]) => ({
      year,
      payout_ratio: Math.round((b.dividends / b.netIncome) * 10000) / 10000,
      constituents: b.constituents,
      dividends: Math.round(b.dividends),
      net_income: Math.round(b.netIncome),
    }));
  return { rows, requested: symbols.length, with_statements: withStatements };
}

function summarise(rows) {
  if (!rows.length) return null;
  const values = rows.map((r) => r.payout_ratio);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    years: rows.length,
    mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10000) / 10000,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    latest: rows[rows.length - 1].payout_ratio,
  };
}

export function buildArtifact({ nowIso }) {
  const stockAction = readJson(STOCK_ACTION);
  const sox = readJson(SOX_CONSTITUENTS);
  const universes = [
    { key: "sp500", name: "S&P 500", symbols: indexMembers(stockAction, "sp500") },
    { key: "nasdaq100", name: "나스닥 100", symbols: indexMembers(stockAction, "nasdaq100") },
    {
      key: "philadelphia_semi",
      name: "필라델피아 반도체",
      symbols: (sox?.rows ?? []).map((r) => r.symbol).filter(Boolean),
    },
    { key: "kospi", name: "코스피", symbols: koreanMembers() },
  ];
  const indices = {};
  for (const u of universes) {
    const built = payoutByYear(u.symbols);
    indices[u.key] = {
      name: u.name,
      constituents_requested: built.requested,
      constituents_with_statements: built.with_statements,
      history: built.rows,
      summary: summarise(built.rows),
    };
  }
  return {
    schema_version: "fenok_rim_payout_history.v1",
    generated_at: nowIso,
    method: "sum(Cash Dividends Paid) / sum(Net Income) across index constituents, per fiscal year",
    source: "data/yf/finance constituent statements; membership from computed/stock_action_index.json and indices/nasdaq-giw-sox-constituents.json",
    purpose: "sanity band for the RIM engine's retention input, not the input itself — this is realised trailing payout while the model consumes a forward figure",
    caveats: [
      `a year is kept only when at least ${Math.round(MIN_REPORTING_SHARE * 100)}% of the constituents that ever report have reported for it, so the current fiscal year is absent until reporting completes`,
      "loss-making constituent years are excluded; a negative denominator has no payout ratio",
      "NASDAQ Composite has no constituent list in this repo and is therefore absent",
      "KOSPI membership is every .KS ticker we collect, not an index-weighted constituent set",
    ],
    indices,
  };
}

function main() {
  const artifact = buildArtifact({ nowIso: new Date().toISOString() });
  for (const dir of [path.dirname(OUT), path.dirname(MIRROR)]) fs.mkdirSync(dir, { recursive: true });
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  fs.writeFileSync(OUT, json);
  fs.writeFileSync(MIRROR, json);
  for (const idx of Object.values(artifact.indices)) {
    const s = idx.summary;
    console.log(
      `${idx.name}: ${s ? `${s.years}y ${(s.min * 100).toFixed(1)}~${(s.max * 100).toFixed(1)}%, mean ${(s.mean * 100).toFixed(1)}%` : "no usable years"}`
      + ` (${idx.constituents_with_statements}/${idx.constituents_requested} constituents with statements)`,
    );
  }
  console.log(`written: ${OUT} (+ public mirror)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
