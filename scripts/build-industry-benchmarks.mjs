#!/usr/bin/env node
/**
 * Compact per-industry benchmark extract for /stock relative valuation.
 *
 * damodaran/industry_metrics.json (308K) + industries.json margins are too
 * heavy to fetch per stock page; this emits a single small artifact bundling
 * the yf->damodaran industry map with the handful of fields the UI compares.
 *
 * Run: node scripts/build-industry-benchmarks.mjs
 * Output: data/damodaran/industry_benchmarks.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const METRICS = path.join(ROOT, "data/damodaran/industry_metrics.json");
const INDUSTRIES = path.join(ROOT, "data/damodaran/industries.json");
const MAP = path.join(ROOT, "100xfenok-next/src/lib/design/yf-damodaran-industry-map.json");
const OUT = path.join(ROOT, "data/damodaran/industry_benchmarks.json");
const PUBLIC_OUT = path.join(ROOT, "100xfenok-next/public/data/damodaran/industry_benchmarks.json");

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const round2 = (x) => (typeof x === "number" ? Math.round(x * 100) / 100 : null);
const round4 = (x) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : null);

const metrics = load(METRICS).industries ?? {};
const industries = load(INDUSTRIES).industries ?? {};
const map = load(MAP);

const out = {};
for (const [key, m] of Object.entries(metrics)) {
  const margins = industries[key]?.margins ?? {};
  out[key] = {
    num_firms: m.num_firms ?? null,
    trailing_pe: round2(m.pe_multiples?.trailing_pe),
    forward_pe: round2(m.pe_multiples?.forward_pe),
    current_pe: round2(m.pe_multiples?.current_pe),
    ev_ebitda: round2(m.ev_multiples?.ev_ebitda),
    roe: round4(m.roe_decomposition?.roe_unadjusted),
    cost_of_capital: round4(m.cost_of_capital?.cost_of_capital),
    operating_margin: round4(margins.operating),
    net_margin: round4(margins.net),
  };
}

// drop nulls in the map so the client artifact stays minimal
const cleanMap = Object.fromEntries(
  Object.entries(map).filter(([, v]) => typeof v === "string" && out[v]),
);
const badTargets = Object.entries(map).filter(([, v]) => typeof v === "string" && !out[v]);
if (badTargets.length) {
  console.error("map values not found in industry_metrics:", badTargets);
  process.exit(1);
}

const payload = {
  schema_version: "industry-benchmarks/v1",
  generated_at: new Date().toISOString(),
  source: "damodaran industry_metrics + industries margins",
  yf_industry_map: cleanMap,
  industries: out,
};

fs.writeFileSync(OUT, JSON.stringify(payload));
fs.mkdirSync(path.dirname(PUBLIC_OUT), { recursive: true });
fs.writeFileSync(PUBLIC_OUT, JSON.stringify(payload));
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`industry_benchmarks: industries=${Object.keys(out).length} mapped=${Object.keys(cleanMap).length} size=${kb}KB`);
