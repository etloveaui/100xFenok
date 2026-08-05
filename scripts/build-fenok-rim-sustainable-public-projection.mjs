#!/usr/bin/env node

// Redacted public projection of the FENO RIM sustainable index ranges.
//
// The canonical artifact is a research record: it carries every operand, the
// frozen calibration constants, the fitted discount equation, and the evidence
// notes that explain where each constant came from. None of that is publishable.
// Copying it to the public mirror would ship the method, not the result.
//
// So this builder does not mirror. It projects: an EXPLICIT allowlist of fields
// is copied into a new document, and anything the allowlist does not name is
// absent by construction rather than by deletion. A field added to the canonical
// artifact later therefore stays private until someone names it here.
//
// Three refusals are structural, not stylistic:
//
//   1. A document that is not promoted, or whose calibration receipt is not
//      eligible, publishes NO rows at all. Refusing per-row would let a partial
//      publication survive a failed promotion.
//   2. A row publishes only when BOTH endpoints of ALL THREE ranges are real and
//      ordered. One endpoint, or a collapsed low==high, is the single target the
//      policy forbids, and a midpoint is never computed anywhere in this file.
//   3. The output is scanned for identity tokens before it is written. The
//      calibration is frozen against one analyst's published claims; his name
//      belongs to the private record and must never reach a public file, in a
//      label, a source note, or a field name.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CANONICAL_REL = "data/computed/fenok-rim/sustainable-index-ranges.json";
export const RECEIPT_REL = "data/computed/fenok-rim/identification-receipt.json";
export const PROJECTION_BASENAME = "sustainable-index-ranges.public.json";
const OUT_DIR = path.join(ROOT, "data/computed/fenok-rim");
const MIRROR_DIR = path.join(ROOT, "100xfenok-next/public/data/computed/fenok-rim");

export const PUBLIC_SCHEMA_VERSION = "fenok_rim_sustainable_public_projection.v1";

// The only row grade this projection may publish. The rows are a research
// diagnostic and say so on the surface; a future production grade must be
// added here deliberately, not inherited.
export const PUBLISHABLE_ROW_STATUS = "RESEARCH_DIAGNOSTIC";

// Case-insensitive. Checked against the SERIALISED output, so a token hiding in
// a key, a label, a status string, or a disclosed finding is caught the same way.
export const FORBIDDEN_PUBLIC_TOKENS = Object.freeze([
  "yoo",
  "dongwon",
  "유동원",
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// An endpoint pair is publishable only when both sides are real numbers and
// strictly ordered. `low === high` is refused: a collapsed range renders as one
// number and is indistinguishable from a point estimate on screen.
function readEndpoints(node) {
  if (!node || typeof node !== "object") return null;
  const { low, high } = node;
  if (!isFiniteNumber(low) || !isFiniteNumber(high)) return null;
  if (!(low < high)) return null;
  return { low, high };
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function findForbiddenTokens(document) {
  const serialised = JSON.stringify(document).toLowerCase();
  return FORBIDDEN_PUBLIC_TOKENS.filter((token) => serialised.includes(token.toLowerCase()));
}

function projectRow(row) {
  if (!row || typeof row !== "object") return { row: null, reason: "row_not_an_object" };
  if (row.publication_status !== PUBLISHABLE_ROW_STATUS) {
    return { row: null, reason: `publication_status=${row.publication_status ?? "absent"}` };
  }
  if (Array.isArray(row.blocking_reasons) && row.blocking_reasons.length > 0) {
    return { row: null, reason: `blocking_reasons=${row.blocking_reasons.join("|")}` };
  }
  // The runtime must never have read a published claim to produce this row.
  if (row.runtime_yoo_value_injection !== false) {
    return { row: null, reason: "runtime_injection_flag_not_false" };
  }
  const value = row.value;
  if (!value || typeof value !== "object") return { row: null, reason: "value_absent" };
  if (value.point_estimate !== null && value.point_estimate !== undefined) {
    return { row: null, reason: "point_estimate_present" };
  }

  const range = readEndpoints(value.range);
  const upside = readEndpoints(value.upside);
  const expected12m = readEndpoints(value.expected_12m);
  if (!range) return { row: null, reason: "range_endpoints_incomplete" };
  if (!upside) return { row: null, reason: "upside_endpoints_incomplete" };
  if (!expected12m) return { row: null, reason: "expected_12m_endpoints_incomplete" };

  const discountRate = value.convexity?.discount;
  const convexityRatio = value.convexity?.growth_over_discount;
  const convexityStatus = value.convexity?.status;
  if (!isFiniteNumber(discountRate)) return { row: null, reason: "discount_rate_absent" };
  if (!isFiniteNumber(convexityRatio)) return { row: null, reason: "convexity_ratio_absent" };
  if (typeof convexityStatus !== "string") return { row: null, reason: "convexity_status_absent" };
  if (typeof row.as_of !== "string") return { row: null, reason: "as_of_absent" };

  return {
    row: {
      id: row.id,
      label: row.label,
      as_of: row.as_of,
      publication_status: row.publication_status,
      confidence: row.confidence ?? null,
      current_price: isFiniteNumber(row.current_price) ? row.current_price : null,
      // Three ranges, each two-ended. No midpoint is derived here or downstream.
      range,
      upside,
      expected_12m: expected12m,
      // The assumptions a reader needs to tell a measurement from an opinion:
      // the discount rate actually applied, the explicit horizon, and where the
      // row's book growth sits against the discount rate. The equation that
      // produced the discount rate stays private; its output does not.
      assumptions: {
        discount_rate: discountRate,
        explicit_years: null,
        convexity_ratio: convexityRatio,
        convexity_status: convexityStatus,
      },
    },
    reason: null,
  };
}

export function buildPublicProjection({ canonical, receipt }) {
  const refusals = [];
  const promoted = canonical?.promotion?.promoted === true;
  const receiptEligible = receipt?.sustainable_calibration_receipt?.promotion?.eligible === true;
  const explicitYears = canonical?.structure?.horizon;

  // Document-level refusal publishes an empty row set rather than a subset.
  if (!promoted) refusals.push("canonical_not_promoted");
  if (!receiptEligible) refusals.push("calibration_receipt_not_eligible");
  if (!isFiniteNumber(explicitYears)) refusals.push("explicit_horizon_absent");

  const rows = [];
  if (refusals.length === 0) {
    for (const candidate of Array.isArray(canonical.rows) ? canonical.rows : []) {
      const { row, reason } = projectRow(candidate);
      if (row === null) {
        refusals.push(`${candidate?.id ?? "unknown"}: ${reason}`);
        continue;
      }
      row.assumptions.explicit_years = explicitYears;
      rows.push(row);
    }
  }

  const findings = Array.isArray(canonical?.promotion?.findings)
    ? canonical.promotion.findings.map((finding) => ({
      id: finding?.id ?? null,
      detail: finding?.detail ?? null,
    }))
    : [];

  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: canonical?.generated_at ?? null,
    as_of: canonical?.as_of ?? null,
    // Read by the surface before it draws anything.
    policy: {
      no_public_single_target: true,
      emits_single_target: false,
    },
    promotion: {
      promoted,
      receipt_eligible: receiptEligible,
      // Disclosed and not resolved: a finding is what the measurement says.
      findings,
    },
    rows,
    // Non-empty whenever something was withheld, so a thin document explains
    // itself instead of looking like a healthy one with fewer indices.
    withheld: refusals,
  };
}

export function readSources(root = ROOT) {
  const canonicalText = fs.readFileSync(path.join(root, CANONICAL_REL), "utf8");
  const receiptText = fs.readFileSync(path.join(root, RECEIPT_REL), "utf8");
  return {
    canonical: JSON.parse(canonicalText),
    receipt: JSON.parse(receiptText),
    canonicalSha256: sha256(canonicalText),
    receiptSha256: sha256(receiptText),
  };
}

// An OPAQUE release id, not the source hashes.
//
// The first version published `canonical_path` plus the canonical and receipt
// sha256. None of it was read by the surface, and all of it was useful to
// somebody else: the path names an internal file precisely enough to ask for it,
// and a published hash lets a guessed copy of a private artifact be confirmed.
// This derives one id from both hashes instead, so a rebuild from unchanged
// sources is still recognisably the same release and nothing about the sources
// is recoverable from it.
export function releaseId(canonicalSha256, receiptSha256) {
  return sha256(`fenok-rim-public-projection:${canonicalSha256}:${receiptSha256}`).slice(0, 16);
}

export function buildFromDisk(root = ROOT) {
  const { canonical, receipt, canonicalSha256, receiptSha256 } = readSources(root);
  const projection = buildPublicProjection({ canonical, receipt });
  projection.release = { id: releaseId(canonicalSha256, receiptSha256) };
  return projection;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const projection = buildFromDisk();
  const leaked = findForbiddenTokens(projection);
  if (leaked.length > 0) {
    console.error(`refused to write: identity token(s) in public projection: ${leaked.join(", ")}`);
    process.exit(1);
  }
  const serialised = `${JSON.stringify(projection, null, 2)}\n`;
  for (const dir of [OUT_DIR, MIRROR_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PROJECTION_BASENAME), serialised);
  }
  for (const row of projection.rows) {
    console.log(`${row.id}: band ${row.range.low.toFixed(1)}~${row.range.high.toFixed(1)} | 12m ${(row.expected_12m.low * 100).toFixed(1)}~${(row.expected_12m.high * 100).toFixed(1)}%`);
  }
  for (const withheld of projection.withheld) console.log(`withheld ${withheld}`);
  console.log(`written: ${path.join(OUT_DIR, PROJECTION_BASENAME)} (+ public mirror)`);
}
