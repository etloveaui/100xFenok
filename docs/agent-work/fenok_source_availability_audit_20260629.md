# Fenok Source Availability Audit Harness

Date: 2026-06-29
Status: implemented as a lightweight private/admin measurement harness

## Purpose

Measure source availability before choosing a final scheduler time. This does
not set a production schedule and does not publish raw third-party data.

## Script

`scripts/audit-fenok-source-availability.mjs`

Default behavior is safe:

```bash
node scripts/audit-fenok-source-availability.mjs --date 2026-06-26 --plan-only
```

Live polling and private output require explicit flags:

```bash
node scripts/audit-fenok-source-availability.mjs --date 2026-06-26 --fetch --write
```

Private outputs:

- `_private/admin/fenok-flow/availability/source_availability_audit_latest.json`
- `_private/admin/fenok-flow/availability/source_availability_audit_history.ndjson`

## Sources

- FINRA CNMS daily short sale volume file
- OCC volume-query CSV for bounded ticker/side probes
- ApeWisdom all-stocks attention aggregate
- Nasdaq Trader symbol directory files
- FRED public release calendar HTML page

Each result records `checked_at_kst`, `checked_at_utc`, `source_date`,
HTTP status when fetched, file/date marker, cheap row count, and
`availability_status`. ApeWisdom also records reported result count, page
metadata, top-row fields, and a `top20` signature hash for repeated polling.

## Scheduling Rule

Do not hardcode a final daily run time from this script alone. Treat repeated
observations from the private availability history as evidence for a later
scheduler decision. ApeWisdom cadence remains empirical until repeated
availability observations show when `count`, page metadata, or the `top20`
signature changes.
