// Consumer-side contract for the FENO RIM sustainable index ranges.
//
// The producer projects a redacted, range-only document. This check proves the
// READER cannot manufacture a single target from it either: not from a payload
// whose promotion failed, not from one whose calibration receipt is not
// eligible, not from a half-built row, and not from a range that has collapsed
// to one number. Every case below is a payload the UI could actually receive.
//
// It also holds the producer and the consumer to the same two constants. They
// live in different languages and different build systems, so nothing but a
// regression keeps them identical.

import fs from "node:fs";
import path from "node:path";

import {
  SUSTAINABLE_PUBLIC_SCHEMA_VERSION,
  SUSTAINABLE_PUBLISHABLE_ROW_STATUS,
  readSustainableRanges,
  type SustainableRangesDoc,
} from "../src/app/market-valuation/sustainableRanges";
import {
  PUBLIC_SCHEMA_VERSION,
  PUBLISHABLE_ROW_STATUS,
} from "../../scripts/build-fenok-rim-sustainable-public-projection.mjs";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// --- producer / consumer parity -------------------------------------------
assert(
  SUSTAINABLE_PUBLIC_SCHEMA_VERSION === PUBLIC_SCHEMA_VERSION,
  `schema version drift: reader ${SUSTAINABLE_PUBLIC_SCHEMA_VERSION} vs producer ${PUBLIC_SCHEMA_VERSION}`,
);
assert(
  SUSTAINABLE_PUBLISHABLE_ROW_STATUS === PUBLISHABLE_ROW_STATUS,
  `row status drift: reader ${SUSTAINABLE_PUBLISHABLE_ROW_STATUS} vs producer ${PUBLISHABLE_ROW_STATUS}`,
);

// --- the real deployed payload --------------------------------------------
const PUBLIC_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "public/data/computed/fenok-rim/sustainable-index-ranges.public.json",
);
const deployed = JSON.parse(fs.readFileSync(PUBLIC_PATH, "utf8")) as SustainableRangesDoc;
const view = readSustainableRanges(deployed);
assert(view.refusal === null, `the deployed payload must render: ${view.refusal}`);
assert(view.rows.length > 0, "the deployed payload must publish at least one row");
for (const row of view.rows) {
  assert(row.range.low < row.range.high, `${row.id}: band endpoints must be ordered`);
  assert(row.upside.low < row.upside.high, `${row.id}: upside endpoints must be ordered`);
  assert(row.twelveMonth.low < row.twelveMonth.high, `${row.id}: twelve-month endpoints must be ordered`);
  assert(Number.isFinite(row.discountRate), `${row.id}: discount rate must be readable`);
  assert(Number.isFinite(row.explicitYears), `${row.id}: explicit horizon must be readable`);
  assert(row.convexityStatus.length > 0, `${row.id}: convexity status must be readable`);
}

// --- refusals --------------------------------------------------------------
type Mutate = (doc: SustainableRangesDoc) => void;
const documentRefusals: Array<[string, Mutate, string]> = [
  ["an absent payload", () => {}, "payload_absent"],
  ["a schema version bump", (doc) => { doc.schema_version = "fenok_rim_sustainable_public_projection.v2"; }, "schema_version_mismatch"],
  ["a dropped policy", (doc) => { doc.policy = null; }, "policy_absent"],
  ["a payload that admits a single target", (doc) => { doc.policy!.emits_single_target = true; }, "payload_emits_single_target"],
  ["a withdrawn promotion", (doc) => { doc.promotion!.promoted = false; }, "not_promoted"],
  ["an ineligible calibration receipt", (doc) => { doc.promotion!.receipt_eligible = false; }, "calibration_receipt_not_eligible"],
  ["a planted point estimate", (doc) => { (doc.rows as Array<Record<string, unknown>>)[0].point_estimate = 11000; }, "payload_carries_single_target"],
  ["a planted price target", (doc) => { (doc.rows as Array<Record<string, unknown>>)[0].target_price = 11000; }, "payload_carries_single_target"],
  ["a planted midpoint", (doc) => { (doc.rows as Array<Record<string, unknown>>)[0].midpoint = 11000; }, "payload_carries_single_target"],
  ["a malformed document clock", (doc) => { doc.as_of = "2026-02-31"; }, "document_clock_absent"],
  ["rows that are not an array", (doc) => { doc.rows = {} as unknown as []; }, "rows_absent"],
];
for (const [label, mutate, expected] of documentRefusals) {
  const payload = label === "an absent payload" ? null : clone(deployed);
  if (payload) mutate(payload);
  const result = readSustainableRanges(payload);
  assert(result.refusal === expected, `${label}: expected ${expected}, got ${result.refusal}`);
  assert(result.rows.length === 0, `${label}: must draw nothing`);
}

// A row-level defect withholds THAT row and leaves the rest readable, except
// when it is the last one, which collapses to a document refusal.
const rowRefusals: Array<[string, (row: Record<string, unknown>) => void]> = [
  ["a collapsed band", (row) => { (row.range as Record<string, number>).high = (row.range as Record<string, number>).low; }],
  ["an inverted band", (row) => { const r = row.range as Record<string, number>; const low = r.low; r.low = r.high; r.high = low; }],
  ["a missing twelve-month endpoint", (row) => { delete (row.expected_12m as Record<string, unknown>).high; }],
  ["a null upside endpoint", (row) => { (row.upside as Record<string, unknown>).low = null; }],
  ["a downgraded publication status", (row) => { row.publication_status = "OUT_OF_SCOPE"; }],
  ["a dropped assumption block", (row) => { row.assumptions = null; }],
  ["a missing discount rate", (row) => { (row.assumptions as Record<string, unknown>).discount_rate = null; }],
  ["a missing explicit horizon", (row) => { (row.assumptions as Record<string, unknown>).explicit_years = null; }],
  ["a malformed row clock", (row) => { row.as_of = "not-a-day"; }],
  ["a non-string label", (row) => { row.label = 42; }],
];
for (const [label, mutate] of rowRefusals) {
  const payload = clone(deployed);
  const rows = payload.rows as Array<Record<string, unknown>>;
  const targetId = rows[0].id as string;
  mutate(rows[0]);
  const result = readSustainableRanges(payload);
  assert(
    !result.rows.some((row) => row.id === targetId),
    `${label}: ${targetId} must be withheld`,
  );
  assert(result.rows.length === rows.length - 1, `${label}: only the defective row is withheld`);
}

// Every row defective means nothing may be drawn at all.
const allDefective = clone(deployed);
for (const row of allDefective.rows as Array<Record<string, unknown>>) {
  (row.range as Record<string, number>).high = (row.range as Record<string, number>).low;
}
assert(
  readSustainableRanges(allDefective).refusal === "no_publishable_row",
  "a payload with no readable row must refuse the whole section",
);

// The reader never invents a midpoint: the view exposes endpoints only.
for (const row of view.rows) {
  const keys = Object.keys(row);
  for (const forbidden of ["midpoint", "mid", "target", "fairValue", "pointEstimate"]) {
    assert(!keys.includes(forbidden), `${row.id}: the view must not expose '${forbidden}'`);
  }
}

process.stdout.write("check-rim-sustainable-render-contract: ok\n");
