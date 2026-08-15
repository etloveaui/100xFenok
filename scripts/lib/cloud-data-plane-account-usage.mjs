/**
 * cloud-data-plane-account-usage.mjs — turn Cloudflare analytics rows into the
 * account baseline that scripts/check-cloud-data-plane-budget.mjs consumes.
 *
 * Why this exists: the budget policy already encodes every Free-plan limit
 * exactly, but every metric reported not_verified because no authenticated usage
 * was ever supplied. Measured 2026-08-14, a metric completes only when the
 * account baseline AND the request demand both carry the field, so this module
 * produces one half of an admission gate for a candidate migration — not a live
 * usage dashboard.
 *
 * Pure by design: callers pass already-fetched rows so normalisation and
 * fail-closed behaviour are testable without network. The CLI owns the fetch.
 *
 * Fail-closed is the whole point. An absent field, an empty window, or an API
 * error must raise or downgrade the envelope, never resolve to zero — a zero
 * here reads as "plenty of headroom" and would authorise a migration on no
 * evidence.
 */

export const ACCOUNT_BASELINE_SCHEMA = "cloud-data-plane-account-baseline/v1";

// R2 bills operations in two classes. Class A is mutating or listing work; Class
// B is object reads. Bucket-level listing and head calls bill as Class A, so they
// are folded into the list bucket rather than dropped.
const CLASS_A_LIST_ACTIONS = new Set(["ListObjects", "ListBuckets", "HeadBucket"]);
const CLASS_A_PUT_ACTIONS = new Set(["PutObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart"]);
const CLASS_A_COPY_ACTIONS = new Set(["CopyObject", "UploadPartCopy"]);
// Deletes bill at no charge, but the checker still requires them to be measured
// rather than assumed: a free operation is not an absent one. Without this bucket
// the delete branch can never complete, so the whole R2 verdict stays unverified
// no matter how good the rest of the capture is. Found by running the collected
// baseline end to end through the checker.
//
// Membership is taken from the provider's published free-operation list, not from
// the shape of an API name. `DeleteObjects` was in an earlier draft of this set
// and is removed: it is a batch API label, and no analytics mapping was found
// showing it as an emitted actionType. Guessing it in would silently fold an
// unmapped label into a free bucket, which errs in the direction that flatters
// us. `DeleteBucket` is free too but is bucket lifecycle, not generation
// rotation, so it is out of scope here. Re-add either only with a documented
// provider-analytics mapping.
const CLASS_A_DELETE_ACTIONS = new Set(["DeleteObject", "AbortMultipartUpload"]);
const CLASS_B_ACTIONS = new Set(["GetObject", "HeadObject"]);

function fail(message) {
  throw new Error(`cloud-data-plane account usage: ${message}`);
}

function requireWindow(window, context) {
  const elapsedDays = window?.elapsedDays;
  const monthDays = window?.monthDays;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) {
    fail(`${context} requires a positive elapsed-day window; refusing to divide by ${elapsedDays}`);
  }
  if (!Number.isFinite(monthDays) || monthDays <= 0) {
    fail(`${context} requires a positive month length`);
  }
  return { elapsedDays, monthDays };
}

function requireNumber(value, context) {
  if (!Number.isFinite(value) || value < 0) fail(`${context} is missing or not a non-negative number`);
  return value;
}

/**
 * Project a month-to-date total onto a full month. Rounding up keeps the
 * projection conservative: for a limit check, over-stating demand is safe and
 * under-stating it is not.
 */
function perMonth(total, { elapsedDays, monthDays }) {
  return Math.ceil((total / elapsedDays) * monthDays);
}

function perDay(total, { elapsedDays }) {
  return Math.ceil(total / elapsedDays);
}

function sumRequests(rows, predicate) {
  return rows
    .filter((row) => predicate(row.actionType))
    .reduce((total, row) => total + requireNumber(row.requests, `operation row ${row.actionType}`), 0);
}

export function normalizeR2({ storage, operations, window }) {
  const bounds = requireWindow(window, "R2 normalisation");
  if (!storage || typeof storage !== "object") fail("R2 storage sample is absent");
  if (!Array.isArray(operations)) fail("R2 operations rows are absent");
  const objectCount = requireNumber(storage.objectCount, "R2 storage objectCount");
  const payloadSize = requireNumber(storage.payloadSize, "R2 storage payloadSize");

  return {
    // Everything already in the account is "unrelated" to the data plane's own
    // current/previous/in_progress slots, which the checker derives from the repo
    // inventory. Byte-days, because the R2 limit is GB-month.
    unrelated_storage_byte_days: payloadSize * bounds.monthDays,
    unrelated_objects: objectCount,
    class_a: {
      put: perMonth(sumRequests(operations, (action) => CLASS_A_PUT_ACTIONS.has(action)), bounds),
      copy: perMonth(sumRequests(operations, (action) => CLASS_A_COPY_ACTIONS.has(action)), bounds),
      list: perMonth(sumRequests(operations, (action) => CLASS_A_LIST_ACTIONS.has(action)), bounds),
      delete: perMonth(sumRequests(operations, (action) => CLASS_A_DELETE_ACTIONS.has(action)), bounds),
    },
    class_b_operations_per_month: perMonth(
      sumRequests(operations, (action) => CLASS_B_ACTIONS.has(action)),
      bounds,
    ),
  };
}

export function normalizeD1({ sums, databaseBytes, accountBytes, maxRowOrBlobBytes = 0, queriesPerWorkerInvocation = 0, perTableRows = {}, window }) {
  const bounds = requireWindow(window, "D1 normalisation");
  if (!sums || typeof sums !== "object") fail("D1 analytics sums are absent");
  const rowsRead = requireNumber(sums.rowsRead, "D1 rowsRead");
  const rowsWritten = requireNumber(sums.rowsWritten, "D1 rowsWritten");

  return {
    rows_read_per_day: perDay(rowsRead, bounds),
    rows_written_per_day: perDay(rowsWritten, bounds),
    database_bytes: requireNumber(databaseBytes, "D1 databaseBytes"),
    account_bytes: requireNumber(accountBytes, "D1 accountBytes"),
    max_row_or_blob_bytes: requireNumber(maxRowOrBlobBytes, "D1 maxRowOrBlobBytes"),
    queries_per_worker_invocation: requireNumber(queriesPerWorkerInvocation, "D1 queriesPerWorkerInvocation"),
    per_table_rows: perTableRows && typeof perTableRows === "object" ? perTableRows : fail("D1 perTableRows must be an object"),
  };
}

export function normalizeKv({ operations, storedBytes, pointers, maxPointerBytes = 0, window }) {
  const bounds = requireWindow(window, "KV normalisation");
  if (!Array.isArray(operations)) fail("KV operations rows are absent");

  return {
    stored_bytes: requireNumber(storedBytes, "KV storedBytes"),
    max_pointer_bytes: requireNumber(maxPointerBytes, "KV maxPointerBytes"),
    reads_per_day: perDay(sumRequests(operations, (action) => action === "read" || action === "list"), bounds),
    writes_per_day: perDay(sumRequests(operations, (action) => action === "write" || action === "delete"), bounds),
    pointers: requireNumber(pointers, "KV pointers"),
  };
}

/**
 * Assemble the envelope the checker's inputVerified() accepts. Any API error
 * downgrades status so the checker refuses the input rather than reading a
 * partial measurement as a complete one.
 */
export function buildAccountBaseline({ verifiedOn, scope, period = "projected-from-month-to-date", r2, d1, kv, errors = null }) {
  if (typeof verifiedOn !== "string" || verifiedOn.length === 0) fail("verifiedOn is required");
  if (typeof scope !== "string" || scope.length === 0) fail("scope is required");
  if (!r2 || typeof r2 !== "object") fail("r2 branch is required");
  if (!d1 || typeof d1 !== "object") fail("d1 branch is required");
  if (!kv || typeof kv !== "object") fail("kv branch is required");

  const hasErrors = Array.isArray(errors) && errors.length > 0;
  return {
    status: hasErrors ? "unverified" : "verified",
    schema_version: ACCOUNT_BASELINE_SCHEMA,
    verified_on: verifiedOn,
    scope,
    period,
    ...(hasErrors ? { errors } : {}),
    r2,
    d1,
    kv,
  };
}
