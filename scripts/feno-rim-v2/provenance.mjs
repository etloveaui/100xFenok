#!/usr/bin/env node

// FENO RIM v2 — input provenance and adapter contract (Phase 2).
//
// The normalized input contract (SPEC v3.0 section 3): every input carries
// eight provenance keys, and joins are refused unless all eight agree.
// Source adapters map raw sources onto this contract and STOP there: after
// normalization no code may condition on index id to alter outputs (the
// invariance property test enforces that against any compute function).

import path from "node:path";

export const PROVENANCE_KEYS = Object.freeze([
  "universe_id",
  "membership_as_of",
  "earnings_basis",
  "equity_basis",
  "negative_earners_policy",
  "currency",
  "share_class_policy",
  "first_knowable_at",
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value) {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// A normalized input is complete when all eight keys carry non-empty values
// and both date keys are real calendar days.
export function validateNormalizedInput(input, label = "input") {
  const errors = [];
  for (const key of PROVENANCE_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null || value === "") {
      errors.push(`${label}: missing provenance key ${key}`);
    }
  }
  if (!errors.some((e) => e.includes("membership_asof") || e.includes("membership_as_of"))) {
    if (!isIsoDay(input?.membership_as_of)) errors.push(`${label}: membership_as_of is not a calendar day`);
  }
  if (!isIsoDay(input?.first_knowable_at)) errors.push(`${label}: first_knowable_at is not a calendar day`);
  if (errors.length) throw new Error(errors.join("; "));
  return true;
}

// Joins across differing provenance are a BUILD ERROR, not a NULL row.
export function joinGuard(a, b, labelA = "a", labelB = "b") {
  const mismatches = [];
  for (const key of PROVENANCE_KEYS) {
    if (a?.[key] !== b?.[key]) mismatches.push(`${key}: ${a?.[key]} != ${b?.[key]}`);
  }
  if (mismatches.length) {
    throw new Error(`provenance join refused (${labelA} x ${labelB}): ${mismatches.join("; ")}`);
  }
  return true;
}

// first-knowable recomputation: an input is only as knowable as its latest
// component. A future date is a look-ahead and fails closed.
export function firstKnowable(componentDates, asOf) {
  const errors = [];
  for (const [name, date] of Object.entries(componentDates)) {
    if (!isIsoDay(date)) errors.push(`${name}: not a calendar day`);
    else if (asOf && date > asOf) errors.push(`${name}: first-knowable ${date} is after ${asOf} (look-ahead)`);
  }
  if (errors.length) throw new Error(`first-knowable refused: ${errors.join("; ")}`);
  return Object.values(componentDates).sort().at(-1);
}

// Adapter boundary: an adapter is a raw-source-to-normalized-input mapper and
// nothing else. This helper pins the shape adapters must return.
export function defineAdapter(name, fn) {
  return {
    name,
    normalize: (rawSource) => {
      const input = fn(rawSource);
      validateNormalizedInput(input, `adapter:${name}`);
      return input;
    },
  };
}

// Invariance property test (SPEC v3.0 section 2): the same normalized input
// under two different ids must produce bit-identical outputs from any
// compliant compute function. Returns the violation list (empty = compliant).
export function invarianceViolations(compute, normalizedInput, idA = "SPX", idB = "TESTIDX") {
  const outA = compute({ ...normalizedInput, id: idA });
  const outB = compute({ ...normalizedInput, id: idB });
  const jsonA = JSON.stringify(outA);
  const jsonB = JSON.stringify(outB);
  if (jsonA === jsonB) return [];
  return [`compute output depends on index id: ${jsonA} != ${jsonB}`];
}

export const PROVENANCE_MODULE = path.basename(new URL(import.meta.url).pathname);
