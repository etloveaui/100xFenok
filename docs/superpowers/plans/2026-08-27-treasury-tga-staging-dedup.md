# Treasury TGA Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Treasury TGA's duplicate manual Git staging while preserving optional administration files and fail-closed canonical output behavior.

**Architecture:** Keep the existing lane registry as the staging SSOT, regenerate its checked-in manifest, and let the existing helper perform all workflow staging. Correct only the canonical Treasury output's requiredness, then reduce the existing workflow contract assertions without adding a test file or suite.

**Tech Stack:** Node.js ESM registry and checks, generated JSON manifest, Bash/GitHub Actions workflow, POSIX shell staging helper.

---

### Task 1: Make Treasury TGA staging helper-only

**Files:**
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-treasury-tga.yml`
- Test: `scripts/test-fetch-treasury-tga.mjs`

- [ ] **Step 1: Add the focused manifest contract assertion**

In the existing Treasury workflow assertion block, load the generated manifest, locate the canonical success entry, remove the three administration-path literal assertions, and add this single requiredness assertion:

```js
const manifest = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
  "utf8",
));
const canonicalSpec = manifest.workflows[".github/workflows/fetch-treasury-tga.yml"]
  .stages.success_if_exists
  .find((spec) => spec.path === "data/macro/tga.json");

assert.equal(
  canonicalSpec?.required,
  true,
  "successful Treasury TGA fetch must require the canonical payload",
);
```

Delete only these redundant assertions:

```js
assert.match(workflow, /data\/admin\/data-supply-state\/detection-attempts\/treasury_tga\.json/);
assert.match(workflow, /data\/admin\/treasury_tga\/index\.json/);
assert.match(workflow, /data\/admin\/treasury_tga\/lkg\/tga\.json/);
```

Keep the helper-call assertions, success guard, forbidden broad-add assertion, commit-step assertion, and registry-completeness gate unchanged.

- [ ] **Step 2: Verify the new assertion detects the current semantic gap**

Run:

```bash
node scripts/test-fetch-treasury-tga.mjs
```

Expected: FAIL only because the canonical manifest entry currently has `required: false`.

If the machine's one-minute load is above 12 or free swap is below 1 GB, do not run this producer check; record it as `[not verified]` and continue with static checks plus the temporary helper fixture.

- [ ] **Step 3: Correct the registry's canonical requiredness**

Immediately after the existing FRED macro policy correction in `scripts/lib/lane-registry.mjs`, add:

```js
workflow_policies[".github/workflows/fetch-treasury-tga.yml"].stages.success_if_exists =
  workflow_policies[".github/workflows/fetch-treasury-tga.yml"].stages.success_if_exists.map((spec) => (
    spec.path === "data/macro/tga.json"
      ? commitSpec(spec.path, spec.kind, true)
      : spec
  ));
```

This keeps every path in its existing stage and changes no workflow other than Treasury TGA.

- [ ] **Step 4: Regenerate and check the manifest**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Expected: both commands exit 0; the generated diff changes the manifest digest and changes only `data/macro/tga.json` from optional to required within the Treasury TGA success stage.

- [ ] **Step 5: Remove the workflow's manual staging**

Replace the staging portion after Git identity setup with exactly:

```bash
scripts/stage-lane-manifest.sh \
  --workflow .github/workflows/fetch-treasury-tga.yml \
  --stage always_if_exists
if [[ "$FETCH_OUTCOME" == "success" ]]; then
  scripts/stage-lane-manifest.sh \
    --workflow .github/workflows/fetch-treasury-tga.yml \
    --stage success_if_exists
fi
```

Remove the `SHARD` variable, phase comment, all guarded administration `git add` commands, and the unguarded canonical `git add`. Leave commit, rebase, push, and downstream behavior unchanged.

- [ ] **Step 6: Run static and exact-diff checks**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-treasury-tga.mjs
git diff --check -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-treasury-tga.yml \
  scripts/test-fetch-treasury-tga.mjs
git status --short -- .
```

Expected: all checks exit 0; status lists exactly the four implementation files and no new test file.

- [ ] **Step 7: Prove helper behavior in an isolated low-load Git fixture**

After confirming one-minute load is at most 12, create a temporary Git repository, copy only the staging helper, and write this minimal manifest:

```json
{
  "workflows": {
    ".github/workflows/fetch-treasury-tga.yml": {
      "stages": {
        "always_if_exists": [
          {
            "path": "data/admin/treasury_tga/index.json",
            "kind": "file",
            "required": false
          },
          {
            "path": "data/admin/treasury_tga/lkg/tga.json",
            "kind": "file",
            "required": false
          }
        ],
        "success_if_exists": [
          {
            "path": "data/macro/tga.json",
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

Run the always stage with only the optional index present and confirm exit 0 with just that file staged. Run the success stage without the canonical file and confirm nonzero output containing `required file is missing`. Create the canonical file, rerun the success stage, and confirm it is staged. Measure the fixture with `/usr/bin/time -lp`; expected wall time is under one second and swap counts are zero.

- [ ] **Step 8: Obtain independent read-only diff review**

The critic must inspect the actual four-file diff and verify:

```text
PASS only if helper-only staging preserves all optional paths, canonical missing-output failure, success guarding, privacy, and unrelated workflow behavior; otherwise report exact file and line findings.
```

- [ ] **Step 9: Commit only the implementation files**

Run:

```bash
git add -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-treasury-tga.yml \
  scripts/test-fetch-treasury-tga.mjs
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: deduplicate Treasury TGA staging"
```

Expected: the staged-name list contains exactly the four files above; commit succeeds locally. Do not push, dispatch, deploy, or run a broad suite.
