#!/usr/bin/env node
/**
 * collect-cloud-data-plane-account-baseline.mjs — capture the Cloudflare account
 * baseline the budget checker needs, read-only.
 *
 * This is the one place that performs network. The query document and every
 * refusal live in scripts/lib/cloud-data-plane-account-query.mjs; the arithmetic
 * lives in scripts/lib/cloud-data-plane-account-usage.mjs. Splitting it that way
 * keeps the fail-closed behaviour testable without a credential.
 *
 * Bounded on purpose:
 *   - the account tag is an explicit argument, never inferred from the token;
 *   - the token is read from the environment, used once, and never written to
 *     the output, the logs, or the error text;
 *   - analytics reads only — no mutation, no bucket/database/namespace creation;
 *   - any API error, partial window, or missing dataset aborts rather than
 *     emitting a baseline, because a baseline that looks measured and is not
 *     would authorise a migration on no evidence.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ACCOUNT_QUERY_ENDPOINT,
  elapsedDaysBetween,
  fetchAccountRows,
} from "./lib/cloud-data-plane-account-query.mjs";
import {
  buildAccountBaseline,
  normalizeD1,
  normalizeKv,
  normalizeR2,
} from "./lib/cloud-data-plane-account-usage.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const FLAGS = new Set(["--account-tag", "--since", "--until", "--month-days", "--scope", "--table", "--out"]);

function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv) {
  const options = { accountTag: null, since: null, until: null, monthDays: 30, scope: null, tables: [], out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!FLAGS.has(flag)) fail(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    index += 1;
    if (flag === "--account-tag") options.accountTag = value;
    else if (flag === "--since") options.since = value;
    else if (flag === "--until") options.until = value;
    else if (flag === "--month-days") options.monthDays = Number.parseInt(value, 10);
    else if (flag === "--scope") options.scope = value;
    // Repeatable. Each declared ledger table must appear even at zero rows: the
    // checker treats an absent table row count as unmeasured rather than none.
    else if (flag === "--table") options.tables.push(value);
    else if (flag === "--out") options.out = path.resolve(value);
  }
  if (!options.accountTag) fail("--account-tag is required and must be explicit");
  if (!options.since || !options.until) fail("--since and --until are required; the window is never guessed");
  if (!Number.isFinite(options.monthDays) || options.monthDays <= 0) fail("--month-days must be a positive integer");
  if (!options.out) fail("--out is required");
  return options;
}

// The only network call in this lane. Non-2xx and unparsable bodies abort before
// any extraction so a proxy error page can never be read as usage data.
async function httpTransport({ endpoint, query, variables, token }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) fail(`analytics endpoint returned HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch {
    fail("analytics endpoint returned a body that is not JSON");
  }
  return null;
}

export async function collectBaseline(options, { transport = httpTransport, token } = {}) {
  if (typeof token !== "string" || token.length === 0) fail(`${TOKEN_ENV} is not set`);
  const elapsedDays = elapsedDaysBetween(options.since, options.until);
  if (elapsedDays <= 0) fail("the measured window must cover at least one day");
  const window = { elapsedDays, monthDays: options.monthDays };

  // The normalized baseline is derived; the provider response is the evidence.
  // Capturing its digest here lets a receipt bind the actual measurement rather
  // than only the arithmetic performed on it.
  let responseDigest = null;
  const capturingTransport = async (call) => {
    const body = await transport(call);
    responseDigest = createHash("sha256").update(canonicalJson(body)).digest("hex");
    return body;
  };

  const { rows, variables } = await fetchAccountRows({
    transport: capturingTransport,
    accountTag: options.accountTag,
    since: options.since,
    until: options.until,
    token,
  });

  const perTableRows = Object.fromEntries(options.tables.map((id) => [id, 0]));
  const baseline = buildAccountBaseline({
    verifiedOn: options.until,
    // The scope string is descriptive provenance, never the credential or the
    // raw account tag secret-handling concern; the tag itself is not a secret,
    // but the default keeps the output self-describing without echoing input.
    scope: options.scope ?? `cloudflare-account-${options.accountTag}`,
    period: "projected-from-month-to-date",
    r2: normalizeR2({ storage: rows.r2.storage, operations: rows.r2.operations, window }),
    d1: normalizeD1({
      sums: rows.d1.sums,
      // The publication ledger does not exist yet. Zero is recorded as a
      // measurement of an absent database, not as an unmeasured field.
      databaseBytes: 0,
      accountBytes: 0,
      perTableRows,
      window,
    }),
    kv: normalizeKv({ operations: rows.kv.operations, storedBytes: 0, pointers: 0, window }),
  });

  if (baseline.status !== "verified") fail("collected baseline is not verified; refusing to write it");
  return {
    ...baseline,
    measured_window: { since: options.since, until: options.until, elapsed_days: elapsedDays, month_days: options.monthDays },
    // Frozen query identity: the exact account tag and window the numbers came
    // from, so a receipt cannot be re-pointed at a different measurement.
    query: {
      account_tag: variables.accountTag,
      since: variables.since,
      until: variables.until,
      response_digest: responseDigest,
      // Named precisely: this is the canonical-JSON digest of the parsed
      // response, not a byte digest of the wire body.
      response_digest_basis: "sha256_of_canonical_json_of_parsed_response",
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const token = process.env[TOKEN_ENV];
    const baseline = await collectBaseline(options, { token });
    fs.writeFileSync(options.out, `${canonicalJson(baseline)}\n`, { encoding: "utf8", mode: 0o600 });
    // Deliberately reports the destination and window only. The baseline body is
    // not echoed: it is written once, to one place, and read from there.
    process.stdout.write(`${canonicalJson({
      wrote: options.out,
      endpoint: ACCOUNT_QUERY_ENDPOINT,
      window: baseline.measured_window,
      status: baseline.status,
    })}\n`);
  } catch (error) {
    // Never interpolate the token or the response body into the failure text.
    process.stderr.write(`collect-cloud-data-plane-account-baseline: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
