# FDIC Tier-1 Staging Deduplication Design

## Goal

Remove FDIC Tier-1's duplicate manual Git staging while preserving fail-closed canonical output behavior, quarterly scheduling, and recovery semantics.

## Chosen approach

Use the existing lane registry, generated commit manifest, and shared staging helper as the only staging control plane.

- Mark only `data/macro/fdic-tier1.json` required in its existing success stage.
- Regenerate the existing manifest.
- Remove the manual administration-file staging and canonical `git add` from the workflow.
- Keep the always stage and success-gated stage helper calls in their current order and inside the existing quarterly eligibility gate.
- Delete three redundant administration-path assertions, add one manifest requiredness assertion, and remove the legacy `git add` expectation from the existing success-stage assertion. Add no test file or suite.

## Rejected approaches

1. Keep the manual hand list: behavior-safe, but preserves the duplicate control plane and drift risk.
2. Delete manual staging without correcting requiredness: unsafe because a successful fetch could omit the canonical output without failing.
3. Add another inline workflow guard: preserves duplicated policy instead of making the registry authoritative.

## Preserved behavior

- Detection, publish-outcome, index, and LKG administration files remain optional and stage when present.
- The three manually listed administration files are currently tracked and non-ignored, so helper staging preserves their present-file behavior; missing optional files remain skippable by the registry contract.
- The canonical Tier-1 output remains success-gated and becomes explicitly required in the staging SSOT.
- Provider acquisition, latest-closed-quarter probing, first-Monday schedule eligibility, persistence migration, recovery, commit, rebase, push, and downstream publication remain unchanged.

## Scope

Implementation changes exactly four existing files:

- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `.github/workflows/fetch-fdic.yml`
- `scripts/test-fetch-fdic-tier1.mjs`

No framework, new checker, global policy, provider migration, schedule change, public-route change, or unrelated cleanup is included.

## Verification

- Confirm regenerated manifest parity and exact canonical requiredness.
- Confirm the workflow has one always-stage helper call, one success-gated helper call, and no manual FDIC staging.
- Reconfirm all formerly manual administration paths remain tracked and non-ignored.
- Use a temporary Git fixture to prove optional present/absent handling and required missing/present behavior.
- Measure fixture runtime and swap count.
- Inspect the exact four-file diff and obtain independent read-only review.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push. The large producer check remains skipped while free swap is below the 1 GB safety threshold.

## Acceptance

- Missing optional administration files remain skippable.
- Missing canonical output after a successful fetch remains fail-closed.
- Quarterly scheduling, recovery, provider probing, and every non-staging workflow section remain unchanged.
- The implementation adds no test file and reduces assertions by two.
- The repository is clean after a local-only commit; natural scheduled proof remains not verified.
