# Yahoo Ticker Staging Deduplication Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` and preserve the exact four-file boundary.

**Goal:** Remove duplicate Yahoo ticker staging while preserving directory semantics, a fail-closed canonical output, recovery, and downstream publication.

**Architecture:** Keep the default registry-derived policy, change only the canonical success path to required, regenerate the manifest, and retain only the existing helper calls in the workflow.

---

### Task 1: Make Yahoo ticker staging helper-only

**Files:**

- Modify: `scripts/test-fetch-yahoo-ticker.mjs`
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-yahoo-ticker.yml`

- [ ] **Step 1: Add one focused manifest assertion**

In the existing workflow-contract block, load `data/admin/lane-commit-manifest.json`. Remove only the attempt-shard and state-directory literal assertions. Add one `assert.deepEqual` for the exact generated stages:

```text
always_if_exists
  optional file      data/admin/data-supply-state/detection-attempts/yahoo_ticker_macro.json
  optional file      data/admin/data-supply-state/publish-outcomes/yahoo-ticker-macro.json
  optional directory data/admin/yahoo-hourly-ticker
success_if_exists
  required file      data/macro/yahoo-ticker.json
other stages
  empty
```

Keep provider execution, controlled-failure, commit, helper-condition, forbidden broad-add, and registry-completeness assertions unchanged. Assertion count decreases by one; add no test file.

- [ ] **Step 2: Prove the requiredness gap**

Run an isolated assertion expecting the exact stages above.

Expected before implementation: exit 1 because the canonical output is currently optional.

- [ ] **Step 3: Correct only the canonical success entry**

After the existing simple-lane requiredness mappings, map `.github/workflows/fetch-yahoo-ticker.yml`'s success specs and replace only `data/macro/yahoo-ticker.json` with `required: true`.

- [ ] **Step 4: Regenerate the manifest**

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Only the digest and Yahoo ticker canonical required flag may change in the generated file.

- [ ] **Step 5: Remove only duplicate workflow staging**

Delete `SHARD` and `STATE_ROOT` assignments, their guarded manual `git add` blocks, and the success branch's manual canonical `git add`. Retain both helper calls, the success guard, recovery exit behavior, commit/rebase/push, downstream trigger, publish job, and persistence job.

- [ ] **Step 6: Run bounded static checks**

Verify manifest parity, test-file syntax, three optional always-stage entries, one required success entry, empty exclusions, exactly two helper calls, no manual Yahoo staging, tracked/nonignored paths, `git diff --check`, and exactly four changed implementation files.

- [ ] **Step 7: Run temporary-repository smokes**

Prove under one second per helper call and zero swaps:

```text
state directory: modified + deleted + new descendants -> same cached patch as legacy git add
state directory absent                               -> exit 0
canonical output absent                              -> exit 1
canonical output present                             -> exit 0 and staged
```

Move each fixture to Trash.

- [ ] **Step 8: Obtain independent read-only diff review**

The critic must inspect the actual four-file diff and confirm directory equivalence, fail-closed canonical output, unchanged recovery, and unchanged publish/persist/public-mirror boundaries.

- [ ] **Step 9: Commit and reverify**

Commit only the four implementation files with `refactor: deduplicate Yahoo ticker staging`, rerun the static checks against the committed result, and confirm a clean repository.

Do not run the producer suite while free swap is below 1 GB. Do not build, dispatch, deploy, push, use the network, or run a broad suite. Natural scheduled proof remains not verified.
