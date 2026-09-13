# Workflow Runtime Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Remove repeated and serialized hosted workflow work while preserving publication and deployment safety.

**Architecture:** Collapse duplicate projection into the writer retry loop, reuse only job-local validation and budget proofs with explicit invalidation/binding, add bounded probe workers, and move cheap deploy failure gates earlier.

**Tech Stack:** GitHub Actions YAML, Node.js ES modules, Python unittest contracts, shell workflow steps.

---

### Task 1: Collapse Update Manifest to one projection

**Files:**

- Modify: `.github/workflows/update-manifest.yml`
- Modify: `scripts/test-update-manifest-runner.mjs`
- Modify: `scripts/test-update-manifest-workflow.mjs`

- [x] Change the contract tests to require exactly one runner call inside the retry loop, one final flag set, and a clean no-change exit from that step.
- [x] Run the two focused tests and confirm they fail against the current two-pass workflow.
- [x] Remove the preliminary projection and change-probe steps; make the retry step unconditional and emit `pushed=false` on no change.
- [x] Run the focused tests and YAML parse validation.

### Task 2: Cache StockAnalysis validation across safe retries

**Files:**

- Modify: `.github/workflows/fetch-stockanalysis.yml`
- Modify: `scripts/test_stockanalysis_workflow_contract.py`

- [x] Add contract assertions for a validation fingerprint, first-attempt validation, safe reuse, and invalidation on covered source or artifact drift.
- [x] Run the workflow contract and confirm it fails.
- [x] Wrap the existing validation suite in a job-local fingerprint gate. Leave artifact application, resolution, projection, stage audit, and materialization inside every retry.
- [x] Run the workflow contract plus the existing focused resolver tests; the full artifact suite is reserved for hosted validation.

### Task 3: Add bounded serving-probe concurrency

**Files:**

- Modify: `scripts/ops/probe-data-plane-serving.mjs`
- Modify: `scripts/ops/test-probe-data-plane-serving.mjs`

- [x] Replace sequential-only test expectations with tests for a bounded maximum, deterministic output order, timeout continuation, and total-deadline accounting.
- [x] Run the focused test and confirm it fails.
- [x] Implement an immutable default worker count with tighten-only parsing and a shared next-index dispatcher that stops admission at the total deadline.
- [x] Run the focused probe tests and syntax check.

### Task 4: Remove the duplicate post-write cost walk

**Files:**

- Modify: `scripts/publish-cloud-data-generation.mjs`
- Modify: `scripts/lib/publish-outcome-shard.mjs`
- Modify: `scripts/test-cloud-data-plane-publisher.mjs`
- Modify: `scripts/test-persist-cloud-publish-outcome.mjs`

- [x] Add tests requiring one cost-gate invocation on normal publication and an explicit `covered_by_preflight_plan` after-write status.
- [x] Run the focused publisher test and confirm it fails.
- [x] Reuse the preflight proof after successful normal publication; preserve separate rollback and chaos measurements and fail-closed preflight behavior.
- [x] Run publisher, outcome, budget, and rate-limit focused tests.

### Task 5: Fail Deploy Worker earlier

**Files:**

- Modify: `.github/workflows/deploy-worker.yml`
- Modify: `scripts/test-build-data-supply-detection-floor.mjs`
- Modify: `100xfenok-next/scripts/test-load-guard-remote-dispatch.mjs`

- [x] Add structural assertions that the source-lineage checkout remains full and token QA runs immediately after install, before data projection and build.
- [x] Run the focused workflow test and confirm it fails.
- [x] Add the early token policy step. Keep full history for the ancestry fence, the in-build post-sync token check, and the post-build bundle budget.
- [x] Run the focused workflow/provenance tests and YAML parse validation.

### Task 6: Verify AKAF closure and integrate

**Files:**

- Verify: `scripts/resolve_etf_detail_candidates.py`
- Verify: `scripts/test_resolve_etf_detail_candidates.py`

- [x] Run the AKAF unavailable regression and StockAnalysis workflow contract on the exact candidate revision.
- [x] Run syntax, diff, and generated-projection checks allowed locally.
- [ ] Commit and push the scoped changes.
- [ ] Dispatch the repository's approved hosted validation workflows for the exact pushed revision and inspect every result.
- [ ] Record the verified changes and remaining natural-runtime measurements in the project worklist/change records.
