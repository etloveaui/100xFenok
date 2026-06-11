#!/usr/bin/env node
/**
 * Weekly EPS-revision movers — aggregate per-ticker consensus revision
 * (global-scouter detail eps_consensus.weekly_change.fy_plus_1) into one
 * small index for the explore "리비전 무버" card. Surfaces a previously
 * unused field that exists only inside 1,066 detail files.
 *
 * Run: node scripts/build-revision-movers.mjs
 * Output: data/global-scouter/core/revision_movers.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DETAIL_DIR = path.join(ROOT, "data/global-scouter/stocks/detail");
const ANALYZER = path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json");
const OUT = path.join(ROOT, "data/global-scouter/core/revision_movers.json");
const PUBLIC_OUT = path.join(
  ROOT,
  "100xfenok-next/public/data/global-scouter/core/revision_movers.json",
);

const TOP_N = 12;
// weekly noise guard: sub-0.5% revisions are not "movers"
const MIN_ABS_CHANGE = 0.005;

const nameByTicker = new Map();
try {
  for (const row of JSON.parse(fs.readFileSync(ANALYZER, "utf8")).data ?? []) {
    if (row.symbol) nameByTicker.set(row.symbol, row.companyName ?? null);
  }
} catch {
  // names are cosmetic — proceed without
}

const rows = [];
let scanned = 0;
for (const file of fs.readdirSync(DETAIL_DIR)) {
  if (!file.endsWith(".json")) continue;
  scanned += 1;
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, file), "utf8"));
    const ch = doc?.eps_consensus?.weekly_change?.fy_plus_1;
    if (typeof ch !== "number" || Math.abs(ch) < MIN_ABS_CHANGE) continue;
    const ticker = file.replace(/\.json$/, "");
    const weekly = doc?.eps_consensus?.weekly?.fy_plus_1;
    const latest = Array.isArray(weekly) && weekly.length ? weekly[0] : null;
    rows.push({
      ticker,
      name: nameByTicker.get(ticker) ?? null,
      change_1w: Math.round(ch * 10000) / 10000,
      eps_fy1: latest && typeof latest.value === "number" ? latest.value : null,
      as_of: latest?.date ?? null,
    });
  } catch {
    // skip unreadable detail file
  }
}

rows.sort((a, b) => b.change_1w - a.change_1w);
const up = rows.filter((r) => r.change_1w > 0).slice(0, TOP_N);
const down = rows.filter((r) => r.change_1w < 0).slice(-TOP_N).reverse();

const payload = {
  schema_version: "revision-movers/v1",
  generated_at: new Date().toISOString(),
  source: "global-scouter detail eps_consensus.weekly_change.fy_plus_1 (1w revision of FY+1 EPS consensus)",
  scanned,
  qualified: rows.length,
  min_abs_change: MIN_ABS_CHANGE,
  up,
  down,
};

fs.writeFileSync(OUT, JSON.stringify(payload));
fs.mkdirSync(path.dirname(PUBLIC_OUT), { recursive: true });
fs.writeFileSync(PUBLIC_OUT, JSON.stringify(payload));
console.log(
  `revision_movers: scanned=${scanned} qualified=${rows.length} up=${up.length} down=${down.length} -> ${OUT}`,
);
