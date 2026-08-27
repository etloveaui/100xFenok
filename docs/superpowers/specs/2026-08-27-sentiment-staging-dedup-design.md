# Sentiment Staging Deduplication Design

## Goal

Remove duplicate manual Git staging from the sentiment workflow without changing provider acquisition, degraded recovery, publication, privacy, or commit behavior.

## Chosen approach

Keep the existing registry-generated manifest and shared staging helper. Make the successful sentiment output glob required, then remove the workflow's matching hand-written staging.

- Keep both existing helper calls and the successful-fetch guard.
- Remove the detection shard variable and five guarded admin staging blocks.
- Remove the successful `data/sentiment/*.json` manual add.
- Mark that successful output glob required in the registry and regenerate the manifest.
- Replace four workflow path-literal assertions with one exact manifest assertion and one zero-manual-staging assertion.
- Update the existing manifest contract's requiredness expectation; add no test file.

## Why required output is necessary

The current unguarded successful-output glob fails when it matches no files. The helper must retain that fail-closed behavior. A required manifest glob does so while preserving tracked, untracked, ignored, and absent-path behavior.

The six always-stage entries remain optional. The generated policy already includes the publish-outcome shard in addition to the five paths duplicated by the hand list.

## Provider and publication boundary

- CNN, CFTC, VIX, MOVE, and crypto remain one provider-aware sentiment lane.
- No producer, source-selection, retention, recovery, cadence, or data path changes.
- Privacy classification and public-mirror ownership remain unchanged.
- Commit, rebase/push retry, and downstream publication remain unchanged.

## Scope

Implementation changes exactly five existing files:

- `.github/workflows/fetch-sentiment.yml`
- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `scripts/test-fetch-sentiment.mjs`
- `scripts/test-lane-commit-manifest.mjs`

The helper, producer, data payloads, recovery code, and public routes are excluded.

## Verification

- Prove RED with the existing direct sentiment test after adding the exact manifest and zero-manual-staging expectations.
- Regenerate and check the manifest.
- Run only the direct sentiment and manifest contract tests, JavaScript syntax checks, exact diff/path checks, and a bounded helper fixture only if semantics become uncertain.
- Obtain independent read-only review of the actual five-file implementation diff.
- Do not build, run broad or producer suites, use the network, dispatch workflows, deploy, pull, push, or rebase.

## Acceptance

- Manual sentiment staging falls from six blocks to zero.
- Six always-stage specs remain optional; the successful output glob is required.
- Direct workflow-contract assertions decrease from 12 to 10.
- All provider, recovery, privacy, publication, and commit behavior outside staging remains unchanged.
- Natural scheduled proof remains not verified.
