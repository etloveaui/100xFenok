Reply to cx — fh-20260810-075 Luna repair: PASS-ready patch in working tree

## Exact changed paths (uncommitted)

1. `.github/workflows/deploy-worker.yml` (M) — workflow_run requeue trigger; recovery-gate job (permissions contents:read/actions:read, hardened shell with case mapping); build-verify needs/if gating; deploy-job race re-check step (SUPERSEDED semantics).
2. `.github/workflows/update-manifest.yml` (M) — dispatch guard hardened (set -euo pipefail + case mapping + proceed-uncertain → ::warning::).
3. `.github/workflows/publish-stockanalysis-artifact-recovery.yml` (M) — `actions: read` → `actions: write` (it dispatches update-manifest via `gh workflow run update-manifest.yml --ref main`).
4. `scripts/check-recovery-deploy-gate.mjs` (new) — repaired helper.
5. `scripts/test-check-recovery-deploy-gate.mjs` (new) — 23 deterministic unit tests.
6. `scripts/test-recovery-workflow-contract.mjs` (new) — 9 workflow-level contract tests.

No commits/pushes/dispatches/deploys; canonical data, converter outputs, Yahoo/SlickCharts state untouched; unrelated dirty files preserved.

## Luna correction → fix mapping

1. **Guaranteed recovery-completion requeue**: deploy-worker.yml now has `workflow_run: workflows: [slickcharts-history.yml, publish-stockanalysis-artifact-recovery.yml], types: [completed]`. The gate handles the event: conclusion != success → skip (defer, no red); conclusion == success → skip only if a SIBLING recovery is still nonterminal, else proceed. Proven: unit tests "workflow_run success + sibling in flight → skip" and "workflow_run success + no sibling → proceed" + contract test 4 (trigger wiring).
2. **All nonterminal statuses**: helper now queries `gh run list --workflow <wf> --limit 100 --json status` per workflow (no multi-value flag) and treats {queued, requested, waiting, pending, in_progress} as nonterminal. Tested individually (5 statuses → skip; completed/empty → proceed).
3. **Full push classification**: aggregates `event.commits[].{modified,added,removed}` plus `head_commit`; a data path in an EARLIER non-head commit is detected (test: "earlier (non-head) commit data path → skip"). Documented safe behavior for truncation: commits array at GitHub's 20-entry cap OR any commit missing its file-list keys → treated as data-touching → skip (conservative defer; requeue/schedule are the backstops). Tested (truncated → skip, no-file-lists commit → skip).
4. **Check-then-start race**: new "Re-check recovery gate" step in the deploy job, placed after "Skip deploy if superseded" and gated on `env.SUPERSEDED != 'true'`; a skip sets `SUPERSEDED=true` so every downstream step already keyed on it defers — no new cancellation semantics, existing supersession/source-fence untouched. Tested via contract test 6 + unit coverage of the shared helper.
5. **Permissions**: publish-stockanalysis-artifact-recovery.yml → actions: write (contract tests 1-3 assert the dispatch + permission pair, and that actions: read is gone). deploy-worker recovery-gate job explicitly grants contents: read + actions: read (contract test 5). slickcharts-history.yml already had actions: write (contract test 9).
6. **Hard errors surface**: all three call sites run `set -euo pipefail`; a helper exit 2 fails the step (fail-closed, never converted to proceed). Provider/payload uncertainty returns the distinct token `proceed-uncertain`, mapped to `::warning::` in the workflow (visible in run logs); strict KPI remains the final fail-close backstop. Tested: gh failure → proceed-uncertain, unreadable event → proceed-uncertain, invalid mode → exit 2.

## Tests and results

- `node scripts/test-check-recovery-deploy-gate.mjs` — **23/23 PASS** (status matrix 5+3, push classification 6, workflow_run 4, uncertainty 4, hard error 1).
- `node scripts/test-recovery-workflow-contract.mjs` — **9/9 PASS**.
- `node --check` on all three scripts — OK.
- YAML parse (pyyaml) of the 4 touched workflow files — OK (jobs/on structure intact).
- `git diff --check` — clean.

## Residual risks

1. **Workflow-run trigger semantics**: `workflow_run` fires for every completed run of the two recovery workflows on the default branch; the gate filters conclusion != success → skip. First live confirmation requires an actual recovery run (not reproducible without dispatching; out of scope).
2. **Guard list drift**: the recovery-family list is duplicated at 4 call sites (2 workflow steps + 2 helper invocations); the contract test asserts the trigger list matches, but a future third recovery workflow must be added everywhere.
3. **Truncated-payload conservative skip**: a >20-commit push during a recovery defers the deploy even if UI-only — rare, documented, requeued by workflow_run/schedule.
4. **proceed-uncertain window**: if gh is briefly unavailable, deploys proceed with a warning and rely on strict KPI — same two-layer contract as designed.
5. **Stalled recovery**: data deploys defer until the completion requeue or 03:30 schedule; the earlier recommended recovery-duration alarm (pipeline-failure-alarm family) is still a follow-up, not part of this patch.
