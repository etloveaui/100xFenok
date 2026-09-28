import assert from "node:assert/strict";

import {
  ATTEMPT_DETAIL_PLAN_SCHEMA,
  computeAttemptDetailPlan,
  executeAttemptDetailPlan,
} from "./lib/cloud-data-plane-attempt-detail-lifecycle.mjs";

const NOW = "2026-08-14T12:00:00Z";
const WEEK = 7 * 24 * 3600;

const detail = (name) => `attempts/stockanalysis-etf/gen-1/${name}.json`;

function assertThrows(run, fragment) {
  assert.throws(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

// The shared listing: payload objects, manifests, probes AND attempt details.
// The planner is handed the same payload retention already reads.
const LISTING = [
  { key: "objects/sha256/aaa", size: 100 },
  { key: "manifests/gen-1.json", size: 200 },
  { key: "probe/lag.json", size: 10 },
  { key: detail("old"), size: 1000 },
  { key: detail("fresh"), size: 2000 },
  { key: detail("open"), size: 3000 },
  { key: detail("future"), size: 4000 },
];

const RESOLUTIONS = [
  { detail_location: detail("old"), terminal_state: "promoted", resolved_at: "2026-08-01T00:00:00Z" },
  { detail_location: detail("fresh"), terminal_state: "swept", resolved_at: "2026-08-13T12:00:00Z" },
  { detail_location: detail("future"), terminal_state: "abandoned", resolved_at: "2026-08-20T00:00:00Z" },
];

// --- the retention window is required, never assumed ---
{
  assertThrows(() => computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW }), "refusing to guess a detail retention window");
  assertThrows(() => computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW, retentionSeconds: -1 }), "non-negative");
  assertThrows(() => computeAttemptDetailPlan({ resolutions: RESOLUTIONS, now: NOW, retentionSeconds: WEEK }), "shared bucket listing");
}

// --- the authority is structurally confined to attempts/ ---
{
  const plan = computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW, retentionSeconds: WEEK });
  assert.equal(plan.schema_version, ATTEMPT_DETAIL_PLAN_SCHEMA);
  assert.equal(plan.authority, "attempt_detail");
  assert.equal(plan.scope_prefix, "attempts/");

  const everyKey = [...plan.candidates, ...plan.retained, ...plan.unresolved].map((row) => row.key);
  for (const key of everyKey) assert.ok(key.startsWith("attempts/"), `${key} is outside the authority`);
  // The three payload/control keys are not merely un-proposed; they are absent
  // from the plan entirely.
  for (const foreign of ["objects/sha256/aaa", "manifests/gen-1.json", "probe/lag.json"]) {
    assert.ok(!everyKey.includes(foreign), `${foreign} must never appear in an attempt-detail plan`);
  }
}

// --- terminal state plus retention decides, and both fail closed ---
{
  const plan = computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW, retentionSeconds: WEEK });

  // Resolved 13 days ago, past a 7-day window: the only candidate.
  assert.deepEqual(plan.candidates.map((row) => row.key), [detail("old")]);
  assert.equal(plan.candidates[0].terminal_state, "promoted");
  assert.equal(plan.candidate_bytes, 1000);

  // Resolved yesterday: inside the window, retained with the reason recorded.
  const fresh = plan.retained.find((row) => row.key === detail("fresh"));
  assert.equal(fresh.reason, "inside the retention window");

  // A future resolution is a clock fault: retained rather than deleted.
  const future = plan.retained.find((row) => row.key === detail("future"));
  assert.equal(future.reason, "resolved_at is in the future");

  // No terminal record at all: the attempt may still be open, and its detail is
  // the only enumeration of what it wrote.
  assert.deepEqual(plan.unresolved.map((row) => row.key), [detail("open")]);
  assert.match(plan.unresolved[0].reason, /no terminal resolution/);
}

// --- malformed resolutions fail closed rather than being skipped ---
{
  const cases = [
    [[{ detail_location: "objects/sha256/aaa", terminal_state: "promoted", resolved_at: NOW }], "not an attempt-detail key"],
    [[{ detail_location: detail("old"), terminal_state: "open", resolved_at: NOW }], "non-terminal or unknown state"],
    [[{ detail_location: detail("old"), terminal_state: "promoted", resolved_at: "nope" }], "must be a parsable instant"],
    [[
      { detail_location: detail("old"), terminal_state: "promoted", resolved_at: NOW },
      { detail_location: detail("old"), terminal_state: "swept", resolved_at: NOW },
    ], "two resolutions name the same detail key"],
  ];
  for (const [resolutions, fragment] of cases) {
    assertThrows(() => computeAttemptDetailPlan({ objectEntries: LISTING, resolutions, now: NOW, retentionSeconds: WEEK }), fragment);
  }
}

// --- a zero window still requires a terminal state ---
{
  const plan = computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW, retentionSeconds: 0 });
  // Both resolved-in-the-past details become candidates; the open one does not.
  assert.deepEqual(plan.candidates.map((row) => row.key).sort(), [detail("fresh"), detail("old")].sort());
  assert.deepEqual(plan.unresolved.map((row) => row.key), [detail("open")]);
}

// --- execution re-checks the boundary and records failures without stranding ---
{
  const plan = computeAttemptDetailPlan({ objectEntries: LISTING, resolutions: RESOLUTIONS, now: NOW, retentionSeconds: 0 });
  const seen = [];
  const result = await executeAttemptDetailPlan({
    plan,
    deleteObject: async (key) => { seen.push(key); return key.endsWith("old.json") ? { ok: true } : { ok: false, error: "http 500" }; },
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(result.deleted.map((row) => row.key), [detail("old")]);
  assert.deepEqual(result.failures.map((row) => row.key), [detail("fresh")]);
  assert.equal(result.deleted_bytes, 1000);

  // A plan that has been round-tripped and tampered cannot smuggle a payload key
  // past the executor, even though the planner could not have produced it.
  await assert.rejects(
    () => executeAttemptDetailPlan({
      plan: { ...plan, candidates: [{ key: "objects/sha256/aaa", size: 1 }] },
      deleteObject: async () => ({ ok: true }),
    }),
    /outside the attempt-detail authority/,
  );
  await assert.rejects(() => executeAttemptDetailPlan({ plan: { schema_version: "x" }, deleteObject: async () => ({ ok: true }) }), /plan schema must be/);
  await assert.rejects(() => executeAttemptDetailPlan({ plan }), /deleter is required/);
}

process.stdout.write("test-cloud-data-plane-attempt-detail-lifecycle: ok\n");
