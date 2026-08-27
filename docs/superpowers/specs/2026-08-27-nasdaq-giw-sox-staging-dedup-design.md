# Nasdaq GIW SOX Staging Deduplication Design

## Goal

Remove Nasdaq GIW SOX's duplicate manual Git staging while preserving fail-closed canonical output behavior and the existing private/public boundary.

## Chosen approach

Use the existing lane registry, generated commit manifest, and shared staging helper as the only staging control plane.

- Mark only `data/indices/nasdaq-giw-sox-constituents.json` required in its existing success stage.
- Regenerate the existing manifest.
- Remove the manual administration-file staging and canonical `git add` from the workflow.
- Keep the always stage and success-gated stage helper calls in their current order.
- Delete three redundant administration-path assertions and add one manifest requiredness assertion in the existing Nasdaq GIW SOX check. Add no test file or suite.

## Rejected approaches

1. Keep the manual hand list: behavior-safe, but preserves the duplicate control plane and drift risk.
2. Delete manual staging without correcting requiredness: unsafe because a successful fetch could omit the canonical output without failing.
3. Add another inline workflow guard: preserves duplicated policy instead of making the registry authoritative.

## Preserved behavior

- Detection, publish-outcome, index, LKG, and history administration files remain optional and stage when present.
- The canonical constituents output remains success-gated and becomes explicitly required in the staging SSOT.
- The private source lane and its separately declared public-safe mirror remain distinct; the workflow continues to run canonical-only and never stages the public mirror.
- Provider acquisition, cadence, provenance, recovery, history rotation, commit, rebase, push, and downstream publication remain unchanged.

## Scope

Implementation changes exactly four existing files:

- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `.github/workflows/fetch-nasdaq-giw-sox.yml`
- `scripts/test-fetch-nasdaq-giw-sox-constituents.mjs`

No framework, new checker, global policy, provider migration, public-route change, or unrelated cleanup is included.

## Verification

- Confirm regenerated manifest parity and exact canonical requiredness.
- Confirm the workflow has one always-stage helper call, one success-gated helper call, and no manual Nasdaq GIW SOX staging.
- Use a temporary Git fixture to prove optional present/absent handling and required missing/present behavior.
- Confirm the workflow manifest contains no public-mirror path.
- Measure fixture runtime and swap count.
- Inspect the exact four-file diff and obtain independent read-only review.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push. The large producer check remains skipped while free swap is below the 1 GB safety threshold.

## Acceptance

- Missing optional administration files remain skippable.
- Missing canonical output after a successful fetch remains fail-closed.
- Private/public routing and every non-staging workflow section remain unchanged.
- The implementation adds no test file and reduces assertions by two.
- The repository is clean after a local-only commit; natural scheduled proof remains not verified.
