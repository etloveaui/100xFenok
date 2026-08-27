# DefiLlama Staging Deduplication Design

## Goal

Remove DefiLlama's duplicate manual staging without changing optional administrative paths, required canonical output, recovery, commit, or publication behavior.

## Scope

- Keep the existing registry, generated manifest, and shared staging helper unchanged.
- Remove manual staging for three administrative files and the canonical stablecoins payload.
- Preserve the always-stage helper and the success-stage helper under their current conditions.
- Delete three redundant workflow path-literal assertions; add no replacement because existing helper, registry, and generic staging contracts already cover the exact paths and requiredness.

## Preserved behavior

- Administrative files remain optional and stage when present.
- The canonical stablecoins payload remains required after a successful fetch.
- Missing optional files remain skippable; a missing required canonical payload remains fail-closed.
- Provider acquisition, cadence, provenance, recovery, commit, push, and downstream publication remain unchanged.

## Excluded work

- No registry or generated-manifest change.
- No other provider or workflow migration.
- No build, broad test, network request, workflow dispatch, deployment, or unrelated cleanup.

## Verification

- Confirm the generated manifest remains current.
- Use temporary Git fixtures to prove optional present/absent handling, successful required staging, and missing-required failure.
- Measure runtime and swap count.
- Inspect the exact two-file diff and obtain independent read-only review.
- Do not push; natural scheduled proof remains not verified.

## Acceptance

- The workflow contains exactly two helper calls and no manual DefiLlama staging.
- The manifest remains four optional administrative paths plus one required canonical path.
- The implementation changes only the workflow and its existing focused check.
