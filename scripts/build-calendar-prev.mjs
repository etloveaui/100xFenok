#!/usr/bin/env node
/**
 * Previous-release values for upcoming US calendar events.
 *
 * usd-calendar.json carries only event metadata (title/time/importance);
 * "what was the last print?" is the context that makes the calendar useful.
 * FRED and existing local macro-activity files are the free sources for
 * actuals. Events without a verified source are skipped honestly — no value is
 * shown rather than a guessed one.
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
const ACTIVITY_IN = path.join(ROOT, "data/macro/activity-surveys.json");

const API_KEY = process.env.FRED_API_KEY;

// transform: how the headline print is derived from the raw series
//   level      — latest observation as-is
//   mom_diff_k — month-over-month change, thousands (e.g. NFP +139K)
//   yoy_pct    — % change vs 12 months earlier (e.g. CPI 2.4%)
//   mom_pct    — % change vs prior observation (e.g. retail sales +0.3%)
const MAP = {
  jobless_claims: { title: "Initial Jobless Claims", series: "ICSA", transform: "level", unit: "K", scale: 1 / 1000, decimals: 0, aliases: ["Initial Jobless Claims", "주간 실업수당 청구"] },
  nonfarm_payrolls: { title: "Nonfarm Payrolls (NFP)", series: "PAYEMS", transform: "mom_diff_k", unit: "K", decimals: 0, aliases: ["Nonfarm Payrolls (NFP)", "비농업 고용지수 NFP"] },
  adp_employment: { title: "ADP Employment Report", series: "ADPMNUSNERSA", transform: "mom_diff_k", unit: "K", scale: 1 / 1000, decimals: 0, aliases: ["ADP Employment Report", "ADP 고용보고서"] },
  cpi: { title: "Consumer Price Index (CPI)", series: "CPIAUCSL", transform: "yoy_pct", unit: "% YoY", decimals: 1, aliases: ["Consumer Price Index (CPI)", "소비자물가지수 CPI"] },
  ppi: { title: "Producer Price Index (PPI)", series: "PPIFIS", transform: "yoy_pct", unit: "% YoY", decimals: 1, aliases: ["Producer Price Index (PPI)", "생산자물가지수 PPI"] },
  pce_price: { title: "PCE Price Index", series: "PCEPI", transform: "yoy_pct", unit: "% YoY", decimals: 1, aliases: ["PCE Price Index", "개인소비지출 PCE"] },
  retail_sales: { title: "Retail Sales", series: "RSAFS", transform: "mom_pct", unit: "% MoM", decimals: 1, aliases: ["Retail Sales", "소매판매"] },
  gdp_annualized: { title: "GDP Annualized", series: "A191RL1Q225SBEA", transform: "level", unit: "% QoQ연율", decimals: 1, aliases: ["GDP Annualized", "국내총생산 GDP"] },
  fomc_rate: { title: "FOMC Rate Decision · Press Conference", series: "DFEDTARU", transform: "level", unit: "% 상단", decimals: 2, aliases: ["FOMC Rate Decision · Press Conference", "FOMC 금리결정 · 기자회견"] },
  michigan_sentiment: { title: "Michigan Consumer Sentiment", series: "UMCSENT", transform: "level", unit: "", decimals: 1, aliases: ["Michigan Consumer Sentiment", "미시간 소비자심리지수"] },
  jolts_openings: { title: "JOLTS Job Openings", series: "JTSJOL", transform: "level", unit: "M", scale: 1 / 1000, decimals: 2, aliases: ["JOLTS Job Openings"] },
  new_home_sales: { title: "New Home Sales", series: "HSN1F", transform: "level", unit: "K 연율", decimals: 0, aliases: ["New Home Sales", "New Home Sales (Catch-up)", "신규주택 판매"] },
  existing_home_sales: { title: "Existing Home Sales", series: "EXHOSLUSM495S", transform: "level", unit: "M 연율", scale: 1 / 1000000, decimals: 2, aliases: ["Existing Home Sales", "기존주택 판매"] },
  philly_fed: { title: "Philly Fed Manufacturing Index", series: "GACDFSA066MSFRBPHI", transform: "level", unit: "", decimals: 1, aliases: ["Philly Fed Manufacturing Index", "필라델피아 연준 제조업"] },
  productivity_costs: { title: "Productivity & Costs", series: "PRS85006092", transform: "level", unit: "% QoQ연율", decimals: 1, aliases: ["Productivity & Costs (Prelim)", "Productivity & Costs (Revised)"] },
};

const ACTIVITY_MAP = {
  ism_manufacturing_pmi: { title: "ISM Manufacturing PMI", dataset: "ism_manufacturing", metric: "headline", unit: "", decimals: 1, aliases: ["ISM Manufacturing PMI", "ISM 제조업 PMI"] },
  ism_services_pmi: { title: "ISM Services PMI", dataset: "ism_services", metric: "headline", unit: "", decimals: 1, aliases: ["ISM Services PMI", "ISM 서비스 PMI"] },
  sp_global_manufacturing_pmi: { title: "S&P Global Manufacturing PMI", dataset: "pmi_manufacturing", metric: "us_sp_global", unit: "", decimals: 1, aliases: ["S&P Global Manufacturing PMI", "S&P 제조업 PMI"] },
  sp_global_services_pmi: { title: "S&P Global Services PMI", dataset: "pmi_services", metric: "us_sp_global", unit: "", decimals: 1, aliases: ["S&P Global Services PMI", "S&P 서비스 PMI"] },
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
    display = `${signed((latest.value - obs[1].value) * scale, cfg.decimals)}${cfg.unit}`;
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

  return { title: cfg.title, value: display, asOf: latest.date, series: cfg.series, source: "FRED" };
}

function normalizeAlias(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

function addValue(values, aliases, key, value, cfg) {
  const row = { ...value, key, aliases: cfg.aliases ?? [] };
  values[key] = row;
  aliases[key] = key;
  for (const alias of [cfg.title, ...(cfg.aliases ?? [])]) {
    if (!alias) continue;
    aliases[alias] = key;
    aliases[normalizeAlias(alias)] = key;
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function deriveActivity(key, cfg, activity) {
  const coverage = activity?.meta?.coverage?.[cfg.dataset];
  const value = coverage?.latest_values?.[cfg.metric];
  if (!Number.isFinite(value)) throw new Error(`${cfg.dataset}.${cfg.metric}: no numeric latest value`);
  const latestDate = coverage.latest_date ?? null;
  const releaseDate = coverage.latest_release_date ?? null;
  const asOf = releaseDate && latestDate && releaseDate >= latestDate
    ? releaseDate
    : latestDate ?? releaseDate ?? activity?.meta?.generated_at ?? null;
  return {
    title: cfg.title,
    value: `${value.toFixed(cfg.decimals)}${cfg.unit}`,
    asOf,
    series: `activity-surveys:${cfg.dataset}.${cfg.metric}`,
    source: "macro/activity-surveys",
  };
}

const values = {};
const aliases = {};
let failed = 0;
if (!API_KEY) {
  console.warn("FRED_API_KEY missing — FRED-backed values skipped");
} else {
  for (const [key, cfg] of Object.entries(MAP)) {
    try {
      const v = await derive(key, cfg);
      addValue(values, aliases, key, v, cfg);
      console.log(`ok   ${cfg.title}: ${v.value} (as of ${v.asOf})`);
    } catch (err) {
      failed += 1;
      console.warn(`skip ${cfg.title}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350)); // FRED rate courtesy
  }
}

const activity = readJson(ACTIVITY_IN, null);
for (const [key, cfg] of Object.entries(ACTIVITY_MAP)) {
  try {
    const v = deriveActivity(key, cfg, activity);
    addValue(values, aliases, key, v, cfg);
    console.log(`ok   ${cfg.title}: ${v.value} (as of ${v.asOf})`);
  } catch (err) {
    failed += 1;
    console.warn(`skip ${cfg.title}: ${err.message}`);
  }
}

const spMfg = values.sp_global_manufacturing_pmi;
const spSvc = values.sp_global_services_pmi;
if (spMfg && spSvc) {
  addValue(values, aliases, "sp_global_flash_pmi", {
    title: "S&P Global Flash PMI",
    value: `Mfg ${spMfg.value} / Svc ${spSvc.value}`,
    asOf: spMfg.asOf ?? spSvc.asOf,
    series: "activity-surveys:pmi_manufacturing.us_sp_global,pmi_services.us_sp_global",
    source: "macro/activity-surveys",
  }, { title: "S&P Global Flash PMI", aliases: ["S&P Global Flash PMI"] });
}

if (Object.keys(values).length === 0) {
  console.error("all series failed — keeping previous output untouched");
  process.exit(1);
}

const doc = {
  generated_at: new Date().toISOString(),
  source: "FRED (api.stlouisfed.org), local macro/activity-surveys",
  note: "직전 발표값. consensus/forecast 미포함 (무료 소스 부재).",
  aliases,
  values,
};

for (const out of [OUT, PUBLIC_OUT]) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`done: ${Object.keys(values).length} values, ${failed} skipped -> ${OUT}`);
