#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { FATAL_MARKERS, SMOKE_PAGE_ROUTES } from "./qa-route-catalog.mjs";

const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
const TIMEOUT_MS = Number(process.env.QA_STOCKANALYSIS_TIMEOUT_MS || 25000);
const RETRIES = Number(process.env.QA_STOCKANALYSIS_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.QA_STOCKANALYSIS_RETRY_DELAY_MS || 2500);

const PAGE_ROUTES = SMOKE_PAGE_ROUTES;
const degradations = [];

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

function assert(condition, message) {
  if (!condition) fail(message);
}

export function recordDegradation(condition, message, warnings = degradations) {
  if (!condition && !warnings.includes(message)) warnings.push(message);
  return condition;
}

function degrade(condition, message) {
  return recordDegradation(condition, message);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function requiredArray(value, label) {
  assert(Array.isArray(value), `${label} malformed schema: expected an array`);
  return value;
}

function optionalArray(value, label) {
  if (value === null || value === undefined) return [];
  return requiredArray(value, label);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} malformed count: ${value}`);
  return value;
}

export function assertReconciledCount(reported, actual, label) {
  const count = requireNonNegativeInteger(reported, label);
  assert(count === actual, `${label} count reconciliation failed: reported ${count}, actual ${actual}`);
  return count;
}

function assertFiniteNumbers(value, label, pointer = "$") {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${label} contains a non-finite number at ${pointer}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, label, `${pointer}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertFiniteNumbers(entry, label, `${pointer}.${key}`);
    }
  }
}

function assertUniqueTickers(records, key, label) {
  const seen = new Set();
  for (const [index, row] of records.entries()) {
    const ticker = row?.[key];
    assert(typeof ticker === "string" && ticker.length > 0, `${label} row ${index} has no ticker identity`);
    assert(!seen.has(ticker), `${label} contains duplicate ticker identity: ${ticker}`);
    seen.add(ticker);
  }
}

function warnNamedFields(row, label, fields) {
  if (!row) {
    degrade(false, `${label} is missing from the delivered coverage.`);
    return;
  }
  for (const [field, description] of fields) {
    degrade(hasValue(row?.[field]), `${label} is delivered without ${description} (${field}).`);
  }
}

function assertExpectedClassification(row, label, expected) {
  if (!row) return;
  if (!row.classification) {
    degrade(false, `${label} is delivered without classification coverage.`);
    return;
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    assert(
      row.classification[field] === expectedValue,
      `${label} classification mismatch for ${field}: expected ${expectedValue}, got ${row.classification[field]}`,
    );
  }
}

function githubAnnotationValue(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();
      // Detect a truncated body: a large response can arrive HTTP 200 with the
      // stream cut short (no thrown error), which JSON.parse then rejects with
      // "Unterminated string". Compare received bytes against Content-Length and
      // treat any shortfall as retryable rather than returning a partial body.
      const declaredBytes = Number(response.headers.get("content-length"));
      const receivedBytes = Buffer.byteLength(text);
      const truncated =
        Number.isFinite(declaredBytes) && declaredBytes > 0 && receivedBytes < declaredBytes;
      if (truncated) {
        lastError = new Error(
          `${url} body truncated: received ${receivedBytes} of ${declaredBytes} bytes`,
        );
        if (attempt >= RETRIES) throw lastError;
      } else if (response.status >= 500 && attempt < RETRIES) {
        lastError = new Error(`${url} returned HTTP ${response.status}`);
      } else {
        return { response, text };
      }
    } catch (error) {
      lastError = error;
      if (attempt >= RETRIES) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  throw lastError ?? new Error(`${url} failed`);
}

async function fetchJson(url) {
  const { response, text } = await fetchText(url);
  if (!response.ok) fail(`${url} returned HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    fail(`${url} did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertFiniteNumbers(payload, url);
  return payload;
}

async function fetchJsonResponse(url) {
  const { response, text } = await fetchText(url);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    fail(`${url} did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertFiniteNumbers(payload, url);
  return { response, payload };
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
  assert(payload && typeof payload === "object", "ETF snapshot malformed schema: expected an object");
  const newEtfRecords = requiredArray(payload?.newEtfs?.records, "ETF snapshot newEtfs.records");
  const screenerRecords = requiredArray(payload?.screener?.records, "ETF snapshot screener.records");
  const screenerVolumeRecords = requiredArray(payload?.screener?.volumeLeaders, "ETF snapshot screener.volumeLeaders");
  const screenerChangeRecords = requiredArray(payload?.screener?.changeLeaders, "ETF snapshot screener.changeLeaders");
  const blackrockRecords = requiredArray(payload?.blackrock?.records, "ETF snapshot blackrock.records");
  const prosharesRecords = requiredArray(payload?.proshares?.records, "ETF snapshot proshares.records");
  const bitcoinRecords = requiredArray(payload?.bitcoin?.records, "ETF snapshot bitcoin.records");
  const classifiedNewEtfs = newEtfRecords.filter((row) => row?.classification);
  const adiuNewEtf = newEtfRecords.find((row) => row?.s === "ADIU");
  const sourceTotals = {
    newEtfs: requireNonNegativeInteger(payload?.newEtfs?.counts?.records, "ETF snapshot newEtfs source"),
    screener: requireNonNegativeInteger(payload?.screener?.counts?.records, "ETF snapshot screener source"),
    blackrock: requireNonNegativeInteger(payload?.blackrock?.counts?.records, "ETF snapshot blackrock source"),
    proshares: requireNonNegativeInteger(payload?.proshares?.counts?.records, "ETF snapshot proshares source"),
    bitcoin: requireNonNegativeInteger(payload?.bitcoin?.counts?.records, "ETF snapshot bitcoin source"),
  };
  const counts = {
    newEtfs: newEtfRecords.length,
    screener: screenerRecords.length,
    screenerVolume: screenerVolumeRecords.length,
    screenerChange: screenerChangeRecords.length,
    blackrock: blackrockRecords.length,
    proshares: prosharesRecords.length,
    bitcoin: bitcoinRecords.length,
  };
  for (const [section, count] of Object.entries(counts)) {
    if (section === "screenerVolume" || section === "screenerChange") continue;
    assert(
      count <= sourceTotals[section],
      `ETF snapshot ${section} count reconciliation failed: preview ${count} exceeds source ${sourceTotals[section]}`,
    );
  }
  const expectedBitcoinPreview = Math.min(sourceTotals.bitcoin, 100);
  degrade(counts.newEtfs >= 100, `ETF snapshot is degraded: new ETF preview has ${counts.newEtfs} of the target 100 rows.`);
  degrade(counts.screener >= 5, `ETF snapshot is degraded: screener preview has ${counts.screener} of the target 5 rows.`);
  degrade(counts.screenerVolume >= 5, `ETF snapshot is degraded: volume leaders have ${counts.screenerVolume} of the target 5 rows.`);
  degrade(counts.screenerChange >= 5, `ETF snapshot is degraded: change leaders have ${counts.screenerChange} of the target 5 rows.`);
  degrade(counts.blackrock >= 20, `ETF snapshot is degraded: BlackRock preview has ${counts.blackrock} of the target 20 rows.`);
  degrade(counts.proshares >= 20, `ETF snapshot is degraded: ProShares preview has ${counts.proshares} of the target 20 rows.`);
  degrade(counts.bitcoin >= expectedBitcoinPreview, `ETF snapshot is degraded: Bitcoin preview has ${counts.bitcoin} of the expected ${expectedBitcoinPreview} rows.`);
  degrade(classifiedNewEtfs.length > 0, "ETF snapshot is degraded: no new ETF row has joined classification coverage.");
  if (adiuNewEtf) {
    assertExpectedClassification(adiuNewEtf, "ADIU new ETF snapshot", {
      is_leveraged: true,
      is_single_stock: true,
      underlying: "ADI",
    });
  }
  return { ...counts, sourceTotals, classifiedNewEtfs: classifiedNewEtfs.length };
}

async function checkEtfUniverse(root) {
  const payload = await fetchJson(`${root}/api/data/stockanalysis/etf-universe`);
  assert(payload?.asset_type === "etf_universe", `ETF universe asset_type mismatch: ${payload?.asset_type}`);
  const records = requiredArray(payload?.records, "ETF universe records");
  assertUniqueTickers(records, "ticker", "ETF universe");
  const tqqq = records.find((row) => row?.ticker === "TQQQ");
  const sqqq = records.find((row) => row?.ticker === "SQQQ");
  const tsll = records.find((row) => row?.ticker === "TSLL");
  const counts = {
    records: assertReconciledCount(payload?.counts?.records, records.length, "ETF universe records"),
    withPrice: requireNonNegativeInteger(payload?.counts?.with_price, "ETF universe with_price"),
    withVolume: requireNonNegativeInteger(payload?.counts?.with_volume, "ETF universe with_volume"),
    withHoldings: requireNonNegativeInteger(payload?.counts?.with_holdings, "ETF universe with_holdings"),
    screenerOnly: requireNonNegativeInteger(payload?.counts?.screener_only, "ETF universe screener_only"),
  };
  for (const [label, count] of [
    ["with_price", counts.withPrice],
    ["with_volume", counts.withVolume],
    ["with_holdings", counts.withHoldings],
    ["screener_only", counts.screenerOnly],
  ]) {
    assert(count <= counts.records, `ETF universe ${label} count reconciliation failed: ${count} exceeds ${counts.records}`);
  }
  degrade(counts.records >= 5250, `ETF universe is degraded: ${counts.records} records are available, below the target 5250.`);
  degrade(counts.withPrice >= 5000, `ETF universe is degraded: ${counts.withPrice} records have price data, below the target 5000.`);
  degrade(counts.withVolume >= 4500, `ETF universe is degraded: ${counts.withVolume} records have volume data, below the target 4500.`);
  degrade(counts.withHoldings >= 4900, `ETF universe is degraded: ${counts.withHoldings} records have holdings data, below the target 4900.`);
  warnNamedFields(tqqq, "ETF universe TQQQ", [
    ["price", "price coverage"],
    ["volume", "volume coverage"],
    ["holdings", "holdings coverage"],
  ]);
  assertExpectedClassification(tqqq, "ETF universe TQQQ", {
    is_leveraged: true,
    is_single_stock: false,
    is_inverse: false,
  });
  warnNamedFields(sqqq, "ETF universe SQQQ", []);
  assertExpectedClassification(sqqq, "ETF universe SQQQ", {
    is_leveraged: true,
    is_single_stock: false,
    is_inverse: true,
  });
  warnNamedFields(tsll, "ETF universe TSLL", []);
  assertExpectedClassification(tsll, "ETF universe TSLL", {
    is_leveraged: true,
    is_single_stock: true,
    is_inverse: false,
  });
  return {
    ...counts,
    tqqq: tqqq ? { price: tqqq.price, volume: tqqq.volume, holdings: tqqq.holdings } : null,
    sqqq: sqqq ? { classification: sqqq.classification } : null,
    tsll: tsll ? { classification: tsll.classification } : null,
  };
}

async function checkEtfDetails(root) {
  const iefa = await fetchJson(`${root}/api/data/stockanalysis/etfs/IEFA`);
  assert(iefa?.ticker === "IEFA", "IEFA detail ticker mismatch");
  assert(iefa?.asset_type === "etf", "IEFA detail must be ETF");
  const iefaHoldings = optionalArray(iefa?.normalized?.holdings, "IEFA normalized.holdings");
  const historyPeriods = iefa?.normalized?.history_periods;
  assert(
    historyPeriods === null || historyPeriods === undefined || (typeof historyPeriods === "object" && !Array.isArray(historyPeriods)),
    "IEFA normalized.history_periods malformed schema: expected an object",
  );
  const iefaDaily = optionalArray(historyPeriods?.daily_1y, "IEFA daily_1y history");
  const iefaWeekly = optionalArray(historyPeriods?.weekly_1y, "IEFA weekly_1y history");
  const iefaMonthly = optionalArray(historyPeriods?.monthly_1y, "IEFA monthly_1y history");
  degrade(iefaHoldings.length > 0, "IEFA detail is degraded: holdings coverage is unavailable.");
  degrade(iefaDaily.length >= 200, `IEFA detail is degraded: daily_1y has ${iefaDaily.length} rows, below the target 200.`);
  degrade(iefaWeekly.length >= 45, `IEFA detail is degraded: weekly_1y has ${iefaWeekly.length} rows, below the target 45.`);
  degrade(iefaMonthly.length >= 10, `IEFA detail is degraded: monthly_1y has ${iefaMonthly.length} rows, below the target 10.`);

  const adiu = await fetchJson(`${root}/api/data/stockanalysis/etfs/ADIU`);
  assert(adiu?.ticker === "ADIU", "ADIU fallback ticker mismatch");
  assert(adiu?.asset_type === "etf", "ADIU fallback must be ETF");
  if (!adiu?.data_supply) {
    degrade(false, "ADIU fallback is degraded: data-supply provenance is missing.");
  } else {
    if (!hasValue(adiu.data_supply.enrollment_state)) {
      degrade(false, "ADIU fallback is degraded: enrollment provenance is missing.");
    } else {
      assert(adiu.data_supply.enrollment_state === "enrolled", `ADIU R2 enrollment state mismatch: ${adiu.data_supply.enrollment_state}`);
    }
    if (!hasValue(adiu.data_supply.resolution_state)) {
      degrade(false, "ADIU fallback is degraded: resolution state is missing.");
    } else {
      assert(
        ["fresh_fallback", "lkg_fallback", "unavailable"].includes(adiu.data_supply.resolution_state),
        `ADIU R2 resolution invalid: ${adiu.data_supply.resolution_state}`,
      );
    }
  }
  // yf_fallback (Yahoo) carries classification but may lack a stockanalysis overview name; require the name only for stockanalysis-sourced fallbacks.
  if (adiu?.detail_status !== "yf_fallback") {
    degrade(hasValue(adiu?.normalized?.overview?.name), "ADIU fallback is degraded: overview name is missing.");
  }
  assertExpectedClassification({ classification: adiu?.normalized?.classification }, "ADIU fallback", {
    is_leveraged: true,
    is_single_stock: true,
    underlying: "ADI",
  });
  const missingFallbacks = await checkMissingEtfDetailFallbacks(root);
  return {
    IEFA: {
      holdings: iefaHoldings.length,
      history: {
        daily_1y: iefaDaily.length,
        weekly_1y: iefaWeekly.length,
        monthly_1y: iefaMonthly.length,
      },
    },
    ADIU: {
      detail_status: adiu.detail_status,
      name: adiu?.normalized?.overview?.name ?? null,
      classification: adiu?.normalized?.classification ?? null,
    },
    missingFallbacks,
  };
}

async function checkR2EtfResolution(root) {
  const index = await fetchJson(`${root}/data/computed/data-supply/etf-detail/index.json`);
  assert(index?.entries && typeof index.entries === "object" && !Array.isArray(index.entries), "R2 ETF resolution index malformed schema: entries must be an object");
  const entries = Object.values(index.entries);
  assertUniqueTickers(entries, "ticker", "R2 ETF resolution index");
  const selected = entries.find((entry) => entry?.resolution_state !== "unavailable");
  const unavailable = entries.find((entry) => entry?.resolution_state === "unavailable");
  degrade(Boolean(selected?.ticker), "R2 ETF detail is degraded: no promotable ticker is available for route verification.");
  if (!selected?.ticker) {
    return { selected: null, unavailable: unavailable?.ticker ?? null, unavailableStatus: null };
  }

  const selectedPayload = await fetchJson(`${root}/api/data/stockanalysis/etfs/${encodeURIComponent(selected.ticker)}`);
  assert(selectedPayload?.data_supply?.resolution_state === selected.resolution_state, "R2 selected API state mismatch");
  assert(selectedPayload?.data_supply?.projection_digest === index.index_sha256, "R2 selected projection digest mismatch");

  if (!unavailable?.ticker) {
    degrade(false, "R2 ETF detail smoke is degraded: no unavailable ticker exists to exercise the negative-cache route.");
    return { selected: selected.ticker, unavailable: null, unavailableStatus: null };
  }
  const result = await fetchJsonResponse(`${root}/api/data/stockanalysis/etfs/${encodeURIComponent(unavailable.ticker)}`);
  assert([200, 503].includes(result.response.status), `R2 unavailable returned HTTP ${result.response.status}`);
  assert(result.payload?.data_supply?.resolution_state === "unavailable", "R2 unavailable API label missing");
  if (result.response.status === 503) {
    const cacheControl = result.response.headers.get("cache-control") ?? "";
    assert(result.payload?.error === "DATA_SUPPLY_UNAVAILABLE", "R2 typed unavailable error missing");
    assert(cacheControl.includes("max-age=15"), "R2 negative cache browser TTL missing");
    assert(cacheControl.includes("s-maxage=60"), "R2 negative cache edge TTL missing");
    assert(!cacheControl.includes("stale"), "R2 negative cache must not serve stale");
  }
  return { selected: selected.ticker, unavailable: unavailable.ticker, unavailableStatus: result.response.status };
}

async function checkMissingEtfDetailFallbacks(root) {
  const coverage = await fetchJson(`${root}/data/stockanalysis/coverage/etf_detail.json`);
  const missingCount = requireNonNegativeInteger(coverage?.counts?.missing_detail_files, "ETF detail missing files");
  const rawMissingSamples = optionalArray(coverage?.samples?.missing, "ETF detail coverage samples.missing");
  const missingSamples = rawMissingSamples.filter(Boolean).slice(0, 5);
  if (missingCount <= 0) return [];
  degrade(
    false,
    `ETF detail coverage is degraded: ${missingCount} ticker(s) have no detail file${missingSamples.length > 0 ? `; examples: ${missingSamples.join(", ")}` : " and no sample ticker was supplied"}.`,
  );
  if (missingSamples.length === 0) return [];

  const results = [];
  for (const ticker of missingSamples) {
    const payload = await fetchJson(`${root}/api/data/stockanalysis/etfs/${encodeURIComponent(ticker)}`);
    assert(payload?.ticker === ticker, `${ticker} missing-detail fallback ticker mismatch`);
    assert(payload?.asset_type === "etf", `${ticker} missing-detail fallback must be ETF`);
    assert(
      ["surface_only", "universe_only"].includes(payload?.detail_status),
      `${ticker} missing-detail fallback status invalid: ${payload?.detail_status}`,
    );
    degrade(hasValue(payload?.normalized?.overview?.name), `${ticker} fallback is degraded: overview name is missing.`);
    results.push({
      ticker,
      detail_status: payload.detail_status,
      name: payload?.normalized?.overview?.name ?? null,
    });
  }
  return results;
}

function surfaceRows(payload, label) {
  const tables = requiredArray(payload?.tables, `${label} tables`);
  const rows = [];
  for (const [index, table] of tables.entries()) {
    rows.push(...requiredArray(table?.records, `${label} tables[${index}].records`));
  }
  assertReconciledCount(payload?.counts?.tables, tables.length, `${label} tables`);
  assertReconciledCount(payload?.counts?.rows, rows.length, `${label} rows`);
  return rows;
}

function warnRowFields(row, label, fields) {
  if (!row) {
    degrade(false, `${label} is degraded: no row is available.`);
    return;
  }
  for (const field of fields) {
    degrade(hasValue(row[field]), `${label} is degraded: the first row has no ${field}.`);
  }
}

async function checkSurfaceContracts(root) {
  const index = await fetchJson(`${root}/api/data/stockanalysis/surfaces/index`);
  const results = requiredArray(index?.results, "StockAnalysis surface index results");
  const requestedCount = assertReconciledCount(index?.counts?.surfaces_requested, results.length, "StockAnalysis surfaces_requested");
  const okCount = requireNonNegativeInteger(index?.counts?.ok, "StockAnalysis surface ok");
  const failedCount = requireNonNegativeInteger(index?.counts?.failed, "StockAnalysis surface failed");
  assert(okCount + failedCount === requestedCount, `StockAnalysis surface count reconciliation failed: ok ${okCount} + failed ${failedCount} != requested ${requestedCount}`);
  for (const [position, result] of results.entries()) {
    assert(typeof result?.surface === "string" && result.surface.length > 0, `StockAnalysis surface result ${position} has no identity`);
    assert(["ok", "failed"].includes(result?.status), `StockAnalysis surface ${result?.surface} has invalid status: ${result?.status}`);
  }
  const uniqueSurfaces = new Set(results.map((result) => result.surface));
  assert(uniqueSurfaces.size === results.length, "StockAnalysis surface index contains duplicate surface identities");
  const actualOk = results.filter((result) => result.status === "ok").length;
  const failedResults = results.filter((result) => result.status === "failed");
  assert(okCount === actualOk, `StockAnalysis surface ok count reconciliation failed: reported ${okCount}, actual ${actualOk}`);
  assert(failedCount === failedResults.length, `StockAnalysis surface failed count reconciliation failed: reported ${failedCount}, actual ${failedResults.length}`);
  degrade(requestedCount >= 25, `StockAnalysis surface delivery is degraded: ${requestedCount} of the target 25 surfaces were requested.`);
  degrade(okCount >= 25, `StockAnalysis surface delivery is degraded: ${okCount} of the target 25 surfaces completed.`);
  degrade(
    failedCount === 0,
    `StockAnalysis surface delivery is degraded: ${failedCount} surface(s) failed: ${failedResults.map((result) => `${result.surface}${result.error ? ` (${result.error})` : ""}`).join(", ")}.`,
  );

  const premarket = await fetchJson(`${root}/api/data/stockanalysis/surfaces/market_premarket`);
  const premarketRows = surfaceRows(premarket, "StockAnalysis premarket surface");
  const firstPremarket = premarketRows[0];
  warnRowFields(firstPremarket, "StockAnalysis premarket surface", ["premkt_price", "pre_volume"]);

  const weekly = await fetchJson(`${root}/api/data/stockanalysis/surfaces/market_gainers_week`);
  const weeklyRows = surfaceRows(weekly, "StockAnalysis weekly-gainers surface");
  const firstWeekly = weeklyRows[0];
  warnRowFields(firstWeekly, "StockAnalysis weekly-gainers surface", ["change_1w"]);

  const industries = await fetchJson(`${root}/api/data/stockanalysis/surfaces/industries_all`);
  const industryRows = surfaceRows(industries, "StockAnalysis industry-map surface");
  const firstIndustry = industryRows[0];
  degrade(industryRows.length >= 100, `StockAnalysis industry-map surface is degraded: ${industryRows.length} rows are available, below the target 100.`);
  warnRowFields(firstIndustry, "StockAnalysis industry-map surface", ["industry_name", "market_cap", "1y_change", "profit_margin"]);

  const technology = await fetchJson(`${root}/api/data/stockanalysis/surfaces/sector_technology`);
  const technologyRows = surfaceRows(technology, "StockAnalysis technology-sector surface");
  const firstTechnology = technologyRows[0];
  degrade(technologyRows.length >= 100, `StockAnalysis technology-sector surface is degraded: ${technologyRows.length} rows are available, below the target 100.`);
  warnRowFields(firstTechnology, "StockAnalysis technology-sector surface", ["symbol", "company_name", "market_cap"]);

  const semiconductors = await fetchJson(`${root}/api/data/stockanalysis/surfaces/industry_semiconductors`);
  const semiconductorRows = surfaceRows(semiconductors, "StockAnalysis semiconductor-industry surface");
  const firstSemiconductor = semiconductorRows[0];
  degrade(semiconductorRows.length >= 50, `StockAnalysis semiconductor-industry surface is degraded: ${semiconductorRows.length} rows are available, below the target 50.`);
  warnRowFields(firstSemiconductor, "StockAnalysis semiconductor-industry surface", ["symbol", "company_name", "market_cap"]);

  return {
    index: index.counts,
    premarket: { rows: premarketRows.length, first: firstPremarket?.symbol ?? null },
    weekly: { rows: weeklyRows.length, first: firstWeekly?.symbol ?? null },
    industry: {
      rows: industryRows.length,
      first: firstIndustry?.industry_name ?? null,
      technologyRows: technologyRows.length,
      semiconductorRows: semiconductorRows.length,
    },
  };
}

async function main() {
  const root = baseUrl();
  const pages = [];
  for (const route of PAGE_ROUTES) pages.push(await checkPage(root, route));
  const snapshot = await checkEtfSnapshot(root);
  const universe = await checkEtfUniverse(root);
  const details = await checkEtfDetails(root);
  const r2Resolution = await checkR2EtfResolution(root);
  const surfaces = await checkSurfaceContracts(root);

  for (const warning of degradations) {
    console.warn(`::warning title=StockAnalysis lane degraded::${githubAnnotationValue(warning)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    status: degradations.length > 0 ? "degraded" : "ready",
    degraded: degradations.length > 0,
    warnings: degradations,
    base_url: root,
    pages,
    snapshot,
    universe,
    details,
    r2Resolution,
    surfaces,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[stockanalysis-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
