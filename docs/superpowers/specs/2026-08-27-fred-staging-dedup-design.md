# FRED Staging Deduplication Design

## Goal

Remove one proven duplicate staging path without changing FRED acquisition, data meaning, failure behavior, publication, or recovery.

## Scope

- Keep the existing provider fetcher and shared manifest staging helper.
- Mark the canonical FRED macro payload as required on a successful fetch in the existing registry policy.
- Remove the workflow's duplicate manual staging for the attempt, recovery, last-good, and canonical files.
- Remove three redundant literal-path assertions from the existing focused check and replace them with one required-output contract assertion. This is a net reduction of two assertions; no test file or suite is added.

## Preserved behavior

- Attempt, publication outcome, recovery index, and last-good files remain staged when present.
- The canonical payload is staged only after a successful fetch.
- A successful fetch with a missing canonical payload still fails before commit.
- Triggers, provider access, provenance, privacy, recovery, commit, push, and downstream publication remain unchanged.

## Excluded work

- No other provider or workflow migration.
- No new framework, registry, checker, or global enforcement gate.
- No build, full test run, browser automation, workflow dispatch, or live deployment.
- No unrelated test cleanup.

## Verification and load contract

1. Stop before execution when the one-minute load exceeds 12.
2. Regenerate the existing manifest and confirm it is current.
3. Run only the existing focused FRED check if the load guard is clear.
4. Inspect the exact staged-path diff; do not run a broader suite.
5. Leave natural scheduled publication proof as not verified until it occurs.

## Acceptance

- The shared manifest is the only staging mechanism for this workflow.
- All five current FRED paths retain their existing conditions.
- Missing canonical output remains fail-closed after fetch success.
- The implementation changes only the registry policy, generated manifest, one workflow, and its existing focused check.
