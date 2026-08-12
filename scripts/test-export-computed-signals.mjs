#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  RAW_SOURCE_NAMES,
  buildComputedSignalsPayload,
  computeSourceAsOf,
  sourceFreshnessWarnings,
} from "./export-computed-signals.mjs";

const GENERATED_AT = "2026-08-11T00:00:00.000Z";

// Fixture mirrors the live signals.json shape: liquidity_flow/liquidity_stress/
// sentiment_signal share the newest date while banking_health lags, so the
// legacy headline as_of (max) is newer than the truthful source minimum.
function fixtureSignals(overrides = {}) {
  return {
    liquidity_flow: { as_of: "2026-08-10" },
    liquidity_stress: { as_of: "2026-08-10" },
    banking_health: { as_of: "2026-07-29" },
    sentiment_signal: { as_of: "2026-08-10" },
    ...overrides,
  };
}

function fixtureSourceDates(overrides = {}, defaultDate = "2026-08-10") {
  return RAW_SOURCE_NAMES.map((name) => ({
    name,
    as_of: Object.hasOwn(overrides, name) ? overrides[name] : defaultDate,
  }));
}

const FDIC_TIER1 = "data/macro/fdic-tier1.json#data";
const BOGZ = "data/macro/fred-banking-quarterly.json#BOGZ1FL010000016Q";
const AAII = "data/sentiment/aaii.json";
const CNN_PUT_CALL = "data/sentiment/cnn-put-call.json";

{
  const payload = buildComputedSignalsPayload(
    fixtureSignals(),
    GENERATED_AT,
    fixtureSourceDates({ "data/macro/fred-macro.json#M2SL": "2026-07-29" }),
  );
  assert.equal(payload.as_of, "2026-08-10", "headline as_of stays the max of component dates");
  assert.equal(payload.source_as_of, "2026-07-29", "source_as_of is the minimum even when headline as_of is newer");
  assert.equal(payload.generated_at, GENERATED_AT, "generated_at passes through unchanged");
  assert.deepEqual(payload.signals, fixtureSignals(), "component fields are unchanged");
  assert.notEqual(payload.source_as_of, payload.generated_at, "source clock must never alias generated_at");
  assert.equal(payload.schema_version, "1.0.0");
  assert.deepEqual(
    payload.source_freshness_warnings,
    [
      {
        contributor: AAII,
        source_as_of: "2026-08-10",
        status: "unresolved",
        reason: "no registered source-family freshness/SLA gate",
      },
      {
        contributor: CNN_PUT_CALL,
        source_as_of: "2026-08-10",
        status: "unresolved",
        reason: "no registered source-family freshness/SLA gate",
      },
    ],
    "only uncovered contributors get non-blocking source-specific warnings",
  );
}

{
  // Mutation: moving a component's date older moves source_as_of to the new
  // actual minimum while headline as_of stays the max.
  const payload = buildComputedSignalsPayload(
    fixtureSignals({ sentiment_signal: { as_of: "2026-07-15" } }),
    GENERATED_AT,
    fixtureSourceDates({ "data/sentiment/vix.json": "2026-07-15" }),
  );
  assert.equal(payload.as_of, "2026-08-10");
  assert.equal(payload.source_as_of, "2026-07-15");
}

{
  // Degenerate case: identical component dates collapse to one clock value.
  const payload = buildComputedSignalsPayload(
    fixtureSignals({ banking_health: { as_of: "2026-08-10" } }),
    GENERATED_AT,
    fixtureSourceDates(),
  );
  assert.equal(payload.as_of, "2026-08-10");
  assert.equal(payload.source_as_of, "2026-08-10");
}

{
  // Missing-date policy: a component without a valid source date fails closed
  // and generated_at is never substituted into the source clock.
  assert.throws(
    () => buildComputedSignalsPayload(
      fixtureSignals({ banking_health: { as_of: null } }),
      GENERATED_AT,
      fixtureSourceDates(),
    ),
    (err) => err instanceof Error
      && /banking_health/.test(err.message)
      && /invalid source date null/.test(err.message)
      && /YYYY-MM-DD/.test(err.message)
      && !err.message.includes(GENERATED_AT),
    "null component date must fail closed without substituting generated_at",
  );
  assert.throws(
    () => buildComputedSignalsPayload(
      fixtureSignals({ sentiment_signal: {} }),
      GENERATED_AT,
      fixtureSourceDates(),
    ),
    /sentiment_signal/,
    "missing component date must fail closed",
  );
  assert.throws(() => computeSourceAsOf([]), /source_as_of/, "empty clock must fail closed");
  assert.throws(
    () => computeSourceAsOf([{ name: "x", as_of: "" }]),
    /raw input x.*invalid source date "".*YYYY-MM-DD/,
    "empty-string date must fail closed",
  );
}

{
  for (const invalidDate of ["2026-02-31", "2025-02-29", "0000-01-01", "2026-2-03"]) {
    assert.throws(
      () => buildComputedSignalsPayload(
        fixtureSignals({ banking_health: { as_of: invalidDate } }),
        GENERATED_AT,
        fixtureSourceDates(),
      ),
      (err) => err instanceof Error
        && err.message.includes("banking_health")
        && err.message.includes(JSON.stringify(invalidDate))
        && err.message.includes("YYYY-MM-DD"),
      `malformed or impossible calendar date must fail closed: ${invalidDate}`,
    );
  }
  assert.equal(
    buildComputedSignalsPayload(
      fixtureSignals({ banking_health: { as_of: "2024-02-29" } }),
      GENERATED_AT,
      fixtureSourceDates({}, "2024-02-29"),
    ).source_as_of,
    "2024-02-29",
    "a real leap-day date remains valid",
  );
}

{
  for (const incompatibleForm of [
    "2026-08-10T00:00:00Z",
    "2026-08-10T09:00:00+09:00",
    "2026-08-10+09:00",
  ]) {
    assert.throws(
      () => buildComputedSignalsPayload(
        fixtureSignals({ sentiment_signal: { as_of: incompatibleForm } }),
        GENERATED_AT,
        fixtureSourceDates(),
      ),
      (err) => err instanceof Error
        && err.message.includes("sentiment_signal")
        && err.message.includes(JSON.stringify(incompatibleForm))
        && err.message.includes("YYYY-MM-DD"),
      `timestamp or timezone form must be rejected: ${incompatibleForm}`,
    );
  }
}

{
  // Masked-source regression: the component headline is newer because it is
  // the maximum of mixed banking inputs, but FDIC is the conservative floor.
  const payload = buildComputedSignalsPayload(
    fixtureSignals({ banking_health: { as_of: "2026-08-10" } }),
    GENERATED_AT,
    fixtureSourceDates({ [BOGZ]: "2025-10-01", [FDIC_TIER1]: "2026-03-31" }),
  );
  assert.equal(payload.as_of, "2026-08-10");
  assert.equal(payload.signals.banking_health.as_of, "2026-08-10");
  assert.equal(payload.source_as_of, "2025-10-01", "oldest BOGZ raw date must not be masked by banking_health.as_of");
  assert.equal(
    payload.source_freshness_warnings.some((row) => row.contributor === BOGZ),
    false,
    "BOGZ is covered by the existing fred_banking source-family gate",
  );
}

{
  const warnings = sourceFreshnessWarnings([
    { name: AAII, as_of: "2026-08-05" },
    { name: CNN_PUT_CALL, as_of: "2026-08-10" },
    { name: BOGZ, as_of: "2025-10-01" },
  ]);
  assert.deepEqual(
    warnings.map(({ contributor, source_as_of, status }) => ({ contributor, source_as_of, status })),
    [
      { contributor: AAII, source_as_of: "2026-08-05", status: "unresolved" },
      { contributor: CNN_PUT_CALL, source_as_of: "2026-08-10", status: "unresolved" },
    ],
    "covered quarterly contributors stay under the existing source-family authority",
  );
}

{
  const omitted = fixtureSourceDates().filter(({ name }) => name !== FDIC_TIER1);
  assert.throws(
    () => buildComputedSignalsPayload(fixtureSignals(), GENERATED_AT, omitted),
    (err) => err instanceof Error
      && err.message.includes("missing raw input date")
      && err.message.includes(FDIC_TIER1),
    "omitting a declared raw contributor must fail closed and name it",
  );

  for (const invalidDate of ["2026-02-31", "2026-03-31T00:00:00Z"]) {
    assert.throws(
      () => buildComputedSignalsPayload(
        fixtureSignals(),
        GENERATED_AT,
        fixtureSourceDates({ [FDIC_TIER1]: invalidDate }),
      ),
      (err) => err instanceof Error
        && err.message.includes(`raw input ${FDIC_TIER1}`)
        && err.message.includes(JSON.stringify(invalidDate))
        && err.message.includes("YYYY-MM-DD"),
      `invalid FDIC raw contributor date must fail closed: ${invalidDate}`,
    );
  }
}

{
  assert.equal(RAW_SOURCE_NAMES.length, 21, "all and only the consumed raw inputs are declared");
  assert.equal(RAW_SOURCE_NAMES.some((name) => name.includes("fred-banking-daily")), false);
  assert.equal(RAW_SOURCE_NAMES.some((name) => name.includes("cnn-components")), false);
}

console.log("test-export-computed-signals: ok");
