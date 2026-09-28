# KRX Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove six duplicate KRX manual staging commands while preserving the existing manifest, private/public boundary, walkback/LKG recovery, and publication behavior.

**Architecture:** The existing registry-generated policy already owns all seven staged paths with correct optional/required semantics. Change only the workflow and its direct workflow test; the test uses one combined assertion to verify both the exact manifest stages and the absence of manual `git add` commands.

**Tech Stack:** GitHub Actions YAML, Node.js ESM assertions, the existing Bash manifest staging helper.

---

### Task 1: Make KRX staging helper-only

**Files:**

- Modify: `scripts/test-fenok-edge-krx-daily-workflow.mjs`
- Modify: `.github/workflows/fenok-edge-krx-daily.yml`

- [ ] **Step 1: Replace five stale path assertions with one staging-control assertion**

Load `data/admin/lane-commit-manifest.json`, flatten the relevant stage specs, and collect exact manual staging commands:

```js
const manifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "data", "admin", "lane-commit-manifest.json"),
  "utf8",
));
const stages = manifest.workflows[".github/workflows/fenok-edge-krx-daily.yml"].stages;
const manualGitAdds = [...workflowText.matchAll(/^\s*git add -- (.+)$/gmu)]
  .map((match) => match[1].trim());
```

Delete only the three computed-output path assertions and the two recovery-path manual-add assertions. Add one `assert.deepEqual` comparing:

```js
{
  manifest_stages: [
    ...stages.always_if_exists.map(({ kind, path: pathValue, required }) => ["always", kind, pathValue, required]),
    ...stages.success_if_exists.map(({ kind, path: pathValue, required }) => ["success", kind, pathValue, required]),
    ["required_on_success", stages.required_on_success.length],
    ["success_verify_not_plan", stages.success_verify_not_plan_if_exists.length],
  ],
  manual_git_adds: manualGitAdds,
}
```

against three optional always-path files, four required success-path files, two zero-length stages, and `manual_git_adds: []`. Keep the detection-attempt assertion and every controlled-failure, helper-stage, walkback, emitter, and broad-add assertion.

- [ ] **Step 2: Run the direct workflow test and verify RED**

```bash
/usr/bin/time -lp node scripts/test-fenok-edge-krx-daily-workflow.mjs
```

Expected: exit 1 because `manual_git_adds` contains the six existing commands. Baseline runtime is 0.95 seconds with zero swaps; stop if the load gate is exceeded.

- [ ] **Step 3: Remove only duplicate workflow staging**

In the commit step:

- Update the staging comment to state that the generated manifest owns recovery and public-safe output staging.
- Remove the guarded `data/admin/krx/index.json` and `data/admin/krx/lkg/bridge.json` manual-add blocks.
- Remove the four success-branch manual adds.
- Retain both helper calls, the success guard, commit/rebase/push loop, and every step before and after this block unchanged.

- [ ] **Step 4: Run GREEN and bounded static verification**

```bash
/usr/bin/time -lp node scripts/test-fenok-edge-krx-daily-workflow.mjs
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fenok-edge-krx-daily-workflow.mjs
git diff --check -- \
  .github/workflows/fenok-edge-krx-daily.yml \
  scripts/test-fenok-edge-krx-daily-workflow.mjs
git status --short -- .
```

Expected: direct test and static checks exit 0; the implementation diff contains exactly two files; the manifest, registry, helper, producer, and data remain unchanged. The direct test must stay below 1.5 seconds with zero swaps.

- [ ] **Step 5: Obtain independent read-only diff review**

The critic must inspect the actual two-file diff and return PASS only if private raw acquisition, all four public-safe outputs, success requiredness, walkback/LKG behavior, commit/push, manifest reconciliation, and downstream public materialization remain unchanged.

- [ ] **Step 6: Commit and reverify**

```bash
git add -- \
  .github/workflows/fenok-edge-krx-daily.yml \
  scripts/test-fenok-edge-krx-daily-workflow.mjs
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: deduplicate KRX staging"
```

Rerun Step 4 against the committed result and confirm the implementation repository is clean. Do not build, run a broad suite, use the network, dispatch a workflow, deploy, or push. Natural scheduled proof remains not verified.
