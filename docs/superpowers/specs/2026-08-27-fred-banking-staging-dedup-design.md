# FRED Banking Staging Deduplication Design

## Goal

Remove the proven duplicate manual staging from the FRED banking workflow without changing any data, absence, recovery, commit, or publication behavior.

## Scope

- Keep the existing registry, generated manifest, and shared staging helper unchanged.
- Remove only the workflow's manual staging of the detection, recovery, last-good, and canonical files.
- Keep the always-stage helper before the success condition and the success-stage helper inside it.
- Delete seven redundant workflow path-literal assertions.
- Add one generated-manifest assertion covering the four optional canonical success paths. This reduces the assertion count by six and adds no test file or suite.

## Preserved behavior

- All seven administrative paths remain optional and stage when present.
- All four canonical paths remain optional and stage only after a successful fetch.
- Missing optional files continue to be skipped without failing the workflow.
- Provider acquisition, cadence, provenance, recovery, commit, push, and downstream publication remain unchanged.

## Excluded work

- No registry or generated-manifest change.
- No other provider or workflow migration.
- No build, broad test, network request, workflow dispatch, deployment, or unrelated cleanup.

## Verification

- Confirm the generated manifest remains current.
- Use a temporary Git fixture to prove one present optional file stages and one absent optional file is skipped.
- Measure the smoke runtime and swap count.
- Inspect the exact two-file diff and obtain independent read-only review.
- Do not push; natural scheduled proof remains not verified.

## Acceptance

- The workflow contains exactly two shared-helper calls and no manual FRED banking staging.
- The four canonical success paths remain present and optional in the manifest.
- The implementation changes only the workflow and its existing focused check.
