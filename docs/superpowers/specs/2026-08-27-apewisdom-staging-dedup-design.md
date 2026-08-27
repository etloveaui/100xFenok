# ApeWisdom Staging Deduplication Design

## Goal

Remove ApeWisdom's duplicate manual Git staging while preserving fail-closed success outputs, recovery, and private-lane behavior.

## Chosen approach

Use the existing lane registry, generated commit manifest, and shared staging helper as the only staging control plane.

- Mark both computed social-attention outputs required in the existing success stage.
- Regenerate the existing manifest.
- Remove the manual attempt-shard block and two-output `git add` from the workflow.
- Keep the always-stage and success-gated helper calls in their current order.
- Replace three redundant workflow-path assertions with one exact manifest assertion in the existing test file.

## Why required

The current manual success command fails when either output is absent. The manifest currently marks both optional, so deleting only the manual command would weaken that behavior. Making both entries required preserves the existing fail-closed contract.

## Preserved behavior

- Attempt, index, and LKG administration files remain optional and stage when present.
- Both computed outputs remain success-gated and required together.
- The lane remains private with no public mirror.
- Provider acquisition, controlled-failure handling, daily cadence, attempt/LKG recovery, commit, rebase, and push remain unchanged.

## Scope

Implementation changes exactly four existing files:

- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `.github/workflows/fetch-fenok-apewisdom.yml`
- `scripts/test-fetch-fenok-apewisdom-attention-proxy.mjs`

No framework, new test file, provider change, privacy change, publication change, or unrelated cleanup is included.

## Verification

- Prove the current manifest assertion fails before implementation.
- Check regenerated manifest parity, exact required paths, tracked/non-ignored paths, workflow helper count, and the four-file diff.
- Use a temporary Git fixture for optional absence and both-required behavior, measuring runtime and swaps.
- Obtain independent read-only review.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push. The producer suite remains skipped while free swap is below the 1 GB safety threshold.

## Acceptance

- Missing optional administration files remain skippable.
- Missing either computed output remains fail-closed.
- Non-staging workflow behavior and privacy remain unchanged.
- No test file is added and the assertion count decreases by two.
- The result is committed locally and the repository is clean; natural scheduled proof remains not verified.
