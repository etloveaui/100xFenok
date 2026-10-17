import fs from "node:fs";
import { pathToFileURL } from "node:url";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REST_ENDPOINT = "https://api.cloudflare.com/client/v4";
// Paid allowance is monthly; a trailing 31-day window conservatively covers
// any billing anchor. Daily/hourly limits detect bursts, not Free-plan quotas.
const MONTHLY_INCLUDED_REQUESTS = 10_000_000;
const DEFAULT_MONTHLY_THRESHOLD = 7_000_000;
const DEFAULT_DAILY_THRESHOLD = 225_000;
const DEFAULT_HOURLY_THRESHOLD = 20_000;
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

function maskAccountId(accountId) {
  if (!accountId) return "";
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
    "Content-Type": "application/json",
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
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
      headers: authHeaders(token),
    });
  } catch (error) {
    throw new ConfigError(
      `Cloudflare account auto-discovery failed: ${error.message}. Set CLOUDFLARE_ACCOUNT_ID as a non-secret GitHub environment variable, or update the existing token to allow account listing.`,
    );
  }

  const accounts = Array.isArray(payload?.result) ? payload.result : [];
  if (accounts.length === 0) {
    throw new ConfigError("Cloudflare account auto-discovery returned no accounts. Set CLOUDFLARE_ACCOUNT_ID.");
  }

  const configuredName = process.env.CLOUDFLARE_ACCOUNT_NAME;
  if (configuredName) {
    const match = accounts.find((account) => account.name === configuredName);
    if (!match) {
      throw new ConfigError(`No Cloudflare account matched CLOUDFLARE_ACCOUNT_NAME=${configuredName}.`);
    }
    return { id: match.id, name: match.name, source: "CLOUDFLARE_ACCOUNT_NAME" };
  }

  if (accounts.length > 1) {
    throw new ConfigError(
      `Cloudflare account auto-discovery found ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_NAME as a non-secret GitHub environment variable.`,
    );
  }

  return { id: accounts[0].id, name: accounts[0].name, source: "auto-discovered" };
}

function sumRequests(rows) {
  return rows.reduce((total, row) => {
    const value = row?.sum?.requests;
    const numeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
    const count = numeric ? Number(value) : NaN;
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(total + count)) {
      throw new Error("Cloudflare Worker request count is missing or invalid; usage is unknown.");
    }
    return total + count;
  }, 0);
}

export function parseWorkerUsage(account) {
  if (!Array.isArray(account?.day) || !account.day.length
    || !Array.isArray(account?.hour) || !account.hour.length
    || !Array.isArray(account?.month) || !account.month.length
    || !Array.isArray(account?.trailing) || !account.trailing.length) {
    throw new Error("Cloudflare Worker usage rows are missing; usage is unknown.");
  }
  const dayRows = account.day;
  const hourRows = account.hour;
  return {
    monthRows: account.month.length,
    monthlyRequests: sumRequests(account.month),
    trailing31dRequests: sumRequests(account.trailing),
    dayRows: dayRows.length,
    hourRows: hourRows.length,
    todayRequests: sumRequests(dayRows),
    lastHourRequests: sumRequests(hourRows),
    truncated: dayRows.length >= 10000 || hourRows.length >= 10000 || account.month.length >= 10000 || account.trailing.length >= 10000,
  };
}

export async function queryWorkerUsage({ token, accountId, dayStart, hourStart, now, monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) }) {
  const query = `
    query WorkerRequestBudget(
      $accountTag: string,
      $monthStart: string,
      $trailingStart: string,
      $dayStart: string,
      $hourStart: string,
      $end: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          trailing: workersInvocationsAdaptive(
            limit: 10000,
            filter: { datetime_geq: $trailingStart, datetime_leq: $end }
          ) { sum { requests } }
          month: workersInvocationsAdaptive(
            limit: 10000,
            filter: { datetime_geq: $monthStart, datetime_leq: $end }
          ) { sum { requests } }
          day: workersInvocationsAdaptive(
            limit: 10000,
            filter: {
              datetime_geq: $dayStart,
              datetime_leq: $end
            }
          ) {
            sum {
              requests
            }
          }
          hour: workersInvocationsAdaptive(
            limit: 10000,
            filter: {
              datetime_geq: $hourStart,
              datetime_leq: $end
            }
          ) {
            sum {
              requests
            }
          }
        }
      }
    }
  `;

  const payload = await fetchJson(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        monthStart: toIso(monthStart),
        trailingStart: toIso(new Date(now.getTime() - 31 * 86400_000)),
        dayStart: toIso(dayStart),
        hourStart: toIso(hourStart),
        end: toIso(now),
      },
    }),
  });

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  const account = payload?.data?.viewer?.accounts?.[0];
  if (!account) {
    throw new Error("Cloudflare GraphQL returned no account data.");
  }

  return parseWorkerUsage(account);
}

function buildIssueBody(result) {
  const paid = [
    `Paid included requests: ${MONTHLY_INCLUDED_REQUESTS}/month; overage USD 0.30/M`,
    `Month-to-date requests: ${result.monthlyRequests}; projected month-end: ${result.projectedMonthRequests}`,
    `Trailing 31-day requests: ${result.trailing31dRequests}; warning ${result.monthlyThreshold} against the larger of trailing usage and month-end projection`,
    `Request-only estimated overage: USD ${result.requestOverageUsd} (KRW ${result.requestOverageKrw}, planning rate 1,500 KRW/USD)`,
    "Extra-charge allowance: about KRW 10,000/month; early warning KRW 5,000.",
    "Coverage: Worker requests only; excludes CPU, Builds, KV, D1, Queues, R2 and tax. R2 publisher gate measures its own costs; this is not an account-wide billing cap.",
  ];
  if (result.status === "blocked") {
    return [
      "[blocked] Worker request budget check could not run.",
      "",
      `Reason: ${result.message}`,
      "",
      "Needed:",
      "- Existing `CLOUDFLARE_API_TOKEN` must be available to the `production` environment and have Cloudflare Account Analytics read access.",
      "- If account auto-discovery is unavailable, set non-secret environment variable `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_ACCOUNT_NAME`.",
      "",
      `Checked at UTC: ${result.checkedAtUtc}`,
      "Scope: all Workers in the Cloudflare account",
    ].join("\n");
  }

  if (result.status === "ok") {
    return [
      "Worker request budget check passed.",
      ...paid,
      "",
      "Scope: all Workers in the Cloudflare account",
      `Checked at UTC: ${result.checkedAtUtc}`,
      `Today UTC requests: ${result.todayRequests} / ${result.dailyThreshold}`,
      `Last-hour requests: ${result.lastHourRequests} / ${result.hourlyThreshold}`,
    ].join("\n");
  }

  return [
    "[alert] Worker request budget threshold crossed.",
    ...paid,
    "",
    "Scope: all Workers in the Cloudflare account",
    `Checked at UTC: ${result.checkedAtUtc}`,
    `UTC day window: ${result.dayStartUtc} -> ${result.checkedAtUtc}`,
    `Last hour window: ${result.hourStartUtc} -> ${result.checkedAtUtc}`,
    "",
    `Today UTC requests: ${result.todayRequests} / ${result.dailyThreshold}`,
    `Last-hour requests: ${result.lastHourRequests} / ${result.hourlyThreshold}`,
    `Rows truncated: ${result.truncated ? "yes" : "no"}`,
    "",
    "This issue is the no-new-secret fallback for the scheduled OPS alarm.",
  ].join("\n");
}

async function main() {
  const monthlyThreshold = envInt("MONTHLY_REQUEST_THRESHOLD", DEFAULT_MONTHLY_THRESHOLD);
  const dailyThreshold = envInt("DAILY_REQUEST_THRESHOLD", DEFAULT_DAILY_THRESHOLD);
  const hourlyThreshold = envInt("HOURLY_REQUEST_THRESHOLD", DEFAULT_HOURLY_THRESHOLD);
  const resultPath = process.env.WORKER_REQUEST_BUDGET_RESULT || "worker-request-budget-result.json";
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);

  const base = {
    monthlyThreshold,
    checkedAtUtc: toIso(now),
    dailyThreshold,
    dayStartUtc: toIso(dayStart),
    hourlyThreshold,
    hourStartUtc: toIso(hourStart),
    issueTitle: "100xFenok Worker request budget alarm",
    scope: "account",
  };

  if (!token) {
    const result = {
      ...base,
      status: "blocked",
      message: "CLOUDFLARE_API_TOKEN is not available.",
    };
    result.issueBody = buildIssueBody(result);
    writeJson(resultPath, result);
    console.error(`[blocked] ${result.message}`);
    process.exit(CONFIG_EXIT);
  }

  try {
    const account = await resolveAccount(token);
    const usage = await queryWorkerUsage({
      accountId: account.id,
      dayStart,
      hourStart,
      now,
      token,
    });

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const projectedMonthRequests = Math.ceil(usage.monthlyRequests * (monthEnd - monthStart) / Math.max(60_000, now - monthStart));
    const budgetRequests = Math.max(usage.trailing31dRequests, projectedMonthRequests);
    const requestOverageUsd = Math.max(0, budgetRequests - MONTHLY_INCLUDED_REQUESTS) / 1_000_000 * 0.30;
    const requestOverageKrw = Math.ceil(requestOverageUsd * 1500);
    const alert =
      budgetRequests >= monthlyThreshold || requestOverageKrw >= 5000 ||
      usage.truncated ||
      usage.todayRequests > dailyThreshold ||
      usage.lastHourRequests > hourlyThreshold;

    const result = {
      ...base,
      ...usage,
      projectedMonthRequests,
      requestOverageUsd,
      requestOverageKrw,
      accountIdMasked: maskAccountId(account.id),
      accountName: account.name,
      accountSource: account.source,
      status: alert ? "alert" : "ok",
    };
    result.issueBody = buildIssueBody(result);

    writeJson(resultPath, result);

    console.log(
      [
        `status=${result.status}`,
        "scope=account",
        `account=${account.name} (${result.accountIdMasked}, ${account.source})`,
        `monthToDate=${result.monthlyRequests} projected=${projectedMonthRequests}/${monthlyThreshold} trailing31d=${result.trailing31dRequests}`,
        `todayUtc=${result.todayRequests}/${dailyThreshold}`,
        `lastHour=${result.lastHourRequests}/${hourlyThreshold}`,
        `rows=day:${result.dayRows},hour:${result.hourRows}`,
        `truncated=${result.truncated ? "yes" : "no"}`,
      ].join(" "),
    );

    process.exit(alert ? ALERT_EXIT : 0);
  } catch (error) {
    const isConfig = error instanceof ConfigError;
    const result = {
      ...base,
      status: "blocked",
      message: error.message,
    };
    result.issueBody = buildIssueBody(result);
    writeJson(resultPath, result);
    console.error(`${isConfig ? "[blocked]" : "[error]"} ${error.message}`);
    process.exit(isConfig ? CONFIG_EXIT : ALERT_EXIT);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
