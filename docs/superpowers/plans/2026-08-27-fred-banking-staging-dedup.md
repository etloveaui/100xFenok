# FRED Banking Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove FRED banking's duplicate manual staging while preserving all optional-file and success-stage behavior.

**Architecture:** Keep the existing registry, generated manifest, and staging helper unchanged. Remove only the workflow's parallel manual staging, then replace seven path-literal assertions with one generated-manifest contract assertion.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, generated JSON manifest, Bash staging helper.

---

### Task 1: Make the existing FRED banking helper path authoritative

**Files:**
- Modify: `.github/workflows/fetch-fred-banking.yml`
- Modify: `scripts/test-fetch-fred-banking.mjs`

- [ ] **Step 1: Recheck the safety boundary**

```bash
uptime
git status --short
git rev-parse HEAD
```

Proceed only with a clean tree and one-minute load at most 12. Do not run a build, broad test, network request, workflow dispatch, or deployment.

- [ ] **Step 2: Replace redundant literals with one manifest contract**

Delete the seven workflow assertions for the detection shard, recovery index, four last-good files, and monthly canonical file. Add this generated-manifest assertion inside the existing workflow check block:

```js
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"), "utf8"));
const canonicalSpecs = manifest.workflows[".github/workflows/fetch-fred-banking.yml"].stages.success_if_exists
  .map(({ path: pathValue, required }) => ({ path: pathValue, required }));
assert.deepEqual(canonicalSpecs, [
  { path: "data/macro/fred-banking-daily.json", required: false },
  { path: "data/macro/fred-banking-weekly.json", required: false },
  { path: "data/macro/fred-banking-monthly.json", required: false },
  { path: "data/macro/fred-banking-quarterly.json", required: false },
], "FRED banking canonical staging remains optional and manifest-owned");
```

Keep the existing helper-call, stage-condition, no-public-mirror, and registry-completeness assertions. Add no test file or suite.

- [ ] **Step 3: Remove only the duplicate workflow staging**

Replace the manual staging portion with the existing helpers only:

```yaml
          scripts/stage-lane-manifest.sh \
            --workflow .github/workflows/fetch-fred-banking.yml \
            --stage always_if_exists
          if [[ "$FETCH_OUTCOME" == "success" ]]; then
            scripts/stage-lane-manifest.sh \
              --workflow .github/workflows/fetch-fred-banking.yml \
              --stage success_if_exists
          fi
```

Keep the staged-diff check, commit, pull/rebase, push, triggers, provider fetch, recovery, and downstream publication unchanged.

- [ ] **Step 4: Run static verification**

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-fred-banking.mjs
git diff --check
git diff --name-only
```

Expected: manifest reports `ok`; syntax and diff checks exit zero; only the two implementation files are listed.

- [ ] **Step 5: Run one temporary low-load behavior smoke**

Run:

```bash
/usr/bin/time -lp node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const helper = path.resolve("scripts/stage-lane-manifest.sh");
const workflow = ".github/workflows/fetch-fred-banking.yml";
const present = "data/admin/fred_banking/index.json";
const absent = "data/admin/fred_banking/lkg/daily.json";
const digest = "fred-banking-low-load-smoke";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fred-banking-stage-smoke-"));

try {
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema_version: "lane-commit-manifest/v1",
    registry_schema: "lane-registry/v3",
    registry_digest: digest,
    workflows: {
      [workflow]: {
        exclude: [],
        stages: {
          always_if_exists: [
            { path: present, kind: "file", required: false },
            { path: absent, kind: "file", required: false },
          ],
        },
      },
    },
  }));
  const presentPath = path.join(root, present);
  fs.mkdirSync(path.dirname(presentPath), { recursive: true });
  fs.writeFileSync(presentPath, "{}\n");
  const result = spawnSync("bash", [
    helper,
    "--repo-root", root,
    "--manifest", manifestPath,
    "--workflow", workflow,
    "--stage", "always_if_exists",
    "--expected-digest", digest,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  assert.deepEqual(staged, [present]);
  console.log("fred-banking-low-load-smoke: ok (present stages, absent skips)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
NODE
```

Expected output:

```text
fred-banking-low-load-smoke: ok (present stages, absent skips)
```

Measure with `/usr/bin/time -lp`; require zero swaps and no repository changes.

- [ ] **Step 6: Commit only the bounded implementation**

```bash
git add -- .github/workflows/fetch-fred-banking.yml scripts/test-fetch-fred-banking.mjs
git commit -m "refactor: deduplicate FRED banking staging"
```

Do not push or dispatch the workflow. Natural scheduled publication proof remains not verified until observed.
