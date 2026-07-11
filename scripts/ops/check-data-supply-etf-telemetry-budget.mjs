import fs from "node:fs";
import { pathToFileURL } from "node:url";

const REST_ENDPOINT = "https://api.cloudflare.com/client/v4";
const DEFAULT_DATASET = "fenok_data_supply_unavailable";
const DEFAULT_DAILY_THRESHOLD = 80_000;
const CONFIG_EXIT = 78;
const ALERT_EXIT = 2;

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toIso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toSqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function maskAccountId(accountId) {
  return `${accountId.slice(0, 4)}...${accountId.slice(-4)}`;
}

function writeJson(path, payload) {
  if (!path) return;
  fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function authHeaders(token) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "text/plain",
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length > 0)) {
    const message = payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function resolveAccount(token) {
  const configuredId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_TAG;
  if (configuredId) {
    return {
      id: configuredId,
      name: process.env.CLOUDFLARE_ACCOUNT_NAME || "configured account",
      source: process.env.CLOUDFLARE_ACCOUNT_ID ? "CLOUDFLARE_ACCOUNT_ID" : "CLOUDFLARE_ACCOUNT_TAG",
    };
  }

  let payload;
  try {
    payload = await fetchJson(`${REST_ENDPOINT}/accounts?per_page=50`, {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
    });
  } catch (error) {
    throw new ConfigError(
      `Cloudflare account auto-discovery failed: ${error.message}. Set CLOUDFLARE_ACCOUNT_ID or allow account listing.`,
    );
  }
  const accounts = Array.isArray(payload?.result) ? payload.result : [];
  if (accounts.length !== 1) {
    throw new ConfigError(`Cloudflare account auto-discovery returned ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID.`);
  }
  return { id: accounts[0].id, name: accounts[0].name, source: "auto-discovered" };
}

function assertDatasetName(dataset) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(dataset)) {
    throw new ConfigError(`Invalid Analytics Engine dataset name: ${dataset}`);
  }
}

export function buildAnalyticsQuery({ dataset, dayStart, now }) {
  assertDatasetName(dataset);
  return `
SELECT
  sum(_sample_interval) AS request_count,
  count(DISTINCT index1) AS unique_ticker_count,
  sumIf(_sample_interval, blob5 = 'HIT') AS cache_hit_count,
  sum(double1 * _sample_interval) / sum(_sample_interval) AS average_state_age_hours,
  max(double1) AS max_state_age_hours
FROM ${dataset}
WHERE timestamp >= toDateTime('${toSqlTimestamp(dayStart)}')
  AND timestamp <= toDateTime('${toSqlTimestamp(now)}')
`.trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseAnalyticsResult(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0] : null;
  return {
    todayRequests: finiteNumber(row?.request_count),
    uniqueTickers: finiteNumber(row?.unique_ticker_count),
    cacheHits: finiteNumber(row?.cache_hit_count),
    averageStateAgeHours: row?.average_state_age_hours == null
      ? null
      : finiteNumber(row.average_state_age_hours),
    maxStateAgeHours: row?.max_state_age_hours == null
      ? null
      : finiteNumber(row.max_state_age_hours),
  };
}

export function evaluateAnalyticsBudget(usage, dailyThreshold) {
  return {
    ...usage,
    cacheHitRatio: usage.todayRequests > 0 ? usage.cacheHits / usage.todayRequests : 0,
    status: usage.todayRequests >= dailyThreshold ? "alert" : "ok",
  };
}

async function queryAnalyticsUsage({ token, accountId, dataset, dayStart, now }) {
  const query = buildAnalyticsQuery({ dataset, dayStart, now });
  const payload = await fetchJson(
    `${REST_ENDPOINT}/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: query,
    },
  );
  return parseAnalyticsResult(payload);
}

function buildIssueBody(result) {
  if (result.status === "blocked") {
    return [
      "[blocked] ETF typed-unavailable telemetry budget check could not run.",
      "",
      `Reason: ${result.message}`,
      "",
      "Needed: the production Cloudflare token must have Account Analytics Read access.",
      `Dataset: ${result.dataset}`,
      `Checked at UTC: ${result.checkedAtUtc}`,
    ].join("\n");
  }
  const headline = result.status === "alert"
    ? "[alert] ETF typed-unavailable telemetry reached the 80% daily budget threshold."
    : "ETF typed-unavailable telemetry budget check passed.";
  return [
    headline,
    "",
    `Dataset: ${result.dataset}`,
    `UTC window: ${result.dayStartUtc} -> ${result.checkedAtUtc}`,
    `Datapoints: ${result.todayRequests} / ${result.dailyThreshold}`,
    `Unique tickers: ${result.uniqueTickers}`,
    `Cache hits: ${result.cacheHits} (${(result.cacheHitRatio * 100).toFixed(2)}%)`,
    `Average state observation age: ${result.averageStateAgeHours ?? "n/a"} hours`,
    `Maximum state observation age: ${result.maxStateAgeHours ?? "n/a"} hours`,
    "",
    "Analytics Engine write loss is fail-open; API responses remain unaffected.",
  ].join("\n");
}

export async function main() {
  const dataset = process.env.DATA_SUPPLY_ANALYTICS_DATASET || DEFAULT_DATASET;
  const dailyThreshold = envInt("DATA_SUPPLY_ANALYTICS_DAILY_THRESHOLD", DEFAULT_DAILY_THRESHOLD);
  const resultPath = process.env.DATA_SUPPLY_ANALYTICS_RESULT || "data-supply-analytics-result.json";
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const base = {
    checkedAtUtc: toIso(now),
    dailyThreshold,
    dataset,
    dayStartUtc: toIso(dayStart),
    issueTitle: "100xFenok ETF typed-unavailable telemetry budget alarm",
  };

  if (!token) {
    const result = { ...base, status: "blocked", message: "CLOUDFLARE_API_TOKEN is not available." };
    result.issueBody = buildIssueBody(result);
    writeJson(resultPath, result);
    console.error(`[blocked] ${result.message}`);
    process.exitCode = CONFIG_EXIT;
    return;
  }

  try {
    const account = await resolveAccount(token);
    const usage = await queryAnalyticsUsage({ token, accountId: account.id, dataset, dayStart, now });
    const result = {
      ...base,
      ...evaluateAnalyticsBudget(usage, dailyThreshold),
      accountIdMasked: maskAccountId(account.id),
      accountName: account.name,
      accountSource: account.source,
    };
    result.issueBody = buildIssueBody(result);
    writeJson(resultPath, result);
    console.log(
      `status=${result.status} dataset=${dataset} todayUtc=${result.todayRequests}/${dailyThreshold} `
      + `uniqueTickers=${result.uniqueTickers} cacheHits=${result.cacheHits}`,
    );
    process.exitCode = result.status === "alert" ? ALERT_EXIT : 0;
  } catch (error) {
    const result = { ...base, status: "blocked", message: error.message };
    result.issueBody = buildIssueBody(result);
    writeJson(resultPath, result);
    console.error(`[blocked] ${error.message}`);
    process.exitCode = error instanceof ConfigError ? CONFIG_EXIT : ALERT_EXIT;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
