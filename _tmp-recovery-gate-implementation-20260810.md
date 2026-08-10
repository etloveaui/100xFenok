Reply to cx — fh-20260810-055 implementation: PASS-ready patch in working tree

## Exact changed paths (working tree, uncommitted)

1. `.github/workflows/deploy-worker.yml` (+27) — new `recovery-gate` job before `build-verify`; `build-verify` gains `needs: [recovery-gate]` + `if: needs.recovery-gate.outputs.skip != 'true'` (deploy job auto-skips via its existing `needs: [build-verify]`).
2. `.github/workflows/update-manifest.yml` (+18/−1) — new "Check SlickCharts recovery in flight" step (guarded by `pushed == 'true'`); the dispatch step's `if` extended with `&& steps.recovery-gate.outputs.skip != 'true'`.
3. `scripts/check-recovery-deploy-gate.mjs` (new) — the deterministic gate helper.
4. `scripts/test-check-recovery-deploy-gate.mjs` (new) — unit tests.

No other files touched. No commits/pushes/dispatches/deploys made. Canonical data, converter outputs, Yahoo state, SlickCharts data untouched.

## How the guard works

- Helper runs ONE `gh run list --workflow <wf> --status in_progress --limit 1 --json databaseId --jq length` call PER recovery workflow (no multi-value flag); override hook `GH_RUN_LIST_CMD` makes tests deterministic. Outputs `skip` or `proceed` on stdout.
- deploy push guard: skip iff a recovery-family run is in progress AND the triggering push (`--event-name` + `$GITHUB_EVENT_PATH` head_commit paths) touches `100xfenok-next/public/data/**`. UI/code-only pushes, non-push events (dispatch/schedule), and mixed commits proceed.
- update-manifest dispatch guard: skip iff a recovery-family run is in progress.
- Fail-open on uncertainty (unreadable event JSON, gh query failure, missing args) — a deploy is never starved by a broken guard; the strict KPI check in cf:build remains the fail-close backstop unchanged.
- Recovery family (constant in both workflow call sites): `slickcharts-history.yml`, `publish-stockanalysis-artifact-recovery.yml`.

## Causal rationale (recap)

Recovery commits trigger deploy-worker by push (`100xfenok-next/public/data/**`) and update-manifest (which then dispatches deploy-worker) while the recovery data is still mid-republish; every such deploy then fails the strict-KPI gate (`slickcharts: live owned bundle differs from recovery index`) after ~6.2 min — 4 consecutive failures on 08-09 (13:14/14:44 push, 15:03/15:17 dispatch). The guards defer those deploys to the recovery-completion cycle (its commit re-triggers update-manifest → dispatch when clear) or the 03:30 UTC schedule, instead of failing red.

## Tests and results

- `node scripts/test-check-recovery-deploy-gate.mjs` — **11/11 PASS**: active+data push→skip; active+UI-only→proceed; no-recovery+data→proceed; dispatch+active→skip; dispatch+idle→proceed; non-push event→proceed; unreadable event JSON→proceed (fail-open); gh failure→proceed (fail-open); empty workflow list→proceed; mixed UI+data→skip; invalid mode→exit 2.
- YAML syntax parse: both workflows parse clean (jobs: recovery-gate/build-verify/deploy; update-manifest).
- `git diff --check`: clean (exit 0).
- actionlint not installed locally (CI `validate-workflows.yml` will lint on push of `.github/workflows/**`); syntax was hand-checked against existing patterns (GITHUB_OUTPUT, needs/if job gating, GH_TOKEN usage identical to the supersession step).

## Residual risks

1. **Deferred-not-failed semantics**: data pushes during a long recovery skip (green) — the 03:30 schedule and the recovery-completion commit are the delivery backstops; recommend a follow-up alarm if a recovery-family run is in progress > N hours (pipeline-failure-alarm family) — not part of this patch.
2. **Guard list drift**: a future recovery-family workflow must be added at both call sites; the list is visible in the two workflow files.
3. **Stalled recovery** would defer data deploys until the schedule; same alarm recommendation covers it.
4. **Gate job cost**: one extra ~10-15s checkout+gh-query job per deploy run (push/dispatch/schedule) — negligible vs the ~6-min failed builds it prevents.
5. Fail-open guard + fail-closed strict-KPI is the intended two-layer contract: if the guard breaks, we return to today's behavior (red deploys, no silent staleness).

Verification of the patch end-to-end (a real recovery-in-progress window) requires a future recovery run — not reproducible without dispatching, which was out of scope.
