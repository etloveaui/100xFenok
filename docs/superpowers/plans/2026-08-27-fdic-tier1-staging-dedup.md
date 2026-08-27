# FDIC Tier-1 Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove FDIC Tier-1's duplicate manual Git staging while preserving its fail-closed canonical output, quarterly gate, and recovery behavior.

**Architecture:** Keep the existing lane registry as the staging SSOT, regenerate its checked-in manifest, and let the existing helper perform all workflow staging. Correct only the canonical FDIC output's requiredness and reduce existing literal assertions without adding a test file or suite.

**Tech Stack:** Node.js ESM registry and checks, generated JSON manifest, Bash/GitHub Actions workflow, POSIX shell staging helper.

---

### Task 1: Make FDIC Tier-1 staging helper-only

**Files:**
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-fdic.yml`
- Test: `scripts/test-fetch-fdic-tier1.mjs`

- [ ] **Step 1: Replace three literal assertions with one manifest contract**

In the existing workflow assertion block, load the manifest and locate the canonical success entry:

```js
const manifest = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
  "utf8",
));
const canonicalSpec = manifest.workflows[".github/workflows/fetch-fdic.yml"]
  .stages.success_if_exists
  .find((spec) => spec.path === "data/macro/fdic-tier1.json");
```

Delete only these redundant assertions:

```js
assert.match(workflow, /detection-attempts\/fdic_tier1\.json/);
assert.match(workflow, /data\/admin\/fdic_tier1\/index\.json/);
assert.match(workflow, /data\/admin\/fdic_tier1\/lkg\/fdic_tier1\.json/);
```

Add:

```js
assert.equal(
  canonicalSpec?.required,
  true,
  "successful FDIC Tier-1 fetch must require the canonical payload",
);
```

In the registry-completeness block, replace only the legacy success-stage assertion with:

```js
assert.match(
  workflowText,
  /if \[\[ "\$FETCH_OUTCOME" == "success" \]\]; then[\s\S]*?scripts\/stage-lane-manifest\.sh[\s\S]*?--stage success_if_exists/,
  "canonical FDIC output must be manifest-staged only on fetch success",
);
```

Keep schedule, latest-closed-quarter, persistence, recovery, helper, and registry-completeness contracts unchanged. Assertion count decreases by two.

- [ ] **Step 2: Verify the current manifest exposes the contract gap**

Run:

```bash
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const spec=manifest.workflows[".github/workflows/fetch-fdic.yml"].stages.success_if_exists.find((item)=>item.path==="data/macro/fdic-tier1.json"); assert.equal(spec?.required,true)'
```

Expected before implementation: exit 1 because the canonical entry is currently optional.

- [ ] **Step 3: Correct canonical requiredness in the registry**

Add this focused override beside the existing workflow-specific requiredness overrides:

```js
workflow_policies[".github/workflows/fetch-fdic.yml"].stages.success_if_exists =
  workflow_policies[".github/workflows/fetch-fdic.yml"].stages.success_if_exists.map((spec) => (
    spec.path === "data/macro/fdic-tier1.json"
      ? commitSpec(spec.path, spec.kind, true)
      : spec
  ));
```

Do not move stages, change the quarterly schedule gate, or rebuild administration arrays.

- [ ] **Step 4: Regenerate and check the manifest**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Expected: both exit 0; the generated diff changes only the registry digest and FDIC canonical `required: false` to `required: true`.

- [ ] **Step 5: Remove only manual workflow staging**

Replace the staging portion after Git identity setup with exactly:

```bash
scripts/stage-lane-manifest.sh \
  --workflow .github/workflows/fetch-fdic.yml \
  --stage always_if_exists
if [[ "$FETCH_OUTCOME" == "success" ]]; then
  scripts/stage-lane-manifest.sh \
    --workflow .github/workflows/fetch-fdic.yml \
    --stage success_if_exists
fi
```

Delete the phase comment, `SHARD` variable, three guarded administration adds, and canonical `git add`. Leave the commit-step condition, schedule eligibility, provider probe, persistence, recovery, commit, rebase, push, and publication unchanged.

- [ ] **Step 6: Run low-load static and focused contract checks**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-fdic-tier1.mjs
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const policy=manifest.workflows[".github/workflows/fetch-fdic.yml"]; const spec=policy.stages.success_if_exists.find((item)=>item.path==="data/macro/fdic-tier1.json"); assert.equal(spec?.required,true); assert.equal(policy.stages.always_if_exists.length,4); assert.ok(policy.stages.always_if_exists.every((item)=>item.required===false))'
for path_value in data/admin/data-supply-state/detection-attempts/fdic_tier1.json data/admin/fdic_tier1/index.json data/admin/fdic_tier1/lkg/fdic_tier1.json; do git ls-files --error-unmatch "$path_value" >/dev/null || exit 1; if git check-ignore -q "$path_value"; then exit 1; fi; done
git diff --check -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fdic.yml \
  scripts/test-fetch-fdic-tier1.mjs
git status --short -- .
```

Expected: all commands exit 0; all formerly manual administration files are tracked and non-ignored; status lists exactly the four implementation files.

- [ ] **Step 7: Prove helper behavior in a temporary Git fixture**

Use this exact minimal manifest with the index present, the LKG file absent, and the canonical file initially absent. Pass `--expected-digest smoke-digest` directly to the helper.

```json
{
  "registry_digest": "smoke-digest",
  "registry_schema": "lane-registry/v3",
  "schema_version": "lane-commit-manifest/v1",
  "workflows": {
    ".github/workflows/fetch-fdic.yml": {
      "stages": {
        "always_if_exists": [
          {
            "path": "data/admin/fdic_tier1/index.json",
            "kind": "file",
            "required": false
          },
          {
            "path": "data/admin/fdic_tier1/lkg/fdic_tier1.json",
            "kind": "file",
            "required": false
          }
        ],
        "success_if_exists": [
          {
            "path": "data/macro/fdic-tier1.json",
            "kind": "file",
            "required": true
          }
        ]
      },
      "exclude": []
    }
  }
}
```

Verify in order:

```text
always stage, optional present/absent -> exit 0; only the present file is staged
success stage, canonical absent      -> exit 1; output contains "required file is missing"
success stage, canonical present     -> exit 0; canonical is staged
```

Measure each helper call with `/usr/bin/time -lp`; acceptance is under one second per call and zero swaps. Move the fixture to Trash afterward.

- [ ] **Step 8: Obtain independent read-only diff review**

The critic must inspect the actual four-file diff and return PASS only if optional paths, canonical fail-closed behavior, quarterly eligibility, provider probing, recovery, and every non-staging workflow section are preserved.

- [ ] **Step 9: Commit exactly the four implementation files**

Run:

```bash
git add -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fdic.yml \
  scripts/test-fetch-fdic-tier1.mjs
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: deduplicate FDIC Tier-1 staging"
```

Expected: exactly the four files above are committed locally. Do not run the large producer suite while free swap is below 1 GB; do not build, push, dispatch, deploy, or run a broad suite.
