import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./json-canonical.mjs";

// The code whose behaviour the receipt attests to. A base commit does not
// identify it: this work is reviewed as an uncommitted patch on top of that base,
// so a receipt bound only to the commit would describe code that is not what ran.
const CONTRACT_SOURCES = Object.freeze([
  "cloud-data-plane-candidate-scope.mjs",
  "cloud-data-plane-candidate-gate.mjs",
  "cloud-data-plane-budget.mjs",
]);

export const CANDIDATE_SCOPE_RECEIPT_SCHEMA = "candidate-scope-receipt/v1";
export const CANDIDATE_GATE_SCHEMA = "candidate-gate/v1";

function fail(message) {
  throw new Error(`cloud-data-plane candidate gate: ${message}`);
}

function digestOf(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function contractDigest() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rows = CONTRACT_SOURCES.map((name) => {
    const bytes = fs.readFileSync(path.join(here, name));
    return `${name}:${createHash("sha256").update(bytes).digest("hex")}`;
  });
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

/**
 * The report as it exists before any receipt or gate is attached.
 *
 * Defined explicitly so that adding the receipt and the gate to an evidence
 * bundle later cannot change what the receipt claims to have measured. Hashing
 * the raw report would be circular the moment the bundle carries both.
 */
export function reportProjection(report) {
  const { candidate_scope: _scope, ...rest } = report;
  return {
    schema_version: rest.schema_version,
    inventory_scope: rest.inventory_scope,
    catalog_verdict: rest.catalog?.verdict ?? null,
    catalog_source_digests: rest.catalog?.source_digests ?? null,
    budget: rest.budget,
    verdict: rest.verdict,
  };
}

function requireString(value, context) {
  if (typeof value !== "string" || value.length === 0) fail(`${context} is required`);
  return value;
}

// UTC only, and seconds precision. A receipt whose time is expressed in local
// time cannot be compared across the machines that will read it.
function requireUtcTimestamp(value, context) {
  requireString(value, context);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) fail(`${context} must be a UTC timestamp like 2026-08-14T05:00:00Z`);
  return value;
}

/**
 * The durable half of a candidate measurement.
 *
 * The scope manifest's path_digest deliberately covers only the deterministic
 * contents, so re-measuring the same tree reproduces it. That determinism is
 * exactly why the manifest cannot carry the time-varying binding: a timestamp or
 * a base commit inside the digest would make every measurement unique and the
 * digest worthless as an equality check. The binding therefore lives here, in a
 * companion artifact that references the manifest by digest.
 */
export function buildCandidateScopeReceipt({
  report,
  baseCommit,
  measuredAt,
  measurementMode = "live_filesystem",
  demand = null,
  accountBaseline = null,
  contentDigest = null,
  accountBaselineRawDigest = null,
} = {}) {
  if (!report || typeof report !== "object") fail("report is required");
  if (report.inventory_scope?.kind !== "candidate") fail("a receipt is only defined for a candidate-scoped report");
  const manifest = report.candidate_scope;
  if (!manifest) fail("report carries no candidate scope manifest");

  requireString(baseCommit, "baseCommit");
  requireUtcTimestamp(measuredAt, "measuredAt");
  if (!["live_filesystem"].includes(measurementMode)) fail(`unsupported measurement mode: ${measurementMode}`);

  return {
    schema_version: CANDIDATE_SCOPE_RECEIPT_SCHEMA,
    candidate: {
      id: manifest.candidate_id,
      owner_lane: manifest.owner.lane_id,
      enforcement: manifest.owner.enforcement,
      owner_workflow: manifest.owner.owner_workflow,
    },
    base: {
      commit: baseCommit,
      lane_registry_digest: report.catalog?.source_digests?.lane_registry ?? null,
      detection_config_digest: report.catalog?.source_digests?.data_supply_detection_config ?? null,
    },
    scope: {
      path_digest: manifest.path_digest,
      // Stated so the reader never has to infer it: path_digest sees a size
      // change, not a same-size content swap. Payload identity is the separate
      // field below, and its absence is labelled rather than left blank.
      path_digest_basis: "relative_path_and_byte_size",
      file_count: manifest.totals.file_count,
      bytes: manifest.totals.bytes,
      included_roots: manifest.included_canonical_roots.map((row) => row.path),
      excluded_paths: manifest.excluded.map((row) => row.path),
    },
    payload_identity: contentDigest === null
      ? { mode: "budget_scope_only", digest: null, note: "size and scope only; this receipt does not attest payload content identity" }
      : { mode: contentDigest.mode, digest: contentDigest.digest, file_count: contentDigest.file_count },
    // Identifies the code that produced the numbers, which the base commit cannot
    // do while this work is an uncommitted patch on top of that base.
    contract: {
      digest: contractDigest(),
      sources: CONTRACT_SOURCES,
    },
    measurement: {
      measured_at: measuredAt,
      mode: measurementMode,
    },
    policy: {
      scope_policy: CANDIDATE_SCOPE_RECEIPT_SCHEMA,
      // Recorded per projection root so a later change from rebuilt to migrated
      // is visible as a policy change rather than as an unexplained byte jump.
      projection_policy: manifest.derived_public_projection_roots.map((row) => ({
        path: row.path,
        kind: row.kind,
        migrates: row.migrates,
      })),
    },
    references: {
      // Over the receipt-free projection, so attaching this receipt and the gate
      // to an evidence bundle cannot retroactively change what was measured.
      report_projection_digest: digestOf(reportProjection(report)),
      report_projection_basis: "schema_version, inventory_scope, catalog verdict and source digests, budget, verdict",
      demand_digest: demand === null ? null : digestOf(demand),
      account_baseline_digest: accountBaseline === null ? null : digestOf(accountBaseline),
      // The normalized baseline is derived; the raw provider response is the
      // actual evidence, so it is bound separately or its absence is explicit.
      account_baseline_raw_digest: accountBaselineRawDigest,
    },
  };
}

function sameList(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/**
 * Enforce the receipt contract instead of merely observing that fields exist.
 *
 * The earlier gate accepted a receipt on schema, candidate id and path digest
 * alone, so every other field could be absent, stale or tampered and the gate
 * still passed. Producing a field and enforcing it are different things, and
 * only the second makes it evidence. Each check returns a named failure so a
 * rejected receipt says which binding broke rather than only that one did.
 */
export function validateReceiptBinding({ report, receipt, demand = null, accountBaseline = null, expectedBase = null } = {}) {
  const failures = [];
  const record = (condition, name) => { if (!condition) failures.push(name); };

  if (!receipt || typeof receipt !== "object") return { bound: false, failures: ["receipt_absent"], attests_payload_identity: false };
  const manifest = report?.candidate_scope;
  if (!manifest) return { bound: false, failures: ["report_not_candidate_scoped"], attests_payload_identity: false };

  record(receipt.schema_version === CANDIDATE_SCOPE_RECEIPT_SCHEMA, "schema_version");
  record(receipt.candidate?.id === manifest.candidate_id, "candidate_id");
  record(receipt.candidate?.enforcement === manifest.owner.enforcement, "candidate_enforcement");
  record(typeof receipt.base?.commit === "string" && receipt.base.commit.length > 0, "base_commit");
  // A nonempty string is not a binding. When the caller knows which base was
  // reviewed, the receipt must name that one and no other; an arbitrary commit
  // id would otherwise satisfy the check while describing different code.
  if (expectedBase !== null) record(receipt.base?.commit === expectedBase, "base_commit_expected");
  record(receipt.base?.lane_registry_digest === (report.catalog?.source_digests?.lane_registry ?? null), "base_lane_registry_digest");
  record(receipt.base?.detection_config_digest === (report.catalog?.source_digests?.data_supply_detection_config ?? null), "base_detection_config_digest");

  record(receipt.measurement?.mode === "live_filesystem", "measurement_mode");
  record(typeof receipt.measurement?.measured_at === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(receipt.measurement.measured_at), "measurement_measured_at");

  record(receipt.scope?.path_digest === manifest.path_digest, "scope_path_digest");
  record(receipt.scope?.path_digest_basis === "relative_path_and_byte_size", "scope_path_digest_basis");
  record(receipt.scope?.file_count === manifest.totals.file_count, "scope_file_count");
  record(receipt.scope?.bytes === manifest.totals.bytes, "scope_bytes");
  record(sameList(receipt.scope?.included_roots, manifest.included_canonical_roots.map((row) => row.path)), "scope_included_roots");
  record(sameList(receipt.scope?.excluded_paths, manifest.excluded.map((row) => row.path)), "scope_excluded_paths");

  record(receipt.contract?.digest === contractDigest(), "contract_digest");
  record(sameList(receipt.contract?.sources, [...CONTRACT_SOURCES]), "contract_sources");

  record(receipt.references?.report_projection_digest === digestOf(reportProjection(report)), "report_projection_digest");
  record(receipt.references?.demand_digest === (demand === null ? null : digestOf(demand)), "demand_digest");
  record(receipt.references?.account_baseline_digest === (accountBaseline === null ? null : digestOf(accountBaseline)), "account_baseline_digest");

  // A verified baseline is a live measurement, so the receipt must name which
  // measurement. An unverified or absent baseline has nothing to bind.
  if (accountBaseline?.status === "verified") {
    const query = accountBaseline.query;
    record(typeof query?.account_tag === "string" && query.account_tag.length > 0, "baseline_query_account_tag");
    record(typeof query?.since === "string" && typeof query?.until === "string", "baseline_query_window");
    record(typeof query?.response_digest === "string" && receipt.references?.account_baseline_raw_digest === query.response_digest, "baseline_raw_response_digest");
  }

  const mode = receipt.payload_identity?.mode;
  record(mode === "budget_scope_only" || mode === "content_sha256", "payload_identity_mode");
  if (mode === "budget_scope_only") {
    record(receipt.payload_identity.digest === null, "payload_identity_blank_digest");
  } else if (mode === "content_sha256") {
    record(typeof receipt.payload_identity.digest === "string" && receipt.payload_identity.digest.length === 64, "payload_identity_digest");
    record(receipt.payload_identity.digest !== manifest.path_digest, "payload_identity_distinct_from_path_digest");
    // A content digest covering fewer files than the scope is a partial attestation
    // presented as a whole one.
    record(receipt.payload_identity.file_count === manifest.totals.file_count, "payload_identity_file_count");
  }

  // The projection policy is what makes a later rebuilt->migrated change visible.
  // If it is not enforced, the receipt records a policy nobody checks.
  const declaredProjection = manifest.derived_public_projection_roots
    .map((row) => `${row.path}:${row.kind}:${row.migrates}`);
  const receiptProjection = Array.isArray(receipt.policy?.projection_policy)
    ? receipt.policy.projection_policy.map((row) => `${row.path}:${row.kind}:${row.migrates}`)
    : null;
  record(sameList(receiptProjection, declaredProjection), "projection_policy");
  record(receipt.policy?.scope_policy === CANDIDATE_SCOPE_RECEIPT_SCHEMA, "scope_policy");

  return {
    bound: failures.length === 0,
    failures,
    // Carried separately so a size-only receipt is never read as attesting content.
    attests_payload_identity: mode === "content_sha256",
  };
}

/**
 * The Phase 1 hard gate for a candidate lane.
 *
 * It reads the scoped candidate budget verdict, never the combined estate
 * report verdict: the estate catalog carries unrelated incompleteness that has
 * nothing to do with whether this payload fits. The estate signals are still
 * carried through as readiness, visible and unmodified — a candidate run must
 * never relabel the catalog as passed, and the default estate-wide migration
 * must stay unverified while that catalog is incomplete.
 */
export function evaluateCandidateGate({ report, receipt = null, demand = null, accountBaseline = null, expectedBase = null } = {}) {
  if (!report || typeof report !== "object") fail("report is required");
  if (report.inventory_scope?.kind !== "candidate") {
    fail("the candidate gate refuses an estate-scoped report; an estate migration stays unverified while the catalog is incomplete");
  }
  const manifest = report.candidate_scope;
  if (!manifest) fail("report carries no candidate scope manifest");

  const budgetVerdict = report.budget?.verdict ?? "not_verified";
  const baselineStatus = report.budget?.input_provenance?.account_baseline?.status ?? "not_verified";
  const retentionComplete = report.budget?.r2?.class_a_breakdown?.delete_free?.complete === true;
  const scopeComplete = manifest.totals.file_count > 0
    && manifest.totals.bytes > 0
    && manifest.excluded.every((row) => typeof row.reason === "string" && row.reason.length > 0);
  // A receipt is an explicit input, not decoration: without it the measurement is
  // not bound to a base or a time and cannot be re-checked later. Every field is
  // enforced, not merely present.
  const receiptCheck = receipt === null
    ? { bound: false, failures: ["receipt_absent"], attests_payload_identity: false }
    : validateReceiptBinding({ report, receipt, demand, accountBaseline, expectedBase });

  // A planning-line pass means nothing about metrics the policy never governs.
  // Measured 2026-08-14 every service is partially covered — R2 leaves class B
  // ungoverned, D1 leaves two metrics, KV governs only writes_per_day — so an
  // unqualified "planning pass" would claim more coverage than exists. The gate
  // therefore holds until the owner either supplies the missing thresholds or
  // accepts hard-limit-only as declared policy.
  const planningCoverage = ["r2", "d1", "kv"].map((service) => ({
    service,
    label: report.budget?.[service]?.planning_line?.coverage?.label ?? "unknown",
    ungoverned: report.budget?.[service]?.planning_line?.coverage?.ungoverned ?? null,
  }));
  const planningCoverageComplete = planningCoverage.every((row) => Array.isArray(row.ungoverned) && row.ungoverned.length === 0);

  // The verifier is required to supply the reviewed base. Leaving it out silently
  // downgrades base binding to "is a nonempty string", which is not a binding at
  // all. A rule that depends on remembering an argument is the kind that gets
  // forgotten exactly once and never noticed, so it is enforced here rather than
  // written down as an operating instruction.
  const baseBindingEnforced = typeof expectedBase === "string" && expectedBase.length > 0;

  const inputs = {
    candidate_scope_complete: scopeComplete,
    account_baseline_status: baselineStatus,
    retention_complete: retentionComplete,
    receipt_bound: receiptCheck.bound,
    base_binding_enforced: baseBindingEnforced,
    receipt_failures: receiptCheck.failures,
    receipt_attests_payload_identity: receiptCheck.attests_payload_identity,
    planning_coverage_complete: planningCoverageComplete,
    planning_coverage: planningCoverage,
    budget_verdict: budgetVerdict,
  };
  const receiptBound = receiptCheck.bound;

  const verdict = budgetVerdict === "fail"
    ? "fail"
    : (budgetVerdict === "pass" && scopeComplete && retentionComplete && receiptBound
        && baseBindingEnforced && planningCoverageComplete && baselineStatus === "verified")
      ? "pass"
      : "not_verified";

  return {
    schema_version: CANDIDATE_GATE_SCHEMA,
    candidate_id: manifest.candidate_id,
    inputs,
    verdict,
    // Carried, never folded into the verdict above.
    readiness_signals: {
      estate_catalog_verdict: report.catalog?.verdict ?? "not_verified",
      combined_report_verdict: report.verdict ?? "not_verified",
    },
  };
}
