# Yardeni Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Yardeni's duplicate manual Git staging while preserving its fail-closed canonical output and private/public boundary.

**Architecture:** Keep the existing lane registry as the staging SSOT, regenerate its checked-in manifest, and let the existing helper perform all workflow staging. Correct only the canonical Yardeni output's requiredness and reduce the existing workflow assertions without adding a test file or suite.

**Tech Stack:** Node.js ESM registry and checks, generated JSON manifest, Bash/GitHub Actions workflow, POSIX shell staging helper.

---

### Task 1: Make Yardeni staging helper-only

**Files:**
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-fred-yardeni.yml`
- Test: `scripts/test-build-feno-yardeni-lkg-recovery.mjs`

- [ ] **Step 1: Replace legacy workflow assertions with two focused contracts**

In the existing registry-completeness block, read the manifest and locate the canonical success entry:

```js
const manifest = JSON.parse(fs.readFileSync(
  new URL("../data/admin/lane-commit-manifest.json", import.meta.url),
  "utf8",
));
const canonicalSpec = manifest.workflows[".github/workflows/fetch-fred-yardeni.yml"]
  .stages.success_if_exists
  .find((spec) => spec.path === "data/yardney/yardney_model.json");
```

Replace the three existing staging assertions with exactly:

```js
assert.match(
  workflowText,
  /scripts\/stage-lane-manifest\.sh[\s\S]*?--stage always_if_exists[\s\S]*?if \[\[ "\$FETCH_OUTCOME" == "success" \]\]; then[\s\S]*?scripts\/stage-lane-manifest\.sh[\s\S]*?--stage success_if_exists/,
  "Yardeni outputs must use manifest staging, with canonical staging gated on success",
);
assert.equal(
  canonicalSpec?.required,
  true,
  "successful Yardeni fetch must require the canonical payload",
);
```

Keep the recovery and registry-completeness assertions unchanged. This changes three staging assertions to two and adds no test file.

- [ ] **Step 2: Verify the current manifest exposes the contract gap**

Run this isolated assertion instead of the large producer suite:

```bash
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const spec=manifest.workflows[".github/workflows/fetch-fred-yardeni.yml"].stages.success_if_exists.find((item)=>item.path==="data/yardney/yardney_model.json"); assert.equal(spec?.required,true)'
```

Expected before implementation: exit 1 because the canonical entry is currently optional.

- [ ] **Step 3: Correct Yardeni canonical requiredness in the registry**

Add this focused override beside the existing workflow-specific requiredness overrides:

```js
workflow_policies[".github/workflows/fetch-fred-yardeni.yml"].stages.success_if_exists =
  workflow_policies[".github/workflows/fetch-fred-yardeni.yml"].stages.success_if_exists.map((spec) => (
    spec.path === "data/yardney/yardney_model.json"
      ? commitSpec(spec.path, spec.kind, true)
      : spec
  ));
```

Do not move stages, rebuild administration arrays, or change the declared public mirror.

- [ ] **Step 4: Regenerate and check the manifest**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Expected: both exit 0; the generated diff changes only the registry digest and Yardeni canonical `required: false` to `required: true`.

- [ ] **Step 5: Remove only Yardeni's manual staging**

Keep the explanatory private-data comment and replace the staging portion with:

```bash
scripts/stage-lane-manifest.sh \
  --workflow .github/workflows/fetch-fred-yardeni.yml \
  --stage always_if_exists
if [[ "$FETCH_OUTCOME" == "success" ]]; then
  scripts/stage-lane-manifest.sh \
    --workflow .github/workflows/fetch-fred-yardeni.yml \
    --stage success_if_exists
fi
```

Delete the phase comment, four-path `SHARD` loop, and canonical `git add`. Leave acquisition, commit, rebase, push, persistence, and publication unchanged.

- [ ] **Step 6: Run low-load static and focused contract checks**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-build-feno-yardeni-lkg-recovery.mjs
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const policy=manifest.workflows[".github/workflows/fetch-fred-yardeni.yml"]; const spec=policy.stages.success_if_exists.find((item)=>item.path==="data/yardney/yardney_model.json"); assert.equal(spec?.required,true); assert.equal(policy.stages.always_if_exists.length,5); assert.ok(policy.stages.always_if_exists.every((item)=>item.required===false)); assert.ok(!JSON.stringify(policy).includes("100xfenok-next/public"))'
git diff --check -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fred-yardeni.yml \
  scripts/test-build-feno-yardeni-lkg-recovery.mjs
git status --short -- .
```

Expected: all commands exit 0; status lists exactly the four implementation files.

- [ ] **Step 7: Prove helper behavior in a temporary Git fixture**

Use this exact minimal manifest with `data/admin/fred_yardeni/index.json` present, the LKG file absent, and the canonical file initially absent. Pass `--expected-digest smoke-digest` directly to the helper.

```json
{
  "registry_digest": "smoke-digest",
  "registry_schema": "lane-registry/v3",
  "schema_version": "lane-commit-manifest/v1",
  "workflows": {
    ".github/workflows/fetch-fred-yardeni.yml": {
      "stages": {
        "always_if_exists": [
          {
            "path": "data/admin/fred_yardeni/index.json",
            "kind": "file",
            "required": false
          },
          {
            "path": "data/admin/fred_yardeni/lkg/yardney_model.json",
            "kind": "file",
            "required": false
          }
        ],
        "success_if_exists": [
          {
            "path": "data/yardney/yardney_model.json",
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
manifest privacy check               -> no public-mirror path appears
```

Measure each helper call with `/usr/bin/time -lp`; acceptance is under one second per call and zero swaps. Move the fixture to Trash afterward.

- [ ] **Step 8: Obtain independent read-only diff review**

The critic must inspect the actual four-file diff and return PASS only if optional paths, canonical fail-closed behavior, success gating, private/public separation, and every non-staging workflow section are preserved.

- [ ] **Step 9: Commit exactly the four implementation files**

Run:

```bash
git add -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fred-yardeni.yml \
  scripts/test-build-feno-yardeni-lkg-recovery.mjs
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: deduplicate Yardeni staging"
```

Expected: exactly the four files above are committed locally. Do not run the large producer suite while free swap is below 1 GB; do not build, push, dispatch, deploy, or run a broad suite.
