Reply to cx — fh-20260810-086 Sol/Luna correction: exact diff + all tests re-run

## Corrections applied (working tree, uncommitted)

### 1. workflow_run trigger — display names (blocking defect fixed)
`.github/workflows/deploy-worker.yml`:
```yaml
  # NOTE: workflow_run.workflows matches the workflows' DISPLAY names (name:),
  # not their file names.
  workflow_run:
    workflows: ["SlickCharts History", "Publish StockAnalysis Artifact Recovery"]
    types: [completed]
```
Display names verified from the files: `slickcharts-history.yml → name: SlickCharts History`; `publish-stockanalysis-artifact-recovery.yml → name: Publish StockAnalysis Artifact Recovery`.

### 2. Truncation evidence — payload-derived, not hard-coded
`scripts/check-recovery-deploy-gate.mjs` — removed `PUSH_COMMITS_TRUNCATION_LIMIT = 20`; `classifyPush` now:
```js
const size = typeof event.size === "number" ? event.size : null;
const commitsArrayTruncated = size !== null && commits.length < size;
const fileListsTruncated = commits.some((c) => c && Array.isArray(c.modified) === false && Array.isArray(c.added) === false && Array.isArray(c.removed) === false);
const truncated = commitsArrayTruncated || fileListsTruncated;
```
Conservative skip retained on demonstrated uncertainty (size > delivered commits, or delivered commits missing their path lists).

### 3. Contract test — exact display-name matching
`scripts/test-recovery-workflow-contract.mjs`:
- asserts the trigger contains `SlickCharts History` and `Publish StockAnalysis Artifact Recovery` + `types: [completed]`;
- asserts the FILE names are NOT in the trigger (`doesNotMatch` on `workflows: [slickcharts-history.yml` and `...publish-stockanalysis-artifact-recovery.yml`) — a silent no-match guard;
- new cross-check: the display names equal the files' `name:` fields.

## Tests re-run (all green)

| suite | result |
|---|---|
| `node scripts/test-check-recovery-deploy-gate.mjs` | **24/24 PASS** — status matrix (queued/requested/waiting/pending/in_progress→skip, completed/empty→proceed), push classification (head data→skip, earlier-commit data→skip, UI-only→proceed, truncated size>delivered→skip, complete size==delivered→proceed, missing file lists→skip), workflow_run 4, uncertainty 4, hard error 1 |
| `node scripts/test-recovery-workflow-contract.mjs` | **10/10 PASS** — incl. new display-name trigger assertions + name: field cross-check |
| `node --check` × 3 scripts | OK |
| YAML parse (pyyaml) of the 4 touched workflows | OK |
| `git diff --check` | clean |

## Exact changed paths (unchanged set from the Luna repair)

1. `.github/workflows/deploy-worker.yml` (M)
2. `.github/workflows/update-manifest.yml` (M)
3. `.github/workflows/publish-stockanalysis-artifact-recovery.yml` (M)
4. `scripts/check-recovery-deploy-gate.mjs` (new)
5. `scripts/test-check-recovery-deploy-gate.mjs` (new)
6. `scripts/test-recovery-workflow-contract.mjs` (new)

No commits/pushes/dispatches/deploys. Nothing else touched.
