#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
const TIMEOUT_MS = Number(process.env.QA_STOCKANALYSIS_TIMEOUT_MS || 25000);

const FATAL_MARKERS = [
  "예상치 못한 오류",
  "일시적인 내부 오류",
  "asOfDate is not a function",
  "stocks_analyzer.json에 존재하지 않는 티커",
];

const PAGE_ROUTES = [
  "/explore",
  "/etfs",
  "/etfs/new",
  "/etfs/new?type=single-stock&days=14&sort=change",
  "/etfs/IEFA",
  "/etfs/ADIU",
  "/market/events",
  "/market/events?tab=industry",
  "/market/events?section=IPO%20%EC%8B%A0%EC%B2%AD&range=30&sort=section",
  "/market/events?section=%EC%82%B0%EC%97%85&from=2026-06-01&to=2026-06-30",
];

function argValue(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function baseUrl() {
  return (argValue("--base-url") || process.env.QA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function fail(message) {
  throw new Error(message);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const { response, text } = await fetchText(url);
  if (!response.ok) fail(`${url} returned HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${url} did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function checkPage(root, route) {
  const url = `${root}${route}`;
  const { response, text } = await fetchText(url);
  assert(response.ok, `${route} returned HTTP ${response.status}`);
  for (const marker of FATAL_MARKERS) {
    assert(!text.includes(marker), `${route} contains fatal marker: ${marker}`);
  }
  return { route, status: response.status, bytes: text.length };
}

async function checkEtfSnapshot(root) {
  const payload = await fetchJson(`${root}/api/data/stockanalysis/etf-snapshot`);
  const counts = {
    newEtfs: payload?.newEtfs?.records?.length ?? 0,
    screener: payload?.screener?.records?.length ?? 0,
    blackrock: payload?.blackrock?.records?.length ?? 0,
    proshares: payload?.proshares?.records?.length ?? 0,
    bitcoin: payload?.bitcoin?.records?.length ?? 0,
  };
  assert(counts.newEtfs === 100, `newEtfs expected 100, got ${counts.newEtfs}`);
  assert(counts.screener === 5, `screener expected 5, got ${counts.screener}`);
  assert(counts.blackrock === 20, `blackrock expected 20, got ${counts.blackrock}`);
  assert(counts.proshares === 20, `proshares expected 20, got ${counts.proshares}`);
  assert(counts.bitcoin === 20, `bitcoin expected 20, got ${counts.bitcoin}`);
  return counts;
}

async function checkEtfDetails(root) {
  const iefa = await fetchJson(`${root}/api/data/stockanalysis/etfs/IEFA`);
  assert(iefa?.ticker === "IEFA", "IEFA detail ticker mismatch");
  assert(iefa?.asset_type === "etf", "IEFA detail must be ETF");
  assert(Array.isArray(iefa?.normalized?.holdings) && iefa.normalized.holdings.length > 0, "IEFA holdings missing");

  const adiu = await fetchJson(`${root}/api/data/stockanalysis/etfs/ADIU`);
  assert(adiu?.ticker === "ADIU", "ADIU fallback ticker mismatch");
  assert(adiu?.asset_type === "etf", "ADIU fallback must be ETF");
  assert(["surface_only", "universe_only"].includes(adiu?.detail_status), `ADIU fallback status invalid: ${adiu?.detail_status}`);
  assert(adiu?.normalized?.overview?.name, "ADIU fallback overview name missing");
  return {
    IEFA: { holdings: iefa.normalized.holdings.length },
    ADIU: { detail_status: adiu.detail_status, name: adiu.normalized.overview.name },
  };
}

async function checkSurfaceContracts(root) {
  const index = await fetchJson(`${root}/api/data/stockanalysis/surfaces/index`);
  assert(index?.counts?.surfaces_requested === 25, `surface index requested count mismatch: ${index?.counts?.surfaces_requested}`);
  assert(index?.counts?.ok === 25, `surface index ok count mismatch: ${index?.counts?.ok}`);
  assert(index?.counts?.failed === 0, `surface index failed count mismatch: ${index?.counts?.failed}`);

  const premarket = await fetchJson(`${root}/api/data/stockanalysis/surfaces/market_premarket`);
  const firstPremarket = premarket?.tables?.[0]?.records?.[0];
  assert(firstPremarket?.premkt_price, "premarket first row missing premkt_price");
  assert(firstPremarket?.pre_volume, "premarket first row missing pre_volume");

  const weekly = await fetchJson(`${root}/api/data/stockanalysis/surfaces/market_gainers_week`);
  const firstWeekly = weekly?.tables?.[0]?.records?.[0];
  assert(firstWeekly?.change_1w, "weekly gainer first row missing change_1w");

  return {
    index: index.counts,
    premarket: { rows: premarket?.counts?.rows, first: firstPremarket?.symbol },
    weekly: { rows: weekly?.counts?.rows, first: firstWeekly?.symbol },
  };
}

async function main() {
  const root = baseUrl();
  const pages = [];
  for (const route of PAGE_ROUTES) pages.push(await checkPage(root, route));
  const snapshot = await checkEtfSnapshot(root);
  const details = await checkEtfDetails(root);
  const surfaces = await checkSurfaceContracts(root);

  console.log(JSON.stringify({
    ok: true,
    base_url: root,
    pages,
    snapshot,
    details,
    surfaces,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[stockanalysis-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
