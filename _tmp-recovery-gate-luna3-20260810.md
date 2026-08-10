Reply to cx — fh-20260810-094 Luna v3 repair: PASS-ready, exact diff

## Corrections applied (working tree, uncommitted; same 6-file ownership set)

### 1. Real changed-path source — bounded GitHub compare query
`scripts/check-recovery-deploy-gate.mjs`:
- Removed the commit-object path classification entirely (real Actions push commit objects do not reliably carry added/removed/modified).
- Push changed paths now come from a bounded compare API query:
  `gh api repos/{repository.full_name}/compare/{before}...{after} --jq '{total_commits, files: [.files[].filename]}'`
  (env override `GH_COMPARE_CMD` for deterministic tests).
- Explicit truncation evidence: the compare `files` array reaching GitHub's 300-entry cap → demonstrated uncertainty → conservative skip. UI-only paths verified through the compare → proceed. Provider/parse failure or a push event missing repository/before/after → `proceed-uncertain` (surfaced).
- Tests model production-faithful push payloads: commit objects WITHOUT path arrays; classification comes only from the stubbed compare resolver (data→skip, UI-only→proceed, 300-cap→skip, compare failure/malformed/missing-event-fields→proceed-uncertain).

### 2. Final requeue guarantee (workflow_run)
`decide()` workflow_run branch now:
- While ANY recovery workflow is nonterminal → every completion (success or not) is gated (`skip`).
- Once NO recovery remains nonterminal → proceed **regardless of the last completion's conclusion**; a non-success/missing conclusion is surfaced as an explicit warning and strict KPI remains the fail-close backstop.
- This covers the lost-requeue case: A succeeds while B active → skip; B later fails/cancels with nothing else running → B's completion proceeds.
- Acceptance coverage added: `workflow_run success + sibling nonterminal → skip`; `workflow_run failure + no sibling → proceed`; `workflow_run cancelled + no sibling → proceed`; `missing conclusion + no sibling → proceed (warning)`; `status-query uncertainty → proceed-uncertain`.

### 3. No windowed blind spot
`recoveryActive()` now issues one `gh run list --workflow <wf> --status <s> --limit 1 --json databaseId --jq length` query per (workflow × status) for {queued, requested, waiting, pending, in_progress} — 10 bounded calls, no 100-run scan. Malformed output (non-integer/non-negative) or query failure → `null` → `proceed-uncertain` (never silently filtered to idle). Tests: each of the 5 statuses active → skip; all idle → proceed; malformed → proceed-uncertain; failure → proceed-uncertain.

Retained unchanged: display-name trigger (`["SlickCharts History", "Publish StockAnalysis Artifact Recovery"]` + filename-absent guard + name: cross-check in the contract test), permissions fixes (recovery actions: write; gate job contents/actions read), second deploy-job re-check (SUPERSEDED semantics), set -euo pipefail + case mapping (hard errors fail the step; proceed-uncertain → ::warning::), strict KPI untouched.

## Results

| suite | result |
|---|---|
| `node scripts/test-check-recovery-deploy-gate.mjs` | **24/24 PASS** |
| `node scripts/test-recovery-workflow-contract.mjs` | **10/10 PASS** |
| `node --check` × 3 | OK |
| YAML parse (pyyaml) × 4 workflows | OK |
| `git diff --check` | clean |

## Exact changed paths

1. `.github/workflows/deploy-worker.yml` (M)
2. `.github/workflows/update-manifest.yml` (M)
3. `.github/workflows/publish-stockanalysis-artifact-recovery.yml` (M)
4. `scripts/check-recovery-deploy-gate.mjs` (new)
5. `scripts/test-check-recovery-deploy-gate.mjs` (new)
6. `scripts/test-recovery-workflow-contract.mjs` (new)

No commits/pushes/dispatches/deploys. Nothing else touched.

## Residual risks

1. The compare query needs `actions: read` scope on the gate job (already granted) and the same on the deploy-job re-check step (deploy job runs with the workflow's default token — the existing supersession step already uses gh there, so scope is proven).
2. A >300-file push during a recovery defers (documented uncertainty) — requeued by the final-completion proceed or the 03:30 schedule.
3. First live validation of the requeue semantics requires a real recovery run (not reproducible without dispatching; out of scope).
