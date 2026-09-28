# ApeWisdom Staging Deduplication Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` and preserve the exact four-file boundary.

**Goal:** Remove duplicate ApeWisdom staging while preserving two fail-closed computed outputs, recovery, and privacy.

**Architecture:** Keep the existing explicit lane policy as the staging SSOT, regenerate its checked-in manifest, and retain only the two existing helper calls in the workflow.

---

### Task 1: Make ApeWisdom staging helper-only

**Files:**

- Modify: `scripts/test-fetch-fenok-apewisdom-attention-proxy.mjs`
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-fenok-apewisdom.yml`

- [ ] **Step 1: Add the focused failing assertion**

In the existing workflow-contract block, load `data/admin/lane-commit-manifest.json`. Delete only the attempt-path and two computed-path literal assertions. Add one `assert.deepEqual` requiring this exact success stage:

```js
[
  {
    kind: "file",
    path: "data/computed/fenok_social_attention_proxy.json",
    required: true,
  },
  {
    kind: "file",
    path: "data/computed/fenok_social_attention_proxy_history.json",
    required: true,
  },
]
```

Keep every provider, controlled-failure, helper-condition, commit, forbidden broad-add, and registry-completeness assertion. This reduces the assertion count by two and adds no test file.

- [ ] **Step 2: Prove the current contract gap**

Run an isolated manifest assertion for the two exact paths with `required: true`.

Expected before implementation: exit 1 because both entries are currently optional.

- [ ] **Step 3: Correct the existing registry policy**

Change only ApeWisdom's success stage:

```js
success_if_exists: [
  commitSpec("data/computed/fenok_social_attention_proxy.json", "file", true),
  commitSpec("data/computed/fenok_social_attention_proxy_history.json", "file", true),
],
```

- [ ] **Step 4: Regenerate the existing manifest**

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Only the digest and both ApeWisdom required flags may change in the generated file.

- [ ] **Step 5: Remove only duplicate workflow staging**

Delete the manual `SHARD` block and the success branch's manual two-output `git add`. Retain the always-stage helper, success guard, success-stage helper, and every non-staging line.

- [ ] **Step 6: Run bounded static checks**

Verify manifest parity, test-file syntax, exact success entries, three optional always-stage entries, empty exclusions, exactly two helper calls, no manual ApeWisdom staging, tracked/non-ignored formerly manual paths, `git diff --check`, and exactly four changed implementation files.

- [ ] **Step 7: Run a temporary-repository helper smoke**

Prove:

```text
optional administration path absent/present -> exit 0
both computed outputs absent                -> exit 1
only canonical output present               -> exit 1
both computed outputs present               -> exit 0 and both staged
```

Measure each call with `/usr/bin/time -lp`; each must stay under one second with zero swaps. Move the fixture to Trash.

- [ ] **Step 8: Obtain independent read-only review**

The critic must inspect the actual four-file diff and confirm fail-closed output semantics, optional administration paths, privacy, recovery, and all non-staging workflow behavior.

- [ ] **Step 9: Commit the exact implementation slice**

Stage and commit only the four files above with `refactor: deduplicate ApeWisdom staging`, then rerun the static checks against the committed result and confirm a clean repository.

Do not run the producer suite while free swap is below 1 GB. Do not build, dispatch, deploy, push, use the network, or run a broad suite. Natural scheduled proof remains not verified.
