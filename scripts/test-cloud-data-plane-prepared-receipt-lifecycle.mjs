import assert from "node:assert/strict";

import {
  PREPARED_RECEIPT_LIFECYCLE_SCHEMA,
  classifyPreparedReceipts,
} from "./lib/cloud-data-plane-prepared-receipt-lifecycle.mjs";

const NOW = "2026-08-14T12:00:00Z";
const WINDOW = 6 * 3600; // six hours, supplied by the caller in every case below

function receipt(overrides = {}) {
  return {
    schema_version: "100x-cloud-publication-receipt/v1",
    receipt_id: "r-1",
    operation: "publish",
    state: "prepared",
    generation_id: "gen-1",
    created_at: "2026-08-14T11:00:00Z",
    promoted_pointer_sequence: null,
    ...overrides,
  };
}

function assertThrows(run, fragment) {
  assert.throws(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

// --- the window is policy and is never guessed ---
{
  assertThrows(() => classifyPreparedReceipts({ receipts: [receipt()], now: NOW }), "refusing to guess a resume window");
  assertThrows(() => classifyPreparedReceipts({ receipts: [receipt()], now: NOW, resumeWindowSeconds: 0 }), "must be positive");
  assertThrows(() => classifyPreparedReceipts({ receipts: [receipt()], now: NOW, resumeWindowSeconds: -1 }), "must be positive");
  assertThrows(() => classifyPreparedReceipts({ receipts: [receipt()], resumeWindowSeconds: WINDOW }), "now is required");
  assertThrows(() => classifyPreparedReceipts({ receipts: "nope", now: NOW, resumeWindowSeconds: WINDOW }), "must be an array");
}

// --- only prepared receipts are protection roots; the filter lives here ---
{
  const result = classifyPreparedReceipts({
    receipts: [
      receipt({ receipt_id: "r-live", generation_id: "gen-live" }),
      receipt({ receipt_id: "r-promoted", generation_id: "gen-promoted", state: "promoted", promoted_pointer_sequence: 4 }),
    ],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  });
  assert.equal(result.schema_version, PREPARED_RECEIPT_LIFECYCLE_SCHEMA);
  assert.deepEqual(result.live_generations, ["gen-live"]);
  assert.deepEqual(result.expired_receipts, []);
  assert.deepEqual(result.released_generations, []);
}

// --- inside the window stays protected, past it is released ---
{
  const result = classifyPreparedReceipts({
    receipts: [
      receipt({ receipt_id: "r-fresh", generation_id: "gen-fresh", created_at: "2026-08-14T11:59:00Z" }),
      receipt({ receipt_id: "r-edge", generation_id: "gen-edge", created_at: "2026-08-14T06:00:00Z" }),
      receipt({ receipt_id: "r-stale", generation_id: "gen-stale", created_at: "2026-08-13T00:00:00Z" }),
    ],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  });
  // Exactly at the window boundary the receipt is still live: the window is the
  // longest legitimate resume, so the last second of it must still resume.
  assert.deepEqual(result.live_generations, ["gen-edge", "gen-fresh"]);
  assert.deepEqual(result.expired_receipts.map((row) => row.generation_id), ["gen-stale"]);
  assert.deepEqual(result.released_generations, ["gen-stale"]);
  assert.equal(result.expired_receipts[0].age_seconds, 36 * 3600);
  // Every expired receipt is enumerated with its identity, never silently dropped.
  assert.equal(result.expired_receipts[0].receipt_id, "r-stale");
  assert.equal(result.expired_receipts[0].created_at, "2026-08-13T00:00:00Z");
}

// --- a generation still held by a live receipt is not released ---
{
  const result = classifyPreparedReceipts({
    receipts: [
      receipt({ receipt_id: "r-old", generation_id: "gen-shared", created_at: "2026-08-12T00:00:00Z" }),
      receipt({ receipt_id: "r-new", generation_id: "gen-shared", created_at: "2026-08-14T11:30:00Z" }),
    ],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  });
  assert.deepEqual(result.live_generations, ["gen-shared"]);
  assert.equal(result.expired_receipts.length, 1, "the old receipt is still reported as expired");
  assert.deepEqual(result.released_generations, [], "but the generation keeps protection from the live receipt");
}

// --- a clock fault protects bytes rather than exposing them, but is never silent ---
{
  const result = classifyPreparedReceipts({
    receipts: [receipt({ receipt_id: "r-future", generation_id: "gen-future", created_at: "2026-08-20T00:00:00Z" })],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  });
  assert.deepEqual(result.live_generations, ["gen-future"]);
  assert.deepEqual(result.released_generations, []);
  // Permissive handling without a diagnostic would leave an indefinite
  // protection root that nobody is looking at.
  assert.equal(result.clock_anomalies.length, 1);
  assert.deepEqual(result.clock_anomalies[0], {
    receipt_id: "r-future",
    generation_id: "gen-future",
    created_at: "2026-08-20T00:00:00Z",
    ahead_seconds: 6 * 24 * 3600 - 12 * 3600,
    effect: "retained_as_live_despite_future_timestamp",
  });
}

// --- an ordinary live receipt raises no anomaly ---
{
  const result = classifyPreparedReceipts({ receipts: [receipt()], now: NOW, resumeWindowSeconds: WINDOW });
  assert.deepEqual(result.clock_anomalies, []);
}

// --- an unattributable protection root fails closed ---
{
  assertThrows(
    () => classifyPreparedReceipts({ receipts: [receipt({ generation_id: "" })], now: NOW, resumeWindowSeconds: WINDOW }),
    "refusing to classify an unattributable protection root",
  );
  assertThrows(
    () => classifyPreparedReceipts({ receipts: [receipt({ created_at: "not-a-time" })], now: NOW, resumeWindowSeconds: WINDOW }),
    "not a parsable instant",
  );
}

// --- determinism: same inputs, same classification ---
{
  const inputs = {
    receipts: [
      receipt({ receipt_id: "b", generation_id: "gen-b", created_at: "2026-08-10T00:00:00Z" }),
      receipt({ receipt_id: "a", generation_id: "gen-a", created_at: "2026-08-11T00:00:00Z" }),
    ],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  };
  assert.deepEqual(classifyPreparedReceipts(inputs), classifyPreparedReceipts(inputs));
  assert.deepEqual(classifyPreparedReceipts(inputs).released_generations, ["gen-a", "gen-b"]);
}

process.stdout.write("test-cloud-data-plane-prepared-receipt-lifecycle: ok\n");
