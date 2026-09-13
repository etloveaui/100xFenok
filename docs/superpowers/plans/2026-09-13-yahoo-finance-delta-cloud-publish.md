# Yahoo Finance Delta Cloud Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and body-verify only Yahoo Finance objects that are not already proven by the active generation.

**Architecture:** The node publisher builds a reuse proof from the validated active manifest and one object listing. The shared generation contract accepts only exact object-key/byte-length proofs, skips remote publication for those objects, and the final parity gate body-checks the remaining objects while reporting the reused portion truthfully.

**Tech Stack:** Node.js ES modules, Cloudflare R2/Durable Object adapters, `node:assert/strict` offline contract tests.

---

### Task 1: Add the shared reuse contract

**Files:**

- Modify: `100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs`
- Test: `scripts/test-cloud-data-plane-generation.mjs`

- [ ] **Step 1: Write the failing contract tests**

Add a mixed-generation case that seeds one object, publishes a generation containing that reused object plus one new object, and passes:

```js
reusableObjects: new Map([[reusedAsset.object_key, reusedAsset.bytes]])
```

Record `putIfAbsent` keys and assert they contain only the new payload key and the new manifest key. Add rejection cases for an unknown reuse key and a byte length that differs from the new manifest.

- [ ] **Step 2: Run the focused test to prove the missing interface**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
```

Expected before implementation: failure because `publishGeneration` ignores the reuse proof and calls `putIfAbsent` for the reused payload.

- [ ] **Step 3: Implement exact reuse validation and filtering**

Add optional `reusableObjects = null` to `publishGeneration`. When supplied, require a `Map`, require every entry to name a manifest payload object, and require its integer byte length to equal every matching asset. Throw `PUBLISH_REUSE_INVALID` before remote writes for any mismatch. Build the immutable write map from assets whose keys are absent from the validated proof, then append the manifest object unchanged.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
```

Expected: exit 0 with `test-cloud-data-plane-generation: ok`.

### Task 2: Build reuse evidence and delta parity

**Files:**

- Modify: `scripts/publish-cloud-data-generation.mjs`
- Test: `scripts/test-cloud-data-plane-publisher.mjs`

- [ ] **Step 1: Write failing reuse-plan and parity tests**

Import and exercise a new `planActiveGenerationReuse` export. Seed an active generation, then build a second manifest with one unchanged and one changed asset. Assert the plan contains only the unchanged object's key and byte length. Wrap the object store to count `get` calls, run optimized parity with the plan, and assert it fetches the manifest plus only the changed object's body. Assert the result reports one reused asset and one body-verified asset. Add missing-listing and wrong-length-listing cases that exclude the affected key from reuse.

- [ ] **Step 2: Run the publisher test to prove the export is missing**

Run:

```bash
node scripts/test-cloud-data-plane-publisher.mjs
```

Expected before implementation: module import failure because `planActiveGenerationReuse` does not exist.

- [ ] **Step 3: Implement the active-generation reuse planner**

Add:

```js
export async function planActiveGenerationReuse({ pointer, manifest, objectStore })
```

Return an empty `Map` without a pointer. Otherwise validate the pointer, fetch and hash-check its active manifest, validate and cross-bind the stored manifest to the pointer, list the object store once, and return only new-manifest object keys that the active manifest references and the listing reports at the same declared length.

- [ ] **Step 4: Extend parity with explicit reuse evidence**

Add optional `reusableObjects = null` to `verifyGenerationParity`. Preserve the current all-body path when omitted. When supplied, validate the proof against the active manifest, count reused assets, group all remaining assets by object key, fetch each remaining object once through the existing bounded pool, verify its hash and every associated local payload, and return total bytes plus `body_verified_assets`, `body_verified_objects`, `reused_assets`, and `reused_objects`.

- [ ] **Step 5: Run the focused publisher test**

Run:

```bash
node scripts/test-cloud-data-plane-publisher.mjs
```

Expected: exit 0 with `test-cloud-data-plane-publisher: ok`.

### Task 3: Opt Yahoo Finance into delta publication

**Files:**

- Modify: `scripts/publish-cloud-data-generation.mjs`
- Test: `scripts/test-cloud-data-plane-publisher.mjs`

- [ ] **Step 1: Add a failing family-wiring assertion**

Assert `FAMILIES["yahoo-finance"].reuse_active_generation === true` and a representative non-Yahoo family does not enable it.

- [ ] **Step 2: Enable and wire the optimization**

Set `reuse_active_generation: true` only on Yahoo Finance. After reading the live pointer, call `planActiveGenerationReuse` only for enabled families. Pass the returned map to `publishGeneration` and `verifyGenerationParity`. Log and emit total, body-verified, and reused counts; keep the timeout and cost plan unchanged.

- [ ] **Step 3: Run focused verification**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
node scripts/test-cloud-data-plane-publisher.mjs
node --check scripts/publish-cloud-data-generation.mjs
node --check 100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs
git diff --check
```

Expected: both tests exit 0, both syntax checks exit 0, and the diff check prints nothing.

- [ ] **Step 4: Inspect scope and commit**

Inspect the actual diff and confirm it changes only the two implementation files, two focused tests, and these design/plan documents. Commit the implementation and tests with:

```bash
git add -- 100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs scripts/publish-cloud-data-generation.mjs scripts/test-cloud-data-plane-generation.mjs scripts/test-cloud-data-plane-publisher.mjs
git commit -m "perf: publish Yahoo Finance cloud deltas"
```

Do not raise the job timeout, alter schemas, run a Mac build, dispatch a live workflow, deploy, or push as part of local implementation verification.
