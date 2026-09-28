# Yahoo Ticker Staging Deduplication Design

## Goal

Remove Yahoo ticker's duplicate manual Git staging while preserving its directory state, fail-closed canonical output, recovery, and downstream publication boundaries.

## Chosen approach

Use the existing registry-derived workflow policy, generated manifest, and shared helper as the only staging control plane.

- Mark only `data/macro/yahoo-ticker.json` required in the existing success stage.
- Leave the attempt shard, later publish-outcome shard, and `data/admin/yahoo-hourly-ticker` directory optional.
- Regenerate the existing manifest.
- Remove the guarded manual attempt and directory blocks plus the success branch's canonical `git add`.
- Keep both helper calls, the success guard, and every non-staging line unchanged.
- Replace two redundant path assertions with one exact manifest-stage assertion in the existing test file.

## Directory equivalence

The helper already stages the state directory before the duplicate manual command. A bounded temporary Git fixture compared both paths with a tracked modification, tracked deletion, and nonignored untracked descendant. Both produced the same `M`, `D`, and `A` entries and an identical cached binary patch. The helper completed in 0.12 seconds with zero swaps. Missing directories remain skippable under both the old guard and optional manifest entry; ignored untracked descendants remain excluded.

## Preserved behavior

- A missing canonical output after a successful fetch remains a hard failure.
- Controlled-failure handling, hourly cadence, keyed recovery state, commit/rebase/push, and the downstream update trigger remain unchanged.
- The later publish job still creates the outcome shard, and the separate persistence job still commits it.
- The lane remains public-mirror classified, while canonical Git staging and downstream mirror ownership stay separate.

## Scope

Implementation changes exactly four existing files:

- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `.github/workflows/fetch-yahoo-ticker.yml`
- `scripts/test-fetch-yahoo-ticker.mjs`

No helper change, framework, new test file, provider change, recovery change, privacy change, publication change, or unrelated cleanup is included.

## Verification

- Prove the new manifest assertion fails before implementation.
- Check regenerated manifest parity, exact requiredness, helper count, absence of manual staging, tracked/nonignored paths, and the exact four-file diff.
- Recheck optional-directory and required-canonical behavior in a temporary Git fixture under the load gate.
- Obtain independent read-only review of the actual diff.
- Do not run a build, broad suite, network request, workflow dispatch, deployment, or push. The producer suite remains skipped while free swap is below the 1 GB safety threshold.

## Acceptance

- Directory modifications, deletions, and new nonignored descendants remain stageable.
- Missing optional administration state remains skippable; missing canonical output remains fail-closed.
- Publication and public-mirror boundaries remain unchanged.
- No test file is added and the workflow-contract assertion count decreases by one.
- The result is committed locally and the repository is clean; natural scheduled proof remains not verified.
