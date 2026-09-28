# EDGAR Admin Staging Deduplication Plan

## Goal and boundary

Remove only the four duplicate EDGAR admin-file staging commands. Keep the manual two-directory staging rail because it preserves whole-directory deletion behavior that the current optional manifest directory stage does not.

Implementation changes exactly two existing files:

- `.github/workflows/fetch-edgar-filings.yml`
- `scripts/test-build-edgar-lkg-recovery.mjs`

Registry, generated manifest, helper, producer, payloads, recovery, privacy, publication, and commit logic remain unchanged.

## Preserved behavior

- The always-stage helper continues to own the attempt shard, publish outcome, recovery index, current marker, and LKG marker.
- The non-plan + fetch-success + verify-success guard remains exact.
- The helper success stage remains followed by manual staging of `data/edgar` and `data/edgar-korean-summaries`.
- The manual directory rail continues to stage tracked whole-directory deletions.
- Commit, rebase/push retry, and cloud publication remain unchanged.

## RED/GREEN steps

1. Replace the existing success-branch regex with one `assert.deepEqual` over two booleans:
   - the legacy four-file `for SHARD` loop is absent;
   - the exact verified-success helper branch still contains the two-directory manual staging rail.
2. Run only the existing direct recovery/workflow contract and prove RED because the legacy loop remains.
3. Remove the parity comment and four-file manual loop; retain the surrounding recovery comments, both helper calls, all guards, and directory staging.
4. Run the direct contract again, JavaScript syntax, manifest parity, exact two-file diff checks, and zero-swap/load checks.
5. Obtain read-only review of the actual diff, create one local commit, and repeat the bounded verification.

The assertion count stays flat. Do not build, run producer or broad suites, use the network, dispatch a workflow, deploy, pull, rebase, or push. Natural scheduled proof remains not verified.
