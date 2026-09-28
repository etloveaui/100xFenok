# News Tone Staging Deduplication Design

## Goal

Remove News Tone's duplicate manual Git staging while preserving fail-closed success outputs, reference-only acquisition, recovery, and private-lane semantics.

## Chosen approach

Use the existing lane registry policy, generated commit manifest, and shared staging helper as the only staging control plane.

- Mark both `data/computed/fenok_news_tone_proxy.json` and `data/computed/fenok_news_tone_proxy_history.json` required in their existing success stage.
- Regenerate the existing manifest.
- Remove the manual attempt-shard staging and two-path canonical `git add` from the workflow.
- Keep the always stage and success-gated stage helper calls in their current order.
- Delete three redundant path assertions and add one manifest assertion covering the exact two required success paths. Add no test file or suite.

## Rejected approaches

1. Keep the manual hand list: behavior-safe, but preserves the duplicate control plane and drift risk.
2. Delete manual staging without correcting requiredness: unsafe because a successful fetch could omit either success output without failing.
3. Add another inline workflow guard: preserves duplicated policy instead of making the registry authoritative.

## Preserved behavior

- Detection, publish-outcome, index, and LKG administration files remain optional and stage when present.
- The formerly manual attempt path and both success outputs are currently tracked and non-ignored.
- Both success outputs remain success-gated and become explicitly required together, preserving the prior single-command failure when either file is absent.
- The lane remains private with no public mirror.
- GDELT acquisition, reference-only mode, retry policy, daily cadence, attempt/LKG recovery, commit, rebase, push, and cloud publication remain unchanged.

## Scope

Implementation changes exactly four existing files:

- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `.github/workflows/fetch-fenok-news-tone.yml`
- `scripts/test-fetch-fenok-news-tone-proxy.mjs`

No framework, new checker, global policy, provider migration, privacy change, public-route change, or unrelated cleanup is included.

## Verification

- Confirm regenerated manifest parity and both exact required success paths.
- Confirm the workflow has one always-stage helper call, one success-gated helper call, and no manual News Tone staging.
- Reconfirm the formerly manual paths remain tracked and non-ignored.
- Use a temporary Git fixture to prove optional absence, failure when either required output is absent, and successful staging when both exist.
- Measure fixture runtime and swap count.
- Inspect the exact four-file diff and obtain independent read-only review.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push. The large producer check remains skipped while free swap is below the 1 GB safety threshold.

## Acceptance

- Missing optional administration files remain skippable.
- Missing either success output remains fail-closed.
- Reference-only acquisition, retry, recovery, privacy, cloud publication, and every non-staging workflow section remain unchanged.
- The implementation adds no test file and reduces assertions by two.
- The repository is clean after a local-only commit; natural scheduled proof remains not verified.
