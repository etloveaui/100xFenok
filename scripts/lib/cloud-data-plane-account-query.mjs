/**
 * cloud-data-plane-account-query.mjs — build the read-only Cloudflare analytics
 * query for the account baseline, and turn its response into the row shapes
 * scripts/lib/cloud-data-plane-account-usage.mjs already normalises.
 *
 * This module never reaches for a global fetch. The caller supplies a transport,
 * so nothing here can perform network on its own and every fail-closed path is
 * testable offline. That keeps the sibling module's contract intact: the CLI
 * owns the network call, the libraries own the shapes and the refusals.
 *
 * Read-only by construction: the document contains only analytics aggregation
 * sets. There is no mutation, no resource creation, and the account tag is an
 * explicit input rather than something discovered from the credential — a
 * credential that can see several accounts must not silently pick one.
 */

export const ACCOUNT_QUERY_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// One document, four aggregation sets. Kept as a single request so every branch
// of the baseline describes the same window: two requests could straddle a day
// boundary and produce a baseline whose parts disagree about "month to date".
export const ACCOUNT_QUERY = `query CloudDataPlaneAccountBaseline($accountTag: String!, $since: Date!, $until: Date!, $datetimeSince: Time!, $datetimeUntil: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(limit: 1, filter: { date_geq: $since, date_leq: $until }) {
        max { objectCount payloadSize }
      }
      r2OperationsAdaptiveGroups(limit: 100, filter: { date_geq: $since, date_leq: $until }) {
        dimensions { actionType }
        sum { requests }
      }
      d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $since, date_leq: $until }) {
        sum { readQueries writeQueries rowsRead rowsWritten }
      }
      kvOperationsAdaptiveGroups(limit: 100, filter: { date_geq: $since, date_leq: $until }) {
        dimensions { actionType }
        sum { requests }
      }
    }
  }
}`;

function fail(message) {
  throw new Error(`cloud-data-plane account query: ${message}`);
}

function isoDate(value, context) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${context} must be an ISO date (YYYY-MM-DD)`);
  return value;
}

export function buildQueryVariables({ accountTag, since, until } = {}) {
  if (typeof accountTag !== "string" || accountTag.length === 0) {
    fail("accountTag is required and must be explicit; it is never inferred from the credential");
  }
  const from = isoDate(since, "since");
  const to = isoDate(until, "until");
  if (from > to) fail("since must not be after until");
  return {
    accountTag,
    since: from,
    until: to,
    datetimeSince: `${from}T00:00:00Z`,
    datetimeUntil: `${to}T23:59:59Z`,
  };
}

// Inclusive day count. The window is what every per-day and per-month projection
// divides by, so an off-by-one here silently mis-states the whole baseline.
export function elapsedDaysBetween(since, until) {
  const from = Date.parse(`${isoDate(since, "since")}T00:00:00Z`);
  const to = Date.parse(`${isoDate(until, "until")}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

function requireRows(value, context) {
  if (!Array.isArray(value)) fail(`${context} is missing from the response; refusing to treat an absent dataset as zero usage`);
  return value;
}

function operationRows(rows, context) {
  return requireRows(rows, context).map((row) => {
    const actionType = row?.dimensions?.actionType;
    const requests = row?.sum?.requests;
    if (typeof actionType !== "string" || actionType.length === 0) fail(`${context} row is missing actionType`);
    if (!Number.isFinite(requests) || requests < 0) fail(`${context} row ${actionType} is missing a non-negative requests total`);
    return { actionType, requests };
  });
}

/**
 * Turn one GraphQL response into the row shapes the normalisers expect.
 *
 * Every refusal below exists because the alternative is a baseline that looks
 * measured and is not. A GraphQL partial success carries both data and errors,
 * and reading only the data half is how an unauthorised dataset becomes an
 * apparent zero.
 */
export function extractAccountRows(response, { accountTag } = {}) {
  if (!response || typeof response !== "object") fail("response is not an object");
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    const messages = response.errors.map((row) => row?.message ?? "unknown").join("; ");
    fail(`API returned errors, so the window is not fully measured: ${messages}`);
  }
  if (response.success === false) fail("API reported success=false");
  const accounts = response?.data?.viewer?.accounts;
  if (!Array.isArray(accounts)) fail("response contains no viewer.accounts array");
  if (accounts.length === 0) fail(`no analytics returned for account ${accountTag}; the token may not be authorised for it`);
  if (accounts.length > 1) fail("filter returned more than one account; the account tag must select exactly one");
  const account = accounts[0];

  const storageRows = requireRows(account.r2StorageAdaptiveGroups, "r2StorageAdaptiveGroups");
  if (storageRows.length === 0) fail("r2 storage window returned no rows; an empty window is not zero usage");
  const objectCount = storageRows[0]?.max?.objectCount;
  const payloadSize = storageRows[0]?.max?.payloadSize;
  if (!Number.isFinite(objectCount) || !Number.isFinite(payloadSize)) fail("r2 storage row is missing objectCount or payloadSize");

  const d1Rows = requireRows(account.d1AnalyticsAdaptiveGroups, "d1AnalyticsAdaptiveGroups");
  const d1Sums = d1Rows.reduce((totals, row) => {
    for (const key of ["readQueries", "writeQueries", "rowsRead", "rowsWritten"]) {
      const value = row?.sum?.[key];
      if (!Number.isFinite(value) || value < 0) fail(`d1 row is missing a non-negative ${key}`);
      totals[key] += value;
    }
    return totals;
  }, { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 });

  return {
    r2: {
      storage: { objectCount, payloadSize },
      operations: operationRows(account.r2OperationsAdaptiveGroups, "r2OperationsAdaptiveGroups"),
    },
    d1: { sums: d1Sums },
    kv: { operations: operationRows(account.kvOperationsAdaptiveGroups, "kvOperationsAdaptiveGroups") },
  };
}

/**
 * Perform the collection with a caller-supplied transport.
 *
 * `transport` receives ({ endpoint, query, variables, token }) and must return
 * the parsed JSON body. It is required rather than defaulted so that importing
 * this module can never cause a network call, and so that the credential is
 * handed to exactly one place instead of being read ambiently.
 */
export async function fetchAccountRows({ transport, accountTag, since, until, token } = {}) {
  if (typeof transport !== "function") fail("a transport function is required; this module performs no network on its own");
  if (typeof token !== "string" || token.length === 0) fail("an API token is required");
  const variables = buildQueryVariables({ accountTag, since, until });
  const body = await transport({ endpoint: ACCOUNT_QUERY_ENDPOINT, query: ACCOUNT_QUERY, variables, token });
  return { rows: extractAccountRows(body, { accountTag }), variables };
}
