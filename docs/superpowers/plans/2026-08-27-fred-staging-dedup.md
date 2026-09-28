# FRED Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove FRED macro's duplicate manual staging while preserving every current artifact condition and failure mode.

**Architecture:** Keep the existing registry-to-manifest-to-helper path. Promote only the canonical FRED macro payload to required within its existing success stage, then remove the workflow's parallel manual staging and reduce redundant assertions in the existing focused check.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, generated JSON manifest, Bash staging helper.

---

### Task 1: Make the existing FRED manifest path authoritative

**Files:**
- Modify: `scripts/lib/lane-registry.mjs`
- Modify: `data/admin/lane-commit-manifest.json`
- Modify: `.github/workflows/fetch-fred-macro.yml`
- Modify: `scripts/test-fetch-fred-macro.mjs`

- [ ] **Step 1: Recheck the safety boundary**

Run:

```bash
uptime
git status --short
git rev-parse HEAD
```

Proceed only when the one-minute load is at most 12 and no unrelated file is dirty. Do not run a build, broad test suite, browser, network request, workflow dispatch, or deployment.

- [ ] **Step 2: Reduce the focused assertions and retain the meaningful contract**

Delete the three workflow-literal assertions for the attempt, recovery-index, and last-good paths. In the same existing workflow check block, read the generated manifest and add one assertion:

```js
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"), "utf8"));
const canonicalSpec = manifest.workflows[".github/workflows/fetch-fred-macro.yml"].stages.success_if_exists
  .find((spec) => spec.path === "data/macro/fred-macro.json");
assert.equal(canonicalSpec?.required, true, "successful FRED fetch must require the canonical payload");
```

Keep the existing helper-call, stage-condition, and registry-completeness assertions. Add no test file or suite.

- [ ] **Step 3: Make the current failure contract explicit in the registry policy**

Immediately after the default workflow-policy map is created, promote only the existing canonical FRED spec to required:

```js
workflow_policies[".github/workflows/fetch-fred-macro.yml"].stages.success_if_exists =
  workflow_policies[".github/workflows/fetch-fred-macro.yml"].stages.success_if_exists.map((spec) => (
    spec.path === "data/macro/fred-macro.json"
      ? commitSpec(spec.path, spec.kind, true)
      : spec
  ));
```

This must not replace or rebuild the `always_if_exists` array, so the attempt, publication-outcome, recovery-index, and last-good paths remain unchanged.

- [ ] **Step 4: Regenerate the existing manifest**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs
```

Expected: the generated manifest is rewritten, its registry digest changes, all four `always_if_exists` paths remain, and `data/macro/fred-macro.json` remains in `success_if_exists` with `required: true`.

- [ ] **Step 5: Remove only the duplicate workflow staging**

Replace the manual staging portion with the existing helpers only:

```yaml
          scripts/stage-lane-manifest.sh \
            --workflow .github/workflows/fetch-fred-macro.yml \
            --stage always_if_exists
          if [[ "$FETCH_OUTCOME" == "success" ]]; then
            scripts/stage-lane-manifest.sh \
              --workflow .github/workflows/fetch-fred-macro.yml \
              --stage success_if_exists
          fi
```

Keep the success condition, staged-diff check, commit, pull/rebase, push, triggers, provider fetch, and downstream publication unchanged.

- [ ] **Step 6: Run the bounded verification once**

Run:

```bash
node scripts/build-lane-commit-manifest.mjs --check
uptime
node scripts/test-fetch-fred-macro.mjs
git diff --check
git diff --name-only
```

Expected: manifest check reports `ok`; the one-minute load remains at most 12 before the focused check; the focused check ends with `test-fetch-fred-macro: ok`; diff check is clean; only the four implementation files are listed.

- [ ] **Step 7: Commit only the bounded implementation**

```bash
git add -- scripts/lib/lane-registry.mjs data/admin/lane-commit-manifest.json .github/workflows/fetch-fred-macro.yml scripts/test-fetch-fred-macro.mjs
git commit -m "refactor: deduplicate FRED manifest staging"
```

Do not push or dispatch the workflow. Natural scheduled publication proof remains not verified until observed.
