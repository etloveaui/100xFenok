# DefiLlama Staging Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove DefiLlama's duplicate manual staging while preserving optional administrative skips and required canonical failure.

**Architecture:** Keep the current registry, generated manifest, and staging helper unchanged. Remove only the workflow's parallel manual staging and three obsolete path-literal assertions already covered by the shared staging contracts.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, generated JSON manifest, Bash staging helper.

---

### Task 1: Make DefiLlama helper staging authoritative

**Files:**
- Modify: `.github/workflows/fetch-defillama.yml`
- Modify: `scripts/test-fetch-defillama.mjs`

- [ ] **Step 1: Recheck the safety boundary**

```bash
uptime
git status --short
git rev-parse HEAD
```

Proceed only with a clean tree and one-minute load at most 12. Do not run a build, broad test, network request, workflow dispatch, or deployment.

- [ ] **Step 2: Delete only the obsolete literal assertions**

Remove these three assertions from the existing workflow contract block:

```js
assert.match(workflow, new RegExp(`detection-attempts/${DEFILLAMA_LANE_ID}\\.json`));
assert.match(workflow, new RegExp(`data/admin/${DEFILLAMA_LANE_ID}/index\\.json`));
assert.match(workflow, new RegExp(`data/admin/${DEFILLAMA_LANE_ID}/lkg/stablecoins\\.json`));
```

Keep the helper-call, stage-condition, commit-step, registry-completeness, and generic manifest staging contracts. Add no assertion, test file, or suite.

- [ ] **Step 3: Remove only the duplicate workflow staging**

Keep this final staging shape:

```yaml
          scripts/stage-lane-manifest.sh \
            --workflow .github/workflows/fetch-defillama.yml \
            --stage always_if_exists
          if [[ "$FETCH_OUTCOME" == "success" ]]; then
            # Select the success policy independently; never flatten it into
            # the always/recovery stage above.
            scripts/stage-lane-manifest.sh \
              --workflow .github/workflows/fetch-defillama.yml \
              --stage success_if_exists
          fi
```

Remove the legacy pilot comment, `SHARD`, three manual administrative adds, and the canonical manual add. Keep all provider, recovery, commit, push, and publication steps unchanged.

- [ ] **Step 4: Run static verification**

```bash
node scripts/build-lane-commit-manifest.mjs --check
node --check scripts/test-fetch-defillama.mjs
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
const workflow = ".github/workflows/fetch-defillama.yml";
const presentAdmin = "data/admin/defillama_stablecoins/index.json";
const absentAdmin = "data/admin/defillama_stablecoins/lkg/stablecoins.json";
const canonical = "data/macro/stablecoins.json";
const digest = "defillama-low-load-smoke";

function fixture(withCanonical) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "defillama-stage-smoke-"));
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
            { path: presentAdmin, kind: "file", required: false },
            { path: absentAdmin, kind: "file", required: false },
          ],
          success_if_exists: [
            { path: canonical, kind: "file", required: true },
          ],
        },
      },
    },
  }));
  for (const relative of [presentAdmin, ...(withCanonical ? [canonical] : [])]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{}\n");
  }
  return { root, manifestPath };
}

function run({ root, manifestPath }, stage) {
  return spawnSync("bash", [
    helper,
    "--repo-root", root,
    "--manifest", manifestPath,
    "--workflow", workflow,
    "--stage", stage,
    "--expected-digest", digest,
  ], { cwd: root, encoding: "utf8" });
}

function staged(root) {
  return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
}

const healthy = fixture(true);
try {
  assert.equal(run(healthy, "always_if_exists").status, 0);
  assert.equal(run(healthy, "success_if_exists").status, 0);
  assert.deepEqual(staged(healthy.root), [canonical, presentAdmin].sort());
} finally {
  fs.rmSync(healthy.root, { recursive: true, force: true });
}

const missing = fixture(false);
try {
  assert.equal(run(missing, "always_if_exists").status, 0);
  assert.deepEqual(staged(missing.root), [presentAdmin]);
  const failed = run(missing, "success_if_exists");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /required file is missing/);
  assert.deepEqual(staged(missing.root), [presentAdmin]);
} finally {
  fs.rmSync(missing.root, { recursive: true, force: true });
}

console.log("defillama-low-load-smoke: ok");
NODE
```

Use `/usr/bin/time -lp`; require output `defillama-low-load-smoke: ok`, zero swaps, temporary-directory cleanup, and no repository changes.

- [ ] **Step 6: Commit only the bounded implementation**

```bash
git add -- .github/workflows/fetch-defillama.yml scripts/test-fetch-defillama.mjs
git commit -m "refactor: deduplicate DefiLlama staging"
```

Do not push or dispatch the workflow. Natural scheduled publication proof remains not verified until observed.
