# Fetch-Lane Cron-Skip Detection — Shadow Specification

Status: execute-GO / implementation contract
Date: 2026-07-20
Owner gate: warn-first shadow only; no deployment blocking; no push

## 1. Problem

The KPI retains missed-slot history for `update-manifest`, but scheduled fetch
lanes have no equivalent current-slot visibility. A GitHub scheduled workflow
can fail to start while its latest attempt shard remains older, making the skip
indistinguishable from ordinary producer staleness in the KPI.

This slice adds point-in-time cron observability for scheduled fetch producers.
It does not create a retained missed-slot ledger and does not change publication
authority.

## 2. Source of truth and eligibility

The implementation MUST derive the monitored set; it MUST NOT maintain a second
handwritten lane list.

- Lane/member identity, workflow path, cron expressions, and cadence calendar:
  `DATA_SUPPLY_DETECTION_CONFIG`.
- Per-cron grace: `data-supply-detection-calendars.json`.
- Observation: latest row in the lane's attempt shard, using member rows for
  composite lanes and the lane row for non-composite lanes.
- Eligible member: `cadence_declaration.kind === "github_workflow"` and
  `schedule.length > 0`.
- Excluded member: artifact-only or otherwise ownerless member with no declared
  workflow schedule. At the current config this excludes `sec_13f`.

The current derived denominator is 25 producer members and 27 schedule
contracts. Tests MUST derive or assert this against the config so registry drift
cannot silently change coverage.

## 3. State model

For every eligible member and every declared cron:

1. Resolve the unique `(cron, cadence_calendar)` grace contract.
2. Find the latest cron occurrence whose grace has fully elapsed at
   `report.generated_at`. This is the `expected_at` slot.
3. Read the latest relevant attempt row.
4. Classify the slot, grouping peers by exact `(workflow, cron)`:
   - `observed`: this member has `observed_at >= expected_at`.
   - `suspected_skip`: this member is not observed and no peer in the same
     workflow/cron group is observed.
   - `attempt_gap`: this member is not observed but a peer in the same
     workflow/cron group is observed, proving that the shared workflow ran.

Only grace-matured slots are evaluated. A just-fired slot still within grace is
not called missed; the prior matured slot remains the current comparison target.
The existing calendar/holiday and cron matching semantics are reused exactly.

An attempt is cron-observation evidence independently of its producer result.
Thus a current attempt that returned HTTP/auth/decode/schema failure is
`observed`, while the existing endpoint health remains degraded/unavailable.
This separation prevents “ran and failed” from being mislabeled “never ran.”

## 4. Detection projection contract

The validated `data-supply-detection-floor/v1` report remains unchanged. A pure
projection reuses its member endpoint observations plus the existing cron,
calendar, and grace evaluator to produce this admin diagnostic:

```json
{
  "schema_version": "fetch-cron-attempt-coverage/v1",
  "mode": "shadow",
  "evaluated_at": "2026-07-20T18:00:00.000Z",
  "status": "ready|warning",
  "deployment_blocking": false,
  "counts": {
    "scheduled_members": 25,
    "schedule_bindings": 27,
    "observed": 0,
    "suspected_skips": 0,
    "attempt_gaps": 0
  },
  "rows": [
    {
      "lane_id": "gdelt_news_tone",
      "member_id": "gdelt_news_tone",
      "workflow": ".github/workflows/fetch-fenok-news-tone.yml",
      "schedule_id": "daily_1443_utc",
      "cron": "43 14 * * *",
      "calendar_id": "utc",
      "expected_at": "2026-07-19T14:43:00.000Z",
      "observed_at": null,
      "state": "suspected_skip",
      "producer_status": "unobserved",
      "producer_reason": "workflow_unobserved"
    }
  ]
}
```

Rules:

- Slot order is config lane order, producer-member order, then schedule order.
- `status` is `warning` iff at least one slot is `suspected_skip` or
  `attempt_gap`; otherwise `ready`.
- `deployment_blocking` is always `false` and is schema-validated.
- Counts are re-derived during projection validation/tests.
- Slot identity and schedule metadata must match config/calendar SSOT exactly;
  the projection does not read raw shard files a second time.
- No credentials, request data, response bodies, artifact paths, or private
  recovery details are allowed in this block.

## 5. KPI projection

The admin KPI receives the diagnostic at
`runtime.fetch_cron_skip_detection`. The public runtime projector emits only:

- `schema_version`, `mode`, `evaluated_at`, `status`, and
  `deployment_blocking:false`;
- all aggregate counts;
- bounded, sorted, deduplicated `suspected_skip_lane_ids` and
  `attempt_gap_lane_ids`.

It MUST omit workflow paths, cron expressions, calendar IDs, expected/observed
timestamps, producer reasons, attempt IDs, and run IDs from the public copy.

The diagnostic MUST NOT:

- add a new required KPI lane;
- change the root KPI status or deployment-integrity result;
- add a key to `PLATFORM_BLOCKING_CHECK_KEYS`;
- affect `runtime.publication_gate` or update-manifest retained-slot logic;
- make a missing detection-floor report fail the platform. Missing input yields
  warning rows from the declared schedule denominator with null observations.

The strict checker treats a well-formed non-ready shadow diagnostic as a warning,
not an error. Malformed shape, inconsistent counts, public overexposure, or a
true `deployment_blocking` value remains a contract error.
The checker always recomputes schedule identity and `expected_at` with the
canonical calendar SSOT. When the ephemeral sibling detection-floor report is
available, it also recomputes the full block and requires exact equality, binding
observations and producer results to source. If that intentionally uncommitted
report is absent in a later checkout, source parity is `[not verified]` warning
rather than fabricated missing-attempt evidence.
For migration compatibility, a pre-shadow KPI with no diagnostic key is also a
warning; every KPI produced by the new builder includes the key.

## 6. Evidence limitation

Attempt shard v1 does not record GitHub `event_name`. Therefore v1 proves that a
producer attempt was observed at or after the expected slot, not that GitHub's
`schedule` event was the origin. A manual or dispatched attempt can satisfy the
point-in-time slot. This is an explicit false-negative risk and MUST be covered
by a test/spec comment; it is not silently represented as schedule-origin proof.

The shard retains only the latest attempt, so this slice detects the latest
grace-matured slot only. It cannot reconstruct historical gaps after a later
attempt arrives. Retained history or event-origin fidelity requires an attempt
schema/version migration and is out of scope.

## 7. RED-first verification matrix

Pure projection tests MUST fail before implementation for:

1. a current successful attempt -> `observed`;
2. a current failed attempt -> `observed` plus failed producer status/reason;
3. an older attempt -> `suspected_skip`;
4. no attempt -> `suspected_skip`;
5. a new occurrence still inside grace -> prior matured occurrence evaluated;
6. multiple crons on one member -> one row per schedule in declared order;
7. composite member lookup -> member-specific observation;
8. shared workflow mixed evidence -> missing member is `attempt_gap`, not a
   cron skip;
9. calendar/holiday grace semantics -> existing evaluator parity;
10. malformed detection report -> existing report validation fails closed.

KPI tests MUST fail before implementation for:

1. all observed -> ready shadow diagnostic;
2. one missed -> warning diagnostic while root status and deployment integrity
   remain unchanged;
3. failed-but-current producer attempt -> cron diagnostic remains observed;
4. absent detection report -> explicit non-blocking warning;
5. shape/count/deployment flag tampering -> checker contract error;
6. root/public parity and absence of admin-only row fields.

## 8. Acceptance and lifecycle

Required targeted gates:

```text
node scripts/test-build-data-supply-detection-floor.mjs
node scripts/test-build-fenok-data-health-kpi.mjs
node 100xfenok-next/scripts/check-fenok-data-health-kpi.mjs --strict --context=reconcile
```

Also run repository-relevant lightweight contract suites and `git diff --check`.
Heavy builds are not required for this slice unless a touched contract demands
them. Commit locally on the existing k3 chain and report the hash and exact gate
results for the CC gate. Do not push, deploy, or flip the diagnostic to required
or deployment-blocking in this slice.
