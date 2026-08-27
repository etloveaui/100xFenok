# News Tone Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove News Tone's duplicate manual Git staging while preserving two fail-closed success outputs, reference-only acquisition, recovery, and privacy.

**Architecture:** Keep the existing explicit lane registry policy as the staging SSOT, regenerate its checked-in manifest, and let the existing helper perform all workflow staging. Mark both success outputs required and reduce literal assertions without adding a test file or suite.

**Tech Stack:** Node.js ESM registry and checks, generated JSON manifest, Bash/GitHub Actions workflow, POSIX shell staging helper.

---

### Task 1: Make News Tone staging helper-only

**Files:**
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-fenok-news-tone.yml`
- Test: `scripts/test-fetch-fenok-news-tone-proxy.mjs`

- [ ] **Step 1: Replace three literal assertions with one manifest contract**

In the existing workflow contract block, load the manifest:

```js
const manifest = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
  "utf8",
));
```

Delete only these three assertions:

```js
assert.match(workflow, new RegExp(`detection-attempts/${LANE_ID}\\.json`));
assert.match(workflow, /data\/computed\/fenok_news_tone_proxy\.json/);
assert.match(workflow, /data\/computed\/fenok_news_tone_proxy_history\.json/);
```

Add this exact generated-manifest assertion:

```js
assert.deepEqual(
  manifest.workflows[WORKFLOW_REL].stages.success_if_exists,
  [
    {
      kind: "file",
      path: "data/computed/fenok_news_tone_proxy.json",
      required: true,
    },
    {
      kind: "file",
      path: "data/computed/fenok_news_tone_proxy_history.json",
      required: true,
    },
  ],
  "successful News Tone fetch must require both computed outputs",
);
```

Keep reference-only, retry, controlled-failure, executable-entrypoint, commit-step, helper-stage, success-guard, forbidden broad-add, and registry-completeness assertions unchanged. Assertion count decreases by two.

- [ ] **Step 2: Verify the current manifest exposes both contract gaps**

Run:

```bash
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const specs=manifest.workflows[".github/workflows/fetch-fenok-news-tone.yml"].stages.success_if_exists; assert.deepEqual(specs.map((item)=>[item.path,item.required]),[["data/computed/fenok_news_tone_proxy.json",true],["data/computed/fenok_news_tone_proxy_history.json",true]])'
```

Expected before implementation: exit 1 because both success entries are currently optional.

- [ ] **Step 3: Correct both success entries in the explicit registry policy**

Change only the existing News Tone success stage to:

```js
success_if_exists: [
  commitSpec("data/computed/fenok_news_tone_proxy.json", "file", true),
  commitSpec("data/computed/fenok_news_tone_proxy_history.json", "file", true),
],
```

Do not move stages, modify optional administration paths, or change privacy metadata.

- [ ] **Step 4: Regenerate and check the manifest**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs
node scripts/build-lane-commit-manifest.mjs --check
```

Expected: both exit 0; the generated diff changes only the registry digest and the two News Tone success entries from optional to required.

- [ ] **Step 5: Remove only manual workflow staging**

Keep the explanatory comments and helper calls, but remove:

```bash
SHARD="data/admin/data-supply-state/detection-attempts/gdelt_news_tone.json"
if [[ -f "$SHARD" ]]; then
  git add -- "$SHARD"
fi
```

Remove the success branch's manual add:

```bash
git add -- \
  data/computed/fenok_news_tone_proxy.json \
  data/computed/fenok_news_tone_proxy_history.json
```

Leave acquisition, reference-only options, retry policy, recovery, commit, rebase, push, and cloud publication unchanged.

- [ ] **Step 6: Run low-load static and focused contract checks**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-fenok-news-tone-proxy.mjs
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const manifest=JSON.parse(fs.readFileSync("data/admin/lane-commit-manifest.json","utf8")); const policy=manifest.workflows[".github/workflows/fetch-fenok-news-tone.yml"]; assert.deepEqual(policy.stages.success_if_exists.map((item)=>[item.path,item.required]),[["data/computed/fenok_news_tone_proxy.json",true],["data/computed/fenok_news_tone_proxy_history.json",true]]); assert.equal(policy.stages.always_if_exists.length,4); assert.ok(policy.stages.always_if_exists.every((item)=>item.required===false)); assert.equal(policy.exclude.length,0)'
for path_value in data/admin/data-supply-state/detection-attempts/gdelt_news_tone.json data/computed/fenok_news_tone_proxy.json data/computed/fenok_news_tone_proxy_history.json; do git ls-files --error-unmatch "$path_value" >/dev/null || exit 1; if git check-ignore -q "$path_value"; then exit 1; fi; done
git diff --check -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fenok-news-tone.yml \
  scripts/test-fetch-fenok-news-tone-proxy.mjs
git status --short -- .
```

Expected: all commands exit 0; formerly manual paths are tracked and non-ignored; status lists exactly four implementation files.

- [ ] **Step 7: Prove helper behavior in a temporary Git fixture**

Use this exact minimal manifest with the index present, LKG absent, and both success files initially absent. Pass `--expected-digest smoke-digest` directly to the helper.

```json
{
  "registry_digest": "smoke-digest",
  "registry_schema": "lane-registry/v3",
  "schema_version": "lane-commit-manifest/v1",
  "workflows": {
    ".github/workflows/fetch-fenok-news-tone.yml": {
      "stages": {
        "always_if_exists": [
          {
            "path": "data/admin/gdelt_news_tone/index.json",
            "kind": "file",
            "required": false
          },
          {
            "path": "data/admin/gdelt_news_tone/lkg/news_tone_proxy.json",
            "kind": "file",
            "required": false
          }
        ],
        "success_if_exists": [
          {
            "path": "data/computed/fenok_news_tone_proxy.json",
            "kind": "file",
            "required": true
          },
          {
            "path": "data/computed/fenok_news_tone_proxy_history.json",
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
always stage, optional present/absent    -> exit 0; only the present file is staged
success stage, both required absent      -> exit 1
success stage, proxy only                -> exit 1 because history is missing
success stage, proxy and history present -> exit 0; both are staged
```

Measure each helper call with `/usr/bin/time -lp`; acceptance is under one second per call and zero swaps. Move the fixture to Trash afterward.

- [ ] **Step 8: Obtain independent read-only diff review**

The critic must inspect the actual four-file diff and return PASS only if both success outputs remain fail-closed, optional paths remain optional, and reference-only acquisition, retry, recovery, privacy, cloud publication, and every non-staging section are preserved.

- [ ] **Step 9: Commit exactly the four implementation files**

Run:

```bash
git add -- \
  scripts/lib/lane-registry.mjs \
  data/admin/lane-commit-manifest.json \
  .github/workflows/fetch-fenok-news-tone.yml \
  scripts/test-fetch-fenok-news-tone-proxy.mjs
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: deduplicate News Tone staging"
```

Expected: exactly the four files above are committed locally. Do not run the large producer suite while free swap is below 1 GB; do not build, push, dispatch, deploy, or run a broad suite.
