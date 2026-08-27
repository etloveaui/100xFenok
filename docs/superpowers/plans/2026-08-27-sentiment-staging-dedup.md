# Sentiment Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sentiment staging manifest-only while preserving the current successful-output failure boundary.

**Architecture:** The registry remains the SSOT. Six optional recovery/admin specs stage on every outcome; one required sentiment-output glob stages only after a successful fetch. The workflow delegates both phases to the existing helper.

**Tech Stack:** GitHub Actions YAML, Node.js ESM assertions, existing registry/manifest generator, existing Bash staging helper.

---

### Task 1: Pin the contract and prove RED

**Files:**

- Modify: `scripts/test-fetch-sentiment.mjs`
- Modify: `scripts/test-lane-commit-manifest.mjs`

- [ ] **Step 1: Replace four path literals with exact staging ownership**

In the direct workflow contract, load the generated manifest, assert the exact six optional always-stage specs and one required successful glob, and assert that executable manual `git add --` commands are absent. Keep provider, controlled-failure, helper-call, success-guard, commit-step, broad-add, and registry-completeness assertions.

Change only the sentiment successful-glob expectation from `required: false` to `required: true` in the existing manifest contract.

- [ ] **Step 2: Run the direct workflow test and verify RED**

```bash
/usr/bin/time -lp node scripts/test-fetch-sentiment.mjs
```

Expected: exit 1 because the committed manifest still marks the output glob optional and the workflow still contains six manual staging blocks. Stop if the load gate is exceeded.

### Task 2: Make the registry and workflow canonical

**Files:**

- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-sentiment.yml`

- [ ] **Step 1: Require the successful sentiment output glob**

Change only `data/sentiment/*.json` to a required commit spec, then regenerate the manifest:

```bash
node scripts/build-lane-commit-manifest.mjs --write
```

- [ ] **Step 2: Remove only duplicate manual staging**

Delete the shard variable, legacy parity comment, five guarded admin adds, and the successful output add. Retain both helper calls, their conditions and order, the no-change exit, commit, rebase/push retry, and every surrounding step.

- [ ] **Step 3: Run bounded GREEN checks one at a time**

```bash
/usr/bin/time -lp node scripts/test-fetch-sentiment.mjs
/usr/bin/time -lp node scripts/test-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-sentiment.mjs
node --check scripts/test-lane-commit-manifest.mjs
git diff --check -- \
  .github/workflows/fetch-sentiment.yml \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  scripts/test-fetch-sentiment.mjs \
  scripts/test-lane-commit-manifest.mjs
git status --short -- .
```

Expected: all checks exit 0, zero swaps, and the implementation diff contains exactly five files. Do not run the producer or broad suite.

- [ ] **Step 4: Obtain independent actual-diff review**

The critic must confirm the exact file set, required-glob failure semantics, zero manual staging, unchanged provider/recovery/privacy/publication/commit boundaries, and reduced assertion count.

- [ ] **Step 5: Commit and reverify**

Stage only the five implementation files and create one local commit. Rerun the bounded GREEN checks against the committed result and confirm a clean implementation repository. Do not pull, rebase, push, deploy, or dispatch a workflow. Natural scheduled proof remains not verified.
