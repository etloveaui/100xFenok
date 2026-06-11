#!/usr/bin/env node
/**
 * Previous-release values for upcoming US calendar events.
 *
 * usd-calendar.json carries only event metadata (title/time/importance);
 * "what was the last print?" is the context that makes the calendar useful.
 * FRED is the free source for actuals; events without a FRED series
 * (ISM, CB confidence, S&P Global PMI...) are skipped honestly — no value
 * is shown rather than a guessed one.
 *
 * Run: FRED_API_KEY=... node scripts/build-calendar-prev.mjs
 * Output: data/calendar/prev-values.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/calendar/prev-values.json");
const PUBLIC_OUT = path.join(ROOT, "100xfenok-next/public/data/calendar/prev-values.json");

const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error("FRED_API_KEY missing");
  process.exit(1);
}

// transform: how the headline print is derived from the raw series
//   level      — latest observation as-is
//   mom_diff_k — month-over-month change, thousands (e.g. NFP +139K)
//   yoy_pct    — % change vs 12 months earlier (e.g. CPI 2.4%)
//   mom_pct    — % change vs prior observation (e.g. retail sales +0.3%)
const MAP = {
  "Initial Jobless Claims": { series: "ICSA", transform: "level", unit: "K", scale: 1 / 1000, decimals: 0 },
  "Nonfarm Payrolls (NFP)": { series: "PAYEMS", transform: "mom_diff_k", unit: "K", decimals: 0 },
  "Consumer Price Index (CPI)": { series: "CPIAUCSL", transform: "yoy_pct", unit: "% YoY", decimals: 1 },
  "Producer Price Index (PPI)": { series: "PPIFIS", transform: "yoy_pct", unit: "% YoY", decimals: 1 },
  "PCE Price Index": { series: "PCEPI", transform: "yoy_pct", unit: "% YoY", decimals: 1 },
  "Retail Sales": { series: "RSAFS", transform: "mom_pct", unit: "% MoM", decimals: 1 },
  "GDP Annualized": { series: "A191RL1Q225SBEA", transform: "level", unit: "% QoQ연율", decimals: 1 },
  "FOMC Rate Decision · Press Conference": { series: "DFEDTARU", transform: "level", unit: "% 상단", decimals: 2 },
  "Michigan Consumer Sentiment": { series: "UMCSENT", transform: "level", unit: "", decimals: 1 },
  "JOLTS Job Openings": { series: "JTSJOL", transform: "level", unit: "M", scale: 1 / 1000, decimals: 2 },
  "New Home Sales": { series: "HSN1F", transform: "level", unit: "K 연율", decimals: 0 },
};

async function fetchObs(series) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${series}` +
    `&api_key=${API_KEY}&file_type=json&sort_order=desc&limit=14`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${series} HTTP ${res.status}`);
  const json = await res.json();
  const obs = (json.observations ?? [])
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value));
  if (obs.length === 0) throw new Error(`FRED ${series}: no numeric observations`);
  return obs; // newest first
}

function signed(v, decimals) {
  const s = v.toFixed(decimals);
  return v > 0 ? `+${s}` : s;
}

async function derive(title, cfg) {
  const obs = await fetchObs(cfg.series);
  const latest = obs[0];
  const scale = cfg.scale ?? 1;

  let display;
  if (cfg.transform === "level") {
    display = `${(latest.value * scale).toFixed(cfg.decimals)}${cfg.unit}`;
  } else if (cfg.transform === "mom_diff_k") {
    if (obs.length < 2) throw new Error(`${cfg.series}: need 2 obs`);
    display = `${signed(latest.value - obs[1].value, cfg.decimals)}${cfg.unit}`;
  } else if (cfg.transform === "mom_pct") {
    if (obs.length < 2) throw new Error(`${cfg.series}: need 2 obs`);
    display = `${signed(((latest.value - obs[1].value) / obs[1].value) * 100, cfg.decimals)}${cfg.unit}`;
  } else if (cfg.transform === "yoy_pct") {
    if (obs.length < 13) throw new Error(`${cfg.series}: need 13 obs`);
    const yearAgo = obs[12];
    display = `${signed(((latest.value - yearAgo.value) / yearAgo.value) * 100, cfg.decimals)}${cfg.unit}`;
  } else {
    throw new Error(`unknown transform ${cfg.transform}`);
  }

  return { title, value: display, asOf: latest.date, series: cfg.series };
}

const values = {};
let failed = 0;
for (const [title, cfg] of Object.entries(MAP)) {
  try {
    const v = await derive(title, cfg);
    values[title] = { value: v.value, asOf: v.asOf, series: v.series };
    console.log(`ok   ${title}: ${v.value} (as of ${v.asOf})`);
  } catch (err) {
    failed += 1;
    console.warn(`skip ${title}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 350)); // FRED rate courtesy
}

if (Object.keys(values).length === 0) {
  console.error("all series failed — keeping previous output untouched");
  process.exit(1);
}

const doc = {
  generated_at: new Date().toISOString(),
  source: "FRED (api.stlouisfed.org)",
  note: "직전 발표값. consensus/forecast 미포함 (무료 소스 부재).",
  values,
};

for (const out of [OUT, PUBLIC_OUT]) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`done: ${Object.keys(values).length} values, ${failed} skipped -> ${OUT}`);
