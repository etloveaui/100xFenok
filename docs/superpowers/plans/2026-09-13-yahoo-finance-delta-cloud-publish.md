# Yahoo Finance Delta Cloud Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and body-verify only Yahoo Finance objects that are not already proven by the active generation.

**Architecture:** The shared generation contract derives reuse from its validated current pointer, active manifest, and one object listing. It body-proves every remaining object before pointer promotion and returns a complete proof so post-CAS verification checks only pointer/manifest activation.

**Tech Stack:** Node.js ES modules, Cloudflare R2/Durable Object adapters, `node:assert/strict` offline contract tests.

---

### Task 1: Add the shared reuse contract

**Files:**

- Modify: `100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs`
- Test: `scripts/test-cloud-data-plane-generation.mjs`

- [x] **Step 1: Write the failing contract tests**

Add a mixed-generation case that first publishes a basis generation, then publishes one reused object plus one new object with:

```js
reuseActiveGeneration: true
```

Record `putIfAbsent` keys and assert they contain only the new payload key and the new manifest key. Reject a non-boolean reuse flag so callers cannot inject an object map.

- [x] **Step 2: Run the focused test to prove the missing interface**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
```

Expected before implementation: failure because `publishGeneration` ignores the reuse proof and calls `putIfAbsent` for the reused payload.

- [x] **Step 3: Implement exact reuse validation and filtering**

Add optional `reuseActiveGeneration = false` to `publishGeneration`. When enabled, derive the proof inside the shared contract from the current pointer, validated active manifest, and one object listing. Build the immutable write map from assets outside the proof, body-prove it before pointer promotion, append the manifest unchanged, and return the complete proof for activation parity.

- [x] **Step 4: Run the focused test**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
```

Expected: exit 0 with `test-cloud-data-plane-generation: ok`.

### Task 2: Build reuse evidence and delta parity

**Files:**

- Modify: `scripts/publish-cloud-data-generation.mjs`
- Test: `scripts/test-cloud-data-plane-publisher.mjs`

- [x] **Step 1: Write failing reuse-plan and parity tests**

Import and exercise a new `planActiveGenerationReuse` export. Seed an active generation, then build a second manifest with one unchanged and one changed asset. Assert the plan contains only the unchanged object's key and byte length. Wrap the object store to count `get` calls, run optimized parity with the plan, and assert it fetches the manifest plus only the changed object's body. Assert the result reports one reused asset and one body-verified asset. Add missing-listing and wrong-length-listing cases that exclude the affected key from reuse.

- [x] **Step 2: Run the publisher test to prove the export is missing**

Run:

```bash
node scripts/test-cloud-data-plane-publisher.mjs
```

Expected before implementation: module import failure because `planActiveGenerationReuse` does not exist.

- [x] **Step 3: Implement the active-generation reuse planner**

Add:

```js
export async function planActiveGenerationReuse({ pointer, manifest, objectStore })
```

Return an empty `Map` without a pointer or usable prior basis. Otherwise validate the pointer, select active for a new generation or previous for a retry, fetch and hash-check that manifest, cross-bind it to the pointer target, list once, and return only matching content-addressed keys with exact stored lengths.

- [x] **Step 4: Extend parity with explicit reuse evidence**

Add optional `verifiedObjects = null` to `verifyGenerationParity`. Preserve the current all-body path when omitted. When supplied by `publishGeneration`, validate it against the active manifest, validate every local payload, and finish pointer/manifest activation without downloading payload bodies again. Return total bytes and proof counts.

- [x] **Step 5: Run the focused publisher test**

Run:

```bash
node scripts/test-cloud-data-plane-publisher.mjs
```

Expected: exit 0 with `test-cloud-data-plane-publisher: ok`.

### Task 3: Opt Yahoo Finance into delta publication

**Files:**

- Modify: `scripts/publish-cloud-data-generation.mjs`
- Test: `scripts/test-cloud-data-plane-publisher.mjs`

- [x] **Step 1: Add a failing family-wiring assertion**

Assert `FAMILIES["yahoo-finance"].reuse_active_generation === true` and a representative non-Yahoo family does not enable it.

- [x] **Step 2: Enable and wire the optimization**

Set `reuse_active_generation: true` only on Yahoo Finance. Pass the boolean to `publishGeneration`, then pass its complete pre-promotion proof to `verifyGenerationParity`. Log and emit total, body-verified, and reused counts; keep the timeout and cost plan unchanged.

- [x] **Step 3: Run focused verification**

Run:

```bash
node scripts/test-cloud-data-plane-generation.mjs
node scripts/test-cloud-data-plane-publisher.mjs
node --check scripts/publish-cloud-data-generation.mjs
node --check 100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs
git diff --check
```

Expected: both tests exit 0, both syntax checks exit 0, and the diff check prints nothing.

- [x] **Step 4: Inspect scope and commit**

Inspect the actual diff and confirm it changes only the two implementation files, two focused tests, and these design/plan documents. Commit the implementation and tests with:

```bash
git add -- 100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs scripts/publish-cloud-data-generation.mjs scripts/test-cloud-data-plane-generation.mjs scripts/test-cloud-data-plane-publisher.mjs
git commit -m "perf: publish Yahoo Finance cloud deltas"
```

Do not raise the job timeout, alter schemas, run a Mac build, dispatch a live workflow, deploy, or push as part of local implementation verification.
