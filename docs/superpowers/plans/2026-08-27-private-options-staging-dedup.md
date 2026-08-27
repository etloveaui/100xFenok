# Private Options Staging Deduplication Plan

## Goal and boundary

Make the private-options commit step manifest-only without changing acquisition, privacy, recovery, publication, or commit behavior.

Implementation changes exactly five existing files:

- `.github/workflows/fetch-fenok-private-options.yml`
- `scripts/lib/lane-registry.mjs`
- `data/admin/lane-commit-manifest.json`
- `scripts/test-fetch-fenok-private-options-workflow.mjs`
- `scripts/test-lane-commit-manifest.mjs`

Raw option payloads remain runner-temporary. Only the existing private admin state and public-safe availability marker remain eligible for staging.

## Preserved semantics

- Optional attempt file: present files stage; absent files skip.
- Optional admin directory: whole-directory absence skips in both old and new paths; with the directory present, tracked changes/deletions and nonignored untracked files stage.
- Successful availability marker: change the manifest spec to required so missing or ignored output still fails under the existing success guard.
- Both helper calls, no-change exit, commit, rebase/push retry, and downstream dispatch remain unchanged.

## RED/GREEN steps

1. In the direct workflow contract, replace three path-literal assertions with exact manifest-stage equality and a zero-manual-staging assertion.
2. In the existing manifest contract, pin the successful availability marker as a required file.
3. Run only the direct workflow contract and prove RED against the optional marker and three manual adds.
4. Add the one registry requiredness override, regenerate the manifest, and remove only the duplicate staging blocks.
5. Run the direct contract, existing manifest contract, manifest parity, syntax, exact five-file diff, and zero-swap/load checks.
6. Obtain independent actual-diff review, create one local commit, and repeat bounded verification.

Direct workflow-contract assertions decrease by one. Do not build, run producer or broad suites, inspect raw payloads, use the network, dispatch a workflow, deploy, pull, rebase, or push. Natural scheduled proof remains not verified.
